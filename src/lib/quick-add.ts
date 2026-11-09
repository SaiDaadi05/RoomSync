import { DateTime } from "luxon";

/**
 * One box for everything: "trash every Tue", "paper towels", "$42 pizza".
 * Deterministic rules only, so the preview under the box always matches what gets saved.
 */
export type QuickAddResult =
  | { kind: "task"; title: string; category: string; recurrence: "NONE" | "DAILY" | "WEEKLY"; interval: number; weekdays: number[]; startsOn: string; dueTime: string; assigneeId: string | null; summary: string }
  | { kind: "shopping"; name: string; quantity: string; summary: string }
  | { kind: "expense"; description: string; amount: string; summary: string };

type Ctx = { today: string; tz: string; currentUserId: string; members: { id: string; name: string }[] };

const DAYS: Record<string, number> = {
  mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5, sat: 6, saturday: 6, sun: 7, sunday: 7,
};
const DAY_RE = "(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:s|nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)";
const DAY_NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Words that start a chore or errand. Anything else with no date, time or person is treated as a shopping item.
const TASK_VERBS = new Set([
  "clean", "wash", "take", "vacuum", "mop", "dust", "wipe", "empty", "unload", "load", "do", "fix", "water", "pay", "call",
  "pick", "return", "cook", "sweep", "scrub", "tidy", "organize", "organise", "change", "replace", "feed", "walk", "drop",
  "put", "make", "book", "shop", "schedule", "deep", "defrost", "descale", "sort", "fold", "hang", "iron", "shovel", "mow", "rake",
  "laundry", "dishes", "trash", "recycling", "garbage", "bins", "bathroom", "kitchen", "fridge", "floors", "groceries", "grocery",
]);

const SHOP_PREFIX = /^(?:buy|get|grab|need|we need|we're out of|were out of|out of|running low on|low on|add)\s+/i;
const SHOP_SUFFIX = /\s+(?:to|on)\s+(?:the\s+)?(?:shopping\s+)?list$/i;

export function guessCategory(title: string): string {
  const t = title.toLowerCase();
  if (/\b(trash|recycl|garbage|bins?|compost)\b/.test(t)) return "trash";
  if (/\b(laundry|fold|iron|sheets|towels)\b/.test(t)) return "laundry";
  if (/\b(bathroom|toilet|shower|tub|sink)\b/.test(t)) return "bathroom";
  if (/\b(dish|dishes|dishwasher|kitchen|cook|fridge|oven|stove|microwave)\b/.test(t)) return "kitchen";
  if (/\b(grocer|shop|costco|market)\b/.test(t)) return "groceries";
  if (/\b(rent|bill|internet|wifi|utilities|electric)\b/.test(t)) return "bills";
  if (/\b(pick up|drop off|return|post office|pharmacy|bank|call|book)\b/.test(t)) return "errands";
  return "cleaning";
}

function parseTime(raw: string): string | null {
  const m = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ap = m[3]?.toLowerCase();
  if (!ap && !m[2]) return null; // a bare number is too ambiguous ("2 sponges")
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

const fmtTime = (hhmm: string) => DateTime.fromFormat(hhmm, "HH:mm").toFormat("h:mm a").replace(":00 ", " ");

export function parseQuickAdd(input: string, ctx: Ctx): QuickAddResult | null {
  let text = input.trim().replace(/\s+/g, " ");
  if (!text) return null;

  // ---- Expense: "$42 pizza" or "pizza $42" ----
  const money = text.match(/^\$\s?(\d+(?:\.\d{1,2})?)\s+(.+)$/) ?? text.match(/^(.+?)\s+\$\s?(\d+(?:\.\d{1,2})?)$/);
  if (money) {
    const [amount, description] = text.startsWith("$") ? [money[1]!, money[2]!] : [money[2]!, money[1]!];
    return { kind: "expense", amount: Number(amount).toFixed(2), description: cap(description), summary: `Opens a new $${Number(amount).toFixed(2)} expense for “${cap(description)}” so you can choose the split` };
  }

  // ---- Shopping with an explicit cue ----
  const explicitShop = SHOP_PREFIX.test(text) || SHOP_SUFFIX.test(text);
  if (explicitShop) return shopping(text.replace(SHOP_PREFIX, "").replace(SHOP_SUFFIX, ""));

  // ---- Task signals ----
  const today = DateTime.fromISO(ctx.today, { zone: ctx.tz });
  let recurrence = "NONE" as "NONE" | "DAILY" | "WEEKLY";
  let interval = 1;
  let weekdays: number[] = [];
  let date = null as DateTime | null;
  let time = null as string | null;
  let assigneeId = null as string | null;
  let signal = false;
  const take = (re: RegExp, fn: (m: RegExpMatchArray) => boolean | void) => {
    const m = text.match(re);
    if (m && fn(m) !== false) { text = (text.slice(0, m.index) + " " + text.slice(m.index! + m[0].length)).replace(/\s+/g, " ").trim(); signal = true; }
  };

  // Person: "@jordan", "for jordan", "- jordan" at the end. "me" means you.
  const findMember = (name: string) => {
    const n = name.toLowerCase();
    if (n === "me" || n === "myself") return ctx.currentUserId;
    return ctx.members.find((m) => m.name.toLowerCase() === n || m.name.toLowerCase().split(" ")[0] === n)?.id ?? null;
  };
  let unknownName: string | null = null;
  take(/(?:^|\s)@([a-z][\w'-]*)/i, (m) => { const id = findMember(m[1]!); if (!id) { unknownName = m[1]!; return; } assigneeId = id; });
  if (!assigneeId) take(/\s(?:for|-|–)\s([a-z][\w'-]*)$/i, (m) => { const id = findMember(m[1]!); if (!id) return false; assigneeId = id; });

  // Recurrence
  take(/\b(?:every ?day|daily|each day)\b/i, () => { recurrence = "DAILY"; });
  take(/\bevery weekday\b|\bon weekdays\b|\bweekdays\b/i, () => { recurrence = "WEEKLY"; weekdays = [1, 2, 3, 4, 5]; });
  take(/\bevery weekend\b|\bon weekends\b|\bweekends\b/i, () => { recurrence = "WEEKLY"; weekdays = [6, 7]; });
  take(new RegExp(`\\bevery (other )?${DAY_RE}((?:(?:,| and|,? &| ?/) ?${DAY_RE})*)\\b`, "i"), (m) => {
    recurrence = "WEEKLY";
    interval = m[1] ? 2 : 1;
    const all = m[0].toLowerCase().match(new RegExp(DAY_RE, "gi")) ?? [];
    weekdays = [...new Set(all.map((d) => DAYS[d.toLowerCase()]!))].sort();
  });
  take(/\b(?:every other week|biweekly|fortnightly)\b/i, () => { recurrence = "WEEKLY"; interval = 2; weekdays = weekdays.length ? weekdays : [today.weekday]; });
  take(/\b(?:every week|weekly|each week)\b/i, () => { recurrence = "WEEKLY"; weekdays = weekdays.length ? weekdays : [today.weekday]; });

  // Date
  take(/\btonight\b/i, () => { date = today; time = time ?? "21:00"; });
  take(/\btoday\b/i, () => { date = today; });
  take(/\btomorrow\b|\btmrw\b|\btmr\b/i, () => { date = today.plus({ days: 1 }); });
  if (recurrence === "NONE") {
    take(new RegExp(`\\b(?:on |this |next )?${DAY_RE}\\b`, "i"), (m) => {
      const wd = DAYS[m[1]!.toLowerCase()]!;
      let d = today.plus({ days: (wd - today.weekday + 7) % 7 });
      if (/^next /i.test(m[0]) && d <= today.plus({ days: 6 })) d = d.plus({ days: d.equals(today) ? 7 : 0 });
      date = d;
    });
  }

  // Time
  take(/\b(?:at |by |@ ?)?(\d{1,2}(?::\d{2})?\s?(?:am|pm)|\d{1,2}:\d{2})\b/i, (m) => { const t = parseTime(m[1]!.replace(/\s/g, "")); if (!t) return false; time = t; });
  take(/\b(?:at |by )?noon\b/i, () => { time = "12:00"; });
  take(/\b(?:in the |this )?morning\b/i, () => { time = "09:00"; });
  take(/\b(?:in the |this )?evening\b/i, () => { time = "19:00"; });

  text = text.replace(/^(?:and|on|at|by)\s+|\s+(?:and|on|at|by)$/gi, "").trim();
  if (!text) return null;

  const firstWord = text.split(" ")[0]!.toLowerCase();
  if (!signal && !TASK_VERBS.has(firstWord)) return shopping(text);

  const title = cap(text);
  const startsOn = (date ?? (recurrence === "WEEKLY" ? nextOf(today, weekdays) : today)).toISODate()!;
  const dueTime = time ?? "20:00";
  const who = assigneeId ? (assigneeId === ctx.currentUserId ? "you" : ctx.members.find((m) => m.id === assigneeId)!.name.split(" ")[0]) : "anyone";
  const when =
    recurrence === "DAILY" ? "every day" :
    recurrence === "WEEKLY" ? (weekdays.length === 5 && weekdays[4] === 5 ? "every weekday" : `every ${interval === 2 ? "other " : ""}${weekdays.map((d) => DAY_NAMES[d]).join(", ")}`) :
    startsOn === ctx.today ? "today" :
    startsOn === today.plus({ days: 1 }).toISODate() ? "tomorrow" :
    DateTime.fromISO(startsOn).toFormat("ccc LLL d");
  return {
    kind: "task", title, category: guessCategory(title), recurrence, interval, weekdays, startsOn, dueTime, assigneeId,
    summary: `Chore “${title}”, ${when} at ${fmtTime(dueTime)}, for ${who}${unknownName ? ` (no roommate called “${unknownName}”)` : ""}`,
  };
}

function nextOf(today: DateTime, weekdays: number[]) {
  for (let i = 0; i < 7; i++) {
    const d = today.plus({ days: i });
    if (weekdays.includes(d.weekday)) return d;
  }
  return today;
}

function cap(s: string) {
  const t = s.trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function shopping(raw: string): QuickAddResult | null {
  let name = raw.trim();
  let quantity = "1";
  const lead = name.match(/^(\d+)\s*(?:x\s+)?(.+)$/i);
  const trail = name.match(/^(.+?)\s+x\s?(\d+)$/i);
  if (lead && !/^\d+\s*(?:oz|lb|g|kg|ml|l|pack|ct)\b/i.test(name)) { quantity = lead[1]!; name = lead[2]!; }
  else if (trail) { name = trail[1]!; quantity = trail[2]!; }
  name = cap(name);
  if (!name) return null;
  return { kind: "shopping", name, quantity, summary: `Adds ${quantity !== "1" ? `${quantity} × ` : ""}“${name}” to the shopping list` };
}
