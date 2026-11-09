/**
 * "Rebalance this week": suggest moving already-assigned tasks from the most loaded
 * roommate to the least loaded one. Pure and deterministic. It only *suggests*; the
 * server turns a suggestion into a handoff request that the other person must accept.
 *
 * Load matches the scheduler: this week's assigned minutes + half of recently completed
 * minutes, so someone who did a lot last week isn't handed even more.
 */

export type FairPerson = { id: string; name: string; weekMinutes: number; recentMinutes: number };
export type FairTask = {
  id: string;
  title: string;
  assigneeId: string;
  minutes: number;
  /** Who may take it. null = anyone in the household. */
  eligible: string[] | null;
};
export type RebalanceMove = {
  occurrenceId: string;
  title: string;
  fromUserId: string;
  toUserId: string;
  minutes: number;
  reason: string;
};

export const loadOf = (p: Pick<FairPerson, "weekMinutes" | "recentMinutes">) => p.weekMinutes + p.recentMinutes / 2;

/** Moves are suggested only when they shrink the gap meaningfully. */
export const MIN_IMPROVEMENT_MINUTES = 10;
const MAX_MOVES = 5;

export function suggestRebalance(people: FairPerson[], tasks: FairTask[]): RebalanceMove[] {
  if (people.length < 2) return [];
  const load = new Map(people.map((p) => [p.id, loadOf(p)]));
  const week = new Map(people.map((p) => [p.id, p.weekMinutes]));
  const name = new Map(people.map((p) => [p.id, p.name.split(" ")[0]]));
  const recent = new Map(people.map((p) => [p.id, p.recentMinutes]));
  const pool = tasks.filter((t) => load.has(t.assigneeId)).map((t) => ({ ...t }));
  const moved = new Set<string>();
  const moves: RebalanceMove[] = [];

  for (let i = 0; i < MAX_MOVES; i++) {
    // Deterministic order: by load, then id.
    const ranked = [...load.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const [heavy, heavyLoad] = ranked[0];
    let best: { task: (typeof pool)[number]; to: string; spread: number } | null = null;
    const spreadNow = heavyLoad - ranked[ranked.length - 1][1];

    for (const [to, toLoad] of [...ranked].reverse()) {
      if (to === heavy) continue;
      for (const t of pool) {
        if (moved.has(t.id) || t.assigneeId !== heavy) continue;
        if (t.eligible && !t.eligible.includes(to)) continue;
        // Spread after the move, across everyone.
        const after = new Map(load);
        after.set(heavy, heavyLoad - t.minutes);
        after.set(to, toLoad + t.minutes);
        const vals = [...after.values()];
        const spread = Math.max(...vals) - Math.min(...vals);
        if (spreadNow - spread < MIN_IMPROVEMENT_MINUTES) continue;
        if (!best || spread < best.spread || (spread === best.spread && t.id < best.task.id)) best = { task: t, to, spread };
      }
    }
    if (!best) break;

    const { task, to } = best;
    const fromBefore = week.get(heavy)!;
    const toBefore = week.get(to)!;
    load.set(heavy, heavyLoad - task.minutes);
    load.set(to, load.get(to)! + task.minutes);
    week.set(heavy, fromBefore - task.minutes);
    week.set(to, toBefore + task.minutes);
    moved.add(task.id);
    moves.push({
      occurrenceId: task.id,
      title: task.title,
      fromUserId: heavy,
      toUserId: to,
      minutes: task.minutes,
      reason:
        `${name.get(heavy)} has ${fromBefore} min this week and ${name.get(to)} has ${toBefore}. ` +
        `Moving this ${task.minutes}-min task makes it ${fromBefore - task.minutes} vs ${toBefore + task.minutes}.` +
        (recent.get(heavy) !== recent.get(to)
          ? ` Completed work from the last 2 weeks counts too (${name.get(heavy)} ${recent.get(heavy)} min, ${name.get(to)} ${recent.get(to)} min).`
          : ""),
    });
  }
  return moves;
}
