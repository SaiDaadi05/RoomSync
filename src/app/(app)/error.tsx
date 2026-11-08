"use client";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const forbidden = /not a member|access/i.test(error.message);
  return (
    <div className="card mx-auto max-w-md p-6 text-center">
      <p className="text-3xl" aria-hidden>😕</p>
      <h1 className="mt-2 text-lg font-bold">{forbidden ? "You don't have access to that" : "Something went wrong"}</h1>
      <p className="mt-1 text-sm text-muted">{forbidden ? "It belongs to a household you're not a member of." : "Please try again. If it keeps happening, reload the page."}</p>
      <button onClick={reset} className="btn-primary mt-4">Try again</button>
    </div>
  );
}
