import Link from "next/link";
import { requireHousehold } from "@/server/session";
import { getHouseholdOverview, listInvitations } from "@/server/households";
import { emailConfigured } from "@/server/notifications";
import { prisma } from "@/server/db";
import { COMMON_TIMEZONES, minutesToHHMM } from "@/lib/time";
import { Avatar, Badge, PageHeader, Section } from "@/components/ui";
import { CopyButton } from "@/components/copy-button";
import { HouseholdForm, InviteForm, LeaveForm, PayHandlesForm, PreferencesForm } from "@/components/settings-forms";
import { getPayHandles } from "@/server/payments";
import { revokeInviteAction } from "@/app/actions/households";
import { logoutAction } from "@/app/actions/auth";
import { googleConfigured } from "@/server/calendar/google";
import { disconnectCalendarAction } from "@/app/actions/planner";

export const metadata = { title: "Household & settings" };

export default async function HouseholdPage({ searchParams }: { searchParams: Promise<{ calendar?: string }> }) {
  const { user, household } = await requireHousehold();
  const sp = await searchParams;
  const [{ members, role }, invites, connections, handleMap] = await Promise.all([
    getHouseholdOverview(user.id, household.id),
    listInvitations(user.id, household.id),
    prisma.calendarConnection.findMany({ where: { userId: user.id }, select: { id: true, provider: true, status: true, accountEmail: true, lastSyncAt: true, lastError: true } }),
    getPayHandles([user.id]),
  ]);
  const myHandles = handleMap.get(user.id) ?? { venmoHandle: null, paypalHandle: null, cashtag: null };
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const google = connections.find((c) => c.provider === "GOOGLE");

  return (
    <>
      <PageHeader title="Household" subtitle={household.name} />

      <Section title={`Roommates · ${members.length}`}>
        <ul className="card divide-y divide-slate-100">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-3 px-4 py-3">
              <Avatar id={m.id} name={m.name} />
              <div className="flex-1">
                <p className="font-medium">{m.name}{m.id === user.id && " (you)"}</p>
                <p className="text-xs text-muted">{m.email}</p>
              </div>
              {m.role === "OWNER" && <Badge tone="blue">Owner</Badge>}
            </li>
          ))}
        </ul>
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

      <Section title="Calendars">
        <div className="card divide-y divide-slate-100">
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
          <div className="flex items-center gap-3 p-4">
            <span className="text-2xl" aria-hidden>🍎</span>
            <div className="flex-1">
              <p className="font-medium">Apple Calendar</p>
              <p className="text-xs text-muted">Planned. Not available yet. Until then, enter your free times manually in the planner.</p>
            </div>
            <Badge>Coming later</Badge>
          </div>
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

      <Section title="Your preferences">
        <div className="card p-4">
          <PreferencesForm
            timezones={COMMON_TIMEZONES}
            emailAvailable={emailConfigured()}
            user={{ name: user.name, timezone: user.timezone, preferredStart: minutesToHHMM(user.preferredStartMin), preferredEnd: minutesToHHMM(user.preferredEndMin), notifyInApp: user.notifyInApp, notifyEmail: user.notifyEmail }}
          />
        </div>
      </Section>

      <div className="space-y-3">
        <Link href="/onboarding" className="btn-secondary w-full">Create or join another household</Link>
        <form action={logoutAction}><button className="btn-secondary w-full">Log out</button></form>
        <LeaveForm />
      </div>
    </>
  );
}
