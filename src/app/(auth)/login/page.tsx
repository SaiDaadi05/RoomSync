import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { loginAction } from "@/app/actions/auth";
import { getCurrentUser } from "@/server/session";
import { demoEnabled } from "@/server/demo";
import { startDemoAction } from "@/app/actions/demo";

export const metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; deleted?: string }> }) {
  if (await getCurrentUser()) redirect("/home");
  const { next, deleted } = await searchParams;
  return (
    <div className="card p-6">
      {deleted && <p role="status" className="mb-4 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Your account has been deleted.</p>}
      <h1 className="mb-1 text-xl font-bold">Welcome back</h1>
      <p className="mb-5 text-sm text-muted">Log in to see what's happening at home.</p>
      <ActionForm action={loginAction} className="space-y-4">
        <input type="hidden" name="next" value={next ?? ""} />
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required className="input" />
        </div>
        <div>
          <div className="flex items-baseline justify-between">
            <label className="label" htmlFor="password">Password</label>
            <Link href="/forgot-password" className="text-xs font-semibold text-brand-700">Forgot it?</Link>
          </div>
          <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
        </div>
        <SubmitButton className="btn-primary w-full" pendingText="Logging in…">Log in</SubmitButton>
      </ActionForm>
      <p className="mt-5 text-center text-sm text-muted">
        New here? <Link href={`/signup${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-semibold text-brand-700">Create an account</Link>
      </p>
      {demoEnabled() && (
        <form action={startDemoAction} className="mt-4 border-t border-slate-100 pt-4 text-center">
          <p className="text-sm text-muted">Just looking? <Link href="/how-it-works" className="font-semibold text-ink underline underline-offset-2">See how it works</Link> or</p>
          <SubmitButton className="btn-ghost text-sm" pendingText="Setting up the demo house…">open the demo house</SubmitButton>
        </form>
      )}
    </div>
  );
}
