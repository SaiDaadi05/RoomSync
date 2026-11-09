"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireHousehold, requireUser } from "@/server/session";
import { toActionError, type ActionState } from "@/server/action";
import { createBill, deleteBill, setBillPaused, updateBill } from "@/server/bills";
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
