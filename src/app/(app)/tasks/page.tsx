import Link from "next/link";
import { DateTime } from "luxon";
import { requireHousehold } from "@/server/session";
import { listOccurrences } from "@/server/tasks";
import { activeMembers } from "@/server/access";
import { TaskList, type OccWithDef } from "@/components/task-row";
import { EmptyState, LinkButton, PageHeader, Section } from "@/components/ui";

export const metadata = { title: "Chores" };

const VIEWS = [
  { key: "mine", label: "Mine" },
  { key: "all", label: "Household" },
  { key: "open", label: "Up for grabs" },
  { key: "history", label: "History" },
] as const;

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ view?: string; category?: string }> }) {
  const { user, household } = await requireHousehold();
  const sp = await searchParams;
  const view = VIEWS.find((v) => v.key === sp.view)?.key ?? "mine";
  const members = await activeMembers(household.id);
  const tz = household.timezone;
  const now = DateTime.now().setZone(tz);
  const endOfToday = now.endOf("day").toJSDate();
  const weekAhead = now.plus({ days: 14 }).endOf("day").toJSDate();

  const assigneeFilter = view === "mine" ? user.id : view === "open" ? ("unassigned" as const) : undefined;
  let groups: { title: string; items: OccWithDef[] }[] = [];

  if (view === "history") {
    const done = await listOccurrences(user.id, household.id, { status: "DONE", category: sp.category, take: 50 });
    const skipped = await listOccurrences(user.id, household.id, { status: "SKIPPED", category: sp.category, take: 20 });
    const all = [...done, ...skipped].sort((a, b) => (b.completedAt ?? b.dueAt).getTime() - (a.completedAt ?? a.dueAt).getTime());
    groups = [{ title: "Completed & skipped", items: all }];
  } else {
    const pending = await listOccurrences(user.id, household.id, { status: "PENDING", to: weekAhead, assigneeId: assigneeFilter, category: sp.category });
    groups = [
      { title: "Running late", items: pending.filter((o) => o.dueAt < now.toJSDate()) },
      { title: "Today", items: pending.filter((o) => o.dueAt >= now.toJSDate() && o.dueAt <= endOfToday) },
      { title: "Next two weeks", items: pending.filter((o) => o.dueAt > endOfToday) },
    ];
  }
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const categories = ["cleaning", "kitchen", "trash", "laundry", "bathroom", "groceries", "errands", "bills", "other"];
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { view, category: sp.category, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/tasks?${p}`;
  };

  return (
    <>
      <PageHeader title="Chores & errands" subtitle="Who does what, and when" action={<LinkButton href="/tasks/new">+ New chore</LinkButton>} />
      <div className="mb-3 flex gap-1 overflow-x-auto rounded-full bg-white p-1 shadow-sm ring-1 ring-slate-200" role="tablist">
        {VIEWS.map((v) => (
          <Link key={v.key} href={qs({ view: v.key })} role="tab" aria-selected={view === v.key}
            className={`flex-1 whitespace-nowrap rounded-full px-3 py-2 text-center text-sm font-semibold ${view === v.key ? "bg-brand-600 text-white" : "text-slate-600"}`}>
            {v.label}
          </Link>
        ))}
      </div>
      <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1" aria-label="Filter by category">
        <Link href={qs({ category: undefined })} className={`chip border py-1 ${!sp.category ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 bg-white"}`}>All</Link>
        {categories.map((c) => (
          <Link key={c} href={qs({ category: c })} className={`chip border py-1 capitalize ${sp.category === c ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 bg-white"}`}>{c}</Link>
        ))}
      </div>
      {total === 0 ? (
        <EmptyState
          icon={view === "history" ? "📜" : "✨"}
          title={view === "history" ? "No completed tasks yet" : view === "mine" ? "Nothing on your plate" : "No upcoming tasks"}
          body={view === "history" ? "Finished chores show up here so everyone can see who's been pitching in." : "Add a chore or errand and it'll show up here."}
          action={view !== "history" ? <LinkButton href="/tasks/new">Add a chore</LinkButton> : undefined}
        />
      ) : (
        groups.filter((g) => g.items.length).map((g) => (
          <Section key={g.title} title={`${g.title} · ${g.items.length}`}>
            <TaskList items={g.items} members={members} tz={tz} currentUserId={user.id} />
          </Section>
        ))
      )}
    </>
  );
}
