"use server";

import { redirect } from "next/navigation";
import { signUp, verifyLogin, updatePreferences } from "@/server/auth";
import { endSession, requireUser, startSession } from "@/server/session";
import { toActionError, type ActionState } from "@/server/action";
import { hhmmToMinutes } from "@/lib/time";
import { revalidatePath } from "next/cache";

function safeNext(next: FormDataEntryValue | null) {
  const s = typeof next === "string" ? next : "";
  return s.startsWith("/") && !s.startsWith("//") ? s : "/home";
}

export async function signUpAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await signUp({
      name: fd.get("name"),
      email: fd.get("email"),
      password: fd.get("password"),
      timezone: fd.get("timezone"),
    });
    await startSession(user.id);
  } catch (e) {
    return toActionError(e);
  }
  redirect(safeNext(fd.get("next")) === "/home" ? "/onboarding" : safeNext(fd.get("next")));
}

export async function loginAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await verifyLogin(String(fd.get("email") ?? ""), String(fd.get("password") ?? ""));
    await startSession(user.id);
  } catch (e) {
    return toActionError(e);
  }
  redirect(safeNext(fd.get("next")));
}

export async function logoutAction() {
  await endSession();
  redirect("/login");
}

export async function updatePreferencesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    await updatePreferences(user.id, {
      name: fd.get("name"),
      timezone: fd.get("timezone"),
      preferredStartMin: hhmmToMinutes(String(fd.get("preferredStart") ?? "09:00")),
      preferredEndMin: hhmmToMinutes(String(fd.get("preferredEnd") ?? "21:00")),
      notifyInApp: fd.get("notifyInApp") === "on",
      notifyEmail: fd.get("notifyEmail") === "on",
    });
    revalidatePath("/", "layout");
    return { ok: true, message: "Preferences saved" };
  } catch (e) {
    return toActionError(e);
  }
}
