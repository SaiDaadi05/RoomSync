import { DateTime } from "luxon";

export type RecurrenceRule = {
  recurrence: "NONE" | "DAILY" | "WEEKLY";
  interval: number;
  weekdays: number[]; // ISO 1=Mon..7=Sun
  startsOn: string; // YYYY-MM-DD (local)
  endsOn?: string | null;
  dueTime: string; // HH:mm (local)
};

export type Slot = { sequence: number; dueAt: Date; localDate: string };

const MAX_SLOTS = 2000;

/**
 * Deterministically enumerate the due slots of a rule, in the given timezone,
 * returning those whose local date falls within [fromDate, toDate] (inclusive).
 * Sequence numbers count from the rule's first slot, so they are stable no matter
 * which window is requested — this is what makes rotation reproducible.
 */
export function generateSlots(rule: RecurrenceRule, tz: string, fromDate: string, toDate: string): Slot[] {
  const start = DateTime.fromISO(rule.startsOn, { zone: tz }).startOf("day");
  if (!start.isValid) throw new Error("Invalid start date");
  const end = rule.endsOn ? DateTime.fromISO(rule.endsOn, { zone: tz }).startOf("day") : null;
  const to = DateTime.fromISO(toDate, { zone: tz }).startOf("day");
  const from = DateTime.fromISO(fromDate, { zone: tz }).startOf("day");
  const last = end && end < to ? end : to;
  const interval = Math.max(1, Math.floor(rule.interval || 1));
  const [hh, mm] = rule.dueTime.split(":").map(Number);

  const toSlot = (d: DateTime, sequence: number): Slot => ({
    sequence,
    localDate: d.toISODate()!,
    dueAt: d.set({ hour: hh, minute: mm, second: 0, millisecond: 0 }).toUTC().toJSDate(),
  });

  const out: Slot[] = [];
  if (rule.recurrence === "NONE") {
    if (start >= from && start <= last) out.push(toSlot(start, 0));
    return out;
  }

  const weekdays = rule.recurrence === "WEEKLY"
    ? (rule.weekdays.length ? [...new Set(rule.weekdays)].sort() : [start.weekday])
    : [];
  const startWeek = start.startOf("week"); // Luxon weeks start Monday

  let seq = 0;
  for (let d = start, guard = 0; d <= last && guard < 366 * 20; d = d.plus({ days: 1 }), guard++) {
    let matches: boolean;
    if (rule.recurrence === "DAILY") {
      matches = Math.round(d.diff(start, "days").days) % interval === 0;
    } else {
      const weekIndex = Math.round(d.startOf("week").diff(startWeek, "weeks").weeks);
      matches = weekIndex % interval === 0 && weekdays.includes(d.weekday);
    }
    if (!matches) continue;
    if (d >= from) out.push(toSlot(d, seq));
    seq++;
    if (out.length >= MAX_SLOTS) break;
  }
  return out;
}

export function describeRule(rule: Pick<RecurrenceRule, "recurrence" | "interval" | "weekdays">): string {
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  if (rule.recurrence === "NONE") return "One-time";
  if (rule.recurrence === "DAILY") return rule.interval > 1 ? `Every ${rule.interval} days` : "Daily";
  const days = [...rule.weekdays].sort().map((d) => names[d - 1]).join(", ");
  const every = rule.interval > 1 ? `Every ${rule.interval} weeks` : "Weekly";
  return days ? `${every} on ${days}` : every;
}
