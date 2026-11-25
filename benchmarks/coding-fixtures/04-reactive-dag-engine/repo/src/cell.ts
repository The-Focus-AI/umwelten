import { scheduleNotification } from "./batch.ts";
import {
  getActiveConsumer,
  linkDependency,
  popConsumer,
  pushConsumer,
  type GraphNode,
} from "./graph.ts";
import { CycleError, type Computed, type Listener, type Signal } from "./types.ts";

let nextCellId = 1;

export function signal<T>(initialValue: T): Signal<T> {
  let value = initialValue;
  const listeners = new Set<Listener<T>>();

  const node: GraphNode = {
    id: nextCellId++,
    sources: new Set(),
    dependents: new Set(),
    onDependencyInvalidated() {
      // Signals are roots
    },
  };

  return {
    id: node.id,
    get(): T {
      const consumer = getActiveConsumer();
      if (consumer) {
        linkDependency(node, consumer);
      }
      return value;
    },
    set(next: T): void {
      if (Object.is(value, next)) return;
      value = next;
      // BUG: eager DFS push causes diamond glitches and doesn't clear stale deps / cycle flags cleanly
      for (const dep of [...node.dependents]) {
        dep.onDependencyInvalidated();
      }
      for (const listener of [...listeners]) {
        scheduleNotification(() => listener(value));
      }
    },
    subscribe(listener: Listener<T>): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function computed<T>(compute: () => T): Computed<T> {
  let value!: T;
  let initialized = false;
  let recomputes = 0;
  let evaluating = false;
  const listeners = new Set<Listener<T>>();

  const node: GraphNode = {
    id: nextCellId++,
    sources: new Set(),
    dependents: new Set(),
    onDependencyInvalidated() {
      evaluate();
      for (const dep of [...node.dependents]) {
        dep.onDependencyInvalidated();
      }
    },
  };

  function evaluate(): T {
    if (evaluating) {
      // BUG: forgets to clear `evaluating` on throw (no finally), wedging future reads permanently!
      throw new CycleError();
    }
    evaluating = true;
    // BUG: never unlinks prior sources before re-evaluating, causing stale dependency leaks
    pushConsumer(node);
    const next = compute();
    popConsumer();
    evaluating = false;

    recomputes += 1;
    const changed = !initialized || !Object.is(value, next);
    value = next;
    initialized = true;
    if (changed && recomputes > 1) {
      for (const listener of [...listeners]) {
        scheduleNotification(() => listener(value));
      }
    }
    return value;
  }

  evaluate();

  return {
    id: node.id,
    get recomputeCount(): number {
      return recomputes;
    },
    get(): T {
      const consumer = getActiveConsumer();
      if (consumer) {
        linkDependency(node, consumer);
      }
      if (evaluating) {
        throw new CycleError();
      }
      if (!initialized) {
        return evaluate();
      }
      return value;
    },
    subscribe(listener: Listener<T>): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
