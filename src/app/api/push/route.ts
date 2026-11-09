import { getCurrentUser } from "@/server/session";
import { removePushSubscription, savePushSubscription } from "@/server/push";
import { AppError } from "@/server/errors";

export const dynamic = "force-dynamic";

/** Same-origin JSON only: a cross-site form can't send JSON, and we also check Origin. */
function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  return !!origin && !!host && new URL(origin).host === host && (req.headers.get("content-type") ?? "").includes("application/json");
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "Bad request" }, { status: 400 });
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in first" }, { status: 401 });
  try {
    await savePushSubscription(user.id, await req.json(), req.headers.get("user-agent"));
    return Response.json({ ok: true });
  } catch (e) {
    const msg = e instanceof AppError ? e.message : "That device couldn't be saved";
    return Response.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "Bad request" }, { status: 400 });
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in first" }, { status: 401 });
  const { endpoint } = (await req.json().catch(() => ({}))) as { endpoint?: string };
  if (typeof endpoint === "string") await removePushSubscription(user.id, endpoint);
  return Response.json({ ok: true });
}
