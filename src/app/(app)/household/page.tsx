import Link from "next/link";
import { requireHousehold } from "@/server/session";
import { getHouseholdOverview, listInvitations } from "@/server/households";
import { emailConfigured } from "@/server/notifications";
import { prisma } from "@/server/db";
import { COMMON_TIMEZONES, minutesToHHMM, todayIn } from "@/lib/time";
import { activeAway } from "@/lib/away";
import { Avatar, Badge, PageHeader, Section } from "@/components/ui";
import { CopyButton } from "@/components/copy-button";
import { MemberActions } from "@/components/member-actions";
import { openTaskCounts } from "@/server/members";
import { moveOutPlan } from "@/server/moveout";
import { AwayForm, HouseRulesForm, HouseholdForm, InviteForm, LeaveForm, PayHandlesForm, PreferencesForm } from "@/components/settings-forms";
import { getPayHandles } from "@/server/payments";
import { revokeInviteAction } from "@/app/actions/households";
import { logoutAction } from "@/app/actions/auth";
import { googleConfigured } from "@/server/calendar/google";
import { disconnectCalendarAction } from "@/app/actions/planner";
import { CalendarFeedRow } from "@/components/calendar-feed";
import { PushToggle } from "@/components/push-toggle";
import { countPushDevices, pushConfigured, vapidPublicKey } from "@/server/push";
import { getFeed } from "@/server/calendar/feed";

export const metadata = { title: "Household & settings" };

export default async function HouseholdPage({ searchParams }: { searchParams: Promise<{ calendar?: string; feed?: string; member?: string; released?: string }> }) {
  const { user, household } = await requireHousehold();
  const sp = await searchParams;
  const [{ members, role }, invites, connections, openCounts, myPlan, handleMap, feed, pushDevices] = await Promise.all([
    getHouseholdOverview(user.id, household.id),
    listInvitations(user.id, household.id),
    prisma.calendarConnection.findMany({ where: { userId: user.id }, select: { id: true, provider: true, status: true, accountEmail: true, lastSyncAt: true, lastError: true } }),
    openTaskCounts(user.id, household.id),
    moveOutPlan(user.id, household.id, user.id),
    getPayHandles([user.id]),
    getFeed(user.id, household.id),
    countPushDevices(user.id),
  ]);
  const released = Number(sp.released ?? 0);
  const myHandles = handleMap.get(user.id) ?? { venmoHandle: null, paypalHandle: null, cashtag: null };
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const google = connections.find((c) => c.provider === "GOOGLE");

  return (
    <>
      <PageHeader title="Household" subtitle={household.name} />

      <Section title={`Roommates · ${members.length}`}>
        <div id="roommates" className="card divide-y divide-slate-100">
          {sp.member === "removed" && (
            <p role="status" className="bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
              Roommate removed.{released > 0 && <> {released} open {released === 1 ? "task is" : "tasks are"} now unassigned. <Link href="/tasks?view=open" className="font-semibold underline">Pick them up →</Link></>}
            </p>
          )}
          <ul className="divide-y divide-slate-100">
            {members.map((m) => (
              <li key={m.id} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <Avatar id={m.id} name={m.name} />
                  <div className="flex-1">
                    <p className="font-medium">{m.name}{m.id === user.id && " (you)"}</p>
                    <p className="text-xs text-muted">{m.email}</p>
                    {(() => { const a = activeAway(m, todayIn(household.timezone)); return a && <p className="text-xs font-medium text-amber-800">{a.now ? "Away until" : "Away from"} {new Date(`${a.now ? a.until : a.from}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}</p>; })()}
                  </div>
                  {m.role === "OWNER" && <Badge tone="blue">Owner</Badge>}
                </div>
                {role === "OWNER" && (members.length > 1 || m.id !== user.id) && (
                  <div className="mt-2 pl-12">
                    <MemberActions member={{ id: m.id, name: m.name, role: m.role }} openTasks={openCounts.get(m.id) ?? 0} isSelf={m.id === user.id} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <Section title="Invite roommates">
        <div id="invite" className="card space-y-3 p-4">
          <InviteForm />
          <p className="text-xs text-muted">Invites are single-use and expire after 7 days. Adding an email restricts the invite to that address.</p>
          {invites.map((inv) => {
            const link = `${appUrl}/join/${inv.code}`;
            return (
              <div key={inv.id} className="rounded-xl bg-slate-50 p-3">
                <div className="flex items-center gap-2">
                  <code className="flex-1 font-mono text-lg tracking-widest">{inv.code}</code>
                  <CopyButton text={link} label="Copy link" />
                  <form action={revokeInviteAction}><input type="hidden" name="id" value={inv.id} />
                    <button className="text-xs text-slate-500 hover:text-red-700">Revoke</button>
                  </form>
                </div>
                <p className="mt-1 text-xs text-muted">{inv.email ? `For ${inv.email} · ` : ""}expires {inv.expiresAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</p>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="Household settings">
        <div className="card p-4">
          <HouseholdForm name={household.name} timezone={household.timezone} timezones={COMMON_TIMEZONES} canEdit={role === "OWNER"} />
        </div>
      </Section>

      <Section title="House rules">
        <div id="rules" className="card p-4">
          {role === "OWNER" ? (
            <HouseRulesForm rules={household.rules ?? ""}
              quietStart={household.quietStartMin != null ? minutesToHHMM(household.quietStartMin) : ""}
              quietEnd={household.quietEndMin != null ? minutesToHHMM(household.quietEndMin) : ""} />
          ) : (
            <div className="space-y-3 text-sm">
              {household.rules ? <p className="whitespace-pre-line">{household.rules}</p> : <p className="text-muted">No house rules yet. The owner can add some.</p>}
              <p className="text-muted">{household.quietStartMin != null && household.quietEndMin != null ? `Quiet hours: ${minutesToHHMM(household.quietStartMin!)} to ${minutesToHHMM(household.quietEndMin!)}. The planner won't suggest chores then.` : "No quiet hours set."}</p>
            </div>
          )}
        </div>
      </Section>

      <Section title="Calendars">
        <div id="calendars" className="card divide-y divide-slate-100">
          {sp.calendar && (
            <p role="status" className={`px-4 py-2 text-sm ${sp.calendar === "connected" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
              {sp.calendar === "connected" ? "Google Calendar connected." : `Google Calendar connection failed (${sp.calendar}).`}
            </p>
          )}
          <div className="flex items-center gap-3 p-4">
            <span className="text-2xl" aria-hidden>📅</span>
            <div className="flex-1">
              <p className="font-medium">Google Calendar</p>
              <p className="text-xs text-muted">
                {!googleConfigured() ? "Not set up on this server yet (needs Google OAuth credentials)."
                  : google?.status === "ACTIVE" ? `Connected${google.accountEmail ? ` as ${google.accountEmail}` : ""}. Busy times are used for planning; roommates never see event details.`
                    : google?.status === "ERROR" ? `Connection problem: ${google.lastError ?? "unknown error"}. Reconnect to fix.`
                      : "Use your busy times to suggest when to do chores, and add accepted tasks to your calendar."}
              </p>
            </div>
            {googleConfigured() && (google?.status === "ACTIVE" ? (
              <form action={disconnectCalendarAction}><input type="hidden" name="provider" value="GOOGLE" /><button className="btn-secondary min-h-9 text-xs">Disconnect</button></form>
            ) : (
              <a href="/api/calendar/google/connect" className="btn-primary min-h-9 text-xs">{google ? "Reconnect" : "Connect"}</a>
            ))}
          </div>
          {sp.feed && <p role="status" className="bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{sp.feed === "ready" ? "Your calendar link is ready. Add it to your calendar app below." : "Calendar link turned off. Old copies no longer work."}</p>}
          <CalendarFeedRow feed={feed} />
          <div className="p-4 text-sm">
            <Link href="/planner/availability" className="font-semibold text-brand-700">Set your weekly availability manually →</Link>
          </div>
        </div>
      </Section>

      <Section title="Get paid back">
        <div id="pay" className="card p-4">
          <PayHandlesForm handles={myHandles} />
        </div>
      </Section>

      <Section title="Away" hint="Going home for the weekend or on a trip? Chores and the planner skip you.">
        <div id="away" className="card p-4">
          <AwayForm today={todayIn(household.timezone)} away={activeAway(members.find((m) => m.id === user.id)!, todayIn(household.timezone))} />
        </div>
      </Section>

      <Section title="Your preferences">
        <div className="card p-4">
          <PreferencesForm
            timezones={COMMON_TIMEZONES}
            emailAvailable={emailConfigured()}
            user={{ name: user.name, timezone: user.timezone, preferredStart: minutesToHHMM(user.preferredStartMin), preferredEnd: minutesToHHMM(user.preferredEndMin), notifyInApp: user.notifyInApp, notifyEmail: user.notifyEmail }}
          />
          <div className="mt-4 border-t border-slate-200 pt-4"><PushToggle publicKey={pushConfigured() ? vapidPublicKey() : null} devices={pushDevices} /></div>
        </div>
      </Section>

      <div className="space-y-3">
        <Link href="/onboarding" className="btn-secondary w-full">Create or join another household</Link>
        <form action={logoutAction}><button className="btn-secondary w-full">Log out</button></form>
        <LeaveForm openTasks={openCounts.get(user.id) ?? 0} viewerId={user.id} plan={{ userId: user.id, cents: myPlan.cents, currency: household.currency, payments: myPlan.payments }} />
      </div>
    </>
  );
}
