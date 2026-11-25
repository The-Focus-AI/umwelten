import assert from "node:assert/strict";
import test from "node:test";
import { batch, computed, signal, type Computed } from "../src/index.ts";

test("diamond dependency updates glitch-free in single evaluation per change", () => {
  const a = signal(1);
  const b = computed(() => a.get() * 2);
  const c = computed(() => a.get() + 10);

  const observedPairs: Array<[number, number]> = [];
  const d = computed(() => {
    const bv = b.get();
    const cv = c.get();
    observedPairs.push([bv, cv]);
    // Invariant: c === b/2 + 10 always holds if glitch-free
    return `${bv}:${cv}`;
  });

  const subEvents: string[] = [];
  d.subscribe((v) => subEvents.push(v));

  const countBefore = d.recomputeCount;
  a.set(5);
  assert.equal(d.get(), "10:15");
  assert.equal(d.recomputeCount - countBefore, 1);
  assert.deepEqual(observedPairs[observedPairs.length - 1], [10, 15]);
  // Never observed inconsistent intermediate pair [10, 11] or [2, 15]
  for (const [bv, cv] of observedPairs) {
    assert.equal(cv, bv / 2 + 10, `saw glitch pair [${bv}, ${cv}]`);
  }
  assert.deepEqual(subEvents, ["10:15"]);
});

test("batch coalesces multi-signal updates into a single glitch-free evaluation", () => {
  const x = signal(1);
  const y = signal(2);
  const z = computed(() => x.get() + y.get());
  const snapshots: number[] = [];
  z.subscribe((v) => snapshots.push(v));

  const before = z.recomputeCount;
  batch(() => {
    x.set(10);
    y.set(20);
  });

  assert.equal(z.get(), 30);
  assert.equal(z.recomputeCount - before, 1);
  assert.deepEqual(snapshots, [30]);
});

test("dynamic conditional computed drops stale upstream subscriptions", () => {
  const useA = signal(true);
  const a = signal(1);
  const b = signal(100);

  const branch = computed(() => (useA.get() ? a.get() : b.get()));
  assert.equal(branch.get(), 1);

  useA.set(false);
  assert.equal(branch.get(), 100);

  const countAfterSwitch = branch.recomputeCount;
  // Updating `a` while `useA` is false MUST NOT trigger recomputation of `branch`
  a.set(999);
  assert.equal(branch.get(), 100);
  assert.equal(branch.recomputeCount, countAfterSwitch);

  // Updating `b` DOES trigger recomputation
  b.set(200);
  assert.equal(branch.get(), 200);
  assert.equal(branch.recomputeCount, countAfterSwitch + 1);
});

test("dynamic dependency release allows safely reversing edge direction without false cycle", () => {
  const mode = signal(true);
  let outer!: Computed<number>;
  const inner = computed(() => (mode.get() ? 0 : outer.get() + 1));
  outer = computed(() => (mode.get() ? inner.get() + 10 : 7));

  assert.equal(outer.get(), 10);
  assert.equal(inner.get(), 0);

  // When mode flips to false, outer drops inner and inner now reads outer cleanly
  mode.set(false);
  assert.equal(outer.get(), 7);
  assert.equal(inner.get(), 8);
});

test("recovers cleanly after a cycle error without leaving nodes wedged", () => {
  const triggerCycle = signal(false);
  let nodeB!: Computed<number>;
  const nodeA: Computed<number> = computed(() =>
    triggerCycle.get() ? nodeB.get() + 1 : 10,
  );
  nodeB = computed(() => nodeA.get() * 2);

  assert.equal(nodeA.get(), 10);
  assert.equal(nodeB.get(), 20);

  assert.throws(() => {
    triggerCycle.set(true);
    nodeA.get();
    nodeB.get();
  }, /cycle/i);

  // Reverting condition restores valid DAG cleanly
  triggerCycle.set(false);
  assert.equal(nodeA.get(), 10);
  assert.equal(nodeB.get(), 20);
});
