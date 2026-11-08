import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { loginAction } from "@/app/actions/auth";
import { getCurrentUser } from "@/server/session";
import { demoEnabled } from "@/server/demo";
import { startDemoAction } from "@/app/actions/demo";

export const metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getCurrentUser()) redirect("/home");
  const { next } = await searchParams;
  return (
    <div className="card p-6">
      <h1 className="mb-1 text-xl font-bold">Welcome back</h1>
      <p className="mb-5 text-sm text-muted">Log in to see what's happening at home.</p>
      <ActionForm action={loginAction} className="space-y-4">
        <input type="hidden" name="next" value={next ?? ""} />
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required className="input" />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
        </div>
        <SubmitButton className="btn-primary w-full" pendingText="Logging in…">Log in</SubmitButton>
      </ActionForm>
      <p className="mt-5 text-center text-sm text-muted">
        New here? <Link href={`/signup${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-semibold text-brand-700">Create an account</Link>
      </p>
      {demoEnabled() && (
        <form action={startDemoAction} className="mt-4 border-t border-slate-100 pt-4 text-center">
          <button className="btn-ghost text-sm">Just looking? Try the demo household</button>
        </form>
      )}
    </div>
  );
}
