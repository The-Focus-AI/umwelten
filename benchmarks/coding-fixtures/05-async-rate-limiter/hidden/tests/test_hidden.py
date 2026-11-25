import unittest
from limiter import (
    CostExceedsCapacityError,
    HierarchicalLimiter,
    SlidingWindowLimiter,
    TokenBucketLimiter,
    VirtualClock,
)


class HiddenRateLimiterTest(unittest.TestCase):
    def test_token_bucket_uses_injected_virtual_clock(self) -> None:
        clock = VirtualClock(1000.0)
        tb = TokenBucketLimiter(capacity=5.0, refill_rate=1.0, clock=clock)
        self.assertTrue(tb.allow(5.0).allowed)
        denied = tb.allow(2.0)
        self.assertFalse(denied.allowed)
        self.assertAlmostEqual(denied.retry_after, 2.0, places=5)

        clock.advance(2.0)
        retried = tb.allow(2.0)
        self.assertTrue(retried.allowed)
        self.assertAlmostEqual(retried.remaining, 0.0, places=5)

    def test_sliding_window_expires_at_exact_retry_after_boundary(self) -> None:
        clock = VirtualClock(0.0)
        sw = SlidingWindowLimiter(capacity=2, window_seconds=10.0, clock=clock)
        self.assertTrue(sw.allow(2).allowed)
        denied = sw.allow(1)
        self.assertFalse(denied.allowed)
        self.assertAlmostEqual(denied.retry_after, 10.0, places=5)

        clock.advance(denied.retry_after)
        self.assertTrue(sw.allow(1).allowed)

    def test_cost_validation_errors(self) -> None:
        clock = VirtualClock(0.0)
        tb = TokenBucketLimiter(capacity=4.0, refill_rate=1.0, clock=clock)
        with self.assertRaises(CostExceedsCapacityError):
            tb.allow(5.0)
        with self.assertRaises(ValueError):
            tb.allow(-1.0)

        sw = SlidingWindowLimiter(capacity=4, window_seconds=10.0, clock=clock)
        with self.assertRaises(CostExceedsCapacityError):
            sw.allow(5)
        with self.assertRaises(ValueError):
            sw.allow(-1)

    def test_hierarchical_acquire_is_atomic_on_downstream_rejection(self) -> None:
        clock = VirtualClock(0.0)
        tenant_a = SlidingWindowLimiter(capacity=5, window_seconds=10.0, clock=clock)
        tenant_b = SlidingWindowLimiter(capacity=5, window_seconds=10.0, clock=clock)
        global_lim = SlidingWindowLimiter(capacity=4, window_seconds=10.0, clock=clock)

        h_a = HierarchicalLimiter([tenant_a, global_lim])
        h_b = HierarchicalLimiter([tenant_b, global_lim])

        # Tenant B takes 3 of 4 global capacity
        self.assertTrue(h_b.acquire(3).allowed)

        # Tenant A wants 3 -> tenant_a has 5, but global only has 1 -> MUST reject atomically!
        rejected = h_a.acquire(3)
        self.assertFalse(rejected.allowed)
        self.assertGreater(rejected.retry_after, 0.0)

        # After global resets? Better: tenant_a STILL has all 5 quota intact when asking for 1!
        r_one = h_a.acquire(1)
        self.assertTrue(r_one.allowed)
        self.assertEqual(r_one.remaining, 0.0)  # global now 0, tenant_a had 5 - 1 = 4 left

        # Advance 10s -> if tenant_a had leaked 3 before, wait at t=10 everything clears;
        # verify without advancing: check tenant_a's remaining directly via second global!
        fresh_global = SlidingWindowLimiter(capacity=10, window_seconds=10.0, clock=clock)
        h_a_fresh = HierarchicalLimiter([tenant_a, fresh_global])
        # tenant_a started at 5, only the successful acquire(1) should have consumed 1 -> 4 left
        res4 = h_a_fresh.acquire(4)
        self.assertTrue(res4.allowed)
        self.assertEqual(res4.remaining, 0.0)

    def test_hierarchical_mixed_tiers_rollback_on_later_tier_rejection(self) -> None:
        clock = VirtualClock(0.0)
        tier1 = TokenBucketLimiter(capacity=10.0, refill_rate=1.0, clock=clock)
        tier2 = TokenBucketLimiter(capacity=3.0, refill_rate=1.0, clock=clock)
        hl = HierarchicalLimiter([tier1, tier2])

        self.assertTrue(hl.acquire(2).allowed)  # tier1=8, tier2=1
        denied = hl.acquire(2)  # tier2 only has 1 -> reject without touching tier1!
        self.assertFalse(denied.allowed)
        self.assertAlmostEqual(denied.retry_after, 1.0, places=5)
        # tier1 must still have all 8.0 remaining tokens (0 leaked on rejection)
        check = tier1.allow(8.0)
        self.assertTrue(check.allowed)
        self.assertAlmostEqual(check.remaining, 0.0, places=5)


if __name__ == "__main__":
    unittest.main()
