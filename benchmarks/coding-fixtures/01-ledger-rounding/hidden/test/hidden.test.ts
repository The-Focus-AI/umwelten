import assert from "node:assert/strict";
import test from "node:test";
import {
  addMoney,
  addTax,
  calculateInvoiceSummary,
  calculateTax,
  currencyDecimals,
  formatMoney,
  fromMajor,
  splitByWeights,
  toMajor,
} from "../src/index.ts";

test("zero-decimal and three-decimal ISO currency scaling and formatting", () => {
  assert.equal(currencyDecimals("JPY"), 0);
  assert.equal(currencyDecimals("KRW"), 0);
  assert.equal(currencyDecimals("BHD"), 3);
  assert.equal(currencyDecimals("KWD"), 3);

  const yen = fromMajor(1500, "jpy");
  assert.equal(yen.minor, 1500);
  assert.equal(toMajor(yen), 1500);
  assert.equal(formatMoney(yen), "JPY 1500");

  const dinar = fromMajor(12.345, "KWD");
  assert.equal(dinar.minor, 12345);
  assert.equal(toMajor(dinar), 12.345);
  assert.equal(formatMoney(dinar), "KWD 12.345");
});

test("splitByWeights conserves exact minor units via largest remainder", () => {
  const shares = splitByWeights({ minor: 10000, currency: "USD" }, [1, 1, 1]);
  assert.equal(
    shares.reduce((s, x) => s + x.minor, 0),
    10000,
  );
  assert.deepEqual(
    shares.map((s) => s.minor),
    [3334, 3333, 3333],
  );

  // Larger remainder gets extra unit first regardless of weight order
  const weighted = splitByWeights({ minor: 10, currency: "USD" }, [1, 2, 1]);
  // exact: 2.5, 5.0, 2.5 -> remainders: 0.5, 0.0, 0.5 -> extras to idx 0 -> [3, 5, 2]
  assert.deepEqual(
    weighted.map((s) => s.minor),
    [3, 5, 2],
  );
});

test("splitByWeights handles negative credit notes without losing units or flipping sign", () => {
  const shares = splitByWeights({ minor: -100, currency: "USD" }, [1, 1, 1]);
  assert.equal(
    shares.reduce((s, x) => s + x.minor, 0),
    -100,
  );
  assert.deepEqual(
    shares.map((s) => s.minor),
    [-34, -33, -33],
  );

  const smallNeg = splitByWeights({ minor: -1, currency: "USD" }, [1, 2]);
  assert.equal(
    smallNeg.reduce((s, x) => s + x.minor, 0),
    -1,
  );
  for (const s of smallNeg) {
    assert.ok(s.minor <= 0, `expected non-positive share, got ${s.minor}`);
  }
});

test("tax rounding is half-away-from-zero and strictly symmetric for negative credits", () => {
  // 50 minor * 500 bps = 2.5 -> +3 ; -50 minor * 500 bps = -2.5 -> -3
  const pos = calculateTax({ minor: 50, currency: "USD" }, 500);
  const neg = calculateTax({ minor: -50, currency: "USD" }, 500);
  assert.equal(pos.minor, 3);
  assert.equal(neg.minor, -3);

  // 100 minor * 50 bps = 0.5 -> +1 ; -100 * 50 bps = -0.5 -> -1
  assert.equal(calculateTax({ minor: 100, currency: "USD" }, 50).minor, 1);
  assert.equal(calculateTax({ minor: -100, currency: "USD" }, 50).minor, -1);

  // 0 credit tax never yields -0
  const zeroTax = calculateTax({ minor: 0, currency: "USD" }, 500);
  assert.ok(!Object.is(zeroTax.minor, -0));
  assert.equal(formatMoney(zeroTax), "USD 0.00");

  const tinyNegTax = calculateTax({ minor: -1, currency: "USD" }, 10);
  assert.ok(!Object.is(tinyNegTax.minor, -0));
  assert.equal(tinyNegTax.minor, 0);
  assert.equal(formatMoney(tinyNegTax), "USD 0.00");

  assert.equal(addTax({ minor: -50, currency: "USD" }, 500).minor, -53);
});

test("invoice summary avoids floating-point drift on JPY and fractional quantities/discounts", () => {
  const jpyInv = calculateInvoiceSummary(
    [
      { description: "Ramen", quantity: 3, unitPriceMajor: 980 },
      { description: "Refund", quantity: -1, unitPriceMajor: 980 },
    ],
    { currency: "JPY", discountBps: 500, taxBps: 1000 },
  );
  // 2940 - 980 = 1960; discount 5% = 98; taxable = 1862; tax 10% = 186; total = 2048
  assert.equal(jpyInv.subtotal.minor, 1960);
  assert.equal(jpyInv.discount.minor, 98);
  assert.equal(jpyInv.taxableSubtotal.minor, 1862);
  assert.equal(jpyInv.tax.minor, 186);
  assert.equal(jpyInv.total.minor, 2048);

  // Classic 0.1 + 0.2 drift check
  const usdInv = calculateInvoiceSummary(
    [
      { description: "Item A", quantity: 1, unitPriceMajor: 0.1 },
      { description: "Item B", quantity: 1, unitPriceMajor: 0.2 },
    ],
    { currency: "USD", taxBps: 0 },
  );
  assert.equal(usdInv.total.minor, 30);

  // Combining addMoney across mixed cases normalizes currency
  const sum = addMoney({ minor: 10, currency: "usd" }, { minor: 20, currency: "USD" });
  assert.equal(sum.minor, 30);
  assert.equal(sum.currency, "USD");
});
