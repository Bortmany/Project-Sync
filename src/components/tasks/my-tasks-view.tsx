// My tasks — the full personal list, grouped by when things are due, with filters and a sort.

"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MyTaskGroups, type MyTask } from "@/components/tasks/my-task-rows";
import { useDashboard } from "@/components/hooks/use-api";
import { dueBucket, formatDate } from "@/components/format";
import {
  Button,
  DisciplineDot,
  EmptyState,
  ErrorBanner,
  FilterChips,
  PriorityFlag,
  Select,
  SkeletonRows,
  StatusBadge,
  hasActiveFilters,
  type ActiveFilters,
  type FilterDimension,
} from "@/components/ui";
import Link from "next/link";

const STATUS_OPTIONS = [
  { value: "NOT_STARTED", label: "Not started" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "BLOCKED", label: "Blocked" },
  { value: "AWAITING_REVIEW", label: "Awaiting review" },
  { value: "COMPLETED", label: "Completed" },
];

const PRIORITY_OPTIONS = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
  { value: "CRITICAL", label: "Critical" },
];

const DUE_OPTIONS = [
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "later", label: "Later" },
];

type SortKey = "deadline" | "priority" | "status" | "project";

const PRIORITY_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

function sortTasks(tasks: MyTask[], sort: SortKey): MyTask[] {
  const copy = [...tasks];
  if (sort === "priority") {
    copy.sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9));
  } else if (sort === "status") {
    copy.sort((a, b) => a.status.localeCompare(b.status));
  } else if (sort === "project") {
    copy.sort((a, b) => a.projectCode.localeCompare(b.projectCode));
  } else {
    copy.sort((a, b) => a.deadline.getTime() - b.deadline.getTime());
  }
  return copy;
}

export function MyTasksView() {
  const params = useSearchParams();
  const dashboard = useDashboard();
  const [sort, setSort] = useState<SortKey>("deadline");
  const [grouped, setGrouped] = useState(true);
  const [filters, setFilters] = useState<ActiveFilters>(() => ({
    status: params.getAll("status"),
    priority: params.getAll("priority"),
    discipline: params.getAll("discipline"),
    due: params.getAll("due"),
  }));

  const tasks = useMemo(() => dashboard.data?.myTasks ?? [], [dashboard.data]);

  const disciplineOptions = useMemo(() => {
    const seen = new Map<string, { value: string; label: string }>();
    for (const task of tasks) {
      if (!seen.has(task.disciplineCode)) {
        seen.set(task.disciplineCode, { value: task.disciplineCode, label: task.disciplineCode });
      }
    }
    return [...seen.values()];
  }, [tasks]);

  const dimensions: FilterDimension[] = [
    { key: "status", label: "Status", options: STATUS_OPTIONS },
    { key: "priority", label: "Priority", options: PRIORITY_OPTIONS },
    { key: "discipline", label: "Discipline", options: disciplineOptions },
    { key: "due", label: "Due", options: DUE_OPTIONS },
  ];

  const visible = useMemo(() => {
    const filtered = tasks.filter((task) => {
      const status = filters.status ?? [];
      const priority = filters.priority ?? [];
      const discipline = filters.discipline ?? [];
      const due = filters.due ?? [];
      if (status.length > 0 && !status.includes(task.status)) return false;
      if (priority.length > 0 && !priority.includes(task.priority)) return false;
      if (discipline.length > 0 && !discipline.includes(task.disciplineCode)) return false;
      if (due.length > 0 && !due.includes(dueBucket(task.deadline, task.isOverdue))) return false;
      return true;
    });
    return sortTasks(filtered, sort);
  }, [tasks, filters, sort]);

  function clearFilters() {
    setFilters({ status: [], priority: [], discipline: [], due: [] });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterChips filters={dimensions} active={filters} onChange={setFilters} />
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-[var(--olng-text)]" htmlFor="my-tasks-sort">
            Sort by
          </label>
          <Select
            id="my-tasks-sort"
            value={sort}
            onChange={(event) => setSort(event.target.value as SortKey)}
            className="w-40"
          >
            <option value="deadline">Deadline</option>
            <option value="priority">Priority</option>
            <option value="status">Status</option>
            <option value="project">Project</option>
          </Select>
          <Button variant="secondary" onClick={() => setGrouped((value) => !value)}>
            {grouped ? "Flat list" : "Grouped"}
          </Button>
        </div>
      </div>

      {dashboard.isError ? (
        <ErrorBanner
          message="Couldn't load your tasks. Try refreshing the page."
          onRetry={() => void dashboard.refetch()}
        />
      ) : dashboard.isPending ? (
        <SkeletonRows rows={8} />
      ) : tasks.length === 0 ? (
        <EmptyState message="No tasks assigned to you right now. When you're added to a discipline task, it'll show up here." />
      ) : visible.length === 0 ? (
        <div className="py-8 text-center text-sm text-[var(--olng-text)]">
          <p>No tasks match your filters.</p>
          <button
            type="button"
            onClick={clearFilters}
            className="mt-1 font-semibold text-[var(--olng-blue)] underline underline-offset-2"
          >
            Clear filters
          </button>
        </div>
      ) : grouped ? (
        <MyTaskGroups tasks={visible} rich />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--border)] bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--olng-gray)]">
              <tr>
                <th className="px-3 py-2 font-semibold">Title</th>
                <th className="px-3 py-2 font-semibold">Project</th>
                <th className="px-3 py-2 font-semibold">Discipline</th>
                <th className="px-3 py-2 font-semibold">Deadline</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Priority</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {visible.map((task) => (
                <tr key={task.id} className="h-11 hover:bg-[var(--page-bg)]">
                  <td className="px-3">
                    <Link
                      href={`/discipline-tasks/${task.id}`}
                      className="font-semibold text-[var(--olng-blue)] hover:underline"
                    >
                      {task.title}
                    </Link>
                  </td>
                  <td className="px-3 text-[var(--olng-text)]">{task.projectCode}</td>
                  <td className="px-3">
                    <DisciplineDot
                      colorHex={task.disciplineColorHex}
                      code={task.disciplineCode}
                      showCode
                    />
                  </td>
                  <td
                    className="px-3"
                    style={{ color: task.isOverdue ? "var(--status-blocked)" : "var(--olng-text)" }}
                  >
                    {formatDate(task.deadline)}
                  </td>
                  <td className="px-3">
                    <StatusBadge status={task.status} />
                  </td>
                  <td className="px-3">
                    <PriorityFlag priority={task.priority} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hasActiveFilters(filters) && visible.length > 0 ? (
        <button
          type="button"
          onClick={clearFilters}
          className="text-xs font-semibold text-[var(--olng-blue)] underline underline-offset-2"
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );
}
