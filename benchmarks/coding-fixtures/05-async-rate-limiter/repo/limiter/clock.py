import time
from typing import Protocol


class Clock(Protocol):
    def time(self) -> float: ...


class MonotonicClock:
    def time(self) -> float:
        return time.monotonic()


class VirtualClock:
    def __init__(self, initial: float = 0.0) -> None:
        self._now = float(initial)

    def time(self) -> float:
        return self._now

    def advance(self, seconds: float) -> float:
        if seconds < 0:
            raise ValueError("Cannot advance virtual clock backwards")
        self._now += float(seconds)
        return self._now
