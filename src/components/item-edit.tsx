"use client";

import { ActionForm, SubmitButton } from "./forms";
import { updateItemAction } from "@/app/actions/money";

export function ItemEdit({ item }: { item: { id: string; name: string; quantity: string; notes: string | null; productUrl: string | null } }) {
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-xs font-semibold text-brand-700">Edit</summary>
      <ActionForm action={updateItemAction} className="mt-2 space-y-2">
        <input type="hidden" name="id" value={item.id} />
        <div className="flex gap-2">
          <input name="name" defaultValue={item.name} required maxLength={100} className="input py-2 text-sm" aria-label="Item name" />
          <input name="quantity" defaultValue={item.quantity} maxLength={30} className="input w-20 py-2 text-sm" aria-label="Quantity" />
        </div>
        <input name="notes" defaultValue={item.notes ?? ""} maxLength={300} placeholder="Note" className="input py-2 text-sm" aria-label="Note" />
        <input name="productUrl" type="url" defaultValue={item.productUrl ?? ""} placeholder="https://… product link" className="input py-2 text-sm" aria-label="Product link" />
        <SubmitButton className="btn-secondary min-h-9 text-xs">Save</SubmitButton>
      </ActionForm>
    </details>
  );
}
