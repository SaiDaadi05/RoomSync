"use server";

import { redirect } from "next/navigation";
import { previewInvitation } from "@/server/households";
import { signUp, verifyLogin, updatePreferences } from "@/server/auth";
import { currentSessionToken, endSession, requireUser, startSession } from "@/server/session";
import { changePassword, requestPasswordReset, resetPassword } from "@/server/passwords";
import { deleteAccount } from "@/server/account";
import { toActionError, type ActionState } from "@/server/action";
import { hhmmToMinutes } from "@/lib/time";
import { revalidatePath } from "next/cache";

function safeNext(next: FormDataEntryValue | null) {
  const s = typeof next === "string" ? next : "";
  return s.startsWith("/") && !s.startsWith("//") ? s : "/home";
}

export async function signUpAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const code = String(fd.get("houseCode") ?? "").trim().toUpperCase();
  try {
    if (code) {
      const invite = await previewInvitation(code);
      if (!invite) return { error: "That household invite code is invalid or expired. Ask your roommate for a new code." };
      if (invite.email && invite.email !== String(fd.get("email") ?? "").trim().toLowerCase()) return { error: "This invitation is for a different email address." };
    }
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
  if (code) redirect(`/join/${encodeURIComponent(code)}`);
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

export async function changePasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    if (fd.get("next") !== fd.get("confirm")) return { error: "The new passwords don't match" };
    await changePassword(user.id, String(fd.get("current") ?? ""), String(fd.get("next") ?? ""), await currentSessionToken());
    return { ok: true, message: "Password changed. Other devices have been signed out." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function requestPasswordResetAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await requestPasswordReset(String(fd.get("email") ?? ""));
    return { ok: true, message: "If that email has an account, a reset link is on its way. It works for an hour." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function resetPasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    if (fd.get("next") !== fd.get("confirm")) return { error: "The passwords don't match" };
    const userId = await resetPassword(String(fd.get("token") ?? ""), String(fd.get("next") ?? ""));
    await startSession(userId);
  } catch (e) {
    return toActionError(e);
  }
  redirect("/home");
}

export async function deleteAccountAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    if (String(fd.get("confirm") ?? "").trim().toLowerCase() !== "delete") return { error: "Type DELETE to confirm" };
    await deleteAccount(user.id, String(fd.get("password") ?? ""));
    await endSession();
  } catch (e) {
    return toActionError(e);
  }
  redirect("/login?deleted=1");
}
