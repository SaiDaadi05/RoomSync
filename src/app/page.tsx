import { Logo } from "@/components/ui";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/session";
import { demoEnabled } from "@/server/demo";
import { startDemoAction } from "@/app/actions/demo";

export default async function Landing() {
  if (await getCurrentUser()) redirect("/home");
  const features = [
    ["🧽", "Chores that rotate", "Daily and weekly chores with turns, history, and reminders, so nobody has to be the nag."],
    ["🗓️", "Planned around real schedules", "Suggests times when people are actually free, from manual availability or Google Calendar."],
    ["⚖️", "Fair by effort", "Tracks estimated minutes, not just task counts, and explains every suggestion."],
    ["🛒", "One shared list", "Claim items so nothing gets bought twice, then turn a purchase into a split expense in one step."],
    ["💸", "Who owes whom", "Equal or custom splits, receipts, balances, and recorded paybacks."],
  ];
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-10 flex items-center gap-2 text-xl font-bold"><Logo className="h-9 w-9" /> RoomSync</div>
      <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">Live together,<br /><span className="text-peach-400">without the chore wars.</span></h1>
      <p className="mt-4 max-w-xl text-lg text-muted">Chores, errands, groceries, shared costs, and schedules for roommates, all in one place.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/signup" className="btn-primary px-6 text-base">Get started free</Link>
        <Link href="/login" className="btn-secondary px-6 text-base">Log in</Link>
        {demoEnabled() && <form action={startDemoAction}><button className="btn-ghost px-4 text-base">Try the demo →</button></form>}
      </div>
      <ul className="mt-12 grid gap-3 sm:grid-cols-2">
        {features.map(([, title, body], idx) => (
          <li key={title} className="card flex gap-4 p-5">
            <span aria-hidden className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-lg font-extrabold ${idx % 2 ? "bg-ink text-white" : "bg-peach-400 text-white"}`}>{idx + 1}</span>
            <div>
            <p className="font-bold">{title}</p>
            <p className="mt-1 text-sm text-muted">{body}</p>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
