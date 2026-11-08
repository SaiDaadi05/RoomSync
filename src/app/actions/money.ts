"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireHousehold, requireUser } from "@/server/session";
import { toActionError, type ActionState } from "@/server/action";
import { attachReceipt, createExpense, deleteExpense, deleteSettlement, recordSettlement, updateExpense } from "@/server/expenses";
import {
  addShoppingItem, claimShoppingItem, createShoppingErrand, deleteShoppingItem, markPurchased,
  purchaseWithExpense, restockItem, unclaimShoppingItem, updateShoppingItem,
} from "@/server/shopping";
import { parseMoneyToCents } from "@/lib/money";
import { invalid } from "@/server/errors";

function refresh() {
  revalidatePath("/home");
  revalidatePath("/expenses", "layout");
  revalidatePath("/shopping");
  revalidatePath("/tasks", "layout");
}

async function receiptFrom(fd: FormData) {
  const f = fd.get("receipt");
  if (!(f instanceof File) || f.size === 0) return null;
  return { buf: Buffer.from(await f.arrayBuffer()), mime: f.type };
}

export async function createExpenseAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const { user, household } = await requireHousehold();
    const receipt = await receiptFrom(fd);
    const expense = await createExpense(user.id, household.id, {
      ...expenseFromForm(fd),
      shoppingItemIds: fd.getAll("shoppingItemIds").map(String),
    });
    id = expense.id;
    if (receipt) {
      try {
        await attachReceipt(user.id, id, receipt.buf, receipt.mime);
      } catch (e) {
        refresh();
        return { ...toActionError(e), error: `Expense saved, but the receipt wasn't: ${(e as Error).message}` };
      }
    }
  } catch (e) {
    return toActionError(e);
  }
  refresh();
  redirect(`/expenses/${id}`);
}

function expenseFromForm(fd: FormData) {
  const splitMethod = fd.get("splitMethod") === "CUSTOM" ? "CUSTOM" : "EQUAL";
  const participants = fd.getAll("participants").map(String).map((userId) => {
    if (splitMethod === "EQUAL") return { userId };
    const raw = String(fd.get(`amt_${userId}`) ?? "").trim();
    return { userId, amountCents: raw ? parseMoneyToCents(raw) : 0 };
  });
  return {
    payerId: fd.get("payerId"),
    amountCents: parseMoneyToCents(String(fd.get("amount") ?? "")),
    date: fd.get("date"),
    description: fd.get("description"),
    category: fd.get("category") || "other",
    splitMethod,
    participants,
  };
}

export async function updateExpenseAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = String(fd.get("id"));
  try {
    const user = await requireUser();
    await updateExpense(user.id, id, expenseFromForm(fd));
  } catch (e) {
    return toActionError(e);
  }
  refresh();
  redirect(`/expenses/${id}?edited=1`);
}

export async function updateItemAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    await updateShoppingItem(user.id, String(fd.get("id")), {
      name: fd.get("name"), quantity: fd.get("quantity") ?? undefined, notes: fd.get("notes"), productUrl: fd.get("productUrl"),
    });
    refresh();
    return { ok: true, message: "Saved" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function uploadReceiptAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const r = await receiptFrom(fd);
    if (!r) throw invalid("Choose a file to upload");
    await attachReceipt(user.id, String(fd.get("expenseId")), r.buf, r.mime);
    refresh();
    return { ok: true, message: "Receipt attached" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteExpenseAction(fd: FormData) {
  const user = await requireUser();
  await deleteExpense(user.id, String(fd.get("id")));
  refresh();
  redirect("/expenses");
}

export async function settleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { user, household } = await requireHousehold();
    await recordSettlement(user.id, household.id, {
      fromUserId: fd.get("fromUserId"),
      toUserId: fd.get("toUserId"),
      amountCents: parseMoneyToCents(String(fd.get("amount") ?? "")),
      date: fd.get("date"),
      note: fd.get("note"),
    });
    refresh();
    return { ok: true, message: "Payment recorded" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteSettlementAction(fd: FormData) {
  const user = await requireUser();
  await deleteSettlement(user.id, String(fd.get("id")));
  refresh();
}

// ---- Shopping ----

export async function addItemAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { user, household } = await requireHousehold();
    await addShoppingItem(user.id, household.id, {
      name: fd.get("name"), quantity: fd.get("quantity") ?? undefined, notes: fd.get("notes"), productUrl: fd.get("productUrl"),
    });
    refresh();
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function claimItemAction(fd: FormData) {
  const user = await requireUser();
  try {
    await claimShoppingItem(user.id, String(fd.get("id")));
  } catch {
    // Someone else claimed it first; the refreshed list shows who.
  }
  refresh();
}

export async function unclaimItemAction(fd: FormData) {
  const user = await requireUser();
  await unclaimShoppingItem(user.id, String(fd.get("id")));
  refresh();
}

export async function deleteItemAction(fd: FormData) {
  const user = await requireUser();
  await deleteShoppingItem(user.id, String(fd.get("id")));
  refresh();
}

export async function restockItemAction(fd: FormData) {
  const user = await requireUser();
  try {
    await restockItem(user.id, String(fd.get("id")));
  } catch {
    /* already on list */
  }
  refresh();
}

/** Handles the shopping "selected items" toolbar: bought (with or without expense) or make an errand. */
export async function shoppingBulkAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { user, household } = await requireHousehold();
    const itemIds = fd.getAll("itemIds").map(String);
    const mode = String(fd.get("mode"));
    if (!itemIds.length) throw invalid("Tick at least one item first");
    if (mode === "errand") {
      await createShoppingErrand(user.id, household.id, { itemIds, date: String(fd.get("date") || ""), assigneeId: String(fd.get("assigneeId") || "") || null });
      refresh();
      return { ok: true, message: "Shopping run added to Tasks" };
    }
    if (mode === "bought") {
      await markPurchased(user.id, itemIds);
      refresh();
      return { ok: true, message: "Marked as bought (no expense recorded)" };
    }
    if (mode === "expense") {
      const participantIds = fd.getAll("participants").map(String);
      await purchaseWithExpense(user.id, household.id, {
        itemIds,
        amountCents: parseMoneyToCents(String(fd.get("amount") ?? "")),
        date: String(fd.get("date")),
        participantIds,
        description: String(fd.get("description") ?? ""),
      });
      refresh();
      return { ok: true, message: "Bought and added to Expenses" };
    }
    throw invalid("Unknown action");
  } catch (e) {
    return toActionError(e);
  }
}
