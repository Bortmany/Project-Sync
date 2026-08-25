// Version history — every revision of one document, newest first, in a slide-over panel.
// Revisions are append-only: there is no delete here, and there never will be. Older revisions stay
// downloadable for as long as the project exists.

"use client";

import { useEffect, useRef } from "react";
import { useDocumentVersions } from "@/components/hooks/use-api";
import { formatDate } from "@/components/format";
import { formatFileSize } from "@/components/documents/file-icon";
import { Badge, ErrorBanner, Skeleton } from "@/components/ui";

export function VersionHistoryPanel({
  documentId,
  documentTitle,
  open,
  onClose,
}: {
  documentId: string;
  documentTitle: string;
  open: boolean;
  onClose: () => void;
}) {
  const versions = useDocumentVersions(documentId, open);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const rows = versions.data ?? [];
  const latestRevision = rows.length > 0 ? Math.max(...rows.map((row) => row.revisionNumber)) : -1;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-[var(--olng-navy)]/40"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={`Version history for ${documentTitle}`}
        tabIndex={-1}
        className="h-full w-full max-w-md overflow-y-auto bg-white shadow-lg focus:outline-none"
      >
        <header className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-[var(--olng-navy)]">
              {documentTitle}
            </h2>
            <p className="text-xs text-[var(--olng-gray)]">
              Every revision, newest first. Revisions are kept for good.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close version history"
            className="rounded p-1 text-[var(--olng-text)] hover:bg-[var(--page-bg)]"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        </header>

        <div className="px-4 py-4">
          {versions.isError ? (
            <ErrorBanner
              message="Couldn't load the version history. Try again."
              onRetry={() => void versions.refetch()}
            />
          ) : versions.isPending ? (
            <div className="space-y-3" role="status" aria-label="Loading version history">
              {[0, 1, 2].map((row) => (
                <div key={row} className="space-y-1">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-3 w-48" />
                </div>
              ))}
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-[var(--olng-text)]">No revisions to show yet.</p>
          ) : (
            <ol className="divide-y divide-[var(--border)]">
              {rows.map((version) => (
                <li key={version.id} className="space-y-1 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>Rev {version.revisionNumber}</Badge>
                    {version.revisionNumber === latestRevision ? (
                      <Badge color="var(--olng-sail)" textColor="var(--olng-navy)">
                        Latest
                      </Badge>
                    ) : null}
                    <span className="text-xs text-[var(--olng-text)]">
                      {version.uploadedByName} · {formatDate(version.createdAt)}
                    </span>
                  </div>
                  <p className="truncate text-sm text-[var(--olng-navy)]">
                    {version.originalFilename}
                  </p>
                  {version.note ? (
                    <p className="text-sm text-[var(--olng-text)]">{version.note}</p>
                  ) : null}
                  <div className="flex items-center gap-3 text-xs text-[var(--olng-gray)]">
                    <span>{formatFileSize(version.sizeBytes)}</span>
                    <a
                      href={version.downloadUrl}
                      className="font-semibold text-[var(--olng-blue)] hover:underline"
                    >
                      Download
                    </a>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
