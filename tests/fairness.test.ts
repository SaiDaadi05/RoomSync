import { describe, expect, it } from "vitest";
import { suggestRebalance, type FairPerson, type FairTask } from "@/lib/fairness";

const person = (id: string, weekMinutes: number, recentMinutes = 0): FairPerson => ({ id, name: id.toUpperCase(), weekMinutes, recentMinutes });
const task = (id: string, assigneeId: string, minutes: number, eligible: string[] | null = null): FairTask => ({ id, title: id, assigneeId, minutes, eligible });

describe("suggestRebalance", () => {
  it("moves work from the most loaded person to the least loaded one", () => {
    const moves = suggestRebalance(
      [person("a", 120), person("b", 20)],
      [task("t1", "a", 60), task("t2", "a", 45), task("t3", "a", 15)],
    );
    // 120 vs 20 → moving 45 gives 75 vs 65 (best single move); after that nothing improves by ≥10.
    expect(moves.map((m) => [m.occurrenceId, m.fromUserId, m.toUserId])).toEqual([["t2", "a", "b"]]);
    expect(moves[0].reason).toContain("75 vs 65");
  });

  it("does nothing when the household is already balanced", () => {
    expect(suggestRebalance([person("a", 60), person("b", 55)], [task("t1", "a", 30)])).toEqual([]);
  });

  it("respects rotation eligibility", () => {
    const moves = suggestRebalance(
      [person("a", 100), person("b", 40), person("c", 20)],
      [task("t1", "a", 40, ["a", "b"])],
    );
    // c is lighter, but isn't in this task's rotation.
    expect(moves).toHaveLength(1);
    expect(moves[0].toUserId).toBe("b");
  });

  it("counts recent completed work, so a busy last week isn't rewarded with more", () => {
    // Same week load, but b did a lot recently → a is lighter overall, so a's tasks don't move to b.
    const moves = suggestRebalance([person("a", 60, 0), person("b", 30, 200)], [task("t1", "a", 30)]);
    expect(moves).toEqual([]);
  });

  it("is deterministic and never moves a task twice", () => {
    const people = [person("a", 200), person("b", 0), person("c", 0)];
    const tasks = [task("t1", "a", 50), task("t2", "a", 50), task("t3", "a", 50), task("t4", "a", 50)];
    const one = suggestRebalance(people, tasks);
    expect(suggestRebalance(people, tasks)).toEqual(one);
    expect(new Set(one.map((m) => m.occurrenceId)).size).toBe(one.length);
    expect(one.map((m) => m.toUserId).sort()).toEqual(["b", "c"]);
  });
});
