import crypto from "node:crypto";
import { DateTime } from "luxon";
import { prisma } from "../db";
import { requireMember } from "../access";
import { decryptSecret, encryptSecret } from "../crypto";
import { ensureOccurrences } from "../tasks";
import { buildCalendar, type IcsEvent } from "@/lib/ics";

const hash = (t: string) => crypto.createHash("sha256").update(t).digest("hex");
const PAST_DAYS = 14;
const FUTURE_DAYS = 60;

export function feedUrl(token: string) {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/api/calendar/feed/${token}.ics`;
}

/** The caller's subscribe link for this household, or null if they haven't made one. */
export async function getFeed(userId: string, householdId: string) {
  await requireMember(userId, householdId);
  const f = await prisma.calendarFeed.findUnique({ where: { userId_householdId: { userId, householdId } } });
  return f ? { url: feedUrl(decryptSecret(f.tokenEnc)), createdAt: f.createdAt, lastFetchedAt: f.lastFetchedAt } : null;
}

/** Create the link, or replace it so any old copies stop working. */
export async function resetFeed(userId: string, householdId: string) {
  await requireMember(userId, householdId);
  const token = crypto.randomBytes(24).toString("base64url");
  const data = { tokenHash: hash(token), tokenEnc: encryptSecret(token), createdAt: new Date(), lastFetchedAt: null };
  await prisma.calendarFeed.upsert({
    where: { userId_householdId: { userId, householdId } },
    create: { userId, householdId, ...data },
    update: data,
  });
  return feedUrl(token);
}

export async function deleteFeed(userId: string, householdId: string) {
  await requireMember(userId, householdId);
  await prisma.calendarFeed.deleteMany({ where: { userId, householdId } });
}

/**
 * Render the .ics for a token. Returns null for an unknown token or when the subscriber
 * no longer lives in the household, so a leaked or stale link reveals nothing.
 */
export async function renderFeed(token: string, now = new Date()) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const feed = await prisma.calendarFeed.findUnique({ where: { tokenHash: hash(token) }, include: { household: true } });
  if (!feed) return null;
  const member = await prisma.membership.findFirst({ where: { userId: feed.userId, householdId: feed.householdId, leftAt: null } });
  if (!member) return null;

  await ensureOccurrences(feed.householdId, now);
  const occs = await prisma.taskOccurrence.findMany({
    where: {
      householdId: feed.householdId,
      assigneeId: feed.userId,
      status: { in: ["PENDING", "DONE"] },
      dueAt: { gte: DateTime.fromJSDate(now).minus({ days: PAST_DAYS }).toJSDate(), lte: DateTime.fromJSDate(now).plus({ days: FUTURE_DAYS }).toJSDate() },
      definition: { archivedAt: null },
    },
    include: { definition: true },
    orderBy: { dueAt: "asc" },
    take: 500,
  });
  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const events: IcsEvent[] = occs.map((o) => {
    const mins = o.definition.estimatedMinutes;
    const start = o.scheduledStart ?? new Date(o.dueAt.getTime() - mins * 60_000);
    const end = o.scheduledEnd ?? (o.scheduledStart ? new Date(o.scheduledStart.getTime() + mins * 60_000) : o.dueAt);
    return {
      uid: `${o.id}@roomsync`,
      start,
      end,
      summary: `${o.status === "DONE" ? "✓ " : ""}${o.definition.title}`,
      description: `${o.scheduledStart ? "Planned time" : `Due by ${DateTime.fromJSDate(o.dueAt).setZone(feed.household.timezone).toFormat("h:mm a")}`} · about ${mins} min · ${feed.household.name}\nMark it done in RoomSync: ${appUrl}/tasks/${o.definitionId}`,
      url: `${appUrl}/tasks/${o.definitionId}`,
      updated: o.completedAt ?? undefined,
    };
  });
  await prisma.calendarFeed.update({ where: { id: feed.id }, data: { lastFetchedAt: now } });
  return buildCalendar(`RoomSync · ${feed.household.name}`, events, now);
}
