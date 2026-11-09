import { describe, expect, it } from "vitest";
import { makeHousehold } from "./helpers";
import { createTask } from "@/server/tasks";
import { prisma } from "@/server/db";
import { deleteFeed, getFeed, renderFeed, resetFeed } from "@/server/calendar/feed";
import { leaveHousehold } from "@/server/households";
import { buildCalendar, escapeText, foldLine } from "@/lib/ics";

const tokenOf = (url: string) => url.split("/").pop()!.replace(/\.ics$/, "");
const today = new Date().toISOString().slice(0, 10);

describe("ics writer", () => {
  it("escapes text and folds long lines at 75 octets", () => {
    expect(escapeText("Dishes, pans; and\nmore\\")).toBe("Dishes\\, pans\\; and\\nmore\\\\");
    const long = "SUMMARY:" + "é".repeat(60);
    const folded = foldLine(long);
    for (const part of folded.split("\r\n")) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    expect(folded.split("\r\n").map((p, i) => (i ? p.slice(1) : p)).join("")).toBe(long);
  });

  it("writes a valid calendar with CRLF line endings", () => {
    const ics = buildCalendar("Test", [{ uid: "a@x", start: new Date("2026-11-10T01:00:00Z"), end: new Date("2026-11-10T01:15:00Z"), summary: "Trash" }], new Date("2026-11-09T00:00:00Z"));
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTART:20261110T010000Z\r\n");
    expect(ics).toContain("DTEND:20261110T011500Z\r\n");
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
  });
});

describe("calendar subscribe feed", () => {
  it("lists only my chores in this household", async () => {
    const { household, owner, members } = await makeHousehold(1);
    const mate = members[1]!;
    await createTask(owner.id, household.id, { title: "Mine: trash", startsOn: today, dueTime: "23:30", assignmentMode: "FIXED", assigneeId: owner.id });
    await createTask(owner.id, household.id, { title: "Theirs: dishes", startsOn: today, dueTime: "23:30", assignmentMode: "FIXED", assigneeId: mate.id });
    const other = await makeHousehold(0, "Other Apt");
    await createTask(other.owner.id, other.household.id, { title: "Other house chore", startsOn: today, dueTime: "23:30", assignmentMode: "FIXED", assigneeId: other.owner.id });

    const url = await resetFeed(owner.id, household.id);
    expect(url).toMatch(/\/api\/calendar\/feed\/[A-Za-z0-9_-]+\.ics$/);
    const ics = (await renderFeed(tokenOf(url)))!;
    expect(ics).toContain("SUMMARY:Mine: trash");
    expect(ics).not.toContain("Theirs");
    expect(ics).not.toContain("Other house");
    expect((await getFeed(owner.id, household.id))!.lastFetchedAt).not.toBeNull();
  });

  it("stores only a hash and an encrypted copy of the token", async () => {
    const { household, owner } = await makeHousehold(0);
    const url = await resetFeed(owner.id, household.id);
    const row = await prisma.calendarFeed.findFirstOrThrow({ where: { userId: owner.id } });
    expect(JSON.stringify(row)).not.toContain(tokenOf(url));
    expect((await getFeed(owner.id, household.id))!.url).toBe(url);
  });

  it("old links stop working after a reset or turning it off", async () => {
    const { household, owner } = await makeHousehold(0);
    const first = await resetFeed(owner.id, household.id);
    const second = await resetFeed(owner.id, household.id);
    expect(await renderFeed(tokenOf(first))).toBeNull();
    expect(await renderFeed(tokenOf(second))).not.toBeNull();
    await deleteFeed(owner.id, household.id);
    expect(await renderFeed(tokenOf(second))).toBeNull();
    expect(await getFeed(owner.id, household.id)).toBeNull();
  });

  it("stops working when the subscriber moves out", async () => {
    const { household, members } = await makeHousehold(1);
    const mate = members[1]!;
    const url = await resetFeed(mate.id, household.id);
    await leaveHousehold(mate.id, household.id);
    expect(await renderFeed(tokenOf(url))).toBeNull();
  });

  it("rejects malformed tokens and non-members", async () => {
    expect(await renderFeed("short")).toBeNull();
    expect(await renderFeed("x".repeat(32))).toBeNull();
    const a = await makeHousehold(0);
    const b = await makeHousehold(0);
    await expect(resetFeed(b.owner.id, a.household.id)).rejects.toThrow();
  });
});
