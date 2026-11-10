import { DateTime } from "luxon";

export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export function isValidTimezone(tz: string): boolean {
  return DateTime.now().setZone(tz).isValid;
}

export function todayIn(tz: string): string {
  return DateTime.now().setZone(tz).toISODate()!;
}

/** Combine a local date + HH:mm in a timezone into a UTC Date. */
export function localToUtc(date: string, time: string, tz: string): Date {
  const dt = DateTime.fromISO(`${date}T${time}`, { zone: tz });
  if (!dt.isValid) throw new Error(`Invalid date/time: ${date} ${time}`);
  return dt.toUTC().toJSDate();
}

export function minutesToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function hhmmToMinutes(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) throw new Error("Use HH:MM");
  const v = Number(m[1]) * 60 + Number(m[2]);
  if (v < 0 || v > 24 * 60) throw new Error("Time out of range");
  return v;
}

export function formatDue(d: Date, tz: string): string {
  const dt = DateTime.fromJSDate(d).setZone(tz);
  const now = DateTime.now().setZone(tz);
  const time = dt.toFormat("h:mm a");
  if (dt.hasSame(now, "day")) return `Today ${time}`;
  if (dt.hasSame(now.plus({ days: 1 }), "day")) return `Tomorrow ${time}`;
  if (dt.hasSame(now.minus({ days: 1 }), "day")) return `Yesterday ${time}`;
  if (Math.abs(dt.diff(now, "days").days) < 6) return dt.toFormat("ccc h:mm a");
  return dt.toFormat("LLL d, h:mm a");
}

export const COMMON_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Toronto",
  "America/Vancouver",
  "America/Mexico_City",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "UTC",
];

/** "2026-11-07" → "Nov 7" (adds the year when it isn't this year). */
export function niceDate(isoDate: string, now = DateTime.now()) {
  const d = DateTime.fromISO(isoDate);
  if (!d.isValid) return isoDate;
  return d.toFormat(d.year === now.year ? "LLL d" : "LLL d, yyyy");
}
