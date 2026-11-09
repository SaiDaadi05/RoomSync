import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { proposeSchedule, quietIntervals, type PersonInput } from "@/lib/scheduling";
import { makeHousehold } from "./helpers";
import { updateHouseRules } from "@/server/households";

const TZ = "America/New_York";
const at = (iso: string) => DateTime.fromISO(iso, { zone: TZ }).toMillis();

describe("quiet hours", () => {
  it("builds windows that wrap past midnight", () => {
    const q = quietIntervals({ startMin: 22 * 60, endMin: 8 * 60 }, at("2026-03-02T12:00"), at("2026-03-03T12:00"), TZ);
    expect(q).toContainEqual({ start: at("2026-03-02T22:00"), end: at("2026-03-03T08:00") });
    expect(quietIntervals(null, 0, 1, TZ)).toEqual([]);
  });

  it("never proposes a chore during quiet hours", () => {
    const p: PersonInput = { id: "a", name: "A", timezone: TZ, preferredStartMin: 0, preferredEndMin: 1440, windows: [{ weekday: 1, startMin: 20 * 60, endMin: 24 * 60 }], busy: [], recentMinutes: 0 };
    const task = { occurrenceId: "t", title: "Vacuum", minutes: 60, dueAt: at("2026-03-03T09:00"), assigneeId: "a", eligible: [] };
    const opts = { from: at("2026-03-02T00:00"), to: at("2026-03-04T00:00"), householdTz: TZ };
    expect(proposeSchedule([p], [task], opts)[0].start).toBe(at("2026-03-02T20:00"));
    const quiet = proposeSchedule([p], [task], { ...opts, quiet: { startMin: 19 * 60, endMin: 8 * 60 } });
    expect(quiet[0].ok).toBe(false); // the only free window is inside quiet hours
    const late = proposeSchedule([p], [task], { ...opts, quiet: { startMin: 22 * 60, endMin: 8 * 60 } });
    expect(late[0].start).toBe(at("2026-03-02T20:00"));
    expect(late[0].end! <= at("2026-03-02T22:00")).toBe(true);
  });
});

describe("house rules", () => {
  it("lets owners save rules and quiet hours, and validates them", async () => {
    const { household, owner, members } = await makeHousehold(1);
    const saved = await updateHouseRules(owner.id, household.id, { rules: "Dishes same night", quietStartMin: 1320, quietEndMin: 480 });
    expect(saved).toEqual({ rules: "Dishes same night", quietStartMin: 1320, quietEndMin: 480 });
    await expect(updateHouseRules(members[1].id, household.id, { rules: "x", quietStartMin: null, quietEndMin: null })).rejects.toThrow(/owner/);
    await expect(updateHouseRules(owner.id, household.id, { rules: "", quietStartMin: 600, quietEndMin: null })).rejects.toThrow(/both a start and an end/);
    expect(await updateHouseRules(owner.id, household.id, { rules: "  ", quietStartMin: null, quietEndMin: null })).toEqual({ rules: null, quietStartMin: null, quietEndMin: null });
  });
});
