import Link from "next/link";
import { previewInvitation } from "@/server/households";
import { getCurrentUser } from "@/server/session";
import { ActionForm, SubmitButton } from "@/components/forms";
import { joinHouseholdAction } from "@/app/actions/households";

export const metadata = { title: "Join household" };

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const invite = await previewInvitation(code);
  const user = await getCurrentUser();
  const next = `/join/${encodeURIComponent(code)}`;
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <div className="card p-6 text-center">
        <img src="/icon.svg" alt="" className="mx-auto mb-3 h-12 w-12" />
        {!invite ? (
          <>
            <h1 className="text-xl font-bold">This invite isn't valid</h1>
            <p className="mt-2 text-sm text-muted">It may have expired or already been used. Ask your roommate for a new one.</p>
            <Link href="/" className="btn-secondary mt-5">Go to RoomSync</Link>
          </>
        ) : (
          <>
            <p className="text-sm text-muted">You've been invited to join</p>
            <h1 className="mt-1 text-2xl font-bold">{invite.householdName}</h1>
            {invite.email && <p className="mt-1 text-xs text-muted">Invite for {invite.email}</p>}
            {user ? (
              <ActionForm action={joinHouseholdAction} className="mt-5">
                <input type="hidden" name="code" value={invite.code} />
                <SubmitButton className="btn-primary w-full" pendingText="Joining…">Join as {user.name}</SubmitButton>
              </ActionForm>
            ) : (
              <div className="mt-5 flex flex-col gap-2">
                <Link href={`/signup?next=${encodeURIComponent(next)}`} className="btn-primary">Create an account to join</Link>
                <Link href={`/login?next=${encodeURIComponent(next)}`} className="btn-secondary">I already have an account</Link>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
