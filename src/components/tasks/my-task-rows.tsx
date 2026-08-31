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
      className="w-32 shrink-0 py-1 text-xs sm:w-36"
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
              // The My tasks screen reads its own route, so it needs telling as well.
              void queryClient.invalidateQueries({ queryKey: ["my-tasks"] });
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

/**
 * One task row. On a phone the title takes the whole first line and the rest — status, priority,
 * discipline, project and the date — wraps underneath, so nothing is pushed off the screen.
 */
function TaskRow({ task, rich }: { task: MyTask; rich: boolean }) {
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius)] px-2 py-2 hover:bg-[var(--page-bg)]">
      {rich ? <QuickStatus task={task} /> : <StatusBadge status={task.status} />}
      <Link
        href={`/discipline-tasks/${task.id}`}
        className="order-first w-full min-w-0 truncate text-sm font-semibold text-[var(--brand-ink)] hover:underline sm:order-none sm:w-auto sm:flex-1"
      >
        {task.title}
      </Link>
      {rich ? <PriorityFlag priority={task.priority} /> : null}
      <DisciplineDot colorHex={task.disciplineColorHex} code={task.disciplineCode} showCode={rich} />
      <span className="rounded-full bg-[var(--page-bg)] px-2 py-0.5 text-xs text-[var(--brand-text)]">
        {task.projectCode}
      </span>
      <span
        className="ml-auto shrink-0 text-right text-xs sm:ml-0 sm:w-24"
        style={{ color: task.isOverdue ? "var(--status-blocked)" : "var(--brand-text)" }}
      >
        {formatDate(task.deadline)}
      </span>
    </div>
  );
}

/** A plain run of task rows, divided by a hairline — the body of every group on this screen. */
export function MyTaskList({ tasks, rich = false }: { tasks: MyTask[]; rich?: boolean }) {
  return (
    <div className="divide-y divide-[var(--border)]">
      {tasks.map((task) => (
        <TaskRow key={task.id} task={task} rich={rich} />
      ))}
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
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--brand-gray)]">
              {DUE_BUCKET_LABEL[bucket]} ({buckets[bucket].length})
            </h3>
            <MyTaskList tasks={buckets[bucket]} rich={rich} />
          </section>
        ),
      )}
    </div>
  );
}
