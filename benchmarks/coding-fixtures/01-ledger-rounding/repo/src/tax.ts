import type { Money } from "./money.ts";

/**
 * Compute tax using basis points (10000 bps = 100%, 825 bps = 8.25%).
 */
export function calculateTax(amount: Money, taxBps: number): Money {
  // BUG: floating-point multiplication + Math.round rounds -0.5 toward 0 (-0)
  const raw = amount.minor * (taxBps / 10_000);
  return {
    minor: Math.round(raw),
    currency: amount.currency.toUpperCase(),
  };
}

export function addTax(amount: Money, taxBps: number): Money {
  const tax = calculateTax(amount, taxBps);
  return {
    minor: amount.minor + tax.minor,
    currency: amount.currency.toUpperCase(),
  };
}
