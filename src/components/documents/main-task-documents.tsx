// The Documents tab on a main task: files attached to the main task itself ("shared"), then a block
// per discipline task underneath, so it is obvious who filed what.

"use client";

import { useMainTaskDocuments } from "@/components/hooks/use-api";
import { DocumentTable, type DocumentGroup } from "@/components/documents/document-table";
import { UploadDropzone } from "@/components/documents/upload-dropzone";
import { canUploadRevisionTo } from "@/components/documents/can-upload";
import type { MeDTO } from "@/components/hooks/use-api";
import { EmptyState } from "@/components/ui";
import type { MainTaskDTO, ProjectDTO } from "@/lib/zod-schemas";

export function MainTaskDocumentsTab({
  task,
  canDelete,
  me,
  project,
}: {
  task: MainTaskDTO;
  canDelete: boolean;
  /** Who is looking, and the project they are on: decides who is offered an upload. */
  me?: MeDTO;
  project?: ProjectDTO;
}) {
  const documents = useMainTaskDocuments(task.id);
  // The same people the server lets upload. Everyone else reads the documents without buttons.
  const canUploadFor = (document: { disciplineTaskId: string | null }) =>
    canUploadRevisionTo(me, project, document, task.disciplineSummary);
  const canUploadShared = canUploadFor({ disciplineTaskId: null });
  const rows = documents.data ?? [];

  const shared = rows.filter((document) => document.disciplineTaskId === null);
  const groups: DocumentGroup[] = [
    {
      key: "shared",
      label: "Shared documents",
      documents: shared,
      emptyNote: "No shared documents yet. Anything uploaded here is visible to every discipline.",
    },
    ...task.disciplineSummary.map((item) => ({
      key: item.disciplineTaskId,
      label: `${item.code} · ${item.title}`,
      documents: rows.filter((document) => document.disciplineTaskId === item.disciplineTaskId),
      emptyNote: "No documents on this discipline task yet.",
    })),
  ];

  return (
    <div className="space-y-4">
      {canUploadShared ? (
        <UploadDropzone target={{ projectId: task.projectId, mainTaskId: task.id }} />
      ) : null}

      <DocumentTable
        groups={groups}
        isPending={documents.isPending}
        isError={documents.isError}
        onRetry={() => void documents.refetch()}
        canDelete={canDelete}
        canUploadFor={canUploadFor}
        empty={
          <EmptyState
            message={
              canUploadShared ? "No documents yet. Upload the first one." : "No documents have been filed yet."
            }
            // Its own opener, so the empty state is actionable without scrolling back to the drop
            // area. The server checks who may upload here, exactly as it does for the drop area.
            action={
              canUploadShared ? (
                <UploadDropzone
                  target={{ projectId: task.projectId, mainTaskId: task.id }}
                  mode="button"
                  buttonLabel="Upload a document"
                />
              ) : undefined
            }
          />
        }
      />
    </div>
  );
}
