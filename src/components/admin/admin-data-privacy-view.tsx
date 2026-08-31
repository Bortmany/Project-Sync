// Admin → Data & privacy: where an administrator takes a full copy of the company's data out.
//
// The page is a single column of full-width cards with a generous gap between them, deliberately
// not the two-column grid Integrations uses: these are not two equally-weighted options. The
// deletion round adds its danger card in the gap marked below.

"use client";

import { useQueryClient } from "@tanstack/react-query";
import { startWorkspaceExport } from "@/components/actions";
import { formatDateTime } from "@/components/format";
import { useAction } from "@/components/hooks/use-action";
import { useWorkspaceExportStatus, WORKSPACE_EXPORT_KEY } from "@/components/hooks/use-export";
import { AdminDeleteWorkspaceCard } from "@/components/admin/admin-delete-workspace-card";
import { Badge, Button, Card, ErrorBanner } from "@/components/ui";
import type { WorkspaceDeletionDTO, WorkspaceExportStatusDTO } from "@/lib/zod-schemas";

/** "214 MB", "1.4 GB" — a size somebody can judge a download by. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

function countWords(status: WorkspaceExportStatusDTO): string {
  const parts: string[] = [];
  if (status.sizeBytes !== null) parts.push(formatSize(status.sizeBytes));
  if (status.fileCount !== null) {
    parts.push(`${status.fileCount.toLocaleString("en-GB")} uploaded ${status.fileCount === 1 ? "file" : "files"}`);
  }
  if (status.documentCount !== null) {
    parts.push(`${status.documentCount.toLocaleString("en-GB")} ${status.documentCount === 1 ? "document" : "documents"}`);
  }
  return parts.join(", ");
}

/** The calm, nothing-has-gone-wrong note — the tone the Microsoft card's good message uses. */
function CalmNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-[var(--radius)] border border-[var(--brand-accent)] bg-[var(--brand-accent)]/10 px-3 py-2 text-sm text-[var(--brand-text)]">
      {children}
    </p>
  );
}

function ExportCard({ initial }: { initial: WorkspaceExportStatusDTO }) {
  const client = useQueryClient();
  const { data, refetch } = useWorkspaceExportStatus(initial);
  const { run, pending, error } = useAction();
  const status = data ?? initial;

  function start() {
    run(() => startWorkspaceExport(), {
      success: "Preparing your export. It will appear here when it is ready.",
      failure: "Couldn't start that export. Try again.",
      onSuccess: (next) => {
        client.setQueryData(WORKSPACE_EXPORT_KEY, next);
        void refetch();
      },
    });
  }

  const working = status.state === "WORKING";

  return (
    <Card
      title="Download everything"
      action={
        status.state === "READY" ? (
          <Badge color="var(--status-completed)">Ready</Badge>
        ) : working ? (
          <Badge color="var(--brand-accent)" textColor="var(--brand-ink)">
            Preparing…
          </Badge>
        ) : null
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-[var(--brand-text)]">
          A ZIP file with all of your workspace&rsquo;s data as JSON — every person, project, task,
          comment, notification and the full activity log — plus every uploaded document, including
          every past revision. It&rsquo;s built for keeping your own copy, not for opening and
          reading casually: expect a large file.
        </p>
        <p className="text-xs text-[var(--brand-gray)]">
          Passwords, sign-in sessions, one-time email links and the address of any connected chat
          channel are left out on purpose. A note inside the file explains what is in it.
        </p>

        {error ? <ErrorBanner message={error} /> : null}
        {status.state === "FAILED" && status.error ? (
          <ErrorBanner message={status.error} onRetry={status.canStart ? start : undefined} />
        ) : null}

        {status.state === "READY" && status.downloadUrl ? (
          <div className="space-y-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--page-bg)] p-3">
            <p className="text-sm text-[var(--brand-ink)]">
              Your export is ready{countWords(status) ? ` — ${countWords(status)}` : ""}.
            </p>
            <a
              href={status.downloadUrl}
              className="inline-flex items-center justify-center gap-2 rounded-[var(--radius)] bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--brand-mid)]"
            >
              Download ZIP
            </a>
            <p className="text-xs text-[var(--brand-gray)]">
              This link stops working{" "}
              {status.linkExpiresAt ? `on ${formatDateTime(status.linkExpiresAt)}` : "in 24 hours"}.
              Asking for a new export replaces the file it points at, and the copy is deleted from
              our server two days after it was made.
            </p>
            {status.requestedAt ? (
              <p className="text-xs text-[var(--brand-gray)]">
                Requested {formatDateTime(status.requestedAt)}
                {status.requestedByName ? ` by ${status.requestedByName}` : ""}.
              </p>
            ) : null}
          </div>
        ) : null}

        {working ? (
          <div className="space-y-2">
            <Button loading disabled>
              Preparing your export…
            </Button>
            <p className="text-xs text-[var(--brand-gray)]">
              This can take a few minutes for a large workspace. You can leave this page — come back
              any time and it will still be here.
            </p>
          </div>
        ) : status.canStart ? (
          <Button loading={pending} onClick={start}>
            Download everything
          </Button>
        ) : (
          <CalmNote>
            You have already asked for a full export today — one at a time keeps things fast for
            everyone.
            {status.nextAllowedAt
              ? ` The next one is available from ${formatDateTime(status.nextAllowedAt)}.`
              : ""}
          </CalmNote>
        )}
      </div>
    </Card>
  );
}

export function AdminDataPrivacyView({
  status,
  deletion,
}: {
  status: WorkspaceExportStatusDTO;
  deletion: WorkspaceDeletionDTO;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-[var(--brand-primary)]">Data &amp; privacy</h1>
        <p className="mt-1 text-sm text-[var(--brand-text)]">
          Everything below applies to your whole company&rsquo;s workspace, not just your own
          account. For your personal data, see Your account in the menu at the top right.
        </p>
      </div>

      <div className="max-w-2xl space-y-8">
        <ExportCard initial={status} />
        {/* The danger zone, red-tinted and set apart by the space-y-8 gap above it. */}
        <AdminDeleteWorkspaceCard status={deletion} />
      </div>
    </div>
  );
}
