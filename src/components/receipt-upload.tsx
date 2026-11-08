"use client";

import { ActionForm, SubmitButton } from "./forms";
import { uploadReceiptAction } from "@/app/actions/money";

export function ReceiptUpload({ expenseId, replace }: { expenseId: string; replace: boolean }) {
  return (
    <ActionForm action={uploadReceiptAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="expenseId" value={expenseId} />
      <label htmlFor="receipt" className="sr-only">Receipt file</label>
      <input id="receipt" name="receipt" type="file" required accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" className="min-w-0 flex-1 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:font-semibold file:text-brand-700" />
      <SubmitButton className="btn-secondary" pendingText="Uploading…">{replace ? "Replace" : "Upload"}</SubmitButton>
    </ActionForm>
  );
}
