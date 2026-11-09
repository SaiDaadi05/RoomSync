import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { resetPasswordAction } from "@/app/actions/auth";
import { checkResetToken } from "@/server/passwords";

export const metadata = { title: "Set a new password" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const ok = await checkResetToken(token);
  return (
    <div className="card p-6">
      <h1 className="mb-1 text-xl font-bold">Set a new password</h1>
      {ok ? (
        <>
          <p className="mb-5 text-sm text-muted">You'll be signed out everywhere else once it's saved.</p>
          <ActionForm action={resetPasswordAction} className="space-y-4">
            <input type="hidden" name="token" value={token} />
            <div>
              <label className="label" htmlFor="next">New password</label>
              <input id="next" name="next" type="password" autoComplete="new-password" minLength={8} required className="input" />
            </div>
            <div>
              <label className="label" htmlFor="confirm">Type it again</label>
              <input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={8} required className="input" />
            </div>
            <SubmitButton className="btn-primary w-full" pendingText="Saving…">Save and log in</SubmitButton>
          </ActionForm>
        </>
      ) : (
        <p className="text-sm text-muted">
          This link has expired or was already used. <Link href="/forgot-password" className="font-semibold text-brand-700">Ask for a new one</Link>.
        </p>
      )}
    </div>
  );
}
