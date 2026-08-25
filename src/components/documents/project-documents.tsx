// The Documents tab on a project: everything filed anywhere on this project, grouped by main task.
// Read-mostly on purpose — a file always belongs to a task, so uploading happens on the task itself.

"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useProjectDocuments, useProjectMainTasks } from "@/components/hooks/use-api";
import { DocumentTable, type DocumentGroup } from "@/components/documents/document-table";
import { EmptyState, Input, Select } from "@/components/ui";
import type { DocumentDTO, ProjectDTO } from "@/lib/zod-schemas";

/** Where a document sits: which main task it belongs to, and which discipline filed it. */
type Placement = { mainTaskId: string; mainTaskTitle: string; disciplineCode: string | null };

const UNPLACED = "unplaced";

export function ProjectDocumentsTab({
  project,
  canDelete,
}: {
  project: ProjectDTO;
  canDelete: boolean;
}) {
  const documents = useProjectDocuments(project.id);
  const mainTasks = useProjectMainTasks(project.id, {});
  const [search, setSearch] = useState("");
  const [mainTaskFilter, setMainTaskFilter] = useState("");

  const placements = useMemo(() => {
    const byDocumentTarget = new Map<string, Placement>();
    for (const task of mainTasks.data ?? []) {
      byDocumentTarget.set(task.id, {
        mainTaskId: task.id,
        mainTaskTitle: task.title,
        disciplineCode: null,
      });
      for (const item of task.disciplineSummary) {
        byDocumentTarget.set(item.disciplineTaskId, {
          mainTaskId: task.id,
          mainTaskTitle: task.title,
          disciplineCode: item.code,
        });
      }
    }
    return byDocumentTarget;
  }, [mainTasks.data]);

  function placementOf(document: DocumentDTO): Placement | undefined {
    const key = document.disciplineTaskId ?? document.mainTaskId;
    return key ? placements.get(key) : undefined;
  }

  const term = search.trim().toLowerCase();
  const rows = (documents.data ?? []).filter((document) => {
    const placement = placementOf(document);
    if (mainTaskFilter && placement?.mainTaskId !== mainTaskFilter) return false;
    if (!term) return true;
    return [document.title, document.category ?? "", document.currentRevision?.originalFilename ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(term);
  });

  const groups: DocumentGroup[] = [];
  for (const task of mainTasks.data ?? []) {
    if (mainTaskFilter && task.id !== mainTaskFilter) continue;
    const forTask = rows.filter((document) => placementOf(document)?.mainTaskId === task.id);
    if (forTask.length > 0) groups.push({ key: task.id, label: task.title, documents: forTask });
  }
  const loose = rows.filter((document) => placementOf(document) === undefined);
  if (loose.length > 0) {
    groups.push({ key: UNPLACED, label: "Elsewhere on this project", documents: loose });
  }

  const isFiltering = term.length > 0 || mainTaskFilter.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block space-y-1">
          <span className="block text-xs text-[var(--olng-gray)]">Search</span>
          <Input
            value={search}
            placeholder="Search documents…"
            className="w-64"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label className="block space-y-1">
          <span className="block text-xs text-[var(--olng-gray)]">Main task</span>
          <Select
            value={mainTaskFilter}
            className="w-64"
            onChange={(event) => setMainTaskFilter(event.target.value)}
          >
            <option value="">All main tasks</option>
            {(mainTasks.data ?? []).map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}
              </option>
            ))}
          </Select>
        </label>
      </div>

      <DocumentTable
        groups={groups}
        isPending={documents.isPending}
        isError={documents.isError}
        onRetry={() => void documents.refetch()}
        canDelete={canDelete}
        showLocation
        locationFor={(document) => {
          const placement = placementOf(document);
          if (!placement) return <span className="text-[var(--olng-gray)]">—</span>;
          return (
            <Link
              href={
                document.disciplineTaskId
                  ? `/discipline-tasks/${document.disciplineTaskId}`
                  : `/tasks/${placement.mainTaskId}`
              }
              className="text-[var(--olng-blue)] hover:underline"
            >
              {placement.mainTaskTitle}
              {placement.disciplineCode ? ` → ${placement.disciplineCode}` : ""}
            </Link>
          );
        }}
        empty={
          isFiltering ? (
            <div className="py-8 text-center text-sm text-[var(--olng-text)]">
              <p>No documents match your search.</p>
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setMainTaskFilter("");
                }}
                className="mt-1 font-semibold text-[var(--olng-blue)] underline underline-offset-2"
              >
                Clear filters
              </button>
            </div>
          ) : (
            <EmptyState message="No documents yet. Upload the first one from a task to keep everything in one place." />
          )
        }
      />
    </div>
  );
}
