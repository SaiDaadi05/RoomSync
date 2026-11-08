import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <Link href="/" className="mb-6 flex items-center gap-2 self-center text-xl font-bold text-ink">
        <img src="/icon.svg" alt="" className="h-9 w-9" /> RoomSync
      </Link>
      {children}
    </main>
  );
}
