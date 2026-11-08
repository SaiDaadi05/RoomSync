import Link from "next/link";
import { requireHousehold } from "@/server/session";
import { unreadCount } from "@/server/notifications";
import { BottomNav, TopNav } from "@/components/nav";
import { Avatar, DemoBanner } from "@/components/ui";
import { HouseholdSwitcher } from "@/components/household-switcher";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, household, households } = await requireHousehold();
  const unread = await unreadCount(user.id);
  return (
    <div className="min-h-dvh pb-24 md:pb-10">
      {household.isDemo && <DemoBanner />}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-2.5">
          <Link href="/home" className="flex items-center gap-2" aria-label="RoomSync home">
            <img src="/icon.svg" alt="" className="h-8 w-8" />
          </Link>
          {households.length > 1 ? (
            <HouseholdSwitcher current={household.id} households={households.map((h) => ({ id: h.id, name: h.name }))} />
          ) : (
            <Link href="/household" className="min-w-0 truncate font-semibold">{household.name}</Link>
          )}
          <div className="ml-auto flex items-center gap-1">
            <TopNav />
            <Link href="/notifications" className="relative rounded-full p-2 text-slate-600 hover:bg-slate-100" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden><path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0" strokeLinecap="round" strokeLinejoin="round" /></svg>
              {unread > 0 && <span className="absolute right-1 top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">{unread > 9 ? "9+" : unread}</span>}
            </Link>
            <Link href="/household" aria-label="Household and settings" className="rounded-full p-0.5 hover:ring-2 hover:ring-brand-200">
              <Avatar id={user.id} name={user.name} />
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-5">{children}</main>
      <BottomNav />
    </div>
  );
}
