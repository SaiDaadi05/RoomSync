import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center px-4 text-center">
      <p className="text-4xl" aria-hidden>🧭</p>
      <h1 className="mt-2 text-xl font-bold">We couldn't find that</h1>
      <p className="mt-1 text-sm text-muted">It may have been deleted, or it belongs to a household you're not in.</p>
      <Link href="/home" className="btn-primary mt-5">Go home</Link>
    </main>
  );
}
