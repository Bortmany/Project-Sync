// The Documents section on a discipline task: the drop area, then this task's own files.

"use client";

import { useDisciplineTaskDocuments } from "@/components/hooks/use-api";
import { DocumentTable } from "@/components/documents/document-table";
import { UploadDropzone } from "@/components/documents/upload-dropzone";
import { EmptyState } from "@/components/ui";
import type { DisciplineTaskDTO } from "@/lib/zod-schemas";

export function DisciplineTaskDocuments({
  task,
  canDelete,
  canUpload = true,
}: {
  task: DisciplineTaskDTO;
  canDelete: boolean;
  /** False when this person may not file documents here: the drop area and Upload buttons go away. */
  canUpload?: boolean;
}) {
  const documents = useDisciplineTaskDocuments(task.id);

  return (
    <div className="space-y-4">
      {canUpload ? (
        <UploadDropzone
          target={{ projectId: task.projectId, disciplineTaskId: task.id }}
          extraKeys={[["task", task.mainTaskId]]}
        />
      ) : null}

      <DocumentTable
        groups={[{ key: task.id, documents: documents.data ?? [] }]}
        isPending={documents.isPending}
        isError={documents.isError}
        onRetry={() => void documents.refetch()}
        canDelete={canDelete}
        canUpload={canUpload}
        empty={
          <EmptyState
            message={
              canUpload ? "No documents yet. Upload the first one." : "No documents have been filed yet."
            }
            action={
              canUpload ? (
                <UploadDropzone
                  target={{ projectId: task.projectId, disciplineTaskId: task.id }}
                  extraKeys={[["task", task.mainTaskId]]}
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
