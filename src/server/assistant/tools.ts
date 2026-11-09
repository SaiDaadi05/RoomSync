import { z } from "zod";
import { DateTime } from "luxon";
import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../db";
import { activeMembers, assertAllMembers, requireMember } from "../access";
import { invalid, notFound } from "../errors";
import { computeBalances, EXPENSE_CATEGORIES, listLedger } from "../expenses";
import { listShopping } from "../shopping";
import { listOccurrences } from "../tasks";
import { workloadSummary, weekBounds } from "../planner";
import { formatCents, splitEqually } from "@/lib/money";
import { todayIn } from "@/lib/time";

/**
 * The assistant's tools, grouped by area. "read" tools run immediately and only read
 * household data the user can already see. "draft" tools never change anything: they
 * validate the request and store an AssistantAction that the user must confirm.
 */

export type ToolContext = {
  userId: string;
  householdId: string;
  timezone: string;
  members: { id: string; name: string }[];
};

export type Area = "expenses" | "shopping" | "chores" | "planner";

type ToolDef = {
  area: Area;
  mode: "read" | "draft";
  tool: Anthropic.Beta.BetaTool;
  run: (ctx: ToolContext, input: unknown) => Promise<string>;
};

const obj = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object" as const,
  properties,
  required,
  additionalProperties: false,
});

const nameOf = (ctx: ToolContext, id: string) => ctx.members.find((m) => m.id === id)?.name.split(" ")[0] ?? "a former roommate";
const dateOk = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && DateTime.fromISO(s).isValid;

async function saveDraft(ctx: ToolContext, kind: string, payload: unknown, summary: string) {
  const a = await prisma.assistantAction.create({
    data: { householdId: ctx.householdId, userId: ctx.userId, kind, payload: payload as object, summary },
  });
  return `Drafted (id ${a.id}): ${summary}. Nothing has changed yet. The user will see a Confirm button for this draft.`;
}

// ---------------- Expenses ----------------

const expenseDraftSchema = z.object({
  description: z.string().trim().min(1).max(140),
  amount_cents: z.number().int().positive().max(100_000_000),
  paid_by: z.string().min(1),
  split_between: z.array(z.string().min(1)).min(1),
  category: z.string().trim().max(40).optional(),
  date: z.string().optional(),
});

const settlementDraftSchema = z.object({
  from_user: z.string().min(1),
  to_user: z.string().min(1),
  amount_cents: z.number().int().positive().max(100_000_000),
  note: z.string().trim().max(200).optional(),
});

// ---------------- Shopping ----------------

const addItemsSchema = z.object({
  items: z.array(z.object({ name: z.string().trim().min(1).max(100), quantity: z.string().trim().max(30).optional() })).min(1).max(30),
});
const markBoughtSchema = z.object({ item_ids: z.array(z.string().min(1)).min(1).max(50) });

// ---------------- Chores ----------------

const taskDraftSchema = z.object({
  title: z.string().trim().min(1).max(120),
  due_date: z.string(),
  due_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  assignee: z.string().optional(),
  estimated_minutes: z.number().int().min(1).max(1440).optional(),
  repeat: z.enum(["none", "daily", "weekly"]).optional(),
  weekdays: z.array(z.number().int().min(1).max(7)).optional(),
});
const completeSchema = z.object({ occurrence_id: z.string().min(1) });

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw invalid(r.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "));
  return r.data;
}

export const TOOLS: ToolDef[] = [
  // ---- expenses ----
  {
    area: "expenses",
    mode: "read",
    tool: {
      name: "expenses_get_balances",
      description: "Who owes whom in this household right now, after all expenses and settlements. Amounts are in cents; positive means the household owes that person.",
      input_schema: obj({}, []),
      strict: true,
    },
    run: async (ctx) => {
      const { balances, suggestions } = await computeBalances(ctx.userId, ctx.householdId);
      return JSON.stringify({
        balances: balances.map((b) => ({ user_id: b.userId, name: b.name, net_cents: b.cents, net: formatCents(b.cents), active: b.active })),
        simplest_payments: suggestions.map((s) => ({ from_user: s.fromUserId, to_user: s.toUserId, amount_cents: s.amountCents, amount: formatCents(s.amountCents) })),
      });
    },
  },
  {
    area: "expenses",
    mode: "read",
    tool: {
      name: "expenses_list_recent",
      description: "The household's most recent expenses and settlements, newest first.",
      input_schema: obj({ limit: { type: "integer", description: "How many entries, 1-30." } }, ["limit"]),
      strict: true,
    },
    run: async (ctx, input) => {
      const limit = Math.max(1, Math.min(30, Number((input as { limit?: number }).limit) || 10));
      const entries = await listLedger(ctx.userId, ctx.householdId, limit);
      return JSON.stringify(entries.slice(0, limit).map((e) => e.kind === "expense"
        ? { kind: "expense", date: e.date, description: e.expense.description, amount: formatCents(e.expense.amountCents), paid_by: nameOf(ctx, e.expense.payerId), split_between: e.expense.splits.map((s) => nameOf(ctx, s.userId)) }
        : { kind: "settlement", date: e.date, from: nameOf(ctx, e.settlement.fromUserId), to: nameOf(ctx, e.settlement.toUserId), amount: formatCents(e.settlement.amountCents) }));
    },
  },
  {
    area: "expenses",
    mode: "draft",
    tool: {
      name: "expenses_draft_expense",
      description: "Draft a shared expense split equally between the listed people. Does NOT save it: the user confirms first. Use member ids from the context. Amount is integer cents (e.g. $12.50 = 1250).",
      input_schema: obj({
        description: { type: "string", description: "Short description, e.g. 'Internet (November)'." },
        amount_cents: { type: "integer" },
        paid_by: { type: "string", description: "Member id of who paid." },
        split_between: { type: "array", items: { type: "string" }, description: "Member ids sharing the cost (usually everyone, including the payer)." },
        category: { type: "string", enum: [...EXPENSE_CATEGORIES] },
        date: { type: "string", description: "YYYY-MM-DD in the household timezone. Today if not mentioned." },
      }, ["description", "amount_cents", "paid_by", "split_between", "category", "date"]),
      strict: true,
    },
    run: async (ctx, input) => {
      const d = parse(expenseDraftSchema, input);
      const people = [...new Set(d.split_between)];
      await assertAllMembers(ctx.householdId, [d.paid_by, ...people]);
      const date = d.date && dateOk(d.date) ? d.date : todayIn(ctx.timezone);
      const category = d.category && (EXPENSE_CATEGORIES as readonly string[]).includes(d.category) ? d.category : "other";
      const shares = splitEqually(d.amount_cents, people.length);
      const payload = { payerId: d.paid_by, amountCents: d.amount_cents, date, description: d.description, category, splitMethod: "EQUAL", participants: people.map((userId) => ({ userId })) };
      const summary = `Add expense “${d.description}” for ${formatCents(d.amount_cents)} on ${date}, paid by ${nameOf(ctx, d.paid_by)}, split equally: ` +
        people.map((p, i) => `${nameOf(ctx, p)} ${formatCents(shares[i])}`).join(", ");
      return saveDraft(ctx, "add_expense", payload, summary);
    },
  },
  {
    area: "expenses",
    mode: "draft",
    tool: {
      name: "expenses_draft_settlement",
      description: "Draft a record that one roommate paid another back (bookkeeping only; no money moves). Does NOT save it: the user confirms first.",
      input_schema: obj({
        from_user: { type: "string", description: "Member id of who paid." },
        to_user: { type: "string", description: "Member id of who received it." },
        amount_cents: { type: "integer" },
        note: { type: "string" },
      }, ["from_user", "to_user", "amount_cents", "note"]),
      strict: true,
    },
    run: async (ctx, input) => {
      const d = parse(settlementDraftSchema, input);
      if (d.from_user === d.to_user) throw invalid("from_user and to_user must be different people");
      await assertAllMembers(ctx.householdId, [d.from_user, d.to_user]);
      const payload = { fromUserId: d.from_user, toUserId: d.to_user, amountCents: d.amount_cents, date: todayIn(ctx.timezone), note: d.note || null };
      return saveDraft(ctx, "record_settlement", payload, `Record that ${nameOf(ctx, d.from_user)} paid ${nameOf(ctx, d.to_user)} back ${formatCents(d.amount_cents)} (bookkeeping only)`);
    },
  },

  // ---- shopping ----
  {
    area: "shopping",
    mode: "read",
    tool: {
      name: "shopping_list",
      description: "Items currently on the shared shopping list (not yet bought), with ids.",
      input_schema: obj({}, []),
      strict: true,
    },
    run: async (ctx) => {
      const { open } = await listShopping(ctx.userId, ctx.householdId);
      return JSON.stringify(open.map((i) => ({ id: i.id, name: i.name, quantity: i.quantity, status: i.status, claimed_by: i.claimedById ? nameOf(ctx, i.claimedById) : null })));
    },
  },
  {
    area: "shopping",
    mode: "draft",
    tool: {
      name: "shopping_draft_add_items",
      description: "Draft adding items to the shared shopping list. Does NOT save: the user confirms first.",
      input_schema: obj({
        items: { type: "array", items: obj({ name: { type: "string" }, quantity: { type: "string", description: "e.g. '2' or '1 gallon'. Use '1' if not given." } }, ["name", "quantity"]) },
      }, ["items"]),
      strict: true,
    },
    run: async (ctx, input) => {
      const d = parse(addItemsSchema, input);
      await requireMember(ctx.userId, ctx.householdId);
      const items = d.items.map((i) => ({ name: i.name, quantity: i.quantity || "1" }));
      return saveDraft(ctx, "add_shopping_items", { items }, `Add to the shopping list: ${items.map((i) => (i.quantity !== "1" ? `${i.name} (${i.quantity})` : i.name)).join(", ")}`);
    },
  },
  {
    area: "shopping",
    mode: "draft",
    tool: {
      name: "shopping_draft_mark_bought",
      description: "Draft marking shopping-list items as bought by the user. Use ids from shopping_list. Does NOT save: the user confirms first. To also split the cost, draft an expense separately.",
      input_schema: obj({ item_ids: { type: "array", items: { type: "string" } } }, ["item_ids"]),
      strict: true,
    },
    run: async (ctx, input) => {
      const d = parse(markBoughtSchema, input);
      const items = await prisma.shoppingItem.findMany({ where: { id: { in: d.item_ids }, householdId: ctx.householdId, status: { not: "PURCHASED" } } });
      if (items.length !== new Set(d.item_ids).size) throw notFound("Some of those items (they may already be bought)");
      return saveDraft(ctx, "mark_bought", { itemIds: items.map((i) => i.id) }, `Mark as bought by you: ${items.map((i) => i.name).join(", ")}`);
    },
  },

  // ---- chores ----
  {
    area: "chores",
    mode: "read",
    tool: {
      name: "chores_list_open",
      description: "Pending chores and errands due in the next 14 days or overdue, with occurrence ids, assignee, and due time in the household timezone.",
      input_schema: obj({ only_mine: { type: "boolean", description: "Only tasks assigned to the user." } }, ["only_mine"]),
      strict: true,
    },
    run: async (ctx, input) => {
      const mine = Boolean((input as { only_mine?: boolean }).only_mine);
      const occs = await listOccurrences(ctx.userId, ctx.householdId, { status: "PENDING", to: new Date(Date.now() + 14 * 86400_000), assigneeId: mine ? ctx.userId : undefined, take: 60 });
      const now = new Date();
      return JSON.stringify(occs.map((o) => ({
        occurrence_id: o.id,
        title: o.definition.title,
        due: DateTime.fromJSDate(o.dueAt).setZone(ctx.timezone).toFormat("ccc LLL d, h:mm a"),
        overdue: o.dueAt < now,
        assignee: o.assigneeId ? nameOf(ctx, o.assigneeId) : "unassigned",
        minutes: o.definition.estimatedMinutes,
      })));
    },
  },
  {
    area: "chores",
    mode: "draft",
    tool: {
      name: "chores_draft_task",
      description: "Draft a new chore or errand (one-time, daily, or weekly). Does NOT save: the user confirms first. Assigning it to someone other than the user notifies them.",
      input_schema: obj({
        title: { type: "string" },
        due_date: { type: "string", description: "YYYY-MM-DD (first due date for repeating tasks)." },
        due_time: { type: "string", description: "HH:mm 24-hour. Use 20:00 if not given." },
        assignee: { type: "string", description: "Member id, or empty string for unassigned." },
        estimated_minutes: { type: "integer", description: "Use 15 if not given." },
        repeat: { type: "string", enum: ["none", "daily", "weekly"] },
        weekdays: { type: "array", items: { type: "integer" }, description: "For weekly: ISO weekdays 1=Mon..7=Sun. Empty otherwise." },
      }, ["title", "due_date", "due_time", "assignee", "estimated_minutes", "repeat", "weekdays"]),
      strict: true,
    },
    run: async (ctx, input) => {
      const d = parse(taskDraftSchema, input);
      if (!dateOk(d.due_date)) throw invalid("due_date must be YYYY-MM-DD");
      const assignee = d.assignee || null;
      if (assignee) await assertAllMembers(ctx.householdId, [assignee]);
      const repeat = d.repeat ?? "none";
      let weekdays = repeat === "weekly" ? [...new Set(d.weekdays ?? [])].sort() : [];
      if (repeat === "weekly" && weekdays.length === 0) weekdays = [DateTime.fromISO(d.due_date).weekday];
      const payload = {
        title: d.title,
        startsOn: d.due_date,
        dueTime: d.due_time ?? "20:00",
        estimatedMinutes: d.estimated_minutes ?? 15,
        recurrence: repeat.toUpperCase(),
        weekdays,
        assignmentMode: assignee ? "FIXED" : "UNASSIGNED",
        assigneeId: assignee,
      };
      const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      const when = repeat === "none" ? `due ${d.due_date} at ${payload.dueTime}` : repeat === "daily" ? `every day at ${payload.dueTime} from ${d.due_date}` : `every ${weekdays.map((w) => days[w - 1]).join("/")} at ${payload.dueTime} from ${d.due_date}`;
      return saveDraft(ctx, "add_task", payload, `Add task “${d.title}”, ${when}, ${assignee ? `assigned to ${nameOf(ctx, assignee)}` : "unassigned"}, ~${payload.estimatedMinutes} min`);
    },
  },
  {
    area: "chores",
    mode: "draft",
    tool: {
      name: "chores_draft_complete",
      description: "Draft marking a pending task occurrence as done by the user. Use an occurrence_id from chores_list_open. Does NOT save: the user confirms first.",
      input_schema: obj({ occurrence_id: { type: "string" } }, ["occurrence_id"]),
      strict: true,
    },
    run: async (ctx, input) => {
      const d = parse(completeSchema, input);
      const occ = await prisma.taskOccurrence.findFirst({ where: { id: d.occurrence_id, householdId: ctx.householdId }, include: { definition: { select: { title: true } } } });
      if (!occ) throw notFound("Task");
      if (occ.status !== "PENDING") throw invalid("That task is already done or skipped");
      const due = DateTime.fromJSDate(occ.dueAt).setZone(ctx.timezone).toFormat("ccc LLL d");
      return saveDraft(ctx, "complete_task", { occurrenceId: occ.id }, `Mark “${occ.definition.title}” (due ${due}) as done by you`);
    },
  },

  // ---- planner ----
  {
    area: "planner",
    mode: "read",
    tool: {
      name: "planner_get_workload",
      description: "This week's workload per roommate (estimated minutes and task count) and minutes completed in the last 14 days.",
      input_schema: obj({}, []),
      strict: true,
    },
    run: async (ctx) => {
      const { start, end } = weekBounds(ctx.timezone, 0);
      const w = await workloadSummary(ctx.userId, ctx.householdId, start, end);
      return JSON.stringify(w.map((m) => ({ name: m.name, week_minutes: m.weekMinutes, week_tasks: m.weekCount, completed_last_14_days_minutes: m.recentMinutes })));
    },
  },
];

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.tool.name, t]));

export async function loadContext(userId: string, householdId: string): Promise<ToolContext> {
  const m = await requireMember(userId, householdId);
  const members = await activeMembers(householdId);
  return { userId, householdId, timezone: m.household.timezone, members: members.map((x) => ({ id: x.id, name: x.name })) };
}
