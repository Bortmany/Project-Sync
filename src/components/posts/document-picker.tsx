// Picking one document that already exists, to point a project board post at.
//
// This is NOT an upload: nothing is copied, nothing new is filed, and no revision is created. The
// post simply carries the id of a document already on this project, and the chip on the card is
// resolved against whoever is reading it — so attaching one can never show somebody a document they
// could not already open.
//
// Only a PROJECT board offers this. On the company-wide and department boards there is no single
// project to pick from, and searching every project a person can see is a read surface this round
// deliberately does not open.

"use client";

import { useMemo, useState } from "react";
import { FileTypeIcon } from "@/components/documents/file-icon";
import { useProjectDocuments } from "@/components/hooks/use-api";
import {
  Button,
  EmptyState,
  ErrorBanner,
  Input,
  Modal,
  SkeletonRows,
} from "@/components/ui";
import type { DocumentDTO } from "@/lib/zod-schemas";

/** What the composer keeps hold of between picking and posting. */
export type PickedDocument = { id: string; title: string; revision: number | null };

function pickedFrom(document: DocumentDTO): PickedDocument {
  return {
    id: document.id,
    title: document.title,
    revision: document.currentRevision?.revisionNumber ?? null,
  };
}

/** "Rev 3", or nothing at all while a document somehow has no revision yet. */
function revisionLabel(revision: number | null): string {
  return revision === null ? "" : `Rev ${revision}`;
}

export function DocumentPicker({
  open,
  projectId,
  onClose,
  onAttach,
}: {
  open: boolean;
  projectId: string;
  onClose: () => void;
  onAttach: (document: PickedDocument) => void;
}) {
  const documents = useProjectDocuments(open ? projectId : "");
  const [term, setTerm] = useState("");
  const [chosen, setChosen] = useState<DocumentDTO | null>(null);

  const all = useMemo(() => documents.data ?? [], [documents.data]);
  const shown = useMemo(() => {
    const needle = term.trim().toLowerCase();
    if (needle.length === 0) return all;
    return all.filter((document) => document.title.toLowerCase().includes(needle));
  }, [all, term]);

  function close() {
    setTerm("");
    setChosen(null);
    onClose();
  }

  return (
    <Modal
      open={open}
      title="Attach a document"
      size="sm"
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            disabled={chosen === null}
            onClick={() => {
              if (!chosen) return;
              onAttach(pickedFrom(chosen));
              close();
            }}
          >
            Attach
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-[var(--brand-text)]">
          Pick one document already filed on this project. Anyone who can&apos;t see it simply
          won&apos;t see the link on your post.
        </p>

        {documents.isError ? (
          <ErrorBanner
            message="Couldn't load this project's documents. Try again."
            onRetry={() => void documents.refetch()}
          />
        ) : documents.isPending ? (
          <SkeletonRows rows={4} />
        ) : all.length === 0 ? (
          <EmptyState compact message="Nothing filed on this project yet." />
        ) : (
          <>
            <Input
              value={term}
              aria-label="Search documents by title"
              placeholder="Search documents by title"
              onChange={(event) => {
                setTerm(event.target.value);
                setChosen(null);
              }}
            />

            {shown.length === 0 ? (
              <EmptyState compact message="No documents match that search." />
            ) : (
              <ul className="max-h-72 divide-y divide-[var(--border)] overflow-y-auto rounded-[var(--radius)] border border-[var(--border)]">
                {shown.map((document) => {
                  const isChosen = chosen?.id === document.id;
                  const meta = [
                    revisionLabel(document.currentRevision?.revisionNumber ?? null),
                    document.category,
                  ]
                    .filter(Boolean)
                    .join(" · ");

                  return (
                    <li key={document.id}>
                      <button
                        type="button"
                        onClick={() => setChosen(isChosen ? null : document)}
                        className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${
                          isChosen ? "bg-[var(--brand-accent)]/15" : "hover:bg-[var(--page-bg)]"
                        }`}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <FileTypeIcon
                            filename={document.currentRevision?.originalFilename ?? document.title}
                          />
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-[var(--brand-ink)]">
                              {document.title}
                            </span>
                            {meta ? (
                              <span className="block text-xs text-[var(--brand-gray)]">{meta}</span>
                            ) : null}
                          </span>
                        </span>
                        {isChosen ? (
                          <span className="shrink-0 text-xs font-semibold text-[var(--brand-primary)]">
                            Chosen
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
