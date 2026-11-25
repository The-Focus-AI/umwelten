from collections import deque
from .bucket import CostExceedsCapacityError, Decision
from .clock import Clock, MonotonicClock


class SlidingWindowLimiter:
    def __init__(
        self,
        capacity: int,
        window_seconds: float,
        clock: Clock | None = None,
    ) -> None:
        if capacity <= 0:
            raise ValueError("capacity must be positive")
        if window_seconds <= 0:
            raise ValueError("window_seconds must be positive")
        self.capacity = int(capacity)
        self.window_seconds = float(window_seconds)
        self.clock: Clock = clock if clock is not None else MonotonicClock()
        self._events: deque[tuple[float, int]] = deque()
        self._used = 0

    def _prune(self, now: float) -> None:
        cutoff = now - self.window_seconds
        # BUG: keeps entries where ts == cutoff (`ts < cutoff` fails to expire exact boundary!)
        while self._events and self._events[0][0] < cutoff:
            _, c = self._events.popleft()
            self._used -= c

    def allow(self, cost: int = 1) -> Decision:
        # BUG: fails to raise CostExceedsCapacityError when cost > capacity (or ValueError on cost < 0)
        if not isinstance(cost, int):
            cost = int(cost)
        now = self.clock.time()
        self._prune(now)
        if self._used + cost <= self.capacity:
            self._events.append((now, cost))
            self._used += cost
            return Decision(
                allowed=True,
                remaining=float(self.capacity - self._used),
                retry_after=0.0,
            )

        need = (self._used + cost) - self.capacity
        freed = 0
        retry_at = now
        for ts, c in self._events:
            freed += c
            if freed >= need:
                retry_at = ts + self.window_seconds
                break
        return Decision(
            allowed=False,
            remaining=float(max(0, self.capacity - self._used)),
            retry_after=max(0.0, retry_at - now),
        )
