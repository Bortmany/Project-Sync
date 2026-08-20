// The personal task list, grouped Overdue / Today / This week / Later.
// Used twice: the compact dashboard card and the fuller My tasks page.

"use client";

import Link from "next/link";
import type { DashboardDTO } from "@/lib/zod-schemas";
import { DisciplineDot, PriorityFlag, StatusBadge } from "@/components/ui";
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

function TaskRow({ task, rich }: { task: MyTask; rich: boolean }) {
  return (
    <Link
      href={`/discipline-tasks/${task.id}`}
      className="flex min-h-11 items-center gap-3 rounded-[var(--radius)] px-2 py-2 hover:bg-[var(--page-bg)]"
    >
      <StatusBadge status={task.status} />
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--olng-navy)]">
        {task.title}
      </span>
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
    </Link>
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
