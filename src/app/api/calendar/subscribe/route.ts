import { requireHousehold } from "@/server/session";
import { ensureFeed, webcalUrl } from "@/server/calendar/feed";

export const dynamic = "force-dynamic";

/**
 * One tap to subscribe: makes the caller's calendar link for the household they're viewing
 * if they don't have one yet, then hands it to the calendar app. ?app=google opens Google
 * Calendar's "add by URL" page instead. It never replaces an existing link and never shows
 * the link to anyone but the signed-in user, so a forged visit gains nothing.
 */
export async function GET(req: Request) {
  const { user, household } = await requireHousehold();
  const webcal = webcalUrl(await ensureFeed(user.id, household.id));
  const app = new URL(req.url).searchParams.get("app");
  const target = app === "google" ? `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}` : webcal;
  return new Response(null, { status: 302, headers: { Location: target, "Cache-Control": "no-store" } });
}
