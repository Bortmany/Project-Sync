// The Documents tab on a main task: files attached to the main task itself ("shared"), then a block
// per discipline task underneath, so it is obvious who filed what.

"use client";

import { useMainTaskDocuments } from "@/components/hooks/use-api";
import { DocumentTable, type DocumentGroup } from "@/components/documents/document-table";
import { UploadDropzone } from "@/components/documents/upload-dropzone";
import { EmptyState } from "@/components/ui";
import type { MainTaskDTO } from "@/lib/zod-schemas";

export function MainTaskDocumentsTab({
  task,
  canDelete,
}: {
  task: MainTaskDTO;
  canDelete: boolean;
}) {
  const documents = useMainTaskDocuments(task.id);
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
      <UploadDropzone target={{ projectId: task.projectId, mainTaskId: task.id }} />

      <DocumentTable
        groups={groups}
        isPending={documents.isPending}
        isError={documents.isError}
        onRetry={() => void documents.refetch()}
        canDelete={canDelete}
        empty={<EmptyState message="No documents yet. Upload the first one." />}
      />
    </div>
  );
}
