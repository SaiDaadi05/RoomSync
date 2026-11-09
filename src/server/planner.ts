import { DateTime } from "luxon";
import { z } from "zod";
import { prisma } from "./db";
import { activeMembers, assertAllMembers, requireMember } from "./access";
import { AppError, forbidden, invalid, notFound } from "./errors";
import { ensureOccurrences } from "./tasks";
import { notify } from "./notifications";
import { proposeSchedule, type Interval, type PersonInput, type Proposal } from "@/lib/scheduling";
import { deleteTaskEvent, fetchBusy, googleConfigured, upsertTaskEvent } from "./calendar/google";

export const RECENT_DAYS = 14;

const quietOf = (h: { quietStartMin: number | null; quietEndMin: number | null }) =>
  h.quietStartMin != null && h.quietEndMin != null ? { startMin: h.quietStartMin, endMin: h.quietEndMin } : null;

export function weekBounds(tz: string, offset = 0) {
  const start = DateTime.now().setZone(tz).startOf("week").plus({ weeks: offset });
  return { start: start.toJSDate(), end: start.plus({ weeks: 1 }).toJSDate(), label: `${start.toFormat("LLL d")} – ${start.plus({ days: 6 }).toFormat("LLL d")}` };
}

// ---- Availability ----

const windowSchema = z.object({
  weekday: z.coerce.number().int().min(1).max(7),
  startMin: z.coerce.number().int().min(0).max(1440),
  endMin: z.coerce.number().int().min(0).max(1440),
}).refine((w) => w.endMin > w.startMin, { message: "End time must be after start time" });

export async function listAvailability(userId: string) {
  return prisma.availabilityWindow.findMany({ where: { userId }, orderBy: [{ weekday: "asc" }, { startMin: "asc" }] });
}

export async function addAvailability(userId: string, input: unknown) {
  const w = windowSchema.parse(input);
  const overlap = await prisma.availabilityWindow.findFirst({
    where: { userId, weekday: w.weekday, startMin: { lt: w.endMin }, endMin: { gt: w.startMin } },
  });
  if (overlap) throw invalid("That overlaps a time you already added for that day");
  return prisma.availabilityWindow.create({ data: { ...w, userId } });
}

export async function deleteAvailability(userId: string, id: string) {
  const res = await prisma.availabilityWindow.deleteMany({ where: { id, userId } });
  if (!res.count) throw notFound("Availability");
}

// ---- Workload / fairness ----

export async function workloadSummary(userId: string, householdId: string, from: Date, to: Date) {
  await requireMember(userId, householdId);
  const members = await activeMembers(householdId);
  const recentFrom = new Date(Date.now() - RECENT_DAYS * 86400_000);
  const [week, recent] = await Promise.all([
    prisma.taskOccurrence.findMany({ where: { householdId, dueAt: { gte: from, lt: to }, status: { not: "SKIPPED" } }, include: { definition: { select: { estimatedMinutes: true } } } }),
    prisma.taskOccurrence.findMany({ where: { householdId, status: "DONE", completedAt: { gte: recentFrom } }, include: { definition: { select: { estimatedMinutes: true } } } }),
  ]);
  return members.map((m) => {
    const mine = week.filter((o) => o.assigneeId === m.id);
    return {
      ...m,
      weekMinutes: mine.reduce((s, o) => s + o.definition.estimatedMinutes, 0),
      weekCount: mine.length,
      recentMinutes: recent.filter((o) => o.completedById === m.id).reduce((s, o) => s + o.definition.estimatedMinutes, 0),
    };
  });
}

// ---- Proposals ----

type BusyNote = { userId: string; name: string; source: "google" | "manual" | "preferred-hours"; error?: string };

/** Build PersonInputs: manual availability, preferred hours, calendar busy blocks, already-planned tasks. */
async function loadPeople(householdId: string, from: Date, to: Date) {
  const members = await activeMembers(householdId);
  const householdTz = (await prisma.household.findUniqueOrThrow({ where: { id: householdId }, select: { timezone: true } })).timezone;
  const ids = members.map((m) => m.id);
  const recentFrom = new Date(Date.now() - RECENT_DAYS * 86400_000);
  const [windows, scheduled, recent, connections] = await Promise.all([
    prisma.availabilityWindow.findMany({ where: { userId: { in: ids } } }),
    // Planned tasks across ALL households count as busy (people can live in more than one).
    prisma.taskOccurrence.findMany({ where: { assigneeId: { in: ids }, status: "PENDING", scheduledStart: { lt: to }, scheduledEnd: { gt: from } } }),
    prisma.taskOccurrence.findMany({ where: { householdId, status: "DONE", completedAt: { gte: recentFrom } }, include: { definition: { select: { estimatedMinutes: true } } } }),
    googleConfigured() ? prisma.calendarConnection.findMany({ where: { userId: { in: ids }, provider: "GOOGLE", status: "ACTIVE" } }) : Promise.resolve([]),
  ]);
  const notes: BusyNote[] = [];
  const people: PersonInput[] = [];
  for (const m of members) {
    const busy: Interval[] = scheduled.filter((o) => o.assigneeId === m.id).map((o) => ({ start: o.scheduledStart!.getTime(), end: o.scheduledEnd!.getTime() }));
    if (m.awayFrom && m.awayUntil) {
      // Away: no free time at all for those household-local days.
      busy.push({ start: DateTime.fromISO(m.awayFrom, { zone: householdTz }).startOf("day").toMillis(), end: DateTime.fromISO(m.awayUntil, { zone: householdTz }).endOf("day").toMillis() });
    }
    const conn = connections.find((c) => c.userId === m.id);
    const myWindows = windows.filter((w) => w.userId === m.id);
    if (conn) {
      try {
        busy.push(...(await fetchBusy(conn, from, to)).map((b) => ({ start: b.start.getTime(), end: b.end.getTime() })));
        notes.push({ userId: m.id, name: m.name, source: "google" });
      } catch (e) {
        notes.push({ userId: m.id, name: m.name, source: myWindows.length ? "manual" : "preferred-hours", error: `Google Calendar unavailable: ${(e as Error).message}` });
      }
    } else {
      notes.push({ userId: m.id, name: m.name, source: myWindows.length ? "manual" : "preferred-hours" });
    }
    people.push({
      id: m.id, name: m.name, timezone: m.timezone, preferredStartMin: m.preferredStartMin, preferredEndMin: m.preferredEndMin,
      windows: myWindows.map((w) => ({ weekday: w.weekday, startMin: w.startMin, endMin: w.endMin })),
      busy,
      recentMinutes: recent.filter((o) => o.completedById === m.id).reduce((s, o) => s + o.definition.estimatedMinutes, 0),
    });
  }
  return { people, notes };
}

/** Suggest times (and people, for unassigned tasks) for this week's unplanned work. Read-only. */
export async function buildProposals(userId: string, householdId: string, range: { from: Date; to: Date }) {
  const m = await requireMember(userId, householdId);
  await ensureOccurrences(householdId);
  const now = new Date();
  const from = range.from > now ? range.from : now;
  const occs = await prisma.taskOccurrence.findMany({
    where: { householdId, status: "PENDING", scheduledStart: null, dueAt: { gt: from, lt: range.to } },
    include: { definition: true },
  });
  const { people, notes } = await loadPeople(householdId, from, range.to);
  const proposals = proposeSchedule(
    people,
    occs.map((o) => ({ occurrenceId: o.id, title: o.definition.title, minutes: o.definition.estimatedMinutes, dueAt: o.dueAt.getTime(), assigneeId: o.assigneeId, eligible: o.definition.eligibleUserIds })),
    { from: from.getTime(), to: range.to.getTime(), householdTz: m.household.timezone, quiet: quietOf(m.household) },
  );
  return { proposals, notes };
}

/** For overdue tasks: suggest a new time in the next 3 days. Nothing changes until accepted. */
export async function buildMissedProposals(userId: string, householdId: string) {
  const m = await requireMember(userId, householdId);
  const now = new Date();
  const to = new Date(now.getTime() + 3 * 86400_000);
  const occs = await prisma.taskOccurrence.findMany({
    where: { householdId, status: "PENDING", dueAt: { lt: now } },
    include: { definition: true },
    orderBy: { dueAt: "asc" },
    take: 20,
  });
  if (!occs.length) return { proposals: [] as Proposal[], notes: [] as BusyNote[] };
  const { people, notes } = await loadPeople(householdId, now, to);
  const proposals = proposeSchedule(
    people,
    occs.map((o) => ({ occurrenceId: o.id, title: o.definition.title, minutes: o.definition.estimatedMinutes, dueAt: to.getTime(), assigneeId: o.assigneeId, eligible: o.definition.eligibleUserIds })),
    { from: now.getTime(), to: to.getTime(), householdTz: m.household.timezone, quiet: quietOf(m.household) },
  );
  return { proposals, notes };
}

const acceptSchema = z.array(z.object({
  occurrenceId: z.string(),
  assigneeId: z.string(),
  start: z.coerce.date(),
  end: z.coerce.date(),
  moveDue: z.boolean().optional(),
})).min(1, "Pick at least one suggestion");

/**
 * Accept proposals or manual slots. Validates on the server: household access, task still
 * pending, the person is a member, the slot ends before the deadline (unless moving the
 * due date for a missed task), and it doesn't overlap the person's other planned tasks.
 */
export async function acceptSchedule(userId: string, householdId: string, input: unknown) {
  await requireMember(userId, householdId);
  const items = acceptSchema.parse(input);
  await assertAllMembers(householdId, items.map((i) => i.assigneeId));
  const results: { occurrenceId: string; ok: boolean; error?: string }[] = [];
  for (const it of items) {
    try {
      if (!(it.end > it.start)) throw invalid("End must be after start");
      const occ = await prisma.taskOccurrence.findUnique({ where: { id: it.occurrenceId }, include: { definition: true } });
      if (!occ || occ.householdId !== householdId) throw notFound("Task");
      if (occ.status !== "PENDING") throw invalid("Already done or skipped");
      if (occ.assigneeId && occ.assigneeId !== it.assigneeId) throw invalid("Already assigned to someone else. Use a swap to change it.");
      if (!it.moveDue && it.end > occ.dueAt) throw invalid("That time is after the deadline");
      const clash = await prisma.taskOccurrence.findFirst({
        where: { id: { not: occ.id }, assigneeId: it.assigneeId, status: "PENDING", scheduledStart: { lt: it.end }, scheduledEnd: { gt: it.start } },
        include: { definition: { select: { title: true } } },
      });
      if (clash) throw new AppError(`Overlaps “${clash.definition.title}” already planned then`, "CONFLICT");
      await prisma.$transaction([
        prisma.taskOccurrence.update({
          where: { id: occ.id },
          data: { assigneeId: it.assigneeId, scheduledStart: it.start, scheduledEnd: it.end, manuallyChanged: true, ...(it.moveDue ? { dueAt: it.end } : {}) },
        }),
        prisma.taskEvent.create({
          data: {
            occurrenceId: occ.id, actorId: userId, type: it.moveDue ? "rescheduled" : "scheduled",
            data: { start: it.start.toISOString(), end: it.end.toISOString(), assigneeId: it.assigneeId, ...(it.moveDue ? { fromDue: occ.dueAt.toISOString() } : {}) },
          },
        }),
      ]);
      if (it.assigneeId !== userId) {
        await notify({
          userId: it.assigneeId, householdId, type: "task_scheduled",
          title: `“${occ.definition.title}” was planned for you`,
          body: `Planned ${it.start.toISOString()}`,
          link: `/tasks/${occ.definitionId}`,
          dedupeKey: `scheduled:${occ.id}:${it.start.getTime()}`,
        });
      }
      results.push({ occurrenceId: occ.id, ok: true });
    } catch (e) {
      results.push({ occurrenceId: it.occurrenceId, ok: false, error: e instanceof AppError ? e.message : (e as Error).message });
    }
  }
  return results;
}

export async function unscheduleOccurrence(userId: string, occurrenceId: string) {
  const occ = await prisma.taskOccurrence.findUnique({ where: { id: occurrenceId }, include: { calendarEvents: { include: { connection: true } } } });
  if (!occ) throw notFound("Task");
  await requireMember(userId, occ.householdId);
  for (const link of occ.calendarEvents) {
    await deleteTaskEvent(link.connection, occ.id).catch(() => {});
  }
  await prisma.$transaction([
    prisma.taskOccurrence.update({ where: { id: occ.id }, data: { scheduledStart: null, scheduledEnd: null } }),
    prisma.taskEvent.create({ data: { occurrenceId: occ.id, actorId: userId, type: "unscheduled" } }),
  ]);
}

/** Copy a planned task to the assignee's own Google Calendar. Only the assignee can do this. */
export async function syncOccurrenceToGoogle(userId: string, occurrenceId: string) {
  const occ = await prisma.taskOccurrence.findUnique({ where: { id: occurrenceId }, include: { definition: true, household: true } });
  if (!occ) throw notFound("Task");
  await requireMember(userId, occ.householdId);
  if (occ.assigneeId !== userId) throw forbidden("Only the person doing the task can add it to their calendar");
  if (!occ.scheduledStart || !occ.scheduledEnd) throw invalid("Plan a time first");
  const conn = await prisma.calendarConnection.findUnique({ where: { userId_provider: { userId, provider: "GOOGLE" } } });
  if (!conn || conn.status !== "ACTIVE") throw invalid("Connect Google Calendar first (Household → Calendars)");
  return upsertTaskEvent(conn, { id: occ.id, title: occ.definition.title, start: occ.scheduledStart, end: occ.scheduledEnd, householdName: occ.household.name });
}

// ---- Swap requests ----

const OPEN_SWAP = "PENDING" as const;

/**
 * Ask a roommate to trade tasks. Nothing changes hands until they accept.
 * The requester must be the assignee of the task they're offering, so nobody can
 * rearrange two other people's commitments.
 */
export async function requestSwap(userId: string, mineId: string, theirsId: string, message?: string | null) {
  const [a, b] = await Promise.all([
    prisma.taskOccurrence.findUnique({ where: { id: mineId }, include: { definition: true } }),
    prisma.taskOccurrence.findUnique({ where: { id: theirsId }, include: { definition: true } }),
  ]);
  if (!a || !b) throw notFound("Task");
  if (a.householdId !== b.householdId) throw invalid("Tasks must be in the same household");
  await requireMember(userId, a.householdId);
  if (a.status !== "PENDING" || b.status !== "PENDING") throw invalid("Both tasks must still be pending");
  if (a.assigneeId !== userId) throw forbidden("You can only offer a task that's assigned to you");
  if (!b.assigneeId || b.assigneeId === userId) throw invalid("Pick a task assigned to another roommate");
  const dupe = await prisma.swapRequest.findFirst({
    where: { status: OPEN_SWAP, fromOccurrenceId: a.id, toOccurrenceId: b.id },
  });
  if (dupe) throw new AppError("You've already asked to swap these", "CONFLICT");
  const req = await prisma.swapRequest.create({
    data: {
      householdId: a.householdId, fromUserId: userId, toUserId: b.assigneeId,
      fromOccurrenceId: a.id, toOccurrenceId: b.id, message: message?.trim().slice(0, 200) || null,
    },
  });
  const me = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
  await notify({
    userId: b.assigneeId, householdId: a.householdId, type: "swap_requested",
    title: `${me.name.split(" ")[0]} wants to swap: their “${a.definition.title}” for your “${b.definition.title}”`,
    body: req.message ?? undefined,
    link: "/planner#swaps", dedupeKey: `swap_req:${req.id}`,
  });
  return req;
}

async function loadSwap(userId: string, requestId: string) {
  const r = await prisma.swapRequest.findUnique({
    where: { id: requestId },
    include: { fromOccurrence: { include: { definition: true } }, toOccurrence: { include: { definition: true } } },
  });
  if (!r) throw notFound("Swap request");
  await requireMember(userId, r.householdId);
  return r;
}

/**
 * Accept or decline. Accepting is race-safe: the request flips from PENDING exactly
 * once, and the trade only happens if both tasks are still pending and still owned
 * by the same two people. Otherwise the request is marked EXPIRED and nothing moves.
 */
export async function respondToSwap(userId: string, requestId: string, accept: boolean) {
  const r = await loadSwap(userId, requestId);
  if (r.toUserId !== userId) throw forbidden("Only the roommate being asked can answer this");
  if (r.status !== OPEN_SWAP) throw invalid("This request was already answered");

  if (!accept) {
    const res = await prisma.swapRequest.updateMany({ where: { id: r.id, status: OPEN_SWAP }, data: { status: "DECLINED", respondedAt: new Date() } });
    if (res.count !== 1) throw invalid("This request was already answered");
    await notify({
      userId: r.fromUserId, householdId: r.householdId, type: "swap_declined",
      title: `Swap declined: you're still on “${r.fromOccurrence.definition.title}”`,
      link: "/planner#swaps", dedupeKey: `swap_res:${r.id}`,
    });
    return "DECLINED" as const;
  }

  const outcome = await prisma.$transaction(async (tx) => {
    const claimed = await tx.swapRequest.updateMany({ where: { id: r.id, status: OPEN_SWAP }, data: { status: "ACCEPTED", respondedAt: new Date() } });
    if (claimed.count !== 1) return "ALREADY" as const;
    const moveA = await tx.taskOccurrence.updateMany({
      where: { id: r.fromOccurrenceId, status: "PENDING", assigneeId: r.fromUserId },
      data: { assigneeId: r.toUserId, manuallyChanged: true, scheduledStart: null, scheduledEnd: null },
    });
    const moveB = await tx.taskOccurrence.updateMany({
      where: { id: r.toOccurrenceId, status: "PENDING", assigneeId: r.toUserId },
      data: { assigneeId: r.fromUserId, manuallyChanged: true, scheduledStart: null, scheduledEnd: null },
    });
    if (moveA.count !== 1 || moveB.count !== 1) {
      // Throwing rolls back the partial swap and the ACCEPTED flip.
      throw new AppError("STALE", "CONFLICT");
    }
    await tx.taskEvent.createMany({
      data: [
        { occurrenceId: r.fromOccurrenceId, actorId: userId, type: "swapped", data: { from: r.fromUserId, to: r.toUserId, requestId: r.id } },
        { occurrenceId: r.toOccurrenceId, actorId: userId, type: "swapped", data: { from: r.toUserId, to: r.fromUserId, requestId: r.id } },
      ],
    });
    // Any other open requests involving these two tasks no longer make sense.
    await tx.swapRequest.updateMany({
      where: {
        id: { not: r.id }, status: OPEN_SWAP,
        OR: [
          { fromOccurrenceId: { in: [r.fromOccurrenceId, r.toOccurrenceId] } },
          { toOccurrenceId: { in: [r.fromOccurrenceId, r.toOccurrenceId] } },
        ],
      },
      data: { status: "EXPIRED", respondedAt: new Date() },
    });
    return "ACCEPTED" as const;
  }).catch(async (e) => {
    if (e instanceof AppError && e.message === "STALE") {
      await prisma.swapRequest.updateMany({ where: { id: r.id, status: OPEN_SWAP }, data: { status: "EXPIRED", respondedAt: new Date() } });
      throw invalid("One of these tasks changed (done, skipped, or reassigned), so the swap no longer applies");
    }
    throw e;
  });
  if (outcome === "ALREADY") throw invalid("This request was already answered");
  await notify({
    userId: r.fromUserId, householdId: r.householdId, type: "swap_accepted",
    title: `Swap accepted: you now have “${r.toOccurrence.definition.title}” instead of “${r.fromOccurrence.definition.title}”`,
    link: `/tasks/${r.toOccurrence.definitionId}`, dedupeKey: `swap_res:${r.id}`,
  });
  return "ACCEPTED" as const;
}

export async function cancelSwap(userId: string, requestId: string) {
  const r = await loadSwap(userId, requestId);
  if (r.fromUserId !== userId) throw forbidden("Only the person who asked can cancel");
  const res = await prisma.swapRequest.updateMany({ where: { id: r.id, status: OPEN_SWAP }, data: { status: "CANCELLED", respondedAt: new Date() } });
  if (res.count !== 1) throw invalid("This request was already answered");
}

/** Open requests for the current user, with stale ones expired on read. */
export async function listSwapRequests(userId: string, householdId: string) {
  await requireMember(userId, householdId);
  const open = await prisma.swapRequest.findMany({
    where: { householdId, status: OPEN_SWAP, OR: [{ fromUserId: userId }, { toUserId: userId }] },
    include: { fromOccurrence: { include: { definition: true } }, toOccurrence: { include: { definition: true } } },
    orderBy: { createdAt: "desc" },
  });
  const stale = open.filter((r) =>
    r.fromOccurrence.status !== "PENDING" || r.toOccurrence.status !== "PENDING" ||
    r.fromOccurrence.assigneeId !== r.fromUserId || r.toOccurrence.assigneeId !== r.toUserId);
  if (stale.length) {
    await prisma.swapRequest.updateMany({ where: { id: { in: stale.map((r) => r.id) }, status: OPEN_SWAP }, data: { status: "EXPIRED", respondedAt: new Date() } });
  }
  const live = open.filter((r) => !stale.includes(r));
  return { incoming: live.filter((r) => r.toUserId === userId), outgoing: live.filter((r) => r.fromUserId === userId) };
}
