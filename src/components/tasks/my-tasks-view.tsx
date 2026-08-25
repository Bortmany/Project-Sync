// My tasks — everything assigned to the signed-in person: grouped by when things are due or by
// status, as a list or as a read-only timeline. The view lives in the address bar (?group=, ?view=,
// ?due=), so the sidebar's drop-down links land straight on the view they promise and a link to
// "my overdue work" can be shared.

"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { MyTaskGroups, MyTaskList, type MyTask } from "@/components/tasks/my-task-rows";
import { MyTasksTimeline } from "@/components/gantt/timeline-tab";
import { useMyTasks } from "@/components/hooks/use-api";
import { ChevronDownIcon } from "@/components/shell/icons";
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
  statusLabel,
  type ActiveFilters,
  type FilterDimension,
} from "@/components/ui";
import type { TaskStatusName } from "@/lib/zod-schemas";

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

/** What needs attention first reads down the page: trouble, then work in flight, then the rest. */
const STATUS_ORDER: TaskStatusName[] = [
  "BLOCKED",
  "IN_PROGRESS",
  "AWAITING_REVIEW",
  "NOT_STARTED",
  "COMPLETED",
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

/** The same address with a few things changed — null removes a value. Keeps everything else. */
function withParams(current: URLSearchParams, changes: Record<string, string | null>): string {
  const next = new URLSearchParams(current.toString());
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) next.delete(key);
    else next.set(key, value);
  }
  const query = next.toString();
  return query ? `/my-tasks?${query}` : "/my-tasks";
}

/** A small row of linked choices — one of them is where you are. */
function SegmentedLinks({
  label,
  options,
}: {
  label: string;
  options: { href: string; label: string; active: boolean }[];
}) {
  return (
    <div
      aria-label={label}
      className="inline-flex overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-white"
    >
      {options.map((option) => (
        <Link
          key={option.label}
          href={option.href}
          aria-current={option.active ? "page" : undefined}
          className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
            option.active
              ? "bg-[var(--olng-blue)] text-white"
              : "text-[var(--olng-text)] hover:bg-[var(--page-bg)]"
          }`}
        >
          {option.label}
        </Link>
      ))}
    </div>
  );
}

export function MyTasksView() {
  const params = useSearchParams();
  const myTasks = useMyTasks();
  const [sort, setSort] = useState<SortKey>("deadline");
  const [grouped, setGrouped] = useState(true);
  const [showCompleted, setShowCompleted] = useState(false);
  const [filters, setFilters] = useState<ActiveFilters>(() => ({
    status: params.getAll("status"),
    priority: params.getAll("priority"),
    discipline: params.getAll("discipline"),
    due: params.getAll("due"),
  }));

  const view = params.get("view") === "timeline" ? "timeline" : "list";
  const groupBy = params.get("group") === "status" ? "status" : "due";
  const dueParam = params.getAll("due").join(",");

  // The sidebar's "Due today" / "Overdue" links change the address while this screen stays mounted,
  // so the due filter follows the address rather than only being read once when the page opens.
  useEffect(() => {
    const due = dueParam ? dueParam.split(",") : [];
    setFilters((current) =>
      (current.due ?? []).join(",") === dueParam ? current : { ...current, due },
    );
  }, [dueParam]);

  const tasks = useMemo(() => myTasks.data?.tasks ?? [], [myTasks.data]);
  const totals = myTasks.data?.totals;

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

  /** Status mode shows every loaded task under its own heading, newest deadline first. */
  const byStatus = useMemo(() => {
    const groups = new Map<TaskStatusName, MyTask[]>();
    for (const status of STATUS_ORDER) groups.set(status, []);
    for (const task of sortTasks(tasks, "deadline")) {
      groups.get(task.status as TaskStatusName)?.push(task);
    }
    return groups;
  }, [tasks]);

  function clearFilters() {
    setFilters({ status: [], priority: [], discipline: [], due: [] });
  }

  const viewSwitcher = (
    <SegmentedLinks
      label="View"
      options={[
        { href: withParams(params, { view: null }), label: "List", active: view === "list" },
        {
          href: withParams(params, { view: "timeline" }),
          label: "Timeline",
          active: view === "timeline",
        },
      ]}
    />
  );

  if (view === "timeline") {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {viewSwitcher}
          <p className="text-xs text-[var(--olng-gray)]">
            Your own work, on one schedule. Dates are changed on the task itself.
          </p>
        </div>
        <MyTasksTimeline />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {viewSwitcher}
          <SegmentedLinks
            label="Group by"
            options={[
              {
                href: withParams(params, { group: null }),
                label: "Due date",
                active: groupBy === "due",
              },
              {
                href: withParams(params, { group: "status", due: null }),
                label: "Status",
                active: groupBy === "status",
              },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {groupBy === "due" ? (
            <>
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
            </>
          ) : null}
        </div>
      </div>

      {/* Filters belong to the due-date view: in status mode the headings carry the true counts
          from the server, and a filter would make those counts a lie. */}
      {groupBy === "due" ? (
        <FilterChips filters={dimensions} active={filters} onChange={setFilters} />
      ) : null}

      {myTasks.isError ? (
        <ErrorBanner
          message="Couldn't load your tasks. Try refreshing the page."
          onRetry={() => void myTasks.refetch()}
        />
      ) : myTasks.isPending ? (
        <SkeletonRows rows={8} />
      ) : tasks.length === 0 ? (
        <EmptyState message="No tasks assigned to you right now. When you're added to a discipline task, it'll show up here." />
      ) : groupBy === "status" ? (
        <div className="space-y-4">
          {STATUS_ORDER.map((status) => {
            const rows = byStatus.get(status) ?? [];
            const count = totals?.[status] ?? rows.length;
            if (count === 0) return null;
            const isCompleted = status === "COMPLETED";
            const open = !isCompleted || showCompleted;

            return (
              <section key={status}>
                <h3 className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--olng-gray)]">
                  {isCompleted ? (
                    <button
                      type="button"
                      onClick={() => setShowCompleted((value) => !value)}
                      aria-expanded={open}
                      aria-controls="my-tasks-completed"
                      className="flex items-center gap-1 uppercase tracking-wide text-[var(--olng-gray)] hover:text-[var(--olng-blue)]"
                    >
                      <span className={`transition-transform ${open ? "" : "-rotate-90"}`}>
                        <ChevronDownIcon size={14} />
                      </span>
                      {statusLabel(status)} ({count})
                    </button>
                  ) : (
                    <span>
                      {statusLabel(status)} ({count})
                    </span>
                  )}
                </h3>
                {open ? (
                  <div id={isCompleted ? "my-tasks-completed" : undefined}>
                    <MyTaskList tasks={rows} rich />
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
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

      {myTasks.data?.truncated ? (
        <p className="text-xs text-[var(--olng-gray)]">
          Showing your next 200 open tasks and your 50 most recently finished ones. The counts above
          cover all of your work.
        </p>
      ) : null}

      {groupBy === "due" && hasActiveFilters(filters) && visible.length > 0 ? (
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
