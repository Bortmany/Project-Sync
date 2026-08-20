// Projects list — every project the signed-in person can see, with search, status filter,
// and (for admins and project managers) the "New project" flow.

"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { NewProjectDialog } from "@/components/projects/new-project-dialog";
import { isManager, useMe, useProjects } from "@/components/hooks/use-api";
import { formatDate } from "@/components/format";
import {
  Button,
  DisciplineDot,
  EmptyState,
  ErrorBanner,
  Input,
  ProgressBar,
  SkeletonRows,
  StatusBadge,
} from "@/components/ui";
import type { ProjectListItemDTO, ProjectStatusName } from "@/lib/zod-schemas";

const PROJECT_STATUS: { value: ProjectStatusName; label: string }[] = [
  { value: "ACTIVE", label: "Active" },
  { value: "ON_HOLD", label: "On hold" },
  { value: "COMPLETED", label: "Completed" },
  { value: "ARCHIVED", label: "Archived" },
];

/** Project statuses ride the task badge's visual system: active reads as in progress, and so on. */
const PROJECT_STATUS_AS_TASK = {
  ACTIVE: "IN_PROGRESS",
  ON_HOLD: "AWAITING_REVIEW",
  COMPLETED: "COMPLETED",
  ARCHIVED: "NOT_STARTED",
} as const;

export function ProjectStatusBadge({ status }: { status: ProjectStatusName }) {
  const label = PROJECT_STATUS.find((item) => item.value === status)?.label ?? status;
  return (
    <span title={label}>
      <StatusBadge status={PROJECT_STATUS_AS_TASK[status]} />
    </span>
  );
}

function DisciplineDots({ disciplines }: { disciplines: ProjectListItemDTO["disciplines"] }) {
  const shown = disciplines.slice(0, 4);
  const rest = disciplines.length - shown.length;
  return (
    <span className="inline-flex items-center gap-1">
      {shown.map((discipline) => (
        <DisciplineDot key={discipline.id} colorHex={discipline.colorHex} code={discipline.code} />
      ))}
      {rest > 0 ? <span className="text-xs text-[var(--olng-gray)]">+{rest}</span> : null}
    </span>
  );
}

export function ProjectsView() {
  const me = useMe();
  const projects = useProjects();
  const [search, setSearch] = useState("");
  const [statuses, setStatuses] = useState<ProjectStatusName[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);

  const canCreate = isManager(me.data);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (projects.data ?? []).filter((project) => {
      if (statuses.length > 0 && !statuses.includes(project.status)) return false;
      if (!term) return true;
      return (
        project.name.toLowerCase().includes(term) || project.code.toLowerCase().includes(term)
      );
    });
  }, [projects.data, search, statuses]);

  const filtering = search.trim().length > 0 || statuses.length > 0;

  function clearFilters() {
    setSearch("");
    setStatuses([]);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-[var(--olng-blue)]">Projects</h1>
        {canCreate ? <Button onClick={() => setDialogOpen(true)}>+ New project</Button> : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-64">
          <Input
            type="search"
            aria-label="Search projects"
            placeholder="Search projects…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {PROJECT_STATUS.map((option) => {
            const active = statuses.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  setStatuses((current) =>
                    current.includes(option.value)
                      ? current.filter((value) => value !== option.value)
                      : [...current, option.value],
                  )
                }
                className={`min-h-9 rounded-full border px-3 text-xs font-semibold ${
                  active
                    ? "border-[var(--olng-blue)] bg-[var(--olng-blue)] text-white"
                    : "border-[var(--border)] bg-white text-[var(--olng-text)]"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {projects.isError ? (
        <ErrorBanner
          message="Couldn't load projects. Try refreshing the page."
          onRetry={() => void projects.refetch()}
        />
      ) : projects.isPending ? (
        <SkeletonRows rows={6} />
      ) : (projects.data ?? []).length === 0 ? (
        canCreate ? (
          <EmptyState
            message="No projects yet. Create the first one to start coordinating work."
            action={<Button onClick={() => setDialogOpen(true)}>+ New project</Button>}
          />
        ) : (
          <EmptyState message="You haven't been added to any projects yet. Check with your project manager." />
        )
      ) : visible.length === 0 ? (
        <div className="py-8 text-center text-sm text-[var(--olng-text)]">
          <p>No projects match your filters.</p>
          <button
            type="button"
            onClick={clearFilters}
            className="mt-1 font-semibold text-[var(--olng-blue)] underline underline-offset-2"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--border)] bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--olng-gray)]">
              <tr>
                <th className="px-3 py-2 font-semibold">Project</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="w-48 px-3 py-2 font-semibold">Progress</th>
                <th className="px-3 py-2 font-semibold">Disciplines</th>
                <th className="px-3 py-2 font-semibold">Overdue</th>
                <th className="px-3 py-2 font-semibold">Deadline</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {visible.map((project) => {
                const overdue =
                  project.targetDate !== null &&
                  project.status !== "COMPLETED" &&
                  project.targetDate.getTime() < Date.now();
                return (
                  <tr key={project.id} className="h-11 hover:bg-[var(--page-bg)]">
                    <td className="px-3">
                      <Link
                        href={`/projects/${project.id}`}
                        className="font-semibold text-[var(--olng-blue)] hover:underline"
                      >
                        {project.name}
                      </Link>
                      <span className="ml-2 rounded-full bg-[var(--page-bg)] px-2 py-0.5 text-xs text-[var(--olng-text)]">
                        {project.code}
                      </span>
                    </td>
                    <td className="px-3">
                      <ProjectStatusBadge status={project.status} />
                    </td>
                    <td className="px-3">
                      <ProgressBar pct={project.progressPct} />
                      <span className="text-xs text-[var(--olng-gray)]">
                        {project.mainTaskCount} main tasks
                      </span>
                    </td>
                    <td className="px-3">
                      <DisciplineDots disciplines={project.disciplines} />
                    </td>
                    <td className="px-3">
                      {project.overdueCount > 0 ? (
                        <span className="text-xs font-semibold text-[var(--status-blocked)]">
                          {project.overdueCount} overdue
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--olng-gray)]">None</span>
                      )}
                    </td>
                    <td
                      className="px-3"
                      style={{ color: overdue ? "var(--status-blocked)" : "var(--olng-text)" }}
                    >
                      {formatDate(project.targetDate)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {filtering && visible.length > 0 ? (
        <button
          type="button"
          onClick={clearFilters}
          className="text-xs font-semibold text-[var(--olng-blue)] underline underline-offset-2"
        >
          Clear filters
        </button>
      ) : null}

      {canCreate ? (
        <NewProjectDialog open={dialogOpen} onClose={() => setDialogOpen(false)} me={me.data} />
      ) : null}
    </div>
  );
}
