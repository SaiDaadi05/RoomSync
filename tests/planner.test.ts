import { describe, expect, it, vi, afterEach } from "vitest";
import { DateTime } from "luxon";
import { makeHousehold } from "./helpers";
import { freeIntervals, proposeSchedule, subtract, type PersonInput } from "@/lib/scheduling";
import { createTask, listOccurrences, completeOccurrence, assignOccurrence } from "@/server/tasks";
import { acceptSchedule, addAvailability, buildProposals, buildMissedProposals } from "@/server/planner";
import { generateReminders, deliverEmails } from "@/server/reminders";
import { prisma } from "@/server/db";
import { encryptSecret, decryptSecret } from "@/server/crypto";
import { eventIdFor, upsertTaskEvent, fetchBusy } from "@/server/calendar/google";

const TZ = "America/New_York";
const at = (iso: string) => DateTime.fromISO(iso, { zone: TZ }).toMillis();

function person(id: string, over: Partial<PersonInput> = {}): PersonInput {
  return { id, name: id, timezone: TZ, preferredStartMin: 9 * 60, preferredEndMin: 22 * 60, windows: [], busy: [], recentMinutes: 0, ...over };
}

describe("scheduling engine", () => {
  it("subtracts busy blocks from free time", () => {
    expect(subtract([{ start: 0, end: 100 }], [{ start: 20, end: 30 }, { start: 90, end: 120 }])).toEqual([{ start: 0, end: 20 }, { start: 30, end: 90 }]);
  });

  it("intersects manual windows with preferred hours in the person's own timezone", () => {
    // Window 07:00-10:00 on Monday, but preferred hours start 09:00 → 09:00-10:00 only.
    const p = person("a", { windows: [{ weekday: 1, startMin: 7 * 60, endMin: 10 * 60 }] });
    const free = freeIntervals(p, at("2026-03-02T00:00"), at("2026-03-08T23:59"));
    expect(free).toEqual([{ start: at("2026-03-02T09:00"), end: at("2026-03-02T10:00") }]);
    // A Los Angeles roommate's 18:00 is 21:00 in New York
    const la = person("b", { timezone: "America/Los_Angeles", windows: [{ weekday: 1, startMin: 18 * 60, endMin: 19 * 60 }] });
    expect(freeIntervals(la, at("2026-03-02T00:00"), at("2026-03-03T06:00"))[0].start).toBe(at("2026-03-02T21:00"));
  });

  it("never proposes a time that overlaps a busy block or misses the deadline", () => {
    const p = person("a", { windows: [{ weekday: 2, startMin: 18 * 60, endMin: 21 * 60 }], busy: [{ start: at("2026-03-03T18:00"), end: at("2026-03-03T19:30") }] });
    const [prop] = proposeSchedule([p], [{ occurrenceId: "o1", title: "Bathroom", minutes: 45, dueAt: at("2026-03-03T21:00"), assigneeId: "a", eligible: [] }], { from: at("2026-03-02T00:00"), to: at("2026-03-09T00:00"), householdTz: TZ });
    expect(prop.ok).toBe(true);
    expect(prop.start).toBe(at("2026-03-03T19:30"));
    expect(prop.end! <= at("2026-03-03T21:00")).toBe(true);
    const [late] = proposeSchedule([p], [{ occurrenceId: "o2", title: "Bathroom", minutes: 120, dueAt: at("2026-03-03T21:00"), assigneeId: "a", eligible: [] }], { from: at("2026-03-02T00:00"), to: at("2026-03-09T00:00"), householdTz: TZ });
    expect(late.ok).toBe(false);
    expect(late.reason).toMatch(/no free 120-minute block/);
  });

  it("does not double-book one person and spreads unassigned work by effort", () => {
    const opts = { from: at("2026-03-02T00:00"), to: at("2026-03-09T00:00"), householdTz: TZ };
    const a = person("a", { windows: [{ weekday: 1, startMin: 18 * 60, endMin: 19 * 60 }] });
    const b = person("b", { windows: [{ weekday: 1, startMin: 18 * 60, endMin: 19 * 60 }], recentMinutes: 200 });
    const tasks = [
      { occurrenceId: "t1", title: "Vacuum", minutes: 60, dueAt: at("2026-03-02T23:00"), assigneeId: null, eligible: [] },
      { occurrenceId: "t2", title: "Mop", minutes: 60, dueAt: at("2026-03-02T23:00"), assigneeId: null, eligible: [] },
    ];
    const props = proposeSchedule([a, b], tasks, opts);
    // a has the lighter recent load → gets the first task; a is then full, so b gets the second.
    expect(props.map((p) => p.assigneeId)).toEqual(["a", "b"]);
    expect(props[0].reason).toMatch(/lightest workload/);
    expect(props[1].reason).toMatch(/lighter load but no free time/);
  });
});

describe("planner service", () => {
  it("proposes, accepts, and rejects conflicting or late slots server-side", async () => {
    const { household, owner, members } = await makeHousehold(1);
    const mate = members[1];
    const tomorrow = DateTime.now().setZone(TZ).plus({ days: 2 }).toISODate()!;
    await createTask(owner.id, household.id, { title: "Clean fridge", startsOn: tomorrow, dueTime: "21:00", estimatedMinutes: 30, assignmentMode: "FIXED", assigneeId: mate.id });
    await createTask(owner.id, household.id, { title: "Mop", startsOn: tomorrow, dueTime: "21:00", estimatedMinutes: 30, assignmentMode: "FIXED", assigneeId: mate.id });
    const now = new Date();
    const { proposals } = await buildProposals(owner.id, household.id, { from: now, to: new Date(now.getTime() + 7 * 86400_000) });
    expect(proposals).toHaveLength(2);
    expect(proposals.every((p) => p.ok && p.assigneeId === mate.id)).toBe(true);
    expect(proposals[0].end! <= proposals[1].start! || proposals[1].end! <= proposals[0].start!).toBe(true);

    const [p1, p2] = proposals;
    const res = await acceptSchedule(owner.id, household.id, [{ occurrenceId: p1.occurrenceId, assigneeId: mate.id, start: new Date(p1.start!), end: new Date(p1.end!) }]);
    expect(res[0].ok).toBe(true);
    // Overlapping the first planned slot is rejected
    const clash = await acceptSchedule(owner.id, household.id, [{ occurrenceId: p2.occurrenceId, assigneeId: mate.id, start: new Date(p1.start!), end: new Date(p1.end!) }]);
    expect(clash[0]).toMatchObject({ ok: false, error: expect.stringMatching(/Overlaps/) });
    // After-deadline slot is rejected
    const occ2 = await prisma.taskOccurrence.findUniqueOrThrow({ where: { id: p2.occurrenceId } });
    const late = await acceptSchedule(owner.id, household.id, [{ occurrenceId: p2.occurrenceId, assigneeId: mate.id, start: occ2.dueAt, end: new Date(occ2.dueAt.getTime() + 1800_000) }]);
    expect(late[0]).toMatchObject({ ok: false, error: expect.stringMatching(/deadline/) });
    // Can't silently take a task assigned to someone else
    const steal = await acceptSchedule(owner.id, household.id, [{ occurrenceId: p2.occurrenceId, assigneeId: owner.id, start: new Date(p2.start!), end: new Date(p2.end!) }]);
    expect(steal[0]).toMatchObject({ ok: false, error: expect.stringMatching(/swap/) });
    // Re-proposing skips already planned work
    const again = await buildProposals(owner.id, household.id, { from: now, to: new Date(now.getTime() + 7 * 86400_000) });
    expect(again.proposals.map((p) => p.occurrenceId)).toEqual([p2.occurrenceId]);
  });

  it("missed-task suggestions don't change anything until accepted", async () => {
    const { household, owner } = await makeHousehold(0);
    const yesterday = DateTime.now().setZone(TZ).minus({ days: 1 }).toISODate()!;
    await createTask(owner.id, household.id, { title: "Return library book", kind: "ERRAND", startsOn: yesterday, dueTime: "12:00", assignmentMode: "FIXED", assigneeId: owner.id });
    const before = await prisma.taskOccurrence.findFirstOrThrow({ where: { householdId: household.id } });
    const { proposals } = await buildMissedProposals(owner.id, household.id);
    expect(proposals).toHaveLength(1);
    const after = await prisma.taskOccurrence.findFirstOrThrow({ where: { householdId: household.id } });
    expect(after.dueAt.toISOString()).toBe(before.dueAt.toISOString());
    const p = proposals[0];
    const [r] = await acceptSchedule(owner.id, household.id, [{ occurrenceId: p.occurrenceId, assigneeId: owner.id, start: new Date(p.start!), end: new Date(p.end!), moveDue: true }]);
    expect(r.ok).toBe(true);
    const moved = await prisma.taskOccurrence.findFirstOrThrow({ where: { householdId: household.id } });
    expect(moved.dueAt.getTime()).toBe(p.end);
    expect(moved.originalDueAt.toISOString()).toBe(before.originalDueAt.toISOString());
  });

  it("offers one new time per missed recurring chore, not one per missed day", async () => {
    const { household, owner } = await makeHousehold(0);
    const fourDaysAgo = DateTime.now().setZone(TZ).minus({ days: 4 }).toISODate()!;
    await createTask(owner.id, household.id, { title: "Dishes", recurrence: "DAILY", startsOn: fourDaysAgo, dueTime: "00:01", assignmentMode: "FIXED", assigneeId: owner.id });
    // Make sure there are at least two missed runs of the same chore.
    const first = await prisma.taskOccurrence.findFirstOrThrow({ where: { householdId: household.id }, orderBy: { dueAt: "asc" } });
    const earlier = new Date(Math.min(first.dueAt.getTime(), Date.now()) - 2 * 86400_000);
    await prisma.taskOccurrence.create({ data: { householdId: household.id, definitionId: first.definitionId, assigneeId: owner.id, sequence: 999, dueAt: earlier, originalDueAt: earlier } });
    const overdue = await prisma.taskOccurrence.findMany({ where: { householdId: household.id, status: "PENDING", dueAt: { lt: new Date() } }, orderBy: { dueAt: "desc" } });
    expect(overdue.length).toBeGreaterThan(1);
    const { proposals } = await buildMissedProposals(owner.id, household.id);
    expect(proposals.map((p) => p.occurrenceId)).toEqual([overdue[0].id]);
  });

  it("availability windows reject overlaps", async () => {
    const { owner } = await makeHousehold(0);
    await addAvailability(owner.id, { weekday: 1, startMin: 1080, endMin: 1260 });
    await expect(addAvailability(owner.id, { weekday: 1, startMin: 1200, endMin: 1300 })).rejects.toThrow(/overlaps/);
    await addAvailability(owner.id, { weekday: 1, startMin: 1260, endMin: 1300 });
  });
});

describe("reminders", () => {
  it("creates due-soon and overdue reminders once, and records email delivery honestly", async () => {
    const { household, owner, members } = await makeHousehold(1);
    const mate = members[1];
    await prisma.user.update({ where: { id: mate.id }, data: { notifyEmail: true } });
    const now = DateTime.now().setZone(TZ);
    await createTask(owner.id, household.id, { title: "Soon", startsOn: now.toISODate()!, dueTime: now.plus({ hours: 1 }).toFormat("HH:mm"), assignmentMode: "FIXED", assigneeId: mate.id });
    await createTask(owner.id, household.id, { title: "Late", startsOn: now.minus({ days: 1 }).toISODate()!, dueTime: "09:00", assignmentMode: "FIXED", assigneeId: mate.id });
    const late = await createTask(owner.id, household.id, { title: "Done already", startsOn: now.minus({ days: 1 }).toISODate()!, dueTime: "09:00", assignmentMode: "FIXED", assigneeId: mate.id });
    const doneOcc = await prisma.taskOccurrence.findFirstOrThrow({ where: { definitionId: late.id } });
    await completeOccurrence(mate.id, doneOcc.id);

    await generateReminders();
    await generateReminders();
    const notes = await prisma.notification.findMany({ where: { userId: mate.id, type: { in: ["task_due_soon", "task_overdue"] } }, include: { deliveries: true } });
    // "Soon" may land on tomorrow if the test runs within an hour of midnight; overdue always exists.
    expect(notes.filter((n) => n.type === "task_overdue")).toHaveLength(1);
    expect(notes.every((n) => !n.title.includes("Done already"))).toBe(true);
    // SMTP not configured in tests → email is SKIPPED with a reason, never "SENT"
    for (const n of notes) expect(n.deliveries.find((d) => d.channel === "EMAIL")).toMatchObject({ status: "SKIPPED", error: "SMTP not configured" });
  });

  it("delivers pending emails through the mailer and retries failures", async () => {
    const { household, owner, members } = await makeHousehold(1);
    const mate = members[1];
    const n = await prisma.notification.create({
      data: { userId: mate.id, householdId: household.id, type: "test", title: "Hi", dedupeKey: "t1", deliveries: { create: [{ channel: "EMAIL", status: "PENDING" }] } },
    });
    const failing = { sendMail: vi.fn().mockRejectedValue(new Error("SMTP down")) };
    await deliverEmails(failing);
    let d = await prisma.notificationDelivery.findFirstOrThrow({ where: { notificationId: n.id } });
    expect(d).toMatchObject({ status: "PENDING", attempts: 1, error: "SMTP down" });
    const ok = { sendMail: vi.fn().mockResolvedValue({}) };
    expect(await deliverEmails(ok)).toBe(1);
    d = await prisma.notificationDelivery.findFirstOrThrow({ where: { notificationId: n.id } });
    expect(d.status).toBe("SENT");
    expect(ok.sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: mate.email, subject: "Hi" }));
    void owner; void assignOccurrence;
  });
});

describe("google calendar client (mocked HTTP)", () => {
  afterEach(() => vi.unstubAllGlobals());

  async function connection() {
    const { household, owner } = await makeHousehold(0);
    const conn = await prisma.calendarConnection.create({
      data: { userId: owner.id, provider: "GOOGLE", accessTokenEnc: encryptSecret("access-1"), refreshTokenEnc: encryptSecret("refresh-1"), tokenExpiresAt: new Date(Date.now() + 3600_000) },
    });
    return { household, owner, conn };
  }

  it("encrypts tokens at rest", () => {
    const enc = encryptSecret("secret-token");
    expect(enc).not.toContain("secret-token");
    expect(decryptSecret(enc)).toBe("secret-token");
  });

  it("reads only busy blocks and sends the bearer token", async () => {
    const { conn } = await connection();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ calendars: { primary: { busy: [{ start: "2026-03-02T23:00:00Z", end: "2026-03-03T00:00:00Z" }] } } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const busy = await fetchBusy(conn, new Date("2026-03-02T00:00:00Z"), new Date("2026-03-09T00:00:00Z"));
    expect(busy).toEqual([{ start: new Date("2026-03-02T23:00:00Z"), end: new Date("2026-03-03T00:00:00Z") }]);
    expect(fetchMock.mock.calls[0][0]).toContain("/freeBusy");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer access-1");
  });

  it("refreshes an expired token and marks the connection on invalid_grant", async () => {
    const { conn } = await connection();
    await prisma.calendarConnection.update({ where: { id: conn.id }, data: { tokenExpiresAt: new Date(Date.now() - 1000) } });
    const expired = await prisma.calendarConnection.findUniqueOrThrow({ where: { id: conn.id } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "invalid_grant", error_description: "Token has been expired or revoked." }), { status: 400 })));
    await expect(fetchBusy(expired, new Date(), new Date())).rejects.toThrow(/revoked/);
    const after = await prisma.calendarConnection.findUniqueOrThrow({ where: { id: conn.id } });
    expect(after.status).toBe("ERROR");
  });

  it("creates each task event once: deterministic id + link row prevent duplicates", async () => {
    const { conn, household, owner } = await connection();
    const t = await createTask(owner.id, household.id, { title: "Bathroom", startsOn: "2031-01-01" });
    const occ = await prisma.taskOccurrence.findFirstOrThrow({ where: { definitionId: t.id } });
    const calls: { method: string; url: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ method: String(init.method), url });
      // Simulate: the first POST "succeeded" at Google before a crash → a retry POST would 409
      if (init.method === "POST") return new Response("{}", { status: 409 });
      return new Response("{}", { status: 200 });
    }));
    const input = { id: occ.id, title: "Bathroom", start: new Date("2031-01-01T18:00:00Z"), end: new Date("2031-01-01T18:45:00Z"), householdName: "Apt" };
    const id1 = await upsertTaskEvent(conn, input);
    const id2 = await upsertTaskEvent(conn, input);
    expect(id1).toBe(eventIdFor(occ.id, conn.id));
    expect(id2).toBe(id1);
    expect(/^[a-v0-9]{5,1024}$/.test(id1)).toBe(true);
    expect(calls.map((c) => c.method)).toEqual(["POST", "PUT", "PUT"]);
    expect(await prisma.calendarEventLink.count({ where: { occurrenceId: occ.id } })).toBe(1);
  });
});
