from .bucket import CostExceedsCapacityError, Decision, TokenBucketLimiter
from .sliding import SlidingWindowLimiter


RateLimiterTier = TokenBucketLimiter | SlidingWindowLimiter


class HierarchicalLimiter:
    """
    Applies a sequence of rate limit tiers (for example: per-tenant tier followed
    by shared global tier). A request is allowed only if EVERY tier allows it;
    rejected requests must not leak quota from any tier.
    """

    def __init__(self, tiers: list[RateLimiterTier]) -> None:
        if not tiers:
            raise ValueError("tiers must not be empty")
        self.tiers = list(tiers)

    def acquire(self, cost: int = 1) -> Decision:
        # BUG: deducts from earlier tiers before verifying downstream tiers allow it!
        decisions: list[Decision] = []
        for tier in self.tiers:
            d = tier.allow(cost)
            decisions.append(d)
            if not d.allowed:
                return Decision(
                    allowed=False,
                    remaining=d.remaining,
                    retry_after=d.retry_after,
                )

        return Decision(
            allowed=True,
            remaining=min(d.remaining for d in decisions),
            retry_after=0.0,
        )
