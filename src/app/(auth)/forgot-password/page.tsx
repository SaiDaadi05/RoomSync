import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { requestPasswordResetAction } from "@/app/actions/auth";
import { passwordResetAvailable } from "@/server/passwords";

export const metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  const available = passwordResetAvailable();
  return (
    <div className="card p-6">
      <h1 className="mb-1 text-xl font-bold">Forgot your password?</h1>
      {available ? (
        <>
          <p className="mb-5 text-sm text-muted">Enter your email and we'll send you a link to set a new one.</p>
          <ActionForm action={requestPasswordResetAction} className="space-y-4" resetOnSuccess>
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input id="email" name="email" type="email" autoComplete="email" required className="input" />
            </div>
            <SubmitButton className="btn-primary w-full" pendingText="Sending…">Send reset link</SubmitButton>
          </ActionForm>
        </>
      ) : (
        <p className="text-sm text-muted">
          Password reset by email isn't set up on this server yet. Ask whoever runs your RoomSync to add email settings, or to help you get back in.
        </p>
      )}
      <p className="mt-5 text-center text-sm text-muted">
        Remembered it? <Link href="/login" className="font-semibold text-brand-700">Log in</Link>
      </p>
    </div>
  );
}
