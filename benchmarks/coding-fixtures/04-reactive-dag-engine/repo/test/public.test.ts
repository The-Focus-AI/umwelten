import assert from "node:assert/strict";
import test from "node:test";
import { batch, computed, signal } from "../src/index.ts";

test("basic linear chain computes and notifies subscribers", () => {
  const base = signal(2);
  const doubled = computed(() => base.get() * 2);
  const plusOne = computed(() => doubled.get() + 1);

  assert.equal(plusOne.get(), 5);

  const seen: number[] = [];
  plusOne.subscribe((v) => seen.push(v));

  base.set(5);
  assert.equal(plusOne.get(), 11);
  assert.deepEqual(seen, [11]);

  batch(() => {
    base.set(10);
  });
  assert.equal(plusOne.get(), 21);
});
