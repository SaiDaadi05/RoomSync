"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { DateTime } from "luxon";
import { hhmmToMinutes } from "@/lib/time";
import {
  acceptInvitation, createHousehold, createInvitation, leaveHousehold, revokeInvitation, updateHousehold, updateHouseRules,
} from "@/server/households";
import { createTask } from "@/server/tasks";
import { requireHousehold, requireUser, setCurrentHousehold } from "@/server/session";
import { toActionError, type ActionState } from "@/server/action";
import { STARTER_CHORES } from "@/lib/starter-chores";

export async function createHouseholdAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const user = await requireUser();
    const h = await createHousehold(user.id, { name: fd.get("name"), timezone: fd.get("timezone") || user.timezone }, { isDemo: user.isDemo });
    id = h.id;
    await setCurrentHousehold(id);
  } catch (e) {
    return toActionError(e);
  }
  redirect("/onboarding/first-tasks");
}

export async function joinHouseholdAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const h = await acceptInvitation(user.id, String(fd.get("code") ?? ""));
    await setCurrentHousehold(h.id);
  } catch (e) {
    return toActionError(e);
  }
  redirect("/home");
}

export async function switchHouseholdAction(fd: FormData) {
  const user = await requireUser();
  const id = String(fd.get("householdId") ?? "");
  // setCurrentHousehold is only a preference; requireHousehold re-validates membership.
  if (id) await setCurrentHousehold(id);
  void user;
  redirect("/home");
}

export async function addStarterChoresAction(fd: FormData) {
  const { user, household } = await requireHousehold();
  const picked = fd.getAll("chore").map(String);
  const today = DateTime.now().setZone(household.timezone);
  for (const key of picked) {
    const c = STARTER_CHORES.find((s) => s.key === key);
    if (!c) continue;
    // Start on the next matching weekday so the first one isn't instantly overdue.
    await createTask(user.id, household.id, {
      title: c.title,
      category: c.category,
      estimatedMinutes: c.minutes,
      recurrence: c.recurrence,
      weekdays: c.weekdays,
      startsOn: today.toISODate(),
      dueTime: c.dueTime,
    });
  }
  redirect("/home");
}

export async function createInviteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { user, household } = await requireHousehold();
    const email = String(fd.get("email") ?? "").trim();
    await createInvitation(user.id, household.id, email || null);
    revalidatePath("/household");
    return { ok: true, message: "Invite created. Share the link or code below." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function revokeInviteAction(fd: FormData) {
  const user = await requireUser();
  await revokeInvitation(user.id, String(fd.get("id")));
  revalidatePath("/household");
}

export async function updateHouseholdAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { user, household } = await requireHousehold();
    await updateHousehold(user.id, household.id, { name: fd.get("name"), timezone: fd.get("timezone") });
    revalidatePath("/", "layout");
    return { ok: true, message: "Household updated" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function leaveHouseholdAction(_: ActionState, _fd: FormData): Promise<ActionState> {
  try {
    const { user, household } = await requireHousehold();
    await leaveHousehold(user.id, household.id);
  } catch (e) {
    return toActionError(e);
  }
  redirect("/home");
}

export async function updateHouseRulesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { user, household } = await requireHousehold();
    const t = (k: string) => { const v = String(fd.get(k) ?? "").trim(); return /^\d{2}:\d{2}$/.test(v) ? hhmmToMinutes(v) : null; };
    await updateHouseRules(user.id, household.id, { rules: fd.get("rules"), quietStartMin: t("quietStart"), quietEndMin: t("quietEnd") });
    revalidatePath("/household");
    revalidatePath("/planner");
    return { ok: true, message: "House rules saved" };
  } catch (e) {
    return toActionError(e);
  }
}
