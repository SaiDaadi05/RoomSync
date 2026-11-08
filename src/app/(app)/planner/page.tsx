import Link from "next/link";
import { DateTime } from "luxon";
import { requireHousehold } from "@/server/session";
import { buildMissedProposals, buildProposals, listSwapRequests, weekBounds, workloadSummary } from "@/server/planner";
import { listOccurrences } from "@/server/tasks";
import { activeMembers } from "@/server/access";
import { prisma } from "@/server/db";
import { Avatar, Badge, EmptyState, PageHeader, Section } from "@/components/ui";
import { PlanManually, ProposalsForm, SwapAnswer, SwapForm, SyncGoogle, type ProposalView } from "@/components/planner-forms";
import { cancelSwapAction, unscheduleAction } from "@/app/actions/planner";
import { CATEGORY_EMOJI } from "@/components/task-row";
import type { Proposal } from "@/lib/scheduling";

export const metadata = { title: "Planner" };

export default async function PlannerPage({ searchParams }: { searchParams: Promise<{ week?: string; suggest?: string; swap?: string }> }) {
  const { user, household } = await requireHousehold();
  const sp = await searchParams;
  const offset = Math.max(-4, Math.min(8, Number(sp.week) || 0));
  const tz = household.timezone;
  const { start, end, label } = weekBounds(tz, offset);
  const [members, occs, workload, myGoogle, missed, swaps] = await Promise.all([
    activeMembers(household.id),
    listOccurrences(user.id, household.id, { from: start, to: end }),
    workloadSummary(user.id, household.id, start, end),
    prisma.calendarConnection.findUnique({ where: { userId_provider: { userId: user.id, provider: "GOOGLE" } } }),
    offset === 0 ? buildMissedProposals(user.id, household.id) : Promise.resolve({ proposals: [] as Proposal[], notes: [] }),
    listSwapRequests(user.id, household.id),
  ]);
  const suggest = sp.suggest === "1" ? await buildProposals(user.id, household.id, { from: start, to: end }) : null;
  const synced = myGoogle ? new Set((await prisma.calendarEventLink.findMany({ where: { connectionId: myGoogle.id, occurrenceId: { in: occs.map((o) => o.id) } } })).map((l) => l.occurrenceId)) : new Set<string>();
  const nameOf = (id: string | null) => (id ? members.find((m) => m.id === id)?.name ?? "Former roommate" : "Anyone");
  const first = (id: string | null) => nameOf(id).split(" ")[0];
  const fmt = (d: Date, zone = tz) => DateTime.fromJSDate(d).setZone(zone).toFormat("ccc h:mm a");
  const toView = (p: Proposal, moveDue = false): ProposalView => ({
    occurrenceId: p.occurrenceId, title: p.title, who: first(p.assigneeId), ok: p.ok, reason: p.reason,
    when: p.start ? `${fmt(new Date(p.start))} – ${DateTime.fromMillis(p.end!).setZone(tz).toFormat("h:mm a")}` : "",
    payload: JSON.stringify({ occurrenceId: p.occurrenceId, assigneeId: p.assigneeId, start: p.start ? new Date(p.start).toISOString() : null, end: p.end ? new Date(p.end).toISOString() : null, moveDue }),
  });
  const maxMin = Math.max(30, ...workload.map((w) => w.weekMinutes));
  const days = Array.from({ length: 7 }, (_, i) => DateTime.fromJSDate(start).setZone(tz).plus({ days: i }));
  const now = new Date();
  const myPending = occs.filter((o) => o.status === "PENDING" && o.assigneeId === user.id && o.dueAt > now);
  const theirPending = occs.filter((o) => o.status === "PENDING" && o.assigneeId && o.assigneeId !== user.id && o.dueAt > now);
  const notes = suggest?.notes ?? [];

  return (
    <>
      <PageHeader title="Planner" subtitle={`Week of ${label}`} action={<Link href="/planner/availability" className="btn-secondary">My free time</Link>} />
      <div className="mb-4 flex items-center justify-between">
        <Link href={`/planner?week=${offset - 1}`} className="btn-ghost min-h-9" aria-label="Previous week">← Prev</Link>
        {offset !== 0 && <Link href="/planner" className="text-sm font-semibold text-brand-700">This week</Link>}
        <Link href={`/planner?week=${offset + 1}`} className="btn-ghost min-h-9" aria-label="Next week">Next →</Link>
      </div>

      {sp.swap && (
        <p role="status" className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {sp.swap === "accepted" ? "Swapped. Your roommate has been notified, and the tasks are now in each other's lists." : "Declined. Your roommate has been notified, and nothing changed."}
        </p>
      )}

      {(swaps.incoming.length > 0 || swaps.outgoing.length > 0) && (
        <Section title="Swap requests">
          <ul id="swaps" className="space-y-2">
            {swaps.incoming.map((r) => (
              <li key={r.id} className="card border-brand-200 bg-brand-50 p-4">
                <p className="text-sm"><b>{first(r.fromUserId)}</b> offers <b>{r.fromOccurrence.definition.title}</b> ({fmt(r.fromOccurrence.dueAt)}) in exchange for your <b>{r.toOccurrence.definition.title}</b> ({fmt(r.toOccurrence.dueAt)}).</p>
                {r.message && <p className="mt-1 text-sm italic text-muted">“{r.message}”</p>}
                <div className="mt-3"><SwapAnswer id={r.id} /></div>
              </li>
            ))}
            {swaps.outgoing.map((r) => (
              <li key={r.id} className="card flex items-center gap-3 p-3 text-sm">
                <span className="flex-1">Waiting on <b>{first(r.toUserId)}</b>: your {r.fromOccurrence.definition.title} for their {r.toOccurrence.definition.title}</span>
                <form action={cancelSwapAction}><input type="hidden" name="id" value={r.id} /><button className="text-xs font-semibold text-slate-600">Cancel</button></form>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Workload this week">
        <div className="card space-y-3 p-4">
          {workload.map((w) => (
            <div key={w.id} className="flex items-center gap-3">
              <Avatar id={w.id} name={w.name} size="sm" />
              <span className="w-20 truncate text-sm">{w.name.split(" ")[0]}</span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                <div className="h-full rounded-full bg-brand-500" style={{ width: `${(w.weekMinutes / maxMin) * 100}%` }} />
              </div>
              <span className="w-28 text-right text-xs tabular-nums text-muted">{w.weekMinutes} min · {w.weekCount} tasks</span>
            </div>
          ))}
          <p className="text-xs text-muted">Effort is estimated minutes, not just task count. Last 14 days completed: {workload.map((w) => `${w.name.split(" ")[0]} ${w.recentMinutes} min`).join(", ")}.</p>
        </div>
      </Section>

      {missed.proposals.length > 0 && (
        <Section title={`Missed tasks · ${missed.proposals.length}`}>
          <div id="missed">
            <p className="mb-2 text-sm text-muted">These are overdue. Here are new times in the next 3 days. Accepting moves only the tasks you tick.</p>
            <ProposalsForm proposals={missed.proposals.map((p) => toView(p, true))} cta="Move ticked tasks to these times" defaultChecked={false} />
          </div>
        </Section>
      )}

      <Section title="Suggested plan">
        {!suggest ? (
          <div className="card flex items-center gap-3 p-4">
            <span className="text-2xl" aria-hidden>🪄</span>
            <p className="flex-1 text-sm">Find times for this week's unplanned tasks based on everyone's free time, deadlines, and workload.</p>
            <Link href={`/planner?week=${offset}&suggest=1`} className="btn-primary">Suggest</Link>
          </div>
        ) : suggest.proposals.length === 0 ? (
          <EmptyState icon="✅" title="Everything this week is already planned" body="Or there's nothing left to plan." />
        ) : (
          <>
            <ul className="mb-3 space-y-1 text-xs text-muted">
              {notes.map((n) => (
                <li key={n.userId}>
                  {n.name.split(" ")[0]}: {n.source === "google" ? "using Google Calendar busy times" : n.source === "manual" ? "using manually entered free time" : "no availability entered, using preferred hours"}
                  {n.error && <span className="text-amber-800"> ({n.error})</span>}
                </li>
              ))}
            </ul>
            <ProposalsForm proposals={suggest.proposals.map((p) => toView(p))} cta="Accept ticked suggestions" />
          </>
        )}
      </Section>

      <Section title="Day by day">
        <div className="space-y-4">
          {days.map((d) => {
            const items = occs.filter((o) => DateTime.fromJSDate(o.dueAt).setZone(tz).hasSame(d, "day"));
            return (
              <div key={d.toISODate()}>
                <h3 className={`mb-1.5 text-sm font-semibold ${d.hasSame(DateTime.now().setZone(tz), "day") ? "text-brand-700" : ""}`}>{d.toFormat("cccc, LLL d")}</h3>
                {items.length === 0 ? <p className="text-xs text-muted">Nothing due.</p> : (
                  <ul className="space-y-1.5">
                    {items.map((o) => (
                      <li key={o.id} className={`card p-3 ${o.status !== "PENDING" ? "opacity-60" : ""}`}>
                        <div className="flex items-center gap-2">
                          <span aria-hidden>{CATEGORY_EMOJI[o.definition.category] ?? "📌"}</span>
                          <Link href={`/tasks/${o.definitionId}`} className="min-w-0 flex-1 truncate text-sm font-medium">{o.definition.title}</Link>
                          {o.status === "DONE" && <Badge tone="green">Done</Badge>}
                          {o.status === "SKIPPED" && <Badge>Skipped</Badge>}
                          {o.assigneeId ? <Avatar id={o.assigneeId} name={nameOf(o.assigneeId)} size="sm" /> : <Badge tone="amber">Unassigned</Badge>}
                        </div>
                        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                          <span>Due {DateTime.fromJSDate(o.dueAt).setZone(tz).toFormat("h:mm a")} · ~{o.definition.estimatedMinutes} min</span>
                          {o.scheduledStart && <Badge tone="blue">Planned {fmt(o.scheduledStart)}</Badge>}
                          {synced.has(o.id) && <Badge tone="green">In your Google Calendar</Badge>}
                        </p>
                        {o.status === "PENDING" && (
                          <div className="mt-2 flex flex-wrap items-center gap-3">
                            {o.scheduledStart ? (
                              <>
                                <form action={unscheduleAction}><input type="hidden" name="occurrenceId" value={o.id} /><button className="text-xs font-semibold text-slate-600">Unplan</button></form>
                                {o.assigneeId === user.id && myGoogle?.status === "ACTIVE" && !synced.has(o.id) && <SyncGoogle occurrenceId={o.id} />}
                              </>
                            ) : (
                              (o.assigneeId === user.id || !o.assigneeId) && <PlanManually occurrenceId={o.id} date={d.toISODate()!} />
                            )}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      {myPending.length > 0 && theirPending.length > 0 && (
        <Section title="Swap a task">
          <div className="card p-4">
            <SwapForm
              mine={myPending.map((o) => ({ id: o.id, label: `Mine: ${o.definition.title} (${fmt(o.dueAt)})` }))}
              theirs={theirPending.map((o) => ({ id: o.id, label: `${first(o.assigneeId)}: ${o.definition.title} (${fmt(o.dueAt)})` }))}
            />
          </div>
        </Section>
      )}
    </>
  );
}
