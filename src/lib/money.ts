/** Money helpers. All amounts are integer cents. */

export function parseMoneyToCents(input: string | number): number {
  const s = String(input).trim().replace(/[$,\s]/g, "");
  if (!/^-?\d+(\.\d{0,2})?$/.test(s)) throw new Error("Enter an amount like 12.34");
  const negative = s.startsWith("-");
  const [whole, frac = ""] = s.replace("-", "").split(".");
  const cents = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  if (!Number.isSafeInteger(cents)) throw new Error("Amount is too large");
  return negative ? -cents : cents;
}

export function formatCents(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

/**
 * Split `total` cents equally among `n` people. Remainder cents go to the first
 * people in the list, so the parts always sum exactly to the total.
 */
export function splitEqually(total: number, n: number): number[] {
  if (!Number.isInteger(total) || total <= 0) throw new Error("Total must be a positive number of cents");
  if (!Number.isInteger(n) || n <= 0) throw new Error("At least one participant is required");
  const base = Math.floor(total / n);
  const remainder = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0));
}
