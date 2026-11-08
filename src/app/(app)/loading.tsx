export default function Loading() {
  return (
    <div className="animate-pulse space-y-3" aria-busy="true" aria-label="Loading">
      <div className="h-7 w-40 rounded-lg bg-slate-200" />
      <div className="h-16 rounded-2xl bg-slate-200/70" />
      <div className="h-16 rounded-2xl bg-slate-200/70" />
      <div className="h-16 rounded-2xl bg-slate-200/70" />
    </div>
  );
}
