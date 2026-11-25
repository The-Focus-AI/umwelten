import unittest
from limiter import HierarchicalLimiter, SlidingWindowLimiter, TokenBucketLimiter, VirtualClock


class PublicRateLimiterTest(unittest.TestCase):
    def test_sliding_window_basic_quota(self) -> None:
        clock = VirtualClock(100.0)
        sw = SlidingWindowLimiter(capacity=3, window_seconds=10.0, clock=clock)
        self.assertTrue(sw.allow(2).allowed)
        self.assertTrue(sw.allow(1).allowed)
        self.assertFalse(sw.allow(1).allowed)
        clock.advance(11.0)
        self.assertTrue(sw.allow(1).allowed)

    def test_hierarchy_happy_path(self) -> None:
        clock = VirtualClock(0.0)
        tenant = SlidingWindowLimiter(capacity=5, window_seconds=10.0, clock=clock)
        global_lim = SlidingWindowLimiter(capacity=10, window_seconds=10.0, clock=clock)
        hl = HierarchicalLimiter([tenant, global_lim])
        res = hl.acquire(3)
        self.assertTrue(res.allowed)
        self.assertEqual(res.remaining, 2.0)


if __name__ == "__main__":
    unittest.main()
