import Link from "next/link";
import { requireHousehold } from "@/server/session";
import { listInAppNotifications, markAllRead } from "@/server/notifications";
import { EmptyState, PageHeader } from "@/components/ui";
import { formatDue } from "@/lib/time";
import { revalidatePath } from "next/cache";

export const metadata = { title: "Notifications" };

async function markAllReadAction() {
  "use server";
  const { user } = await requireHousehold();
  await markAllRead(user.id);
  revalidatePath("/", "layout");
}

export default async function NotificationsPage() {
  const { user, household } = await requireHousehold();
  const items = await listInAppNotifications(user.id);
  return (
    <>
      <PageHeader title="Notifications" subtitle="In-app reminders and updates. Email reminders, if enabled, are sent separately."
        action={items.some((n) => !n.readAt) ? <form action={markAllReadAction}><button className="btn-ghost">Mark all read</button></form> : undefined} />
      {items.length === 0 ? (
        <EmptyState icon="🔔" title="No notifications yet" body="You'll see reminders for chores due soon or overdue, and when a roommate assigns you something." />
      ) : (
        <ul className="card divide-y divide-slate-100">
          {items.map((n) => (
            <li key={n.id}>
              <Link href={n.link ?? "/home"} className={`flex gap-3 px-4 py-3 hover:bg-slate-50 ${n.readAt ? "" : "bg-brand-50/60"}`}>
                {!n.readAt && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-brand-600" aria-label="Unread" />}
                <div className="flex-1">
                  <p className="text-sm font-medium">{n.title}</p>
                  {n.body && <p className="text-xs text-muted">{n.body}</p>}
                  <p className="mt-0.5 text-[11px] text-muted">{formatDue(n.createdAt, household.timezone)}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
