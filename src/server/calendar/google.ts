import crypto from "node:crypto";
import type { CalendarConnection } from "@prisma/client";
import { prisma } from "../db";
import { decryptSecret, encryptSecret } from "../crypto";

/**
 * Google Calendar integration (server-side only).
 * Scopes are the minimum needed:
 *  - calendar.freebusy: read busy/free blocks only, never event titles or details
 *  - calendar.events.owned: create/update/delete events RoomSync adds to the user's calendars
 * Docs: https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query
 *       https://developers.google.com/identity/protocols/oauth2/web-server
 */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/calendar.events.owned",
];

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/calendar/v3";

export function googleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function redirectUri() {
  return `${process.env.APP_URL ?? "http://localhost:3000"}/api/calendar/google/callback`;
}

export function buildAuthUrl(state: string) {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state,
  });
  return `${AUTH_URL}?${p}`;
}

export class CalendarError extends Error {
  constructor(message: string, public reconnect = false) {
    super(message);
  }
}

type TokenResponse = { access_token: string; expires_in: number; refresh_token?: string; id_token?: string; scope?: string; error?: string; error_description?: string };

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, ...body }),
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok) throw new CalendarError(json.error_description || json.error || `Google token error ${res.status}`, json.error === "invalid_grant");
  return json;
}

/** Exchange the OAuth code and store encrypted tokens. */
export async function completeGoogleConnection(userId: string, code: string) {
  const t = await postToken({ code, grant_type: "authorization_code", redirect_uri: redirectUri() });
  let email: string | null = null;
  if (t.id_token) {
    // id_token came straight from Google's token endpoint over TLS, so decoding without verifying is acceptable here.
    try { email = JSON.parse(Buffer.from(t.id_token.split(".")[1], "base64url").toString()).email ?? null; } catch { /* ignore */ }
  }
  const existing = await prisma.calendarConnection.findUnique({ where: { userId_provider: { userId, provider: "GOOGLE" } } });
  const refresh = t.refresh_token ? encryptSecret(t.refresh_token) : existing?.refreshTokenEnc;
  if (!refresh) throw new CalendarError("Google didn't return a refresh token. Remove RoomSync from your Google account permissions and try again.");
  return prisma.calendarConnection.upsert({
    where: { userId_provider: { userId, provider: "GOOGLE" } },
    create: { userId, provider: "GOOGLE", accountEmail: email, accessTokenEnc: encryptSecret(t.access_token), refreshTokenEnc: refresh, tokenExpiresAt: new Date(Date.now() + (t.expires_in - 60) * 1000) },
    update: { status: "ACTIVE", lastError: null, accountEmail: email ?? existing?.accountEmail, accessTokenEnc: encryptSecret(t.access_token), refreshTokenEnc: refresh, tokenExpiresAt: new Date(Date.now() + (t.expires_in - 60) * 1000) },
  });
}

async function markError(conn: CalendarConnection, err: unknown) {
  const reconnect = err instanceof CalendarError && err.reconnect;
  await prisma.calendarConnection.update({
    where: { id: conn.id },
    data: { status: reconnect ? "ERROR" : conn.status, lastError: (err as Error).message.slice(0, 300) },
  });
}

export async function getAccessToken(conn: CalendarConnection): Promise<string> {
  if (conn.accessTokenEnc && conn.tokenExpiresAt && conn.tokenExpiresAt > new Date()) return decryptSecret(conn.accessTokenEnc);
  if (!conn.refreshTokenEnc) throw new CalendarError("Missing refresh token", true);
  try {
    const t = await postToken({ grant_type: "refresh_token", refresh_token: decryptSecret(conn.refreshTokenEnc) });
    await prisma.calendarConnection.update({
      where: { id: conn.id },
      data: { accessTokenEnc: encryptSecret(t.access_token), tokenExpiresAt: new Date(Date.now() + (t.expires_in - 60) * 1000), status: "ACTIVE", lastError: null },
    });
    return t.access_token;
  } catch (e) {
    await markError(conn, e);
    throw e;
  }
}

async function api<T>(conn: CalendarConnection, path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const token = await getAccessToken(conn);
  const res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const body = (await res.json().catch(() => ({}))) as T;
  if (res.status === 401) {
    const err = new CalendarError("Google rejected the saved credentials", true);
    await markError(conn, err);
    throw err;
  }
  return { status: res.status, body };
}

/** Busy intervals only. Event titles, attendees, and locations are never requested. */
export async function fetchBusy(conn: CalendarConnection, timeMin: Date, timeMax: Date): Promise<{ start: Date; end: Date }[]> {
  const { status, body } = await api<{ calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: unknown[] }> }>(conn, "/freeBusy", {
    method: "POST",
    body: JSON.stringify({ timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), items: [{ id: conn.calendarId }] }),
  });
  if (status >= 400) {
    const err = new CalendarError(`Google freeBusy failed (${status})`);
    await markError(conn, err);
    throw err;
  }
  const cal = body.calendars?.[conn.calendarId];
  if (cal?.errors?.length) throw new CalendarError("Google couldn't read that calendar's availability");
  await prisma.calendarConnection.update({ where: { id: conn.id }, data: { lastSyncAt: new Date(), lastError: null } });
  return (cal?.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
}

/** Deterministic event id (base32hex charset) so retries can never create a duplicate event. */
export function eventIdFor(occurrenceId: string, connectionId: string) {
  return "rs" + crypto.createHash("sha256").update(`${occurrenceId}:${connectionId}`).digest("hex").slice(0, 40);
}

/**
 * Write a scheduled task to the user's Google Calendar. Idempotent:
 *  - CalendarEventLink (unique per occurrence+connection) records what's been synced
 *  - the Google event id is deterministic, so a retry after a crash gets 409 instead of a duplicate
 */
export async function upsertTaskEvent(conn: CalendarConnection, occ: { id: string; title: string; start: Date; end: Date; householdName: string }) {
  const id = eventIdFor(occ.id, conn.id);
  const event = {
    id,
    summary: `🏠 ${occ.title}`,
    description: `RoomSync chore for ${occ.householdName}.`,
    start: { dateTime: occ.start.toISOString() },
    end: { dateTime: occ.end.toISOString() },
    extendedProperties: { private: { roomsyncOccurrenceId: occ.id } },
    reminders: { useDefault: true },
  };
  const existing = await prisma.calendarEventLink.findUnique({ where: { occurrenceId_connectionId: { occurrenceId: occ.id, connectionId: conn.id } } });
  let res = existing
    ? await api(conn, `/calendars/${encodeURIComponent(conn.calendarId)}/events/${id}`, { method: "PUT", body: JSON.stringify(event) })
    : await api(conn, `/calendars/${encodeURIComponent(conn.calendarId)}/events`, { method: "POST", body: JSON.stringify(event) });
  if (res.status === 409) res = await api(conn, `/calendars/${encodeURIComponent(conn.calendarId)}/events/${id}`, { method: "PUT", body: JSON.stringify(event) });
  if (res.status >= 400) {
    const err = new CalendarError(`Couldn't add the event to Google Calendar (${res.status})`);
    await markError(conn, err);
    throw err;
  }
  await prisma.calendarEventLink.upsert({
    where: { occurrenceId_connectionId: { occurrenceId: occ.id, connectionId: conn.id } },
    create: { occurrenceId: occ.id, connectionId: conn.id, externalEventId: id },
    update: { syncedAt: new Date(), externalEventId: id },
  });
  return id;
}

export async function deleteTaskEvent(conn: CalendarConnection, occurrenceId: string) {
  const link = await prisma.calendarEventLink.findUnique({ where: { occurrenceId_connectionId: { occurrenceId, connectionId: conn.id } } });
  if (!link) return;
  const res = await api(conn, `/calendars/${encodeURIComponent(conn.calendarId)}/events/${link.externalEventId}`, { method: "DELETE" });
  if (res.status >= 400 && res.status !== 404 && res.status !== 410) throw new CalendarError(`Couldn't remove the Google Calendar event (${res.status})`);
  await prisma.calendarEventLink.delete({ where: { id: link.id } });
}

export async function revokeGoogle(userId: string) {
  const conn = await prisma.calendarConnection.findUnique({ where: { userId_provider: { userId, provider: "GOOGLE" } } });
  if (!conn) return;
  if (conn.refreshTokenEnc) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(decryptSecret(conn.refreshTokenEnc))}`, { method: "POST" }).catch(() => {});
  }
  await prisma.calendarConnection.delete({ where: { id: conn.id } });
}
