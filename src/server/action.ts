import { ZodError } from "zod";
import { AppError } from "./errors";
import { unstable_rethrow } from "next/navigation";

export type ActionState = { error?: string; fieldErrors?: Record<string, string>; ok?: boolean; message?: string } | null;

/** Turn service-layer errors into a form-friendly state. Unexpected errors are logged, not leaked. */
export function toActionError(e: unknown): ActionState {
  unstable_rethrow(e);
  if (e instanceof AppError) return { error: e.message };
  if (e instanceof ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of e.issues) fieldErrors[issue.path.join(".") || "_"] ??= issue.message;
    return { error: e.issues[0]?.message ?? "Please check the form", fieldErrors };
  }
  if (e instanceof Error && /Enter an amount|Use HH:MM|Invalid date/.test(e.message)) return { error: e.message };
  console.error(e);
  return { error: "Something went wrong. Please try again." };
}
