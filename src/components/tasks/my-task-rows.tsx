// The personal task list, grouped Overdue / Today / This week / Later.
// Used twice: the compact dashboard card and the fuller My tasks page.

"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { updateDisciplineTaskStatus } from "@/components/actions";
import { useAction } from "@/components/hooks/use-action";
import type { DashboardDTO, TaskStatusName } from "@/lib/zod-schemas";
import { DisciplineDot, PriorityFlag, Select, StatusBadge, statusLabel } from "@/components/ui";
import {
  DUE_BUCKET_LABEL,
  DUE_BUCKET_ORDER,
  dueBucket,
  formatDate,
  type DueBucket,
} from "@/components/format";

export type MyTask = DashboardDTO["myTasks"][number];

function group(tasks: MyTask[]): Record<DueBucket, MyTask[]> {
  const buckets: Record<DueBucket, MyTask[]> = { overdue: [], today: [], week: [], later: [] };
  for (const task of tasks) buckets[dueBucket(task.deadline, task.isOverdue)].push(task);
  for (const bucket of DUE_BUCKET_ORDER) {
    buckets[bucket].sort((a, b) => a.deadline.getTime() - b.deadline.getTime());
  }
  return buckets;
}

const QUICK_STATUSES: TaskStatusName[] = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "BLOCKED",
  "AWAITING_REVIEW",
  "COMPLETED",
];

/**
 * Change a task's status without leaving the list. The server still decides — a completion that
 * skips a mandatory document or an open dependency comes back refused, in its own words.
 */
function QuickStatus({ task }: { task: MyTask }) {
  const queryClient = useQueryClient();
  const { run, pending } = useAction();

  return (
    <Select
      aria-label={`Status of ${task.title}`}
      value={task.status}
      disabled={pending}
      className="w-36 shrink-0 py-1 text-xs"
      onChange={(event) =>
        run(
          () =>
            updateDisciplineTaskStatus({
              id: task.id,
              status: event.target.value as TaskStatusName,
            }),
          {
            success: "Status updated.",
            failure: "Couldn't update this task. Try again.",
            onSuccess: () => {
              void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
              void queryClient.invalidateQueries({ queryKey: ["discipline-task", task.id] });
              void queryClient.invalidateQueries({ queryKey: ["task", task.mainTaskId] });
            },
          },
        )
      }
    >
      {QUICK_STATUSES.map((status) => (
        <option key={status} value={status}>
          {statusLabel(status)}
        </option>
      ))}
    </Select>
  );
}

function TaskRow({ task, rich }: { task: MyTask; rich: boolean }) {
  return (
    <div className="flex min-h-11 items-center gap-3 rounded-[var(--radius)] px-2 py-2 hover:bg-[var(--page-bg)]">
      {rich ? <QuickStatus task={task} /> : <StatusBadge status={task.status} />}
      <Link
        href={`/discipline-tasks/${task.id}`}
        className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--olng-navy)] hover:underline"
      >
        {task.title}
      </Link>
      {rich ? <PriorityFlag priority={task.priority} /> : null}
      <DisciplineDot colorHex={task.disciplineColorHex} code={task.disciplineCode} showCode={rich} />
      <span className="rounded-full bg-[var(--page-bg)] px-2 py-0.5 text-xs text-[var(--olng-text)]">
        {task.projectCode}
      </span>
      <span
        className="w-24 shrink-0 text-right text-xs"
        style={{ color: task.isOverdue ? "var(--status-blocked)" : "var(--olng-text)" }}
      >
        {formatDate(task.deadline)}
      </span>
    </div>
  );
}

export function MyTaskGroups({ tasks, rich = false }: { tasks: MyTask[]; rich?: boolean }) {
  const buckets = group(tasks);

  return (
    <div className="space-y-4">
      {DUE_BUCKET_ORDER.map((bucket) =>
        buckets[bucket].length === 0 ? null : (
          <section key={bucket}>
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--olng-gray)]">
              {DUE_BUCKET_LABEL[bucket]} ({buckets[bucket].length})
            </h3>
            <div className="divide-y divide-[var(--border)]">
              {buckets[bucket].map((task) => (
                <TaskRow key={task.id} task={task} rich={rich} />
              ))}
            </div>
          </section>
        ),
      )}
    </div>
  );
}
