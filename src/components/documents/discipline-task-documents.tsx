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
}: {
  task: DisciplineTaskDTO;
  canDelete: boolean;
}) {
  const documents = useDisciplineTaskDocuments(task.id);

  return (
    <div className="space-y-4">
      <UploadDropzone
        target={{ projectId: task.projectId, disciplineTaskId: task.id }}
        extraKeys={[["task", task.mainTaskId]]}
      />

      <DocumentTable
        groups={[{ key: task.id, documents: documents.data ?? [] }]}
        isPending={documents.isPending}
        isError={documents.isError}
        onRetry={() => void documents.refetch()}
        canDelete={canDelete}
        empty={
          <EmptyState
            message="No documents yet. Upload the first one."
            action={
              <UploadDropzone
                target={{ projectId: task.projectId, disciplineTaskId: task.id }}
                extraKeys={[["task", task.mainTaskId]]}
                mode="button"
                buttonLabel="Upload a document"
              />
            }
          />
        }
      />
    </div>
  );
}
