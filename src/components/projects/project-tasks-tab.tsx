// A project's Tasks tab: filter chips, a sort, and the main-task table.

"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { NewMainTaskDialog } from "@/components/tasks/new-main-task-dialog";
import { useProjectMainTasks, type MainTaskFilters } from "@/components/hooks/use-api";
import { formatDate, isDueSoon } from "@/components/format";
import {
  Button,
  DisciplineDot,
  EmptyState,
  ErrorBanner,
  FilterChips,
  PriorityFlag,
  ProgressBar,
  Select,
  SkeletonRows,
  StatusBadge,
  hasActiveFilters,
  type ActiveFilters,
  type FilterDimension,
} from "@/components/ui";
import type { MainTaskListItemDTO, ProjectDTO } from "@/lib/zod-schemas";

type SortKey = "deadline" | "priority" | "status" | "title";

const PRIORITY_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

function sortTasks(tasks: MainTaskListItemDTO[], sort: SortKey): MainTaskListItemDTO[] {
  const copy = [...tasks];
  if (sort === "priority") {
    copy.sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9));
  } else if (sort === "status") {
    copy.sort((a, b) => a.effectiveStatus.localeCompare(b.effectiveStatus));
  } else if (sort === "title") {
    copy.sort((a, b) => a.title.localeCompare(b.title));
  } else {
    copy.sort((a, b) => a.deadline.getTime() - b.deadline.getTime());
  }
  return copy;
}

export function ProjectTasksTab({
  project,
  canManage,
}: {
  project: ProjectDTO;
  canManage: boolean;
}) {
  const [active, setActive] = useState<ActiveFilters>({});
  const [sort, setSort] = useState<SortKey>("deadline");
  const [dialogOpen, setDialogOpen] = useState(false);

  const filters: MainTaskFilters = useMemo(
    () => ({
      status: active.status ?? [],
      disciplineId: active.disciplineId ?? [],
      priority: active.priority ?? [],
      assigneeId: active.assigneeId ?? [],
    }),
    [active],
  );

  const tasks = useProjectMainTasks(project.id, filters);
  const rows = sortTasks(tasks.data ?? [], sort);

  const dimensions: FilterDimension[] = [
    {
      key: "status",
      label: "Status",
      single: true,
      options: [
        { value: "NOT_STARTED", label: "Not started" },
        { value: "IN_PROGRESS", label: "In progress" },
        { value: "BLOCKED", label: "Blocked" },
        { value: "AWAITING_REVIEW", label: "Awaiting review" },
        { value: "COMPLETED", label: "Completed" },
      ],
    },
    {
      key: "disciplineId",
      label: "Discipline",
      single: true,
      options: project.disciplines.map((discipline) => ({
        value: discipline.disciplineId,
        label: discipline.name,
        adornment: <DisciplineDot colorHex={discipline.colorHex} code={discipline.code} />,
      })),
    },
    {
      key: "priority",
      label: "Priority",
      single: true,
      options: [
        { value: "LOW", label: "Low" },
        { value: "MEDIUM", label: "Medium" },
        { value: "HIGH", label: "High" },
        { value: "CRITICAL", label: "Critical" },
      ],
    },
    {
      key: "assigneeId",
      label: "Assignee",
      single: true,
      options: project.members.map((member) => ({
        value: member.userId,
        label: member.userName,
      })),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <FilterChips filters={dimensions} active={active} onChange={setActive} />
        <div className="flex items-center gap-2">
          <label htmlFor="project-task-sort" className="text-xs text-[var(--olng-text)]">
            Sort by
          </label>
          <Select
            id="project-task-sort"
            value={sort}
            onChange={(event) => setSort(event.target.value as SortKey)}
            className="w-40"
          >
            <option value="deadline">Deadline</option>
            <option value="priority">Priority</option>
            <option value="status">Status</option>
            <option value="title">Title</option>
          </Select>
          {canManage ? <Button onClick={() => setDialogOpen(true)}>+ New main task</Button> : null}
        </div>
      </div>

      {tasks.isError ? (
        <ErrorBanner
          message="Couldn't load tasks. Try refreshing the page."
          onRetry={() => void tasks.refetch()}
        />
      ) : tasks.isPending ? (
        <SkeletonRows rows={8} />
      ) : rows.length === 0 && hasActiveFilters(active) ? (
        <div className="py-8 text-center text-sm text-[var(--olng-text)]">
          <p>No tasks match your filters.</p>
          <button
            type="button"
            onClick={() => setActive({})}
            className="mt-1 font-semibold text-[var(--olng-blue)] underline underline-offset-2"
          >
            Clear filters
          </button>
        </div>
      ) : rows.length === 0 ? (
        canManage ? (
          <EmptyState
            message="No main tasks yet. Break this project down into tasks to get the team moving."
            action={<Button onClick={() => setDialogOpen(true)}>+ New main task</Button>}
          />
        ) : (
          <EmptyState message="No main tasks yet. Check back once your project manager sets up the work." />
        )
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--border)] bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--olng-gray)]">
              <tr>
                <th className="px-3 py-2 font-semibold">Title</th>
                <th className="px-3 py-2 font-semibold">Disciplines</th>
                <th className="w-40 px-3 py-2 font-semibold">Progress</th>
                <th className="px-3 py-2 font-semibold">Deadline</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Priority</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {rows.map((task) => {
                const soon = !task.isOverdue && isDueSoon(task.deadline);
                return (
                  <tr key={task.id} className="h-11 hover:bg-[var(--page-bg)]">
                    <td className="px-3">
                      <Link
                        href={`/tasks/${task.id}`}
                        className="font-semibold text-[var(--olng-blue)] hover:underline"
                      >
                        {task.title}
                      </Link>
                    </td>
                    <td className="px-3">
                      <span className="inline-flex items-center gap-1">
                        {task.disciplineSummary.slice(0, 4).map((item) => (
                          <DisciplineDot
                            key={item.disciplineId}
                            colorHex={item.colorHex}
                            code={item.code}
                          />
                        ))}
                        {task.disciplineSummary.length > 4 ? (
                          <span className="text-xs text-[var(--olng-gray)]">
                            +{task.disciplineSummary.length - 4}
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className="px-3">
                      <ProgressBar
                        pct={task.progressPct}
                        completed={task.counts.completed}
                        total={task.counts.disciplineTasks}
                        showCount
                      />
                    </td>
                    <td
                      className="px-3"
                      style={{
                        color: task.isOverdue
                          ? "var(--status-blocked)"
                          : soon
                            ? "var(--olng-sand)"
                            : "var(--olng-text)",
                      }}
                    >
                      {formatDate(task.deadline)}
                    </td>
                    <td className="px-3">
                      <StatusBadge status={task.effectiveStatus} overridden={task.hasOverride} />
                    </td>
                    <td className="px-3">
                      <PriorityFlag priority={task.priority} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {canManage ? (
        <NewMainTaskDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          project={project}
        />
      ) : null}
    </div>
  );
}
