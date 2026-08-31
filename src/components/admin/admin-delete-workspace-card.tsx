// Admin → Data & privacy → the danger zone: deleting the whole workspace.
//
// Two states and nothing in between. Idle draws the typed-name confirmation inline — this is rare
// and deliberate enough not to hide behind a first "Delete" press — and Scheduled replaces the
// whole card with the countdown and a single, calm "Cancel deletion" button. Cancelling is the safe
// act here, so it is a secondary button and asks for no confirmation of its own: friction belongs
// on the dangerous side only.

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { cancelWorkspaceDeletion, requestWorkspaceDeletion } from "@/components/actions";
import { formatDate } from "@/components/format";
import { useAction } from "@/components/hooks/use-action";
import { Badge, Button, Card, ErrorBanner, Field, Input, Modal } from "@/components/ui";
import type { WorkspaceDeletionDTO } from "@/lib/zod-schemas";

export function AdminDeleteWorkspaceCard({ status }: { status: WorkspaceDeletionDTO }) {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [confirming, setConfirming] = useState(false);
  const { run, pending, error, fieldErrors } = useAction();

  const matches = typed.trim() === status.workspaceName.trim();

  function request() {
    run(() => requestWorkspaceDeletion({ confirmName: typed }), {
      success: "This workspace is scheduled for deletion. Any administrator can cancel it.",
      failure: "Couldn't schedule this deletion. Try again.",
      onSuccess: () => {
        setConfirming(false);
        setTyped("");
        router.refresh();
      },
    });
  }

  function cancel() {
    run(() => cancelWorkspaceDeletion(), {
      success: "Deletion cancelled. Your workspace is safe.",
      failure: "Couldn't cancel this deletion. Try again.",
      onSuccess: () => router.refresh(),
    });
  }

  return (
    <>
      <Card
        title={status.pending ? "Workspace deletion" : "Delete this workspace"}
        className="border-[var(--status-blocked)]/30 bg-[var(--status-blocked)]/5"
        action={<Badge color="var(--status-blocked)">Danger zone</Badge>}
      >
        <div className="space-y-4">
          {error ? <ErrorBanner message={error} /> : null}

          {status.pending ? (
            <>
              <p className="text-sm text-[var(--brand-text)]">
                This workspace is scheduled for deletion on {formatDate(status.deletesOn)}. Any
                administrator can cancel before then — after that, it&rsquo;s permanent.
              </p>
              <p className="text-sm font-semibold text-[var(--status-blocked)]">
                {status.daysLeft === 0
                  ? "Less than a day left."
                  : `${status.daysLeft} ${status.daysLeft === 1 ? "day" : "days"} left.`}
              </p>
              <p className="text-xs text-[var(--brand-gray)]">
                Requested by {status.requestedByName ?? "an administrator"} on{" "}
                {formatDate(status.requestedAt)}. Take a copy of anything you want to keep before
                the time runs out — use Download everything above.
              </p>
              <Button variant="secondary" loading={pending} onClick={cancel}>
                Cancel deletion
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-[var(--brand-text)]">
                Deleting your workspace removes everything permanently: every person&rsquo;s
                account, every project, task, comment, document and its full revision history, and
                the whole activity log. There&rsquo;s a 7-day grace period first — any administrator
                can cancel during that window. After the 7 days, it&rsquo;s gone for good and cannot
                be recovered.
              </p>
              <Field
                label="Type your workspace's name to confirm"
                hint={`Type ${status.workspaceName} exactly.`}
                error={fieldErrors.confirmName?.[0]}
              >
                <Input
                  value={typed}
                  autoComplete="off"
                  onChange={(event) => setTyped(event.target.value)}
                />
              </Field>
              <Button variant="danger" disabled={!matches} onClick={() => setConfirming(true)}>
                Delete workspace
              </Button>
            </>
          )}
        </div>
      </Card>

      {confirming ? (
        <Modal
          open
          size="sm"
          title={`Delete ${status.workspaceName}?`}
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button variant="danger" loading={pending} onClick={request}>
                Delete workspace
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            {error ? <ErrorBanner message={error} /> : null}
            <p>
              Everything this workspace holds — every person&rsquo;s account, every project, task,
              comment, document and its full revision history, and the whole activity log — is
              removed after 7 days. Any administrator can cancel during that window.
            </p>
            <p>This can&rsquo;t be undone once the 7 days pass.</p>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
