"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireHousehold, requireUser } from "@/server/session";
import { toActionError, type ActionState } from "@/server/action";
import { DateTime } from "luxon";
import { billInputSchema, createBill, deleteBill, setBillPaused, updateBill } from "@/server/bills";
import { STARTER_BILLS } from "@/lib/starter-bills";
import { parseMoneyToCents } from "@/lib/money";

function billFromForm(fd: FormData) {
  const splitMethod = fd.get("splitMethod") === "CUSTOM" ? "CUSTOM" : "EQUAL";
  const participants = fd.getAll("participants").map(String).map((userId) => {
    if (splitMethod === "EQUAL") return { userId };
    const raw = String(fd.get(`amt_${userId}`) ?? "").trim();
    return { userId, amountCents: raw ? parseMoneyToCents(raw) : 0 };
  });
  return {
    description: fd.get("description"),
    amountCents: parseMoneyToCents(String(fd.get("amount") ?? "")),
    payerId: fd.get("payerId"),
    category: fd.get("category") || "rent",
    splitMethod,
    participants,
    dayOfMonth: fd.get("dayOfMonth"),
    startMonth: fd.get("startMonth"),
    splitWithEveryone: fd.get("splitWithEveryone") === "on",
  };
}

export async function createBillAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { user, household } = await requireHousehold();
    await createBill(user.id, household.id, billFromForm(fd));
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath("/", "layout");
  redirect("/expenses?bill=created#bills");
}

export async function updateBillAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    await updateBill(user.id, String(fd.get("id")), billFromForm(fd));
    revalidatePath("/", "layout");
    return { ok: true, message: "Saved. Months already added keep their old amounts." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function pauseBillAction(fd: FormData) {
  const user = await requireUser();
  const id = String(fd.get("id"));
  await setBillPaused(user.id, id, fd.get("paused") === "1");
  revalidatePath("/", "layout");
  redirect(`/expenses/bills/${id}`);
}

export async function deleteBillAction(fd: FormData) {
  const user = await requireUser();
  await deleteBill(user.id, String(fd.get("id")));
  revalidatePath("/", "layout");
  redirect("/expenses?bill=deleted#bills");
}

/** The first-run "bills" step: up to a few monthly bills, paid by you, split with everyone. */
export async function addStarterBillsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { user, household } = await requireHousehold();
    const today = DateTime.now().setZone(household.timezone);
    const rows = STARTER_BILLS.map((b) => ({
      ...b,
      description: String(fd.get(`name_${b.key}`) ?? b.label).trim() || b.label,
      amount: String(fd.get(`amount_${b.key}`) ?? "").trim(),
      day: Number(fd.get(`day_${b.key}`) ?? b.day),
    })).filter((r) => r.amount);
    const inputs = rows.map((r) => {
      // Start next month if this month's day has already passed, so nothing is charged
      // before roommates have had a chance to join.
      const start = r.day <= today.day ? today.plus({ months: 1 }) : today;
      return {
        description: r.description,
        amountCents: parseMoneyToCents(r.amount),
        payerId: user.id,
        category: r.category,
        splitMethod: "EQUAL" as const,
        participants: [{ userId: user.id }],
        splitWithEveryone: true,
        dayOfMonth: r.day,
        startMonth: start.toFormat("yyyy-LL"),
      };
    });
    // Check every row before saving any, so a typo doesn't leave half the bills added.
    inputs.forEach((i) => billInputSchema.parse(i));
    for (const i of inputs) await createBill(user.id, household.id, i);
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath("/", "layout");
  redirect("/home?tour=1");
}
