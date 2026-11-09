/** Shown while a page's data loads (e.g. a cold database on first visit). Plain grey blocks, no spinner. */
export function PageSkeleton() {
  return (
    <div role="status" aria-live="polite" className="animate-pulse motion-reduce:animate-none">
      <span className="sr-only">Loading…</span>
      <div className="mb-6 space-y-2">
        <div className="h-4 w-40 rounded bg-slate-100" />
        <div className="h-8 w-64 max-w-full rounded bg-slate-100" />
      </div>
      <div className="mb-8 grid grid-cols-3 gap-2.5 md:max-w-2xl">
        {[0, 1, 2].map((i) => <div key={i} className="h-20 rounded-2xl border border-slate-200" />)}
      </div>
      <div className="space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 rounded-2xl border border-slate-200 p-4">
            <div className="h-9 w-9 rounded-full bg-slate-100" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-1/2 rounded bg-slate-100" />
              <div className="h-3 w-1/3 rounded bg-slate-100" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
