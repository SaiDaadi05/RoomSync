import Link from "next/link";
import { DateTime } from "luxon";
import { requireHousehold } from "@/server/session";
import { getHouseholdOverview, listInvitations } from "@/server/households";
import { emailConfigured } from "@/server/notifications";
import { prisma } from "@/server/db";
import { COMMON_TIMEZONES, minutesToHHMM, todayIn } from "@/lib/time";
import { activeAway } from "@/lib/away";
import { Avatar, Badge, PageHeader, Section } from "@/components/ui";
import { Fold, OpenFromHash } from "@/components/fold";
import { CopyButton } from "@/components/copy-button";
import { MemberActions } from "@/components/member-actions";
import { openTaskCounts } from "@/server/members";
import { moveOutPlan } from "@/server/moveout";
import { AwayForm, ChangePasswordForm, HouseRulesForm, HouseholdForm, InviteForm, LeaveForm, PayHandlesForm, PreferencesForm } from "@/components/settings-forms";
import { getPayHandles } from "@/server/payments";
import { StartTourButton } from "@/components/tour/tour";
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
  const today = todayIn(household.timezone);
  const away = activeAway(members.find((m) => m.id === user.id)!, today);
  const shortDate = (iso: string) => DateTime.fromISO(iso).toFormat("LLL d");
  const hm = (min: number) => DateTime.fromObject({ hour: Math.floor(min / 60), minute: min % 60 }).toFormat("h:mm a");
  const payList = [myHandles.venmoHandle && "Venmo", myHandles.paypalHandle && "PayPal", myHandles.cashtag && "Cash App"].filter(Boolean) as string[];
  const quiet = household.quietStartMin != null && household.quietEndMin != null ? `quiet ${hm(household.quietStartMin)} to ${hm(household.quietEndMin)}` : "no quiet hours";

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
                <div className="flex flex-wrap items-center gap-2">
                  <code className="flex-1 font-mono text-lg tracking-widest">{inv.code}</code>
                  <CopyButton text={inv.code} label="Copy code" />
                  <CopyButton text={link} label="Copy invite link" />
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

      <Section title="Settings">
        <OpenFromHash />
        <div className="card overflow-hidden">
          <Fold id="away" title="Away" summary={away ? (away.now ? `Away until ${shortDate(away.until)}` : `Away ${shortDate(away.from)} to ${shortDate(away.until)}`) : "Going away? Chores and the planner skip you."}>
            <AwayForm today={today} away={away} />
          </Fold>
          <Fold id="pay" title="Get paid back" summary={payList.length ? payList.join(" · ") : "Add Venmo, PayPal or Cash App"}>
            <PayHandlesForm handles={myHandles} />
          </Fold>
          <Fold id="calendars" title="Calendars" open={!!(sp.calendar || sp.feed)} summary={google?.status === "ACTIVE" ? "Google Calendar connected" : feed ? "Calendar link on" : "Not connected"}>
            <div className="-mx-4 divide-y divide-slate-100 border-y border-slate-100">
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
          </Fold>
          <Fold id="rules" title="House rules and quiet hours" summary={[household.rules ? "Rules written" : "No rules yet", quiet].join(" · ")}>
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
          </Fold>
          <Fold id="preferences" title="Your preferences" summary={`Chores ${hm(user.preferredStartMin)} to ${hm(user.preferredEndMin)} · ${user.notifyEmail && emailConfigured() ? "app and email reminders" : user.notifyInApp ? "app reminders" : "reminders off"}`}>
          <PreferencesForm
            timezones={COMMON_TIMEZONES}
            emailAvailable={emailConfigured()}
            user={{ name: user.name, timezone: user.timezone, preferredStart: minutesToHHMM(user.preferredStartMin), preferredEnd: minutesToHHMM(user.preferredEndMin), notifyInApp: user.notifyInApp, notifyEmail: user.notifyEmail }}
          />
          <div className="mt-4 border-t border-slate-200 pt-4"><PushToggle publicKey={pushConfigured() ? vapidPublicKey() : null} devices={pushDevices} /></div>
          </Fold>
          <Fold id="household-settings" title="Name and timezone" summary={`${household.name} · ${household.timezone.replace(/_/g, " ")}`}>
          <HouseholdForm name={household.name} timezone={household.timezone} timezones={COMMON_TIMEZONES} canEdit={role === "OWNER"} />
          </Fold>
          {!user.isDemo && (
            <Fold id="password" title="Password" summary="Change your password">
              <ChangePasswordForm email={user.email} />
            </Fold>
          )}
        </div>
      </Section>

      <div className="space-y-3">
        <StartTourButton className="btn-secondary w-full">Replay the app tour</StartTourButton>
        <Link href="/onboarding" className="btn-secondary w-full">Create or join another household</Link>
        <form action={logoutAction}><button className="btn-secondary w-full">Log out</button></form>
        <LeaveForm openTasks={openCounts.get(user.id) ?? 0} viewerId={user.id} plan={{ userId: user.id, cents: myPlan.cents, currency: household.currency, payments: myPlan.payments }} />
        {!user.isDemo && <p className="pt-2 text-center text-xs"><Link href="/delete-account" className="text-muted underline">Delete my account</Link></p>}
      </div>
    </>
  );
}
