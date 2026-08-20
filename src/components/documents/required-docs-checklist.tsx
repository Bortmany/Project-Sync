// The required-documents checklist on a discipline task. Every mandatory row must be ticked before
// the task can be marked complete, so each missing row carries its own upload button that files the
// document against that requirement in one step.

"use client";

import { UploadDropzone } from "@/components/documents/upload-dropzone";
import { useDisciplineTaskDocuments } from "@/components/hooks/use-api";
import { formatDate } from "@/components/format";
import { Badge } from "@/components/ui";
import type { DisciplineTaskDTO } from "@/lib/zod-schemas";

export function RequiredDocsChecklist({ task }: { task: DisciplineTaskDTO }) {
  // The same query the Documents section uses, so a satisfied row can name the file that filled it.
  const documents = useDisciplineTaskDocuments(task.id);

  if (task.requiredDocuments.length === 0) {
    return (
      <p className="text-sm text-[var(--olng-gray)]">
        No required documents for this discipline task.
      </p>
    );
  }

  const byId = new Map((documents.data ?? []).map((document) => [document.id, document]));

  return (
    <ul className="divide-y divide-[var(--border)]">
      {task.requiredDocuments.map((requirement) => {
        const document = requirement.documentId ? byId.get(requirement.documentId) : undefined;
        const revision = document?.currentRevision;

        return (
          <li key={requirement.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
            <span
              aria-hidden="true"
              className="w-3 text-center"
              style={{
                color: requirement.isSatisfied
                  ? "var(--status-completed)"
                  : "var(--status-blocked)",
              }}
            >
              {requirement.isSatisfied ? "✓" : "✕"}
            </span>
            <span className="sr-only">
              {requirement.isSatisfied ? "Uploaded:" : "Still missing:"}
            </span>

            <span className="min-w-40 flex-1 text-sm text-[var(--olng-navy)]">
              {requirement.name}
            </span>

            {requirement.isMandatory ? (
              <span className="text-xs text-[var(--olng-gray)]">Mandatory</span>
            ) : null}

            {requirement.isSatisfied ? (
              <span className="flex flex-wrap items-center gap-2 text-xs text-[var(--olng-text)]">
                {revision ? <Badge>Rev {revision.revisionNumber}</Badge> : null}
                <span>
                  {document?.title ?? "Uploaded"}
                  {requirement.satisfiedAt ? ` · ${formatDate(requirement.satisfiedAt)}` : ""}
                </span>
                {revision ? (
                  <a
                    href={revision.downloadUrl}
                    className="font-semibold text-[var(--olng-blue)] hover:underline"
                  >
                    View
                  </a>
                ) : null}
                {document ? (
                  <UploadDropzone
                    mode="link"
                    buttonLabel="New revision"
                    target={{ projectId: task.projectId, documentId: document.id }}
                    extraKeys={[
                      ["discipline-task", task.id],
                      ["task", task.mainTaskId],
                    ]}
                  />
                ) : null}
              </span>
            ) : (
              <span className="flex items-center gap-3">
                <span className="text-xs text-[var(--olng-gray)]">Not uploaded</span>
                <UploadDropzone
                  mode="button"
                  buttonLabel="Upload"
                  requirementName={requirement.name}
                  target={{
                    projectId: task.projectId,
                    disciplineTaskId: task.id,
                    requiredDocumentId: requirement.id,
                  }}
                  extraKeys={[["task", task.mainTaskId]]}
                />
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
