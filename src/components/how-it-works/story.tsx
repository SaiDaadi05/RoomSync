"use client";

import { useEffect, useRef, useState } from "react";
import { AssistantScene, BillsScene, ChoreScene, PlanScene, RecapScene, ShoppingScene, SplitScene, SwapScene } from "./scenes";

const CHAPTERS = [
  { when: "Sunday night", title: "The week plans itself.", body: "RoomSync looks at everyone's free time and how long each chore really takes, then spreads the work so nobody carries the house. A 40-minute bathroom clean counts for more than taking out the trash.", Scene: PlanScene },
  { when: "Monday", title: "Trash day, without the group chat.", body: "Whoever's up gets a reminder. They tick it off, the history is saved, and next time is already lined up for the next person in the rotation.", Scene: ChoreScene },
  { when: "Tuesday", title: "Out of oat milk.", body: "One list for the whole place. Say you're getting something so it isn't bought twice, then log the receipt when you're back.", Scene: ShoppingScene },
  { when: "Wednesday", title: "One receipt, three shares.", body: "Split evenly, by shares, by percent, or item by item. Everyone's balance updates the moment it's added, down to the cent.", Scene: SplitScene },
  { when: "Thursday", title: "Plans change.", body: "Ask to swap a chore with someone. They get the request, and nothing moves until they agree.", Scene: SwapScene },
  { when: "The 1st", title: "Rent shows up on its own.", body: "Set up rent, internet and utilities once. They're added every month and split with whoever lives there, so a new roommate is included from their first month.", Scene: BillsScene },
  { when: "Any time", title: "Or just say it.", body: "Type it the way you'd text it. The assistant fills in the details and shows you a draft, and nothing is saved until you confirm.", Scene: AssistantScene },
  { when: "Sunday, 6 PM", title: "The week, in one page.", body: "Who did what, what the house spent, and what's coming up. No scorekeeping, no awkward conversations.", Scene: RecapScene },
] as const;

/** Where in the viewport a chapter counts as "being read". */
const READ_LINE = 0.55;

export function Story() {
  const refs = useRef<(HTMLElement | null)[]>([]);
  const target = useRef<number[]>(CHAPTERS.map(() => 0));
  const shown = useRef<number[]>(CHAPTERS.map(() => 0));
  const [progress, setProgress] = useState<number[]>(CHAPTERS.map(() => 0));
  const [active, setActive] = useState(0);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let running = false;

    const measure = () => {
      const line = window.innerHeight * READ_LINE;
      let act = 0;
      refs.current.forEach((el, i) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        target.current[i] = Math.min(1, Math.max(0, (line - r.top) / r.height));
        if (r.top < line) act = i;
      });
      setActive(act);
    };

    // Ease the displayed progress toward the scroll position, so wheel steps and
    // jumpy touch scrolling still animate smoothly.
    const tick = () => {
      let moving = false;
      shown.current = shown.current.map((v, i) => {
        const t = target.current[i]!;
        const next = reduce ? t : v + (t - v) * 0.16;
        if (Math.abs(t - next) > 0.0005) moving = true;
        return Math.abs(t - next) > 0.0005 ? next : t;
      });
      setProgress([...shown.current]);
      if (moving) raf = requestAnimationFrame(tick);
      else running = false;
    };
    const onScroll = () => {
      measure();
      if (!running) { running = true; raf = requestAnimationFrame(tick); }
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  const overall = (active + (progress[active] ?? 0)) / CHAPTERS.length;

  return (
    <section className="relative mx-auto max-w-6xl px-5 md:px-8" aria-label="One week with RoomSync">
      <div className="md:grid md:grid-cols-[minmax(0,1fr)_380px] md:gap-16 lg:gap-24">
        {/* The phone. Sticky at the top on phones, beside the text on wider screens. */}
        <div className="sticky top-0 z-10 -mx-5 border-b border-slate-200 bg-canvas px-5 pb-3 pt-3 md:order-2 md:top-[max(1.5rem,calc(50vh-320px))] md:mx-0 md:h-fit md:border-0 md:p-0" aria-hidden>
          <div className="mb-2 flex items-center gap-3 md:hidden">
            <span className="text-xs font-semibold tabular-nums text-muted">{String(active + 1).padStart(2, "0")} / {String(CHAPTERS.length).padStart(2, "0")}</span>
            <span className="h-px flex-1 bg-slate-200"><span className="block h-px bg-ink" style={{ width: `${overall * 100}%` }} /></span>
            <span className="text-xs font-semibold">{CHAPTERS[active]!.when}</span>
          </div>
          <Phone>
            {CHAPTERS.map(({ Scene }, i) => (
              <div key={i} className="absolute inset-0 p-5 transition-[opacity,transform] duration-500 ease-out motion-reduce:transition-none"
                style={{ opacity: i === active ? 1 : 0, transform: `translateY(${i === active ? 0 : i < active ? -16 : 16}px)` }}>
                <div className="max-md:w-[137%] max-md:origin-top-left max-md:scale-[0.73]"><Scene p={Math.min(1, (progress[i] ?? 0) / 0.75)} /></div>
              </div>
            ))}
          </Phone>
        </div>

        {/* The story. Each chapter is tall so there's room to scroll through its animation. */}
        <ol className="relative md:order-1">
          <span className="absolute left-0 top-0 hidden h-full w-px bg-slate-200 md:block" aria-hidden>
            <span className="block w-px bg-ink" style={{ height: `${overall * 100}%` }} />
          </span>
          {CHAPTERS.map((c, i) => (
            <li key={c.title} ref={(el) => { refs.current[i] = el; }} className="flex min-h-[100svh] items-end pb-[8svh] md:min-h-[95vh] md:items-center md:pb-10 md:pl-10 md:pt-10">
              <div className={`max-w-md transition-opacity duration-500 motion-reduce:transition-none ${i === active ? "opacity-100" : "opacity-30"}`}>
                <p className="hidden items-center gap-3 text-sm font-semibold text-muted md:flex">
                  <span className="tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                  <span className="h-px w-6 bg-slate-300" />
                  <span>{c.when}</span>
                </p>
                <h2 className="text-[1.75rem] md:mt-3 font-bold leading-[1.1] tracking-tight md:text-[2.75rem]">{c.title}</h2>
                <p className="mt-3 text-base leading-relaxed text-slate-700 md:mt-4 md:text-[17px]">{c.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Phone({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[340px] md:max-w-none">
      <div className="rounded-[1.75rem] border border-slate-300 bg-paper p-1.5 shadow-[0_10px_30px_rgba(0,0,0,0.08)] md:rounded-[2.25rem] md:p-2 md:shadow-[0_16px_50px_rgba(0,0,0,0.10)]">
        <div className="relative overflow-hidden rounded-[1.4rem] border border-slate-200 bg-paper md:rounded-[1.8rem]">
          <div className="hidden items-center justify-between border-b border-slate-200 px-5 py-3 md:flex">
            <span className="text-[13px] font-bold text-peach-400">RoomSync</span>
            <span className="text-[11px] text-muted">4B Maple St</span>
          </div>
          <div className="relative h-[290px] md:h-[500px]">{children}</div>
        </div>
      </div>
    </div>
  );
}
