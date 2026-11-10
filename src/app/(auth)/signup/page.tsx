import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { BrowserTimezoneInput } from "@/components/timezone-input";
import { signUpAction } from "@/app/actions/auth";
import { getCurrentUser } from "@/server/session";

export const metadata = { title: "Sign up" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string; code?: string }> }) {
  if (await getCurrentUser()) redirect("/home");
  const { next, code } = await searchParams;
  return (
    <div className="card p-6">
      <h1 className="mb-1 text-xl font-bold">Create your account</h1>
      <p className="mb-5 text-sm text-muted">Takes 20 seconds. Then set up or join your household.</p>
      <ActionForm action={signUpAction} className="space-y-4">
        <input type="hidden" name="next" value={next ?? ""} />
        <BrowserTimezoneInput />
        <div>
          <label className="label" htmlFor="name">Your name</label>
          <input id="name" name="name" autoComplete="given-name" required maxLength={60} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required className="input" />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required className="input" />
          <p className="mt-1 text-xs text-muted">At least 8 characters.</p>
        </div>
        <div>
          <label className="label" htmlFor="houseCode">Household invite code (optional)</label>
          <input id="houseCode" name="houseCode" defaultValue={code ?? ""} maxLength={10} autoCapitalize="characters" autoCorrect="off" spellCheck={false} className="input font-mono uppercase tracking-wider" placeholder="e.g. K7Q2M9XPRA" />
          <p className="mt-1 text-xs text-muted">Have a code from your roommate? Enter it here, or join later.</p>
        </div>
        <SubmitButton className="btn-primary w-full" pendingText="Creating account…">Create account</SubmitButton>
      </ActionForm>
      <p className="mt-5 text-center text-sm text-muted">
        Already have an account? <Link href={`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-semibold text-brand-700">Log in</Link>
      </p>
    </div>
  );
}
