import Link from "next/link";
import { Logo } from "@/components/ui";
import { Story } from "@/components/how-it-works/story";
import { demoEnabled } from "@/server/demo";
import { startDemoAction } from "@/app/actions/demo";

export const metadata = {
  title: "How it works",
  description: "One week in a shared apartment with RoomSync: chores, the shopping list, splitting costs, rent and more.",
};

export default function HowItWorks() {
  const demo = demoEnabled();
  return (
    <main className="bg-white">
      <header className="mx-auto flex max-w-6xl items-center gap-2.5 px-5 py-4 md:px-8">
        <Link href="/" className="flex items-center gap-2.5" aria-label="RoomSync home">
          <Logo className="h-8 w-8" />
          <span className="text-lg font-bold text-peach-400">RoomSync</span>
        </Link>
        <Link href="/login" className="ml-auto rounded-full px-4 py-2 text-sm font-semibold hover:bg-slate-100">Log in</Link>
      </header>

      <section className="mx-auto max-w-6xl px-5 pb-6 pt-10 md:px-8 md:pb-16 md:pt-24">
        <p className="text-sm font-semibold text-muted">How RoomSync works</p>
        <h1 className="mt-4 max-w-4xl text-[2.6rem] font-bold leading-[1.02] tracking-tight md:text-[5.5rem]">
          One week in a<br />shared apartment.
        </h1>
        <div className="mt-8 flex max-w-4xl flex-col gap-6 border-t border-slate-300 pt-6 md:flex-row md:items-end md:justify-between">
          <p className="max-w-md text-[17px] leading-relaxed text-slate-700">
            Maya, Jordan and Sam share 4B. Scroll through their week to see what RoomSync does, screen by screen.
          </p>
          <p className="flex items-center gap-2 text-sm font-semibold text-muted" aria-hidden>
            Scroll
            <svg viewBox="0 0 24 24" className="h-4 w-4 animate-bounce motion-reduce:animate-none" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 5v14M6 13l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </p>
        </div>
      </section>

      <Story />

      <section className="mx-auto max-w-6xl px-5 pb-24 pt-10 md:px-8 md:pt-20">
        <div className="border-t border-slate-300 pt-10 md:grid md:grid-cols-[1fr_auto] md:items-end md:gap-10">
          <div>
            <p className="text-sm font-semibold text-muted">That&apos;s the whole week.</p>
            <h2 className="mt-3 max-w-2xl text-[2.25rem] font-bold leading-[1.05] tracking-tight md:text-6xl">Try it with your place.</h2>
            <p className="mt-4 max-w-md text-[17px] text-slate-700">Set up takes about two minutes: name your place, invite your roommates, pick your chores, add the rent.</p>
          </div>
          <div className="mt-8 flex flex-wrap gap-3 md:mt-0">
            <Link href="/signup" className="btn-peach px-6 text-base">Get started free</Link>
            {demo && <form action={startDemoAction}><button className="btn-secondary px-5 text-base">Walk around the demo house</button></form>}
          </div>
        </div>
      </section>
    </main>
  );
}
