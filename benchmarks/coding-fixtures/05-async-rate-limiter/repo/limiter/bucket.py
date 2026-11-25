from dataclasses import dataclass
import time
from .clock import Clock, MonotonicClock


class CostExceedsCapacityError(ValueError):
    pass


@dataclass(frozen=True)
class Decision:
    allowed: bool
    remaining: float
    retry_after: float


class TokenBucketLimiter:
    def __init__(
        self,
        capacity: float,
        refill_rate: float,
        clock: Clock | None = None,
    ) -> None:
        if capacity <= 0:
            raise ValueError("capacity must be positive")
        if refill_rate <= 0:
            raise ValueError("refill_rate must be positive")
        self.capacity = float(capacity)
        self.refill_rate = float(refill_rate)
        self.clock: Clock = clock if clock is not None else MonotonicClock()
        self._tokens = float(capacity)
        # BUG: mixes time.time() with injected clock
        self._last_refill = time.time()

    def _refill(self) -> None:
        now = time.time()  # BUG: ignores self.clock.time()
        elapsed = now - self._last_refill
        if elapsed > 0:
            self._tokens = min(self.capacity, self._tokens + elapsed * self.refill_rate)
            self._last_refill = now

    def can_acquire(self, cost: float = 1.0) -> bool:
        self._refill()
        return self._tokens >= cost

    def allow(self, cost: float = 1.0) -> Decision:
        # BUG: does not validate cost < 0 or cost > capacity
        self._refill()
        if self._tokens >= cost:
            self._tokens -= cost
            return Decision(allowed=True, remaining=self._tokens, retry_after=0.0)
        deficit = cost - self._tokens
        return Decision(
            allowed=False,
            remaining=self._tokens,
            retry_after=deficit / self.refill_rate,
        )
