import { renderFeed } from "@/server/calendar/feed";

export const dynamic = "force-dynamic";

// Calendar apps fetch this without cookies, so the unguessable token in the path is the only credential.
export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await renderFeed(token.replace(/\.ics$/, ""));
  if (!body) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="roomsync.ics"',
      "Cache-Control": "private, max-age=300",
      "X-Robots-Tag": "noindex",
    },
  });
}
