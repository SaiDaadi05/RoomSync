"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { TOUR_STEPS, type TourTarget } from "./steps";

const STEP_KEY = "roomsync.tour.step"; // set while a tour is running, so it survives page changes
const DONE_KEY = "roomsync.tour.done"; // set once someone finishes or skips it

function store(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* private mode or blocked storage: the tour still works for this page view */ }
}
function read(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}

type TourApi = { start: () => void; running: boolean };
const TourContext = createContext<TourApi>({ start: () => {}, running: false });
export const useTour = () => useContext(TourContext);

function visible(el: Element) {
  return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
}

function findTarget(t: TourTarget | undefined): HTMLElement | null {
  if (!t) return null;
  if ("selector" in t) {
    return (Array.from(document.querySelectorAll<HTMLElement>(t.selector)).find(visible) ?? null);
  }
  const h = Array.from(document.querySelectorAll<HTMLElement>("main section h2")).find((el) => el.textContent?.trim().startsWith(t.heading));
  return h?.closest("section") ?? null;
}

type Box = { top: number; left: number; width: number; height: number };

/**
 * Wraps the signed-in app. Starts the walkthrough when asked (a button, or
 * ?tour=1 in the URL), and on a demo household's first visit.
 */
export function TourProvider({ autoStart = false, children }: { autoStart?: boolean; children: React.ReactNode }) {
  const [step, setStep] = useState<number | null>(null);
  const router = useRouter();
  const path = usePathname();

  const go = useCallback((i: number | null) => {
    setStep(i);
    store(STEP_KEY, i === null ? null : String(i));
  }, []);

  const start = useCallback(() => go(0), [go]);
  const finish = useCallback(() => { go(null); store(DONE_KEY, "1"); }, [go]);

  // Resume after a page change, or start from ?tour=1 / the demo's first visit.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("tour")) {
      params.delete("tour");
      const qs = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash);
      go(0);
      return;
    }
    const saved = Number(read(STEP_KEY));
    if (read(STEP_KEY) !== null && Number.isInteger(saved) && saved >= 0 && saved < TOUR_STEPS.length) setStep(saved);
    else if (autoStart && !read(DONE_KEY)) go(0);
  }, [autoStart, go]);

  const current = step === null ? null : TOUR_STEPS[step];

  // Each step lives on a page; take the person there.
  useEffect(() => {
    if (current && path !== current.route) router.push(current.route);
  }, [current, path, router]);

  return (
    <TourContext.Provider value={{ start, running: step !== null }}>
      {children}
      {current && step !== null && path === current.route && (
        <TourOverlay
          key={step}
          index={step}
          onBack={() => go(Math.max(0, step - 1))}
          onNext={() => (step + 1 >= TOUR_STEPS.length ? finish() : go(step + 1))}
          onClose={finish}
        />
      )}
    </TourContext.Provider>
  );
}

function TourOverlay({ index, onBack, onNext, onClose }: { index: number; onBack: () => void; onNext: () => void; onClose: () => void }) {
  const s = TOUR_STEPS[index]!;
  const last = index === TOUR_STEPS.length - 1;
  const [box, setBox] = useState<Box | null>(null);
  const [searching, setSearching] = useState(!!s.target);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const targetRef = useRef<HTMLElement | null>(null);

  // Find the target (the page may still be rendering), scroll it into view, then track it.
  useLayoutEffect(() => {
    let tries = 0;
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const measure = () => {
      const el = targetRef.current;
      if (!el || !el.isConnected) return setBox(null);
      const r = el.getBoundingClientRect();
      const pad = 6;
      setBox({ top: r.top - pad, left: r.left - pad, width: r.width + pad * 2, height: r.height + pad * 2 });
    };
    const onMove = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); };
    const look = () => {
      const el = findTarget(s.target);
      if (el) {
        targetRef.current = el;
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        // Put the target near the top of the screen; the card sits below it.
        const top = el.getBoundingClientRect().top + window.scrollY - 84;
        if (getComputedStyle(el).position !== "fixed") window.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" });
        measure();
        setSearching(false);
      } else if (s.target && tries++ < 15) {
        timer = setTimeout(look, 100);
      } else {
        setSearching(false);
      }
    };
    look();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [s.target]);

  useEffect(() => { headingRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") onNext();
      else if (e.key === "ArrowLeft" && index > 0) onBack();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [index, onBack, onNext, onClose]);

  // The card normally sits at the bottom. If the target is pinned low on screen (the
  // bottom bar's Add button) or the page couldn't scroll it up, move the card to the top.
  const cardOnTop = !!box && box.top > window.innerHeight * 0.55;

  return (
    <div className="fixed inset-0 z-50" aria-hidden={false}>
      {/* Blocks clicks on the page while the tour is open, so it can't get out of step. */}
      <div className={`absolute inset-0 ${box ? "" : "bg-black/40"}`} onClick={(e) => e.stopPropagation()} />
      {box && (
        <div
          className="pointer-events-none absolute rounded-2xl ring-2 ring-white transition-all duration-200 motion-reduce:transition-none"
          style={{ ...box, boxShadow: "0 0 0 9999px rgba(0,0,0,0.4)" }}
        />
      )}
      {!searching && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="tour-title"
          aria-describedby="tour-body"
          className={`absolute inset-x-4 mx-auto max-w-md rounded-2xl border border-slate-300 bg-white p-5 shadow-[0_6px_24px_rgba(0,0,0,0.18)] md:inset-x-auto md:right-6 md:mx-0 md:w-[400px] ${
            cardOnTop ? "top-4" : "bottom-24 md:bottom-6"
          }`}
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-xs font-medium text-muted">Tour · {index + 1} of {TOUR_STEPS.length}</p>
            <button type="button" onClick={onClose} className="text-sm font-semibold text-muted underline-offset-4 hover:text-ink hover:underline">
              Skip tour
            </button>
          </div>
          <div className="mb-3 h-1 overflow-hidden rounded-full bg-slate-200" aria-hidden>
            <div className="h-full bg-ink transition-all motion-reduce:transition-none" style={{ width: `${((index + 1) / TOUR_STEPS.length) * 100}%` }} />
          </div>
          <h2 id="tour-title" ref={headingRef} tabIndex={-1} className="text-lg font-bold text-ink focus:outline-none">{s.title}</h2>
          <p id="tour-body" className="mt-1 text-[15px] leading-relaxed text-slate-700">{s.body}</p>
          <div className="mt-4 flex gap-2">
            {index > 0 && <button type="button" onClick={onBack} className="btn-secondary flex-1">Back</button>}
            <button type="button" onClick={onNext} className="btn-peach flex-1">{last ? "Done" : "Next"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** A plain button that (re)starts the walkthrough. */
export function StartTourButton({ className = "btn-secondary", children = "Take the tour" }: { className?: string; children?: React.ReactNode }) {
  const { start, running } = useTour();
  const router = useRouter();
  const path = usePathname();
  return (
    <button type="button" className={className} disabled={running}
      onClick={() => { if (path !== "/home") router.push("/home"); start(); }}>
      {children}
    </button>
  );
}

/** A small card on Home offering the tour, until someone has taken or skipped it. */
export function TourPrompt() {
  const { running } = useTour();
  const [show, setShow] = useState(false);
  useEffect(() => { setShow(!read(DONE_KEY)); }, []);
  if (!show || running) return null;
  return (
    <div className="card mb-8 flex flex-wrap items-center gap-3 p-4">
      <p className="min-w-0 flex-1 text-sm"><b>New to RoomSync?</b> A quick tour shows where chores, shopping and money live.</p>
      <div className="flex gap-2">
        <button type="button" className="btn-ghost" onClick={() => { store(DONE_KEY, "1"); setShow(false); }}>Not now</button>
        <StartTourButton className="btn-secondary" />
      </div>
    </div>
  );
}
