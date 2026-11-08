import crypto from "node:crypto";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/server/session";
import { buildAuthUrl, googleConfigured } from "@/server/calendar/google";

export async function GET() {
  const user = await getCurrentUser();
  const base = process.env.APP_URL ?? "http://localhost:3000";
  if (!user) return Response.redirect(`${base}/login?next=/household`);
  if (!googleConfigured()) return Response.redirect(`${base}/household?calendar=not_configured`);
  if (user.isDemo) return Response.redirect(`${base}/household?calendar=demo_mode`);
  const state = crypto.randomBytes(24).toString("base64url");
  (await cookies()).set("rs_oauth_state", `${state}.${user.id}`, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/calendar/google", maxAge: 600 });
  return Response.redirect(buildAuthUrl(state));
}
