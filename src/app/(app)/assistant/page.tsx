import { requireHousehold } from "@/server/session";
import { assistantConfigured, ASSISTANT_MODEL } from "@/server/assistant/run";
import { listPendingActions } from "@/server/assistant/actions";
import { PageHeader } from "@/components/ui";
import { AssistantChat } from "@/components/assistant-chat";

export const metadata = { title: "Assistant" };

export default async function AssistantPage() {
  const { user, household } = await requireHousehold();
  if (!assistantConfigured()) {
    return (
      <>
        <PageHeader title="Assistant" subtitle="Plain-language help with expenses, shopping, and chores" />
        <div className="card p-4 text-sm">
          <p className="font-semibold">Not set up on this server yet</p>
          <p className="mt-1 text-muted">The assistant needs an Anthropic API key (<code>ANTHROPIC_API_KEY</code>). Everything else in RoomSync works without it.</p>
        </div>
      </>
    );
  }
  const drafts = await listPendingActions(user.id, household.id);
  return (
    <>
      <PageHeader title="Assistant" subtitle="Drafts changes for you to confirm. Nothing saves on its own." />
      <AssistantChat firstName={user.name.split(" ")[0]} initialDrafts={drafts.map((d) => ({ id: d.id, summary: d.summary }))} />
      <p className="-mt-24 mb-28 text-center text-xs text-muted">Your message and the household details it needs are sent to Anthropic ({ASSISTANT_MODEL}) to answer.</p>
    </>
  );
}
