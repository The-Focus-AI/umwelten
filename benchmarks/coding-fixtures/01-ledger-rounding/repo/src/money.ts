export interface Money {
  readonly minor: number;
  readonly currency: string;
}

export function currencyDecimals(currency: string): number {
  void currency;
  // BUG: assumes every ISO currency has 2 decimal places
  return 2;
}

export function fromMajor(amount: number, currency: string): Money {
  const decimals = currencyDecimals(currency);
  const scale = 10 ** decimals;
  return {
    minor: Math.round(amount * scale),
    currency: currency.toUpperCase(),
  };
}

export function toMajor(m: Money): number {
  const scale = 10 ** currencyDecimals(m.currency);
  return m.minor / scale;
}

export function formatMoney(m: Money): string {
  const decimals = currencyDecimals(m.currency);
  const scale = 10 ** decimals;
  const val = (m.minor / scale).toFixed(decimals);
  return `${m.currency.toUpperCase()} ${val}`;
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency.toUpperCase() !== b.currency.toUpperCase()) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
  return {
    minor: a.minor + b.minor,
    currency: a.currency.toUpperCase(),
  };
}
