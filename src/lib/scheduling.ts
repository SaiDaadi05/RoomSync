import { DateTime } from "luxon";

/**
 * Deterministic scheduling rules (no AI). Everything is computed on UTC instants;
 * availability rules are interpreted in each person's own timezone.
 */

export type Interval = { start: number; end: number }; // epoch ms

export type PersonInput = {
  id: string;
  name: string;
  timezone: string;
  preferredStartMin: number;
  preferredEndMin: number;
  /** Manual weekly availability in the person's timezone. Empty = "any time within preferred hours". */
  windows: { weekday: number; startMin: number; endMin: number }[];
  /** Busy blocks (from a connected calendar, or tasks already planned). Details never included. */
  busy: Interval[];
  /** Minutes of household work this person completed recently (for fairness). */
  recentMinutes: number;
};

export type TaskInput = {
  occurrenceId: string;
  title: string;
  minutes: number;
  dueAt: number;
  /** Fixed assignee, or null = anyone in `eligible` (or everyone if empty). */
  assigneeId: string | null;
  eligible: string[];
};

export type Proposal = {
  occurrenceId: string;
  title: string;
  assigneeId: string | null;
  start: number | null;
  end: number | null;
  ok: boolean;
  reason: string;
};

const MIN_GAP = 0;

export function subtract(free: Interval[], busy: Interval[]): Interval[] {
  let out = free;
  for (const b of busy) {
    const next: Interval[] = [];
    for (const f of out) {
      if (b.end <= f.start || b.start >= f.end) { next.push(f); continue; }
      if (b.start > f.start) next.push({ start: f.start, end: b.start });
      if (b.end < f.end) next.push({ start: b.end, end: f.end });
    }
    out = next;
  }
  return out.filter((i) => i.end - i.start > 0);
}

/** Free intervals for one person between from and to (epoch ms). */
export function freeIntervals(p: PersonInput, from: number, to: number): Interval[] {
  const out: Interval[] = [];
  let day = DateTime.fromMillis(from).setZone(p.timezone).startOf("day");
  const last = DateTime.fromMillis(to).setZone(p.timezone).endOf("day");
  while (day <= last) {
    const prefStart = day.plus({ minutes: p.preferredStartMin }).toMillis();
    const prefEnd = day.plus({ minutes: p.preferredEndMin }).toMillis();
    const rules = p.windows.length ? p.windows.filter((w) => w.weekday === day.weekday) : [{ startMin: p.preferredStartMin, endMin: p.preferredEndMin }];
    for (const w of rules) {
      const s = Math.max(day.plus({ minutes: w.startMin }).toMillis(), prefStart, from);
      const e = Math.min(day.plus({ minutes: w.endMin }).toMillis(), prefEnd, to);
      if (e > s) out.push({ start: s, end: e });
    }
    day = day.plus({ days: 1 });
  }
  return subtract(out.sort((a, b) => a.start - b.start), p.busy);
}

/** Round up to the next 15-minute boundary so suggestions look like times people pick. */
const roundUp = (t: number) => Math.ceil(t / (15 * 60_000)) * 15 * 60_000;

function findSlot(free: Interval[], minutes: number, deadline: number): Interval | null {
  const dur = minutes * 60_000;
  for (const f of free) {
    const start = roundUp(f.start);
    const end = start + dur;
    if (end <= f.end && end <= deadline) return { start, end };
  }
  return null;
}

function fmt(t: number, tz: string) {
  return DateTime.fromMillis(t).setZone(tz).toFormat("ccc h:mm a");
}

/**
 * Propose a time (and, for unassigned tasks, a person) for each task.
 * Rules, in order:
 *  1. Earliest deadline first; longer tasks first on ties.
 *  2. A slot must fit entirely inside the person's free time and finish before the deadline.
 *  3. For unassigned tasks, prefer the eligible person with the lowest workload,
 *     where workload = minutes already planned this run + half of recently completed minutes.
 *  4. Nothing is changed until a person accepts the proposal.
 */
export function proposeSchedule(people: PersonInput[], tasks: TaskInput[], opts: { from: number; to: number; householdTz: string }): Proposal[] {
  const free = new Map(people.map((p) => [p.id, freeIntervals(p, opts.from, opts.to)]));
  const planned = new Map(people.map((p) => [p.id, 0]));
  const byId = new Map(people.map((p) => [p.id, p]));
  const load = (id: string) => (planned.get(id) ?? 0) + Math.round((byId.get(id)?.recentMinutes ?? 0) / 2);

  const sorted = [...tasks].sort((a, b) => a.dueAt - b.dueAt || b.minutes - a.minutes || a.occurrenceId.localeCompare(b.occurrenceId));
  const out: Proposal[] = [];
  for (const t of sorted) {
    const deadline = Math.min(t.dueAt, opts.to);
    const pool = t.assigneeId ? [t.assigneeId] : (t.eligible.length ? t.eligible : people.map((p) => p.id)).filter((id) => byId.has(id));
    const ranked = [...pool].sort((a, b) => load(a) - load(b) || a.localeCompare(b));
    let chosen: { id: string; slot: Interval } | null = null;
    for (const id of ranked) {
      const slot = findSlot(free.get(id) ?? [], t.minutes, deadline);
      if (slot) { chosen = { id, slot }; break; }
    }
    if (!chosen) {
      const who = t.assigneeId ? byId.get(t.assigneeId)?.name ?? "The assignee" : "No one";
      out.push({
        occurrenceId: t.occurrenceId, title: t.title, assigneeId: t.assigneeId, start: null, end: null, ok: false,
        reason: `${who} has no free ${t.minutes}-minute block before it's due (${fmt(t.dueAt, opts.householdTz)}). Add availability or move the due date.`,
      });
      continue;
    }
    const p = byId.get(chosen.id)!;
    free.set(chosen.id, subtract(free.get(chosen.id)!, [{ start: chosen.slot.start - MIN_GAP, end: chosen.slot.end + MIN_GAP }]));
    const before = load(chosen.id);
    planned.set(chosen.id, (planned.get(chosen.id) ?? 0) + t.minutes);
    let reason = `${p.name.split(" ")[0]} is free ${fmt(chosen.slot.start, p.timezone)}, before it's due ${fmt(t.dueAt, opts.householdTz)}.`;
    if (!t.assigneeId && ranked.length > 1) {
      const skipped = ranked.slice(0, ranked.indexOf(chosen.id));
      reason = skipped.length
        ? `Suggested ${p.name.split(" ")[0]}: ${skipped.map((id) => byId.get(id)!.name.split(" ")[0]).join(", ")} ${skipped.length === 1 ? "has" : "have"} a lighter load but no free time before the deadline. ${reason}`
        : `Suggested ${p.name.split(" ")[0]}: lightest workload right now (~${before} min). ${reason}`;
    }
    out.push({ occurrenceId: t.occurrenceId, title: t.title, assigneeId: chosen.id, start: chosen.slot.start, end: chosen.slot.end, ok: true, reason });
  }
  return out;
}
