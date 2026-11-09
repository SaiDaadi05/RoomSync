/**
 * Split engine shared by the server (authoritative) and the expense form (live preview).
 * Every function returns integer cents that sum EXACTLY to the total.
 */
import { splitEqually } from "./money";

/**
 * Divide `total` cents in proportion to non-negative integer `weights`, using the
 * largest-remainder method. Leftover cents go to the largest fractional parts, ties to
 * the earlier person, so the result is deterministic and sums exactly to `total`.
 */
export function allocateByWeights(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum <= 0) throw new Error("Weights must add up to more than zero");
  const exact = weights.map((w) => (total * w) / sum);
  const out = exact.map(Math.floor);
  let left = total - out.reduce((s, c) => s + c, 0);
  const order = exact.map((x, i) => ({ i, frac: x - Math.floor(x) })).filter((o) => weights[o.i] > 0)
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k].i]++;
  return out;
}

export type SplitItem = { name: string; amountCents: number; userIds: string[] };

/**
 * Itemized split: each item is shared equally by the people on it. Anything left over
 * (tax, tip, delivery fee) is shared in proportion to what each person's items cost.
 */
export function itemizedSplit(total: number, items: SplitItem[]): Map<string, number> {
  const per = new Map<string, number>();
  const add = (id: string, c: number) => per.set(id, (per.get(id) ?? 0) + c);
  let itemsSum = 0;
  for (const item of items) {
    itemsSum += item.amountCents;
    splitEqually(item.amountCents, item.userIds.length).forEach((c, i) => add(item.userIds[i], c));
  }
  const extra = total - itemsSum;
  if (extra < 0) throw new Error("Items add up to more than the total");
  if (extra > 0) {
    const ids = [...per.keys()];
    allocateByWeights(extra, ids.map((id) => per.get(id)!)).forEach((c, i) => add(ids[i], c));
  }
  return per;
}

/** "12.5" → 1250 basis points (percent × 100). Null if not a valid percent with ≤ 2 decimals. */
export function parsePercent(s: string): number | null {
  const t = s.trim().replace(/%$/, "");
  if (!/^\d{1,3}(\.\d{0,2})?$/.test(t)) return null;
  const [w, f = ""] = t.split(".");
  return Number(w) * 100 + Number((f + "00").slice(0, 2));
}
