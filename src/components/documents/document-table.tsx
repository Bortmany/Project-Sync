// The documents table. One row per document showing its current revision; older revisions live in
// the version history panel, never as extra rows. Deleting removes the whole document from view —
// its revisions and audit rows stay exactly where they are.

"use client";

import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { softDeleteDocument } from "@/components/actions";
import { useAction } from "@/components/hooks/use-action";
import { formatDate } from "@/components/format";
import { FileTypeIcon, formatFileSize } from "@/components/documents/file-icon";
import { UploadDropzone } from "@/components/documents/upload-dropzone";
import { VersionHistoryPanel } from "@/components/documents/version-history-panel";
import {
  Avatar,
  Badge,
  Button,
  CompanyBadge,
  DesktopTable,
  ErrorBanner,
  Modal,
  PhoneCard,
  PhoneCardList,
  SkeletonRows,
} from "@/components/ui";
import type { DocumentDTO } from "@/lib/zod-schemas";

/** A titled block of rows — "Shared documents", one per discipline, or one per main task. */
export type DocumentGroup = {
  key: string;
  label?: string;
  documents: DocumentDTO[];
  /** Shown in place of rows when this group alone is empty. */
  emptyNote?: string;
};

function DeleteDialog({
  document,
  open,
  onClose,
  onDeleted,
}: {
  document: DocumentDTO;
  open: boolean;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { run, pending, error } = useAction();

  return (
    <Modal
      open={open}
      size="sm"
      title="Delete this document?"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={pending}
            onClick={() =>
              run(() => softDeleteDocument({ id: document.id }), {
                success: "Document deleted.",
                failure: "Couldn't delete this document. Try again.",
                onSuccess: () => {
                  onDeleted();
                  onClose();
                },
              })
            }
          >
            Delete
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {/* The server's refusals are shown word for word — they explain what to do next. */}
        {error ? <ErrorBanner message={error} /> : null}
        <p className="text-sm">
          “{document.title}” will stop showing in the documents list. Its{" "}
          {document.versionsCount === 1 ? "revision" : `${document.versionsCount} revisions`} and the
          audit trail stay on record — nothing is erased.
        </p>
        <p className="text-sm">
          If this document ticked off a required document, that checklist item goes back to missing.
        </p>
      </div>
    </Modal>
  );
}

function DocumentRow({
  document,
  canDelete,
  canUpload,
  location,
  onOpenHistory,
  onDeleted,
}: {
  document: DocumentDTO;
  canDelete: boolean;
  canUpload: boolean;
  location?: ReactNode;
  onOpenHistory: () => void;
  onDeleted: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const revision = document.currentRevision;

  return (
    <tr className="h-11 align-middle hover:bg-[var(--page-bg)]">
      <td className="px-3">
        <div className="flex items-center gap-2">
          <FileTypeIcon filename={revision?.originalFilename ?? document.title} />
          <button
            type="button"
            onClick={onOpenHistory}
            className="min-w-0 max-w-md break-words text-left font-semibold text-[var(--brand-primary)] hover:underline"
          >
            {document.title}
          </button>
          {revision ? <Badge>Rev {revision.revisionNumber}</Badge> : null}
          {revision ? (
            <Badge color="var(--brand-accent)" textColor="var(--brand-ink)">
              Latest
            </Badge>
          ) : null}
        </div>
      </td>

      <td className="px-3 text-[var(--brand-text)]">
        {document.category ? (
          <span className="rounded-full bg-[var(--page-bg)] px-2 py-0.5 text-xs">
            {document.category}
          </span>
        ) : (
          <span className="text-xs text-[var(--brand-gray)]">—</span>
        )}
      </td>

      {location !== undefined ? <td className="px-3 text-xs">{location}</td> : null}

      <td className="px-3">
        <span className="inline-flex flex-wrap items-center gap-2 text-xs text-[var(--brand-text)]">
          <Avatar name={document.uploadedByName} size={24} />
          {document.uploadedByName}
          <CompanyBadge companyName={document.uploadedByCompanyName} />
        </span>
      </td>

      <td className="px-3 text-xs text-[var(--brand-text)]">
        {formatDate(revision?.createdAt ?? document.createdAt)}
      </td>

      <td className="px-3 text-xs text-[var(--brand-text)]">
        {revision ? formatFileSize(revision.sizeBytes) : "—"}
      </td>

      <td className="px-3">
        <div className="flex items-center justify-end gap-3 text-xs">
          {revision ? (
            <a
              href={revision.downloadUrl}
              className="font-semibold text-[var(--brand-primary)] hover:underline"
            >
              Download
            </a>
          ) : null}
          <button
            type="button"
            onClick={onOpenHistory}
            className="font-semibold text-[var(--brand-primary)] hover:underline"
          >
            History
          </button>
          {/* Sending the document id is what makes this the next revision instead of a new file. */}
          {canUpload ? (
            <UploadDropzone
              mode="link"
              buttonLabel="New revision"
              target={{ projectId: document.projectId, documentId: document.id }}
              extraKeys={[
                ...(document.mainTaskId ? [["task", document.mainTaskId] as const] : []),
                ...(document.disciplineTaskId
                  ? [["discipline-task", document.disciplineTaskId] as const]
                  : []),
              ]}
            />
          ) : null}
          {canDelete ? (
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="font-semibold text-[var(--status-blocked)] hover:underline"
            >
              Delete
            </button>
          ) : null}
        </div>

        {canDelete ? (
          <DeleteDialog
            document={document}
            open={confirmOpen}
            onClose={() => setConfirmOpen(false)}
            onDeleted={onDeleted}
          />
        ) : null}
      </td>
    </tr>
  );
}

/** The same document on a phone: one card, the three buttons that matter full width at the bottom. */
function DocumentCard({
  document,
  canDelete,
  canUpload,
  location,
  onOpenHistory,
  onDeleted,
}: {
  document: DocumentDTO;
  canDelete: boolean;
  canUpload: boolean;
  location?: ReactNode;
  onOpenHistory: () => void;
  onDeleted: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const revision = document.currentRevision;

  return (
      <PhoneCard
        leading={<FileTypeIcon filename={revision?.originalFilename ?? document.title} />}
        title={document.title}
        meta={
          revision ? (
            <>
              <Badge>Rev {revision.revisionNumber}</Badge>
              <Badge color="var(--brand-accent)" textColor="var(--brand-ink)">
                Latest
              </Badge>
            </>
          ) : null
        }
        fields={[
          { label: "Category", hidden: !document.category, value: document.category },
          { label: "Location", hidden: location === undefined, value: location },
          {
            label: "Filed by",
            value: (
              <span className="inline-flex flex-wrap items-center gap-2">
                <Avatar name={document.uploadedByName} size={24} />
                {document.uploadedByName}
                <CompanyBadge companyName={document.uploadedByCompanyName} />
              </span>
            ),
          },
          { label: "Date", value: formatDate(revision?.createdAt ?? document.createdAt) },
          { label: "Size", value: revision ? formatFileSize(revision.sizeBytes) : "—" },
        ]}
        actions={
          <>
            {revision ? (
              <a
                href={revision.downloadUrl}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-[var(--radius)] border border-[var(--brand-primary)] bg-white px-4 py-2 text-sm font-semibold text-[var(--brand-primary)] hover:bg-[var(--page-bg)]"
              >
                Download
              </a>
            ) : null}
            <Button variant="secondary" className="min-h-11 w-full" onClick={onOpenHistory}>
              History
            </Button>
            {/* Sending the document id is what makes this the next revision instead of a new file. */}
            {canUpload ? (
              <div className="[&>button]:min-h-11 [&>button]:w-full">
                <UploadDropzone
                  mode="button"
                  buttonLabel="New revision"
                  target={{ projectId: document.projectId, documentId: document.id }}
                  extraKeys={[
                    ...(document.mainTaskId ? [["task", document.mainTaskId] as const] : []),
                    ...(document.disciplineTaskId
                      ? [["discipline-task", document.disciplineTaskId] as const]
                      : []),
                  ]}
                />
              </div>
            ) : null}
            {canDelete ? (
              <Button
                variant="ghost"
                className="min-h-11 w-full text-[var(--status-blocked)]"
                onClick={() => setConfirmOpen(true)}
              >
                Delete
              </Button>
            ) : null}
            {canDelete ? (
              <DeleteDialog
                document={document}
                open={confirmOpen}
                onClose={() => setConfirmOpen(false)}
                onDeleted={onDeleted}
              />
            ) : null}
          </>
        }
      />
  );
}

export function DocumentTable({
  groups,
  isPending,
  isError,
  onRetry,
  canDelete,
  canUpload = true,
  canUploadFor,
  empty,
  showLocation = false,
  locationFor,
  onChanged,
}: {
  groups: DocumentGroup[];
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  canDelete: boolean;
  /** False hides "New revision" on every row. A courtesy: the server refuses the upload regardless. */
  canUpload?: boolean;
  /** Per-document answer, for tabs where it depends on the document's task. Wins over canUpload. */
  canUploadFor?: (document: DocumentDTO) => boolean;
  /** What to show when there is not a single document anywhere in these groups. */
  empty: ReactNode;
  showLocation?: boolean;
  locationFor?: (document: DocumentDTO) => ReactNode;
  onChanged?: () => void;
}) {
  const queryClient = useQueryClient();
  const [history, setHistory] = useState<{ id: string; title: string } | null>(null);

  function refresh(document: DocumentDTO) {
    void queryClient.invalidateQueries({ queryKey: ["project", document.projectId] });
    if (document.mainTaskId) {
      void queryClient.invalidateQueries({ queryKey: ["task", document.mainTaskId] });
    }
    if (document.disciplineTaskId) {
      void queryClient.invalidateQueries({ queryKey: ["discipline-task", document.disciplineTaskId] });
    }
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    onChanged?.();
  }

  if (isError) {
    return (
      <ErrorBanner message="Couldn't load documents. Try refreshing the page." onRetry={onRetry} />
    );
  }

  if (isPending) return <SkeletonRows rows={6} height="h-11" />;

  const total = groups.reduce((count, group) => count + group.documents.length, 0);
  if (total === 0) return <>{empty}</>;

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <section key={group.key} className="space-y-2">
          {group.label ? (
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--brand-gray)]">
              {group.label} ({group.documents.length})
            </h3>
          ) : null}

          {group.documents.length === 0 ? (
            <p className="text-sm text-[var(--brand-gray)]">
              {group.emptyNote ?? "No documents yet."}
            </p>
          ) : (
            <>
              <PhoneCardList label={group.label ?? "Documents"}>
                {group.documents.map((document) => (
                  <DocumentCard
                    key={document.id}
                    document={document}
                    canDelete={canDelete}
                    canUpload={canUploadFor ? canUploadFor(document) : canUpload}
                    location={showLocation ? (locationFor?.(document) ?? "—") : undefined}
                    onOpenHistory={() => setHistory({ id: document.id, title: document.title })}
                    onDeleted={() => refresh(document)}
                  />
                ))}
              </PhoneCardList>
              <DesktopTable>
              <table className="w-full text-sm">
                <thead className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--brand-gray)]">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Name</th>
                    <th className="px-3 py-2 font-semibold">Category</th>
                    {showLocation ? <th className="px-3 py-2 font-semibold">Location</th> : null}
                    <th className="px-3 py-2 font-semibold">Uploaded by</th>
                    <th className="px-3 py-2 font-semibold">Date</th>
                    <th className="px-3 py-2 font-semibold">Size</th>
                    <th className="px-3 py-2 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {group.documents.map((document) => (
                    <DocumentRow
                      key={document.id}
                      document={document}
                      canDelete={canDelete}
                      canUpload={canUploadFor ? canUploadFor(document) : canUpload}
                      location={showLocation ? (locationFor?.(document) ?? "—") : undefined}
                      onOpenHistory={() =>
                        setHistory({ id: document.id, title: document.title })
                      }
                      onDeleted={() => refresh(document)}
                    />
                  ))}
                </tbody>
              </table>
              </DesktopTable>
            </>
          )}
        </section>
      ))}

      {history ? (
        <VersionHistoryPanel
          documentId={history.id}
          documentTitle={history.title}
          open
          onClose={() => setHistory(null)}
        />
      ) : null}
    </div>
  );
}
