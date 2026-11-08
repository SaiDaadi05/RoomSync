import Link from "next/link";
import { requireHousehold } from "@/server/session";
import { listShopping } from "@/server/shopping";
import { activeMembers } from "@/server/access";
import { ActionForm, SubmitButton } from "@/components/forms";
import { ShoppingBulk } from "@/components/shopping-bulk";
import { Avatar, Badge, EmptyState, PageHeader, Section } from "@/components/ui";
import { addItemAction, claimItemAction, deleteItemAction, restockItemAction, unclaimItemAction } from "@/app/actions/money";
import { formatCents } from "@/lib/money";
import { todayIn } from "@/lib/time";

export const metadata = { title: "Shopping" };

function hostOf(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "link"; }
}

export default async function ShoppingPage() {
  const { user, household } = await requireHousehold();
  const [{ open, recent }, members] = await Promise.all([listShopping(user.id, household.id), activeMembers(household.id)]);
  const nameOf = (id: string | null) => members.find((m) => m.id === id)?.name ?? "Someone";

  return (
    <>
      <PageHeader title="Shopping" subtitle="Shared groceries & household essentials" />
      <div className="card mb-5 p-4">
        <ActionForm action={addItemAction} resetOnSuccess className="space-y-2">
          <div className="flex gap-2">
            <label htmlFor="item-name" className="sr-only">Item</label>
            <input id="item-name" name="name" required maxLength={100} placeholder="Add an item, e.g. paper towels" className="input flex-1" />
            <label htmlFor="item-qty" className="sr-only">Quantity</label>
            <input id="item-qty" name="quantity" placeholder="Qty" maxLength={30} className="input w-20" />
            <SubmitButton pendingText="…">Add</SubmitButton>
          </div>
          <details>
            <summary className="cursor-pointer text-xs font-semibold text-brand-700">Add a note or product link</summary>
            <div className="mt-2 space-y-2">
              <input name="notes" maxLength={300} placeholder="Note (brand, size…)" className="input" aria-label="Note" />
              <input name="productUrl" type="url" placeholder="https://… product link (Amazon, Target, etc.)" className="input" aria-label="Product link" />
              <p className="text-xs text-muted">Links open the store's site so you can check out there. RoomSync doesn't place orders.</p>
            </div>
          </details>
        </ActionForm>
      </div>

      <Section title={`Needed · ${open.length}`}>
        {open.length === 0 ? (
          <EmptyState icon="🛒" title="The list is empty" body="Add things the household is running low on. Everyone sees the same list, so nothing gets bought twice." />
        ) : (
          <ul className="space-y-2">
            {open.map((i) => (
              <li key={i.id} className="card flex items-start gap-3 p-3">
                <input type="checkbox" name="itemIds" value={i.id} form="bulk" aria-label={`Select ${i.name}`} className="mt-1 h-5 w-5 accent-brand-600" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{i.name} {i.quantity !== "1" && <span className="text-sm font-normal text-muted">× {i.quantity}</span>}</p>
                  {i.notes && <p className="text-xs text-muted">{i.notes}</p>}
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    {i.productUrl && (
                      <a href={i.productUrl} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold text-brand-700 underline">
                        Open on {hostOf(i.productUrl)} ↗
                      </a>
                    )}
                    {i.errandOccurrence && (
                      <Link href={`/tasks/${i.errandOccurrence.definition.id}`}><Badge tone="violet">🏃 {i.errandOccurrence.definition.title}</Badge></Link>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {i.status === "CLAIMED" ? (
                    i.claimedById === user.id ? (
                      <form action={unclaimItemAction}><input type="hidden" name="id" value={i.id} />
                        <button className="chip bg-emerald-100 py-1 text-emerald-800" title="Tap to unclaim">✓ You're getting it</button>
                      </form>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-muted"><Avatar id={i.claimedById!} name={nameOf(i.claimedById)} size="sm" /> {nameOf(i.claimedById).split(" ")[0]}'s getting it</span>
                    )
                  ) : (
                    <form action={claimItemAction}><input type="hidden" name="id" value={i.id} />
                      <button className="chip border border-dashed border-slate-300 py-1 text-slate-700 hover:border-brand-500">I'll buy it</button>
                    </form>
                  )}
                  <form action={deleteItemAction}><input type="hidden" name="id" value={i.id} />
                    <button className="text-xs text-slate-500 hover:text-red-700" aria-label={`Remove ${i.name}`}>Remove</button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {open.length > 0 && (
        <div className="mb-6">
          <ShoppingBulk members={members} today={todayIn(household.timezone)} currentUserId={user.id} />
        </div>
      )}

      <Section title="Recently bought">
        {recent.length === 0 ? (
          <p className="text-sm text-muted">Bought items show up here, with a link to the expense if one was recorded.</p>
        ) : (
          <ul className="card divide-y divide-slate-100">
            {recent.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <div className="flex-1">
                  <p className="font-medium text-slate-600">{i.name}</p>
                  <p className="text-xs text-muted">
                    {nameOf(i.purchasedById)} · {i.purchasedAt?.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    {i.expense && <> · <Link href={`/expenses/${i.expense.id}`} className="text-brand-700 underline">{formatCents(i.expense.amountCents)} expense</Link></>}
                  </p>
                </div>
                <form action={restockItemAction}><input type="hidden" name="id" value={i.id} />
                  <button className="text-xs font-semibold text-brand-700">Need again</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
