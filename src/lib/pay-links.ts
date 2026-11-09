/**
 * Links that open a payment app with the recipient and amount filled in.
 * RoomSync never moves money: the person confirms the payment in that app, then records it here.
 */
export type PayHandles = { venmoHandle?: string | null; paypalHandle?: string | null; cashtag?: string | null };

const HANDLE = /^[A-Za-z0-9_-]{1,30}$/;

/** Strip a leading @ or $ and any profile-URL prefix; null if what's left isn't a plausible handle. */
export function cleanHandle(raw: string | null | undefined): string | null {
  let s = (raw ?? "").trim();
  if (!s) return null;
  s = s.replace(/^https?:\/\/(www\.)?(venmo\.com\/(u\/)?|paypal\.me\/|cash\.app\/)/i, "").replace(/^[@$]/, "").replace(/\/$/, "");
  return HANDLE.test(s) ? s : null;
}

export function payLinks(h: PayHandles, amountCents: number, note = "RoomSync") {
  const amount = (amountCents / 100).toFixed(2);
  const out: { app: "Venmo" | "PayPal" | "Cash App"; href: string }[] = [];
  const v = cleanHandle(h.venmoHandle);
  if (v) out.push({ app: "Venmo", href: `https://venmo.com/?txn=pay&recipients=${encodeURIComponent(v)}&amount=${amount}&note=${encodeURIComponent(note)}` });
  const p = cleanHandle(h.paypalHandle);
  if (p) out.push({ app: "PayPal", href: `https://paypal.me/${encodeURIComponent(p)}/${amount}` });
  const c = cleanHandle(h.cashtag);
  if (c) out.push({ app: "Cash App", href: "https://cash.app/$" + encodeURIComponent(c) + "/" + amount });
  return out;
}
