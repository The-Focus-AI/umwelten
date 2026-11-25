import { currencyDecimals, fromMajor, type Money } from "./money.ts";
import { calculateTax } from "./tax.ts";

export interface InvoiceLine {
  description: string;
  quantity: number;
  unitPriceMajor: number;
}

export interface InvoiceOptions {
  currency: string;
  discountBps?: number;
  taxBps?: number;
}

export interface InvoiceSummary {
  currency: string;
  subtotal: Money;
  discount: Money;
  taxableSubtotal: Money;
  tax: Money;
  total: Money;
}

export function calculateInvoiceSummary(
  lines: readonly InvoiceLine[],
  options: InvoiceOptions,
): InvoiceSummary {
  const currency = options.currency.toUpperCase();
  const scale = 10 ** currencyDecimals(currency);

  // BUG: accumulates floating point dollars instead of minor units
  let floatSubtotal = 0;
  for (const line of lines) {
    floatSubtotal += line.quantity * line.unitPriceMajor;
  }

  const subtotal: Money = fromMajor(floatSubtotal, currency);
  const discountRate = (options.discountBps ?? 0) / 10_000;
  const discountMinor = Math.round(floatSubtotal * scale * discountRate);
  const discount: Money = { minor: discountMinor, currency };
  const taxableSubtotal: Money = {
    minor: subtotal.minor - discount.minor,
    currency,
  };
  const tax = calculateTax(taxableSubtotal, options.taxBps ?? 0);
  const total: Money = {
    minor: taxableSubtotal.minor + tax.minor,
    currency,
  };

  return { currency, subtotal, discount, taxableSubtotal, tax, total };
}
