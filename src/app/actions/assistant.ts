"use server";

import { revalidatePath } from "next/cache";
import { requireHousehold } from "@/server/session";
import { toActionError } from "@/server/action";
import { runAssistant, type ChatTurn } from "@/server/assistant/run";
import { confirmAction, discardAction } from "@/server/assistant/actions";

export type DraftView = { id: string; summary: string };
export type AskResult = { reply?: string; drafts?: DraftView[]; error?: string };

export async function askAssistantAction(message: string, history: ChatTurn[]): Promise<AskResult> {
  try {
    const { user, household } = await requireHousehold();
    const safeHistory = (Array.isArray(history) ? history : [])
      .filter((t) => (t?.role === "user" || t?.role === "assistant") && typeof t.text === "string")
      .map((t) => ({ role: t.role, text: t.text }));
    const r = await runAssistant(user.id, household.id, String(message ?? ""), safeHistory);
    return { reply: r.reply, drafts: r.drafts.map((d) => ({ id: d.id, summary: d.summary })) };
  } catch (e) {
    return { error: toActionError(e)?.error ?? "Something went wrong" };
  }
}

export async function confirmDraftAction(id: string): Promise<{ ok?: boolean; link?: string | null; error?: string }> {
  try {
    const { user } = await requireHousehold();
    const a = await confirmAction(user.id, String(id));
    revalidatePath("/", "layout");
    return { ok: true, link: a.resultLink };
  } catch (e) {
    return { error: toActionError(e)?.error ?? "Something went wrong" };
  }
}

export async function discardDraftAction(id: string): Promise<{ ok?: boolean; error?: string }> {
  try {
    const { user } = await requireHousehold();
    await discardAction(user.id, String(id));
    return { ok: true };
  } catch (e) {
    return { error: toActionError(e)?.error ?? "Something went wrong" };
  }
}
