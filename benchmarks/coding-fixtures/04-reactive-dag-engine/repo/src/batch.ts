let batchDepth = 0;
const deferredCallbacks: Array<() => void> = [];

export function isInBatch(): boolean {
  return batchDepth > 0;
}

export function scheduleNotification(fn: () => void): void {
  if (batchDepth > 0) {
    deferredCallbacks.push(fn);
  } else {
    fn();
  }
}

export function batch<T>(fn: () => T): T {
  batchDepth += 1;
  try {
    return fn();
  } finally {
    batchDepth -= 1;
    if (batchDepth === 0) {
      // BUG: fires uncoalesced callbacks directly without glitch-free topological propagation
      const pending = deferredCallbacks.splice(0, deferredCallbacks.length);
      for (const cb of pending) {
        cb();
      }
    }
  }
}
