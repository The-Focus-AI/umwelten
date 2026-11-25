import assert from "node:assert/strict";
import test from "node:test";
import {
  addTax,
  calculateInvoiceSummary,
  formatMoney,
  fromMajor,
  splitByWeights,
} from "../src/index.ts";

test("basic even USD split and whole-dollar tax", () => {
  const total = fromMajor(100, "usd");
  const shares = splitByWeights(total, [1, 1]);
  assert.deepEqual(shares, [
    { minor: 5000, currency: "USD" },
    { minor: 5000, currency: "USD" },
  ]);

  const taxed = addTax(fromMajor(200, "USD"), 1000);
  assert.equal(formatMoney(taxed), "USD 220.00");

  const summary = calculateInvoiceSummary(
    [{ description: "Widget", quantity: 2, unitPriceMajor: 50 }],
    { currency: "USD", taxBps: 500 },
  );
  assert.equal(summary.total.minor, 10500);
});
