// Uploading a file. Drag one in or browse for it, add the optional details, and post it to
// /api/uploads as multipart. Every upload creates the next revision — nothing is ever overwritten,
// so the same file name can be sent again as often as the work needs it.

"use client";

import { useRef, useState, type DragEvent } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { Button, ErrorBanner, Field, Input, Modal, Textarea, useToast } from "@/components/ui";
import { DocumentVersionDTO } from "@/lib/zod-schemas";

/** Where the file is going. The server checks all of this again before it writes anything. */
export type UploadTarget = {
  projectId: string;
  /** Attach to the main task itself (a "shared" document). */
  mainTaskId?: string;
  /** Attach to one discipline task. */
  disciplineTaskId?: string;
  /** Add the next revision to an existing document instead of starting a new one. */
  documentId?: string;
  /** Tick off a required-documents checklist item with this upload. */
  requiredDocumentId?: string;
};

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.docx,.pptx,.zip,.csv,.txt,.dwg";

export const UPLOAD_LIMITS_LINE =
  "Drop a file here or browse — PDF, Office, images, CSV, DWG or ZIP, up to 25 MB";

const GENERIC_FAILURE = "Couldn't upload this file. Try again or use a different file.";

/** "vendor-datasheet.pdf" → "vendor-datasheet", so the title field starts somewhere sensible. */
function titleFromFilename(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return (dot > 0 ? filename.slice(0, dot) : filename).slice(0, 200);
}

/** Posts the multipart body and unwraps the { ok, data } envelope the routes all return. */
async function postUpload(
  file: File,
  target: UploadTarget,
  details: { title: string; category: string; note: string },
): Promise<DocumentVersionDTO> {
  const form = new FormData();
  form.set("file", file);
  form.set("projectId", target.projectId);
  if (target.mainTaskId) form.set("mainTaskId", target.mainTaskId);
  if (target.disciplineTaskId) form.set("disciplineTaskId", target.disciplineTaskId);
  if (target.documentId) form.set("documentId", target.documentId);
  if (target.requiredDocumentId) form.set("requiredDocumentId", target.requiredDocumentId);
  if (details.title.trim()) form.set("title", details.title.trim());
  if (details.category.trim()) form.set("category", details.category.trim());
  if (details.note.trim()) form.set("note", details.note.trim());

  let payload: unknown;
  try {
    const response = await fetch("/api/uploads", {
      method: "POST",
      body: form,
      credentials: "same-origin",
    });
    payload = await response.json();
  } catch {
    throw new Error(GENERIC_FAILURE);
  }

  const envelope = payload as { ok?: boolean; error?: string; data?: unknown };
  // The server writes its refusals in plain English, so they are shown exactly as they arrive.
  if (!envelope?.ok) throw new Error(envelope?.error || GENERIC_FAILURE);

  const parsed = DocumentVersionDTO.safeParse(envelope.data);
  if (!parsed.success) throw new Error("The server sent something we couldn't read.");
  return parsed.data;
}

export function UploadDropzone({
  target,
  mode = "zone",
  buttonLabel = "Upload",
  requirementName,
  extraKeys = [],
  onUploaded,
}: {
  target: UploadTarget;
  /**
   * "zone" is the drop area on a Documents tab, "button" the compact opener used in lists, and
   * "link" the text action that sits beside Download and History inside a table row.
   */
  mode?: "zone" | "button" | "link";
  buttonLabel?: string;
  /** Named when this upload satisfies a checklist item, so the dialog can say what it's for. */
  requirementName?: string;
  /** Extra query keys to refresh, e.g. the parent main task behind a discipline task. */
  extraKeys?: QueryKey[];
  onUploaded?: (version: DocumentVersionDTO) => void;
}) {
  const queryClient = useQueryClient();
  const { show } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");

  // A revision of an existing document keeps that document's title and category — only the file and
  // the note change, so the dialog does not offer to edit them.
  const isNewRevision = Boolean(target.documentId);

  function choose(next: File | null | undefined) {
    if (!next) return;
    setFile(next);
    setTitle(titleFromFilename(next.name));
    setError(null);
    setOpen(true);
  }

  function closeDialog() {
    if (uploading) return;
    setOpen(false);
    setFile(null);
    setError(null);
    setCategory("");
    setNote("");
    if (inputRef.current) inputRef.current.value = "";
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragging(false);
    choose(event.dataTransfer.files?.[0]);
  }

  async function submit() {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const version = await postUpload(file, target, {
        title: isNewRevision ? "" : title,
        category: isNewRevision ? "" : category,
        note,
      });

      void queryClient.invalidateQueries({ queryKey: ["project", target.projectId] });
      if (target.mainTaskId) {
        void queryClient.invalidateQueries({ queryKey: ["task", target.mainTaskId] });
      }
      if (target.disciplineTaskId) {
        void queryClient.invalidateQueries({ queryKey: ["discipline-task", target.disciplineTaskId] });
      }
      void queryClient.invalidateQueries({ queryKey: ["document", version.documentId] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      for (const key of extraKeys) void queryClient.invalidateQueries({ queryKey: key });

      show(`Rev ${version.revisionNumber} uploaded.`, "success");
      onUploaded?.(version);
      setUploading(false);
      setOpen(false);
      setFile(null);
      setCategory("");
      setNote("");
      if (inputRef.current) inputRef.current.value = "";
    } catch (caught) {
      // The file stays selected so the same one can be sent again after a fix.
      setUploading(false);
      setError(caught instanceof Error ? caught.message : GENERIC_FAILURE);
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        aria-label="Choose a file to upload"
        className="sr-only"
        onChange={(event) => choose(event.target.files?.[0])}
      />

      {mode === "link" ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="font-semibold text-[var(--brand-primary)] hover:underline"
        >
          {buttonLabel}
        </button>
      ) : mode === "button" ? (
        <Button variant="secondary" onClick={() => inputRef.current?.click()}>
          {buttonLabel}
        </Button>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex w-full flex-col items-center gap-2 rounded-[var(--radius)] border border-dashed px-4 py-6 text-sm transition-colors ${
            dragging
              ? "border-[var(--brand-accent)] bg-[var(--brand-accent)]/10 text-[var(--brand-ink)]"
              : "border-[var(--brand-gray)] text-[var(--brand-text)] hover:border-[var(--brand-primary)]"
          }`}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M12 16V5m0 0L8 9m4-4l4 4M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>{UPLOAD_LIMITS_LINE}</span>
        </button>
      )}

      <Modal
        open={open}
        size="sm"
        title={
          isNewRevision
            ? "Upload the next revision"
            : requirementName
              ? `Upload for “${requirementName}”`
              : "Upload a document"
        }
        onClose={closeDialog}
        footer={
          <>
            <Button variant="ghost" onClick={closeDialog} disabled={uploading}>
              Cancel
            </Button>
            <Button loading={uploading} disabled={!file || uploading} onClick={() => void submit()}>
              {uploading ? "Uploading…" : "Upload"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {error ? <ErrorBanner message={error} /> : null}

          <p className="text-sm text-[var(--brand-ink)]">
            <span className="font-semibold">{file?.name}</span>
          </p>
          {requirementName ? (
            <p className="text-xs text-[var(--brand-text)]">
              This upload ticks off “{requirementName}” on the checklist.
            </p>
          ) : null}

          {isNewRevision ? (
            <p className="text-xs text-[var(--brand-text)]">
              This becomes the next revision of the same document. The file that is there now stays
              in the history and can still be downloaded.
            </p>
          ) : (
            <>
              <Field label="Title" hint="Leave it as it is to use the file name.">
                <Input
                  value={title}
                  disabled={uploading}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </Field>
              <Field label="Category" hint="Optional — for example Drawing, Datasheet or Report.">
                <Input
                  value={category}
                  disabled={uploading}
                  onChange={(event) => setCategory(event.target.value)}
                />
              </Field>
            </>
          )}
          <Field label="Revision note" hint="Optional — what changed in this revision.">
            <Textarea
              value={note}
              disabled={uploading}
              placeholder="e.g. Updated after HAZOP comments"
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>

          {uploading ? (
            <div
              role="progressbar"
              aria-label="Uploading"
              className="h-1 w-full overflow-hidden rounded bg-[var(--brand-gray)]/30"
            >
              <span className="block h-full w-1/3 animate-pulse rounded bg-[var(--brand-accent)]" />
            </div>
          ) : (
            <p className="text-xs text-[var(--brand-gray)]">
              PDF, Office, images, CSV, DWG or ZIP — up to 25 MB.
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}
