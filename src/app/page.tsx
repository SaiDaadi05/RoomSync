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
      <section className="bg-ink text-white">
        <div className="mx-auto max-w-6xl px-5 pb-14 pt-6 md:px-8 md:pb-20">
          <nav className="flex items-center gap-2.5">
            <Logo className="h-9 w-9 rounded-[10px] ring-2 ring-white/20" />
            <span className="text-xl font-extrabold">RoomSync</span>
            <Link href="/login" className="ml-auto rounded-xl px-3 py-2 text-sm font-bold text-white/80 hover:text-white">Log in</Link>
          </nav>
          <div className="mt-10 grid items-center gap-12 md:mt-16 md:grid-cols-[1.1fr_1fr]">
            <div>
              <p className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-peach-300">For roommates who'd rather not argue</p>
              <h1 className="mt-4 text-[2.6rem] font-extrabold leading-[1.05] md:text-6xl">
                Live together,<br /><span className="text-peach-400">without the chore wars.</span>
              </h1>
              <p className="mt-5 max-w-lg text-lg text-white/70">Chores, errands, groceries, shared costs and schedules for your whole place, in one app everyone actually opens.</p>
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Link href="/signup" className="btn-peach px-6 text-base">Get started free</Link>
                {demoEnabled() && (
                  <form action={startDemoAction}><button className="btn min-h-11 bg-white/10 px-5 text-base text-white hover:bg-white/15">Try the demo house</button></form>
                )}
              </div>
            </div>
            <PhonePreview />
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-5 py-16 md:px-8">
        <h2 className="max-w-2xl text-3xl font-extrabold leading-tight md:text-4xl">Everything a shared home runs on.</h2>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(([cat, title, body]) => (
            <li key={title} className="card p-5">
              <CategoryIcon category={cat} className="h-12 w-12" />
              <p className="mt-4 text-lg font-extrabold">{title}</p>
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
            <div key={t} className="flex gap-4 rounded-[20px] bg-peach-100 p-5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-peach-400 text-lg font-extrabold text-white">{i + 1}</span>
              <div><p className="font-extrabold">{t}</p><p className="mt-0.5 text-sm text-ink/70">{b}</p></div>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-peach-400">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-5 px-5 py-12 md:flex-row md:items-center md:px-8">
          <p className="flex-1 text-2xl font-extrabold text-white md:text-3xl">Your place, but nobody's keeping a mental tally anymore.</p>
          <Link href="/signup" className="btn bg-ink px-6 text-base text-white hover:bg-brand-500">Get started free</Link>
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
    ["kitchen", "Run the dishwasher", "Up for grabs", "grab"],
  ];
  return (
    <div className="relative mx-auto w-full max-w-[320px]" aria-hidden>
      <div className="absolute -left-6 top-10 h-40 w-40 rounded-full bg-peach-400/25 blur-2xl" />
      <div className="relative rotate-2 rounded-[2.4rem] border-[6px] border-white/10 bg-canvas p-3 text-ink shadow-2xl">
        <div className="rounded-[22px] bg-ink p-4 text-white">
          <p className="text-[11px] font-semibold text-white/60">Sunday, November 8</p>
          <p className="mt-0.5 text-lg font-extrabold">Good evening, Alex</p>
          <div className="mt-3 flex gap-2">
            <span className="rounded-xl bg-peach-400 px-2.5 py-1.5 text-[11px] font-extrabold">You owe Sam $35.89</span>
            <span className="rounded-xl bg-white/10 px-2.5 py-1.5 text-[11px] font-extrabold">5 to buy</span>
          </div>
        </div>
        <p className="mb-2 mt-4 px-1 text-sm font-extrabold">Your turn</p>
        <div className="card divide-y divide-slate-200 overflow-hidden">
          {rows.map(([cat, t, sub, kind]) => (
            <div key={t} className="flex items-center gap-2.5 px-3 py-2.5">
              <CategoryIcon category={cat} className="h-8 w-8" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-bold">{t}</p>
                <p className={`text-[11px] ${kind === "late" ? "font-bold text-peach-500" : "text-muted"}`}>{sub}</p>
              </div>
              {kind === "grab" ? <span className="rounded-full bg-peach-400 px-2 py-1 text-[10px] font-bold text-white">I'll do it</span> : <span className="h-5 w-5 rounded-md border-2 border-ink" />}
            </div>
          ))}
        </div>
        <div className="card mt-3 p-3">
          <p className="text-[11px] font-bold text-muted">Who's doing what</p>
          <div className="mt-2 flex h-2.5 overflow-hidden rounded-full"><div className="w-[35%] bg-peach-400" /><div className="w-[42%] bg-ink" /><div className="w-[23%] bg-amber-400" /></div>
        </div>
      </div>
    </div>
  );
}
