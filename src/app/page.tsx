import { Logo } from "@/components/ui";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/session";
import { demoEnabled } from "@/server/demo";
import { startDemoAction } from "@/app/actions/demo";
import { CategoryIcon } from "@/components/task-row";

const FEATURES: [string, string, string][] = [
  ["cleaning", "Chores that take turns", "Daily and weekly chores rotate between roommates, with history and reminders, so nobody has to be the nag."],
  ["bills", "Fair by effort, not count", "A 45-minute bathroom clean isn't the same as taking out the trash. RoomSync weighs chores by time."],
  ["errands", "Planned around real life", "Suggests times when people are actually free, from your availability or Google Calendar."],
  ["groceries", "One shared shopping list", "Claim what you'll buy so nothing gets bought twice, then split the receipt in one step."],
  ["kitchen", "Who owes whom, settled", "Equal or custom splits, receipts and balances, with the fewest payments to square up."],
  ["trash", "Up for grabs", "Unclaimed chores sit in a shared pool. Whoever has a free minute takes one."],
];

export default async function Landing() {
  if (await getCurrentUser()) redirect("/home");
  return (
    <main>
      {/* Hero */}
      <section className="border-b border-slate-200">
        <div className="mx-auto max-w-6xl px-5 pb-14 pt-6 md:px-8 md:pb-20">
          <nav className="flex items-center gap-2.5">
            <Logo className="h-9 w-9" />
            <span className="text-xl font-bold text-peach-400">RoomSync</span>
            <Link href="/how-it-works" className="ml-auto rounded-full px-4 py-2 text-sm font-semibold hover:bg-slate-100">How it works</Link>
            <Link href="/login" className="rounded-full px-4 py-2 text-sm font-semibold hover:bg-slate-100">Log in</Link>
          </nav>
          <div className="mt-10 grid items-center gap-12 md:mt-16 md:grid-cols-[1.1fr_1fr]">
            <div>
              <p className="text-sm font-semibold text-muted">For roommates who'd rather not argue</p>
              <h1 className="mt-3 text-[2.5rem] font-bold leading-[1.05] tracking-tight md:text-6xl">
                Live together,<br /><span className="text-peach-400">without the chore wars.</span>
              </h1>
              <p className="mt-5 max-w-lg text-lg text-muted">Chores, errands, groceries, shared costs and schedules for your whole place, in one app everyone actually opens.</p>
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Link href="/signup" className="btn-peach px-6 text-base">Get started free</Link>
                {demoEnabled() && (
                  <form action={startDemoAction}><button className="btn-secondary px-5 text-base">Try the demo house</button></form>
                )}
                <Link href="/how-it-works" className="px-2 py-2 text-base font-semibold underline underline-offset-4">See how it works</Link>
              </div>
            </div>
            <PhonePreview />
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-5 py-16 md:px-8">
        <h2 className="max-w-2xl text-3xl font-bold leading-tight md:text-4xl">Everything a shared home runs on.</h2>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(([cat, title, body]) => (
            <li key={title} className="card p-5">
              <CategoryIcon category={cat} className="h-12 w-12" />
              <p className="mt-4 text-lg font-semibold">{title}</p>
              <p className="mt-1 text-[15px] text-muted">{body}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-5 pb-16 md:px-8">
        <div className="grid gap-4 md:grid-cols-3">
          {[
            ["Create your place", "Name it, set your timezone and currency."],
            ["Invite roommates", "Share one link. Everyone sees the same list."],
            ["Split it fairly", "Add chores and costs. RoomSync keeps score."],
          ].map(([t, b], i) => (
            <div key={t} className="flex gap-4 border-t border-slate-300 pt-5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-ink text-lg font-semibold">{i + 1}</span>
              <div><p className="font-semibold">{t}</p><p className="mt-0.5 text-sm text-muted">{b}</p></div>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-slate-200 bg-slate-100">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-5 px-5 py-12 md:flex-row md:items-center md:px-8">
          <p className="flex-1 text-2xl font-bold md:text-3xl">Your place, but nobody's keeping a mental tally anymore.</p>
          <Link href="/signup" className="btn-peach px-6 text-base">Get started free</Link>
        </div>
      </section>
    </main>
  );
}

/** A static preview of the Home screen inside a phone frame. */
function PhonePreview() {
  const rows: [string, string, string, string][] = [
    ["trash", "Take out the recycling", "Was due last night", "late"],
    ["bathroom", "Clean the bathroom", "Today · 45 min", "today"],
    ["kitchen", "Run the dishwasher", "Today · 15 min", "grab"],
  ];
  return (
    <div className="mx-auto w-full max-w-[320px]" aria-hidden>
      <div className="rounded-[2.4rem] border border-slate-300 bg-white p-5 shadow-[0_12px_40px_rgba(0,0,0,0.12)]">
        <p className="text-xs text-muted">Sunday, November 8 · 3 roommates</p>
        <p className="mt-1 text-xl font-bold">Good evening, Alex</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[["You owe Sam", "$35.89"], ["To buy", "5 items"], ["Your share", "39%"]].map(([l, v]) => (
            <div key={l} className="rounded-xl border border-slate-300 p-2"><p className="truncate text-[10px] text-muted">{l}</p><p className="text-sm font-bold">{v}</p></div>
          ))}
        </div>
        <p className="mb-1 mt-5 font-bold">Your turn</p>
        <div className="divide-y divide-slate-200">
          {rows.map(([cat, t, sub, kind]) => (
            <div key={t} className="flex items-center gap-2.5 py-2.5">
              <CategoryIcon category={cat} className="h-9 w-9" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold">{t}</p>
                <p className={`text-[11px] ${kind === "late" ? "text-peach-700" : "text-muted"}`}>{sub}</p>
              </div>
              {kind === "grab" ? <span className="rounded-md bg-peach-500 px-2 py-1 text-[10px] font-semibold text-white">I'll do it</span> : <span className="rounded-md border border-ink px-2 py-1 text-[10px] font-semibold">Done</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
