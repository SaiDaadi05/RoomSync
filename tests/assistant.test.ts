import { describe, expect, it } from "vitest";
import { makeHousehold } from "./helpers";
import { runAssistant } from "@/server/assistant/run";
import { confirmAction, discardAction, listPendingActions } from "@/server/assistant/actions";
import { TOOL_BY_NAME, loadContext } from "@/server/assistant/tools";
import { addShoppingItem } from "@/server/shopping";
import { computeBalances } from "@/server/expenses";
import { prisma } from "@/server/db";

type Block = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: unknown };

/** A scripted stand-in for the Messages API: returns the given responses in order. */
function fakeClient(script: ((req: { messages: unknown[] }) => { stop_reason: string; content: Block[] })[]) {
  const calls: { messages: unknown[]; tools: { name: string }[] }[] = [];
  return {
    calls,
    client: {
      beta: {
        messages: {
          create: (async (req: { messages: unknown[]; tools: { name: string }[] }) => {
            calls.push(JSON.parse(JSON.stringify(req)));
            const step = script[calls.length - 1];
            if (!step) throw new Error("unexpected extra call");
            return step(req);
          }) as never,
        },
      },
    },
  };
}

describe("assistant", () => {
  it("drafts a cross-area request and changes nothing until confirmed", async () => {
    const { household, owner, members: [, mate] } = await makeHousehold(1);
    const item = await addShoppingItem(owner.id, household.id, { name: "Paper towels" });
    const fake = fakeClient([
      () => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "shopping_list", input: {} }] }),
      () => ({
        stop_reason: "tool_use",
        content: [
          { type: "tool_use", id: "t2", name: "shopping_draft_mark_bought", input: { item_ids: [item.id] } },
          { type: "tool_use", id: "t3", name: "expenses_draft_expense", input: { description: "Paper towels", amount_cents: 801, paid_by: owner.id, split_between: [owner.id, mate.id], category: "household supplies", date: "2031-01-05" } },
        ],
      }),
      () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "Drafted both. Tap Confirm." }] }),
    ]);
    const r = await runAssistant(owner.id, household.id, "I bought the paper towels for $8.01, split it", [], { client: fake.client });
    expect(r.reply).toBe("Drafted both. Tap Confirm.");
    expect(r.drafts.map((d) => d.kind)).toEqual(["mark_bought", "add_expense"]);
    expect(r.drafts[1].summary).toContain("$4.01");
    expect(r.drafts[1].summary).toContain("$4.00");
    // Every tool area was offered, and read results were fed back.
    expect(fake.calls[0].tools.map((t) => t.name)).toContain("chores_draft_task");
    expect(JSON.stringify(fake.calls[1].messages)).toContain("Paper towels");

    // Nothing changed yet.
    expect((await prisma.shoppingItem.findUniqueOrThrow({ where: { id: item.id } })).status).not.toBe("PURCHASED");
    expect(await prisma.expense.count({ where: { householdId: household.id } })).toBe(0);

    // The roommate can't confirm someone else's draft.
    await expect(confirmAction(mate.id, r.drafts[1].id)).rejects.toThrow(/person who asked/);

    for (const d of r.drafts) await confirmAction(owner.id, d.id);
    expect((await prisma.shoppingItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("PURCHASED");
    const { balances } = await computeBalances(owner.id, household.id);
    expect(balances.find((b) => b.userId === owner.id)?.cents).toBe(400);
    // Confirming twice does nothing.
    await expect(confirmAction(owner.id, r.drafts[1].id)).rejects.toThrow(/already handled/);
    expect(await prisma.expense.count({ where: { householdId: household.id } })).toBe(1);
  });

  it("rejects drafts that name people outside the household and reports it to the model", async () => {
    const { household, owner } = await makeHousehold(1);
    const outsider = await makeHousehold(0);
    const fake = fakeClient([
      () => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "expenses_draft_settlement", input: { from_user: owner.id, to_user: outsider.owner.id, amount_cents: 500, note: "" } }] }),
      (req) => {
        const last = JSON.stringify(req.messages[req.messages.length - 1]);
        expect(last).toContain('"is_error":true');
        return { stop_reason: "end_turn", content: [{ type: "text", text: "They aren't in your household." }] };
      },
    ]);
    const r = await runAssistant(owner.id, household.id, "I paid Pat back $5", [], { client: fake.client });
    expect(r.drafts).toHaveLength(0);
    expect(await prisma.assistantAction.count({ where: { householdId: household.id } })).toBe(0);
  });

  it("read tools never expose another household's data", async () => {
    const a = await makeHousehold(1);
    const b = await makeHousehold(1);
    await addShoppingItem(b.owner.id, b.household.id, { name: "Secret snacks" });
    const ctx = await loadContext(a.owner.id, a.household.id);
    expect(await TOOL_BY_NAME.get("shopping_list")!.run(ctx, {})).not.toContain("Secret snacks");
    await expect(loadContext(a.owner.id, b.household.id)).rejects.toThrow(/not a member/);
    // An item id from another household can't be drafted.
    const theirItem = await prisma.shoppingItem.findFirstOrThrow({ where: { householdId: b.household.id } });
    await expect(TOOL_BY_NAME.get("shopping_draft_mark_bought")!.run(ctx, { item_ids: [theirItem.id] })).rejects.toThrow(/not found/);
  });

  it("drafts a weekly chore and discards cleanly", async () => {
    const { household, owner, members: [, mate] } = await makeHousehold(1);
    const ctx = await loadContext(owner.id, household.id);
    const out = await TOOL_BY_NAME.get("chores_draft_task")!.run(ctx, {
      title: "Take out trash", due_date: "2031-03-03", due_time: "19:00", assignee: mate.id, estimated_minutes: 10, repeat: "weekly", weekdays: [1, 4],
    });
    expect(out).toContain("every Mon/Thu at 19:00");
    const [draft] = await listPendingActions(owner.id, household.id);
    await discardAction(owner.id, draft.id);
    await expect(confirmAction(owner.id, draft.id)).rejects.toThrow(/already handled/);
    expect(await prisma.taskDefinition.count({ where: { householdId: household.id } })).toBe(0);

    await TOOL_BY_NAME.get("chores_draft_task")!.run(ctx, { title: "Water plants", due_date: "2031-03-03", due_time: "09:00", assignee: "", estimated_minutes: 5, repeat: "none", weekdays: [] });
    const [d2] = await listPendingActions(owner.id, household.id);
    const done = await confirmAction(owner.id, d2.id);
    expect(done.resultLink).toMatch(/^\/tasks\//);
  });

  it("handles a refusal without drafting anything", async () => {
    const { household, owner } = await makeHousehold(0);
    const fake = fakeClient([() => ({ stop_reason: "refusal", content: [] })]);
    const r = await runAssistant(owner.id, household.id, "something", [], { client: fake.client });
    expect(r.reply).toMatch(/can't help/);
    expect(r.drafts).toHaveLength(0);
  });
});
