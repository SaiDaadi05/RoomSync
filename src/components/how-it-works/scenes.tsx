"use client";

/**
 * The phone screens on /how-it-works. Each scene takes `p`, how far the reader
 * has scrolled through that chapter (0 to 1), and moves with it, so the
 * animation is tied to the scroll instead of playing on a timer.
 */

/** 0 before `a`, 1 after `b`, linear in between. */
export const seg = (p: number, a: number, b: number) => Math.min(1, Math.max(0, (p - a) / (b - a)));
const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const money = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

const PEOPLE = {
  maya: { name: "Maya", tone: "bg-amber-100 text-amber-800" },
  jordan: { name: "Jordan", tone: "bg-sky-100 text-sky-800" },
  sam: { name: "Sam", tone: "bg-emerald-100 text-emerald-800" },
  lee: { name: "Lee", tone: "bg-violet-100 text-violet-800" },
} as const;
type Who = keyof typeof PEOPLE;

function Face({ who, size = "h-7 w-7 text-[11px]" }: { who: Who; size?: string }) {
  return <span className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${PEOPLE[who].tone} ${size}`}>{PEOPLE[who].name[0]}</span>;
}

function Check({ on }: { on: boolean }) {
  return (
    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors duration-300 ${on ? "border-ink bg-ink text-white" : "border-slate-400 bg-paper"}`}>
      <svg viewBox="0 0 24 24" className={`h-4 w-4 transition-transform duration-300 ${on ? "scale-100" : "scale-0"}`} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg>
    </span>
  );
}

function Title({ kicker, children }: { kicker: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <p className="text-[11px] text-muted">{kicker}</p>
      <p className="text-lg font-bold leading-tight">{children}</p>
    </div>
  );
}

/** Slide-and-fade in as t goes 0 → 1. */
const enter = (t: number, dy = 14): React.CSSProperties => ({ opacity: ease(t), transform: `translateY(${(1 - ease(t)) * dy}px)` });

// 01 · The week plans itself: workload evens out, chores land on days.
export function PlanScene({ p }: { p: number }) {
  const t = ease(seg(p, 0.1, 0.6));
  const bars: [Who, number, number][] = [["maya", 62, 34], ["jordan", 25, 33], ["sam", 13, 33]];
  const days = [["Mon", "Trash", "sam"], ["Tue", "Dishes", "jordan"], ["Thu", "Bathroom", "maya"], ["Sat", "Vacuum", "jordan"]] as const;
  return (
    <div>
      <Title kicker="Sunday, 8:12 PM">Planner</Title>
      <p className="mb-2 text-xs font-semibold">Workload this week</p>
      <div className="space-y-2.5">
        {bars.map(([who, from, to]) => {
          const v = from + (to - from) * t;
          return (
            <div key={who} className="flex items-center gap-2">
              <Face who={who} />
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-ink" style={{ width: `${v}%` }} />
              </div>
              <span className="w-9 text-right text-[11px] tabular-nums text-muted">{Math.round(v)}%</span>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-muted" style={{ opacity: seg(p, 0.5, 0.65) }}>Balanced by time, not count.</p>
      <div className="mt-4 space-y-2">
        {days.map(([d, chore, who], i) => (
          <div key={d} className="flex items-center gap-3 rounded-xl border border-slate-300 px-3 py-2.5" style={enter(seg(p, 0.45 + i * 0.1, 0.6 + i * 0.1))}>
            <span className="w-8 text-[11px] font-semibold text-muted">{d}</span>
            <span className="flex-1 text-[13px] font-medium">{chore}</span>
            <Face who={who} size="h-6 w-6 text-[10px]" />
          </div>
        ))}
      </div>
    </div>
  );
}

// 02 · Trash day: a reminder lands, it gets ticked, the next one is already scheduled.
export function ChoreScene({ p }: { p: number }) {
  const notif = seg(p, 0.05, 0.25);
  const done = p > 0.5;
  const next = seg(p, 0.6, 0.8);
  return (
    <div>
      <div className="mb-4 rounded-2xl border border-slate-300 bg-paper p-3 shadow-[0_6px_20px_rgba(0,0,0,0.08)]" style={{ opacity: ease(notif), transform: `translateY(${(1 - ease(notif)) * -24}px)` }}>
        <p className="text-[11px] text-muted">RoomSync · now</p>
        <p className="text-[13px] font-semibold">Trash goes out tonight</p>
        <p className="text-[12px] text-muted">It&apos;s your turn, Sam. About 10 minutes.</p>
      </div>
      <Title kicker="Monday, 7:40 PM">Your turn</Title>
      <div className="space-y-2">
        <div className={`flex items-center gap-3 rounded-xl border px-3 py-3 transition-colors duration-300 ${done ? "border-slate-200 bg-slate-50" : "border-slate-300"}`}>
          <Check on={done} />
          <div className="min-w-0 flex-1">
            <p className={`text-[13px] font-semibold transition-colors ${done ? "text-muted line-through" : ""}`}>Take out trash and recycling</p>
            <p className="text-[11px] text-muted">{done ? "Done by Sam · 7:52 PM" : "Due tonight · every Mon and Thu"}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-dashed border-slate-300 px-3 py-3" style={enter(next)}>
          <span className="h-6 w-6 shrink-0 rounded-md border border-slate-300" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold">Take out trash and recycling</p>
            <p className="text-[11px] text-muted">Next up Thursday · Maya&apos;s turn</p>
          </div>
        </div>
      </div>
      <p className="mt-4 text-[11px] text-muted" style={{ opacity: seg(p, 0.75, 0.9) }}>History kept for every week. Nobody has to remember whose turn it is.</p>
    </div>
  );
}

// 03 · Out of oat milk: items get added, claimed and bought.
export function ShoppingScene({ p }: { p: number }) {
  const items: [string, string, Who][] = [["Oat milk", "× 2", "jordan"], ["Dish soap", "", "jordan"], ["Paper towels", "1 pack", "maya"]];
  const logged = seg(p, 0.75, 0.9);
  return (
    <div>
      <Title kicker="Tuesday, 6:05 PM">Shopping list</Title>
      <div className="space-y-2">
        {items.map(([name, qty, who], i) => {
          const shown = seg(p, 0.02 + i * 0.12, 0.14 + i * 0.12);
          const claimed = p > 0.42 + i * 0.04;
          const bought = p > 0.6 + i * 0.05;
          return (
            <div key={name} className="flex items-center gap-3 rounded-xl border border-slate-300 px-3 py-2.5" style={enter(shown)}>
              <Check on={bought} />
              <p className={`flex-1 text-[13px] font-medium ${bought ? "text-muted line-through" : ""}`}>{name} <span className="font-normal text-muted">{qty}</span></p>
              <span className={`flex items-center gap-1.5 text-[11px] text-muted transition-opacity duration-300 ${claimed ? "opacity-100" : "opacity-0"}`}>
                <Face who={who} size="h-5 w-5 text-[9px]" /> {bought ? "Bought" : "Getting it"}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex items-center justify-between rounded-xl bg-slate-100 px-3 py-3" style={enter(logged)}>
        <span className="text-[12px]">Jordan logged the receipt</span>
        <span className="text-[13px] font-bold tabular-nums">$18.20</span>
      </div>
      <p className="mt-3 text-[11px] text-muted" style={{ opacity: seg(p, 0.85, 0.95) }}>It goes straight into Money, split with the house.</p>
    </div>
  );
}

// 04 · Groceries, split three ways: one receipt becomes three shares and balances move.
export function SplitScene({ p }: { p: number }) {
  const total = 8430;
  const split = ease(seg(p, 0.15, 0.5));
  const shares: [Who, number][] = [["maya", 2810], ["jordan", 2810], ["sam", 2810]];
  const bal = ease(seg(p, 0.6, 0.85));
  return (
    <div>
      <Title kicker="Wednesday, 9:30 PM">New cost</Title>
      <div className="rounded-xl border border-slate-300 p-3">
        <div className="flex items-baseline justify-between">
          <p className="text-[13px] font-semibold">Groceries, Trader Joe&apos;s</p>
          <p className="text-lg font-bold tabular-nums">{money(total)}</p>
        </div>
        <p className="text-[11px] text-muted">Paid by Maya · split equally</p>
        <div className="mt-3 flex h-3 gap-0.5 overflow-hidden rounded-full">
          {shares.map(([who], i) => (
            <div key={who} className={`h-full ${["bg-amber-200", "bg-sky-200", "bg-emerald-200"][i]}`} style={{ flexGrow: 1, opacity: 0.25 + 0.75 * split, marginLeft: i ? `${split * 4}px` : 0 }} />
          ))}
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1 text-center">
          {shares.map(([who, c]) => (
            <div key={who} style={{ opacity: split }}>
              <p className="text-[11px] text-muted">{PEOPLE[who].name}</p>
              <p className="text-[13px] font-semibold tabular-nums">{money(Math.round(c * split))}</p>
            </div>
          ))}
        </div>
      </div>
      <p className="mb-2 mt-5 text-xs font-semibold" style={{ opacity: bal }}>Everyone&apos;s balance</p>
      <div className="space-y-1.5" style={enter(bal)}>
        {([["maya", 5620], ["jordan", -2810], ["sam", -2810]] as [Who, number][]).map(([who, c]) => (
          <div key={who} className="flex items-center gap-2 text-[13px]">
            <Face who={who} size="h-6 w-6 text-[10px]" />
            <span className="flex-1">{PEOPLE[who].name}</span>
            <span className={`font-semibold tabular-nums ${c > 0 ? "text-emerald-700" : "text-peach-700"}`}>{c > 0 ? "gets back " : "owes "}{money(Math.abs(Math.round(c * bal)))}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// 05 · Plans change: a swap request arrives and gets accepted.
export function SwapScene({ p }: { p: number }) {
  const card = seg(p, 0.08, 0.3);
  const accepted = p > 0.55;
  const moved = ease(seg(p, 0.6, 0.8));
  return (
    <div>
      <Title kicker="Thursday, 12:14 PM">Swap request</Title>
      <div className="rounded-2xl border border-slate-300 p-4" style={enter(card, 30)}>
        <div className="flex items-center gap-2">
          <Face who="maya" />
          <p className="text-[13px]"><b>Maya</b> asked to swap</p>
        </div>
        <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-center text-[12px]">
          <div className="rounded-lg bg-slate-100 px-2 py-2"><p className="font-semibold">Bathroom</p><p className="text-muted">Thu · Maya</p></div>
          <svg viewBox="0 0 24 24" className="h-4 w-4 text-muted" fill="none" stroke="currentColor" strokeWidth={2}><path d="M7 7h12l-3-3M17 17H5l3 3" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <div className="rounded-lg bg-slate-100 px-2 py-2"><p className="font-semibold">Vacuum</p><p className="text-muted">Sat · Jordan</p></div>
        </div>
        <p className="mt-3 text-[11px] text-muted">&ldquo;Working late Thursday, can I take Saturday?&rdquo;</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <span className="rounded-lg border border-ink py-2 text-center text-[12px] font-semibold">Not this time</span>
          <span className={`rounded-lg py-2 text-center text-[12px] font-semibold text-white transition-all duration-300 ${accepted ? "scale-[0.97] bg-peach-500" : "bg-peach-400"}`}>{accepted ? "Swapped" : "Swap"}</span>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        {([["Thu", "Bathroom", moved > 0.5 ? "jordan" : "maya"], ["Sat", "Vacuum", moved > 0.5 ? "maya" : "jordan"]] as const).map(([d, c, who]) => (
          <div key={d} className="flex items-center gap-3 rounded-xl border border-slate-300 px-3 py-2.5">
            <span className="w-8 text-[11px] font-semibold text-muted">{d}</span>
            <span className="flex-1 text-[13px] font-medium">{c}</span>
            <span style={{ transform: `scale(${1 - Math.sin(moved * Math.PI) * 0.4})` }} className="inline-flex"><Face who={who} size="h-6 w-6 text-[10px]" /></span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-muted" style={{ opacity: seg(p, 0.75, 0.9) }}>Nothing moves until the other person says yes.</p>
    </div>
  );
}

// 06 · Rent shows up on its own, and includes whoever lives there that month.
export function BillsScene({ p }: { p: number }) {
  const months = ["Sep", "Oct", "Nov", "Dec"];
  const reached = p < 0.05 ? 0 : Math.min(months.length, 1 + Math.floor(seg(p, 0.05, 0.8) * months.length));
  const leeJoined = reached >= 3;
  return (
    <div>
      <Title kicker="The 1st of every month">Recurring bills</Title>
      <div className="flex items-center justify-between rounded-xl border border-slate-300 px-3 py-3">
        <div><p className="text-[13px] font-semibold">Rent</p><p className="text-[11px] text-muted">Every month on the 1st · paid by Maya</p></div>
        <p className="text-[13px] font-bold">$3,600</p>
      </div>
      <div className="mt-4 space-y-2">
        {months.map((m, i) => {
          const on = i < reached;
          const people: Who[] = i >= 2 ? ["maya", "jordan", "sam", "lee"] : ["maya", "jordan", "sam"];
          return (
            <div key={m} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-all duration-500 ${on ? "border-slate-300 opacity-100" : "translate-y-2 border-transparent opacity-0"}`}>
              <span className="w-8 text-[11px] font-semibold text-muted">{m} 1</span>
              <span className="flex flex-1 -space-x-1.5">{people.map((w) => <Face key={w} who={w} size="h-6 w-6 text-[10px] ring-2 ring-paper" />)}</span>
              <span className="text-[12px] tabular-nums text-muted">{money(360000 / people.length)} each</span>
            </div>
          );
        })}
      </div>
      <p className={`mt-3 text-[11px] transition-opacity duration-500 ${leeJoined ? "opacity-100" : "opacity-0"}`}><b>Lee moved in</b> in November and was added to the split automatically.</p>
    </div>
  );
}

// 07 · Just say it: the assistant turns a sentence into a draft you confirm.
export function AssistantScene({ p }: { p: number }) {
  const text = "I paid $42 for pizza, split with everyone except Sam";
  const typed = text.slice(0, Math.round(seg(p, 0.05, 0.45) * text.length));
  const draft = seg(p, 0.5, 0.68);
  const saved = p > 0.8;
  return (
    <div>
      <Title kicker="Friday, 11:48 PM">Assistant</Title>
      <div className="ml-6 rounded-2xl rounded-br-md bg-ink px-3 py-2.5 text-[13px] text-white" style={{ minHeight: 44 }}>
        {typed}<span className={`ml-0.5 inline-block h-3.5 w-px translate-y-0.5 bg-white ${p < 0.47 ? "animate-pulse" : "opacity-0"}`} />
      </div>
      <div className="mr-6 mt-3 rounded-2xl rounded-bl-md border border-slate-300 p-3" style={enter(draft)}>
        <p className="text-[11px] text-muted">Draft · nothing saved yet</p>
        <div className="mt-1.5 flex items-baseline justify-between">
          <p className="text-[13px] font-semibold">Pizza</p>
          <p className="text-[13px] font-bold">$42.00</p>
        </div>
        <p className="text-[11px] text-muted">Paid by you · Maya $14, Jordan $14, you $14</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <span className="rounded-lg border border-ink py-1.5 text-center text-[12px] font-semibold">Edit</span>
          <span className={`rounded-lg py-1.5 text-center text-[12px] font-semibold text-white transition-colors duration-300 ${saved ? "bg-ink" : "bg-peach-400"}`}>{saved ? "Added" : "Confirm"}</span>
        </div>
      </div>
    </div>
  );
}

// 08 · Sunday recap: the week in three numbers.
export function RecapScene({ p }: { p: number }) {
  const t = ease(seg(p, 0.1, 0.6));
  const stats: [string, string][] = [
    [String(Math.round(14 * t)), "chores done"],
    [`$${Math.round(212 * t)}`, "spent together"],
    [String(Math.round(9 * t)), "things bought"],
  ];
  return (
    <div>
      <Title kicker="Sunday, 6:00 PM">Weekly recap</Title>
      <div className="grid grid-cols-3 gap-2">
        {stats.map(([v, l]) => (
          <div key={l} className="rounded-xl border border-slate-300 px-2 py-3 text-center">
            <p className="text-xl font-bold tabular-nums">{v}</p>
            <p className="text-[10px] text-muted">{l}</p>
          </div>
        ))}
      </div>
      <p className="mb-2 mt-5 text-xs font-semibold">Who did what</p>
      <div className="space-y-2">
        {([["maya", 5], ["jordan", 5], ["sam", 4]] as [Who, number][]).map(([who, n], i) => (
          <div key={who} className="flex items-center gap-2" style={enter(seg(p, 0.35 + i * 0.08, 0.5 + i * 0.08))}>
            <Face who={who} size="h-6 w-6 text-[10px]" />
            <span className="flex-1 text-[13px]">{PEOPLE[who].name}</span>
            <span className="flex gap-0.5">{Array.from({ length: 5 }, (_, k) => <span key={k} className={`h-2 w-4 rounded-sm ${k < n ? "bg-ink" : "bg-slate-200"}`} />)}</span>
          </div>
        ))}
      </div>
      <div className="mt-5 rounded-xl bg-slate-100 px-3 py-3 text-center text-[13px] font-semibold" style={enter(seg(p, 0.7, 0.85))}>Everyone&apos;s square. See you next week.</div>
    </div>
  );
}
