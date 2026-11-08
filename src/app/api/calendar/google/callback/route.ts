import { cookies } from "next/headers";
import { getCurrentUser } from "@/server/session";
import { completeGoogleConnection } from "@/server/calendar/google";

export async function GET(req: Request) {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  const url = new URL(req.url);
  const jar = await cookies();
  const saved = jar.get("rs_oauth_state")?.value;
  jar.delete("rs_oauth_state");
  const user = await getCurrentUser();
  if (!user) return Response.redirect(`${base}/login?next=/household`);
  const [state, uid] = (saved ?? "").split(".");
  if (!state || state !== url.searchParams.get("state") || uid !== user.id) return Response.redirect(`${base}/household?calendar=state_mismatch`);
  const err = url.searchParams.get("error");
  if (err) return Response.redirect(`${base}/household?calendar=${encodeURIComponent(err)}`);
  const code = url.searchParams.get("code");
  if (!code) return Response.redirect(`${base}/household?calendar=missing_code`);
  try {
    await completeGoogleConnection(user.id, code);
  } catch (e) {
    console.error("Google connect failed", e);
    return Response.redirect(`${base}/household?calendar=token_exchange_failed`);
  }
  return Response.redirect(`${base}/household?calendar=connected`);
}
