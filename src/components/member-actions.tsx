"use client";

import { ActionForm, SubmitButton } from "./forms";
import { removeMemberAction, setMemberRoleAction } from "@/app/actions/households";

/** Owner-only controls for one roommate. The server re-checks ownership on every action. */
export function MemberActions({ member, openTasks, isSelf }: {
  member: { id: string; name: string; role: "OWNER" | "MEMBER" };
  openTasks: number;
  isSelf: boolean;
}) {
  const first = member.name.split(" ")[0];
  return (
    <details className="group">
      <summary className="cursor-pointer list-none text-xs font-semibold text-brand-700">Manage</summary>
      <div className="mt-2 space-y-3 rounded-xl bg-slate-50 p-3">
        <ActionForm action={setMemberRoleAction}>
          <input type="hidden" name="memberId" value={member.id} />
          <input type="hidden" name="role" value={member.role === "OWNER" ? "MEMBER" : "OWNER"} />
          <SubmitButton className="btn-secondary min-h-9 w-full text-xs">
            {member.role === "OWNER" ? (isSelf ? "Step down to regular member" : `Make ${first} a regular member`) : `Make ${first} an owner`}
          </SubmitButton>
          <p className="mt-1 text-xs text-muted">Owners can change household settings and manage roommates.</p>
        </ActionForm>
        {!isSelf && (
          <details>
            <summary className="cursor-pointer list-none text-xs font-semibold text-red-700">Remove {first} from household…</summary>
            <ActionForm action={removeMemberAction} className="mt-2 space-y-2">
              <input type="hidden" name="memberId" value={member.id} />
              <p className="text-xs text-slate-700">
                {openTasks > 0
                  ? `${first}'s ${openTasks} open ${openTasks === 1 ? "task" : "tasks"} will become unassigned. `
                  : ""}
                Their completed chores, expenses, and balances stay in the history. {first} will be notified.
              </p>
              <SubmitButton className="btn-danger min-h-9 w-full text-xs" pendingText="Removing…">Yes, remove {first}</SubmitButton>
            </ActionForm>
          </details>
        )}
      </div>
    </details>
  );
}
