import Link from "next/link";
import { requireHousehold } from "@/server/session";
import { listAvailability } from "@/server/planner";
import { minutesToHHMM, WEEKDAY_LABELS } from "@/lib/time";
import { PageHeader, Section } from "@/components/ui";
import { AvailabilityForm } from "@/components/planner-forms";
import { deleteAvailabilityAction } from "@/app/actions/planner";

export const metadata = { title: "My free time" };

export default async function AvailabilityPage() {
  const { user } = await requireHousehold();
  const windows = await listAvailability(user.id);
  return (
    <>
      <Link href="/planner" className="mb-3 inline-block text-sm font-medium text-brand-700">← Planner</Link>
      <PageHeader title="My free time" subtitle={`Typical weekly times you can do chores (${user.timezone.replace(/_/g, " ")}).`} />
      <div className="card mb-5 p-4"><AvailabilityForm /></div>
      <Section title="Your weekly availability">
        {windows.length === 0 ? (
          <p className="card p-4 text-sm text-muted">None yet. Until you add some, the planner assumes you're free during your preferred hours ({minutesToHHMM(user.preferredStartMin)}–{minutesToHHMM(user.preferredEndMin)}).</p>
        ) : (
          <ul className="card divide-y divide-slate-100">
            {windows.map((w) => (
              <li key={w.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="w-10 font-semibold">{WEEKDAY_LABELS[w.weekday - 1]}</span>
                <span className="flex-1 tabular-nums">{minutesToHHMM(w.startMin)} – {minutesToHHMM(w.endMin)}</span>
                <form action={deleteAvailabilityAction}><input type="hidden" name="id" value={w.id} /><button className="text-xs text-slate-500 hover:text-red-700">Remove</button></form>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <p className="text-xs text-muted">Roommates see only the suggested times this produces, never your calendar or this list. If you connect Google Calendar, its busy times are subtracted from these windows.</p>
    </>
  );
}
