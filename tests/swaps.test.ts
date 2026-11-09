import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { makeHousehold } from "./helpers";
import { createTask, listOccurrences, completeOccurrence, assignOccurrence } from "@/server/tasks";
import { cancelSwap, listSwapRequests, requestSwap, respondToSwap } from "@/server/planner";
import { prisma } from "@/server/db";

const TZ = "America/New_York";

async function setup() {
  const h = await makeHousehold(2);
  const [me, them, other] = h.members;
  const d = DateTime.now().setZone(TZ).plus({ days: 3 }).toISODate()!;
  await createTask(me.id, h.household.id, { title: "Bathroom", startsOn: d, assignmentMode: "FIXED", assigneeId: me.id, estimatedMinutes: 45 });
  await createTask(me.id, h.household.id, { title: "Trash", startsOn: d, assignmentMode: "FIXED", assigneeId: them.id, estimatedMinutes: 10 });
  await createTask(me.id, h.household.id, { title: "Vacuum", startsOn: d, assignmentMode: "FIXED", assigneeId: other.id, estimatedMinutes: 20 });
  const occs = await listOccurrences(me.id, h.household.id);
  const t = (title: string) => occs.find((o) => o.definition.title === title)!;
  return { ...h, me, them, other, mine: t("Bathroom"), theirs: t("Trash"), third: t("Vacuum") };
}
const owner = (id: string) => prisma.taskOccurrence.findUniqueOrThrow({ where: { id } }).then((o) => o.assigneeId);

describe("swap requests", () => {
  it("changes nothing until the other roommate accepts, then trades and notifies", async () => {
    const { me, them, mine, theirs, household } = await setup();
    const req = await requestSwap(me.id, mine.id, theirs.id, "Exam on Thursday");
    expect(await owner(mine.id)).toBe(me.id);
    expect(await owner(theirs.id)).toBe(them.id);
    expect(await prisma.notification.count({ where: { userId: them.id, type: "swap_requested" } })).toBe(1);
    const { incoming } = await listSwapRequests(them.id, household.id);
    expect(incoming.map((r) => r.id)).toEqual([req.id]);

    await expect(respondToSwap(me.id, req.id, true)).rejects.toThrow(/Only the roommate being asked/);
    expect(await respondToSwap(them.id, req.id, true)).toBe("ACCEPTED");
    expect(await owner(mine.id)).toBe(them.id);
    expect(await owner(theirs.id)).toBe(me.id);
    expect(await prisma.notification.count({ where: { userId: me.id, type: "swap_accepted" } })).toBe(1);
    await expect(respondToSwap(them.id, req.id, true)).rejects.toThrow(/already answered/);
  });

  it("decline and cancel leave ownership alone", async () => {
    const { me, them, mine, theirs } = await setup();
    const r1 = await requestSwap(me.id, mine.id, theirs.id);
    await expect(requestSwap(me.id, mine.id, theirs.id)).rejects.toThrow(/already asked/);
    expect(await respondToSwap(them.id, r1.id, false)).toBe("DECLINED");
    const r2 = await requestSwap(me.id, mine.id, theirs.id);
    await expect(cancelSwap(them.id, r2.id)).rejects.toThrow(/Only the person who asked/);
    await cancelSwap(me.id, r2.id);
    expect(await owner(mine.id)).toBe(me.id);
    expect(await owner(theirs.id)).toBe(them.id);
  });

  it("only offers your own task, within your household", async () => {
    const { me, them, other, mine, theirs, third } = await setup();
    await expect(requestSwap(me.id, theirs.id, third.id)).rejects.toThrow(/assigned to you/);
    await expect(requestSwap(me.id, mine.id, mine.id)).rejects.toThrow(/another roommate/);
    const outsider = await makeHousehold(0);
    await expect(requestSwap(outsider.owner.id, mine.id, theirs.id)).rejects.toThrow(/not a member/);
    void them; void other;
  });

  it("expires instead of swapping when a task changed after the request", async () => {
    const { me, them, other, mine, theirs, household } = await setup();
    const req = await requestSwap(me.id, mine.id, theirs.id);
    await completeOccurrence(them.id, theirs.id);
    await expect(respondToSwap(them.id, req.id, true)).rejects.toThrow(/no longer applies/);
    expect(await owner(mine.id)).toBe(me.id);
    expect((await prisma.swapRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("EXPIRED");
    // Reassignment also invalidates, and stale requests drop out of the list on read
    const vacuum = (await listOccurrences(me.id, household.id)).find((o) => o.definition.title === "Vacuum")!;
    const r2 = await requestSwap(me.id, mine.id, vacuum.id);
    await assignOccurrence(me.id, mine.id, other.id);
    const { incoming } = await listSwapRequests(other.id, household.id);
    expect(incoming.find((r) => r.id === r2.id)).toBeUndefined();
  });

  it("two simultaneous accepts of competing requests can't double-trade a task", async () => {
    const { me, them, other, mine, theirs, third } = await setup();
    // I offer the same task to two roommates; both accept at the same instant.
    const toThem = await requestSwap(me.id, mine.id, theirs.id);
    const toOther = await requestSwap(me.id, mine.id, third.id);
    const results = await Promise.allSettled([respondToSwap(them.id, toThem.id, true), respondToSwap(other.id, toOther.id, true)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const owners = [await owner(mine.id), await owner(theirs.id), await owner(third.id)];
    // Exactly one trade happened: I hold exactly one of the two other tasks, and nobody holds two.
    expect(owners.filter((o) => o === me.id)).toHaveLength(1);
    expect(new Set(owners).size).toBe(3);
  });
});
