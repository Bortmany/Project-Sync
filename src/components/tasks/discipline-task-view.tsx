// Discipline-task page — the engineer's workspace: what's required, what's blocking, and the one
// dominant "Mark complete" action.

"use client";

import Link from "next/link";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  completeDisciplineTask,
  reopenDisciplineTask,
  updateDisciplineTask,
  updateDisciplineTaskStatus,
} from "@/components/actions";
import { DisciplineTaskActivity } from "@/components/activity/activity-feeds";
import { DisciplineTaskComments } from "@/components/comments/comment-list";
import { useAction } from "@/components/hooks/use-action";
import { isLeadOrAbove, useDisciplineTask, useMe, useProject } from "@/components/hooks/use-api";
import { formatDate } from "@/components/format";
import {
  Avatar,
  Breadcrumb,
  Button,
  Card,
  ErrorBanner,
  Field,
  Modal,
  PriorityFlag,
  Select,
  Skeleton,
  SkeletonRows,
  StatusBadge,
  Tabs,
  Textarea,
} from "@/components/ui";
import type { TaskStatusName } from "@/lib/zod-schemas";

const UPLOAD_TOOLTIP = "Document upload arrives in the next milestone";

export function DisciplineTaskView({ taskId }: { taskId: string }) {
  const me = useMe();
  const task = useDisciplineTask(taskId);
  const project = useProject(task.data?.projectId ?? "");
  const queryClient = useQueryClient();
  const { run, pending } = useAction();
  const [blockOpen, setBlockOpen] = useState(false);
  const [blockNote, setBlockNote] = useState("");
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["discipline-task", taskId] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    if (task.data) {
      void queryClient.invalidateQueries({ queryKey: ["task", task.data.mainTaskId] });
      void queryClient.invalidateQueries({ queryKey: ["project", task.data.projectId] });
    }
  }

  if (task.isError) {
    return (
      <ErrorBanner
        message="Couldn't load this task. Try refreshing the page."
        onRetry={() => void task.refetch()}
      />
    );
  }

  if (task.isPending || !task.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-3 w-64" />
        <Skeleton className="h-7 w-96" />
        <SkeletonRows rows={4} height="h-16" />
      </div>
    );
  }

  const data = task.data;
  const canControl = isLeadOrAbove(me.data) || me.data?.id === data.assigneeId;
  const canReassign = isLeadOrAbove(me.data);
  const teammates = (project.data?.members ?? []).filter(
    (member) => member.disciplineId === data.disciplineId,
  );
  const mentionable = (project.data?.members ?? []).map((member) => ({
    userId: member.userId,
    userName: member.userName,
  }));

  function setStatus(status: TaskStatusName, note?: string) {
    run(() => updateDisciplineTaskStatus({ id: data.id, status, note }), {
      success:
        status === "BLOCKED"
          ? "Marked as blocked."
          : status === "IN_PROGRESS"
            ? "Marked as in progress."
            : status === "AWAITING_REVIEW"
              ? "Marked ready for review."
              : "Status updated.",
      failure: "Couldn't update the status. Try again.",
      onSuccess: refresh,
    });
  }

  return (
    <div className="space-y-5">
      <Breadcrumb
        items={[
          { label: "Projects", href: "/projects" },
          { label: project.data?.name ?? data.projectCode, href: `/projects/${data.projectId}` },
          { label: data.mainTaskTitle, href: `/tasks/${data.mainTaskId}` },
          { label: data.disciplineName },
        ]}
      />

      <header className="space-y-2">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--olng-gray)]">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: data.disciplineColorHex }}
            aria-hidden="true"
          />
          {data.disciplineName}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-[var(--olng-blue)]">{data.title}</h1>
          <StatusBadge status={data.status} />
          <PriorityFlag priority={data.priority} />
          {data.isMandatory ? (
            <span className="rounded-full bg-[var(--page-bg)] px-2 py-0.5 text-xs text-[var(--olng-text)]">
              Mandatory
            </span>
          ) : null}
        </div>
        <p
          className="text-sm"
          style={{ color: data.isOverdue ? "var(--status-blocked)" : "var(--olng-text)" }}
        >
          Deadline {formatDate(data.deadline)}
          {data.isOverdue ? " — overdue" : ""}
        </p>
        <p className="text-sm">
          Part of:{" "}
          <Link
            href={`/tasks/${data.mainTaskId}`}
            className="font-semibold text-[var(--olng-blue)] hover:underline"
          >
            {data.mainTaskTitle} →
          </Link>
        </p>
      </header>

      {canControl ? (
        <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-white p-3">
          <StatusBadge status={data.status} />
          <label className="text-xs text-[var(--olng-text)]" htmlFor="discipline-status">
            Change status
          </label>
          <Select
            id="discipline-status"
            className="w-52"
            value={data.status}
            disabled={pending}
            onChange={(event) => {
              const next = event.target.value as TaskStatusName;
              if (next === "BLOCKED") {
                setBlockOpen(true);
                return;
              }
              setStatus(next);
            }}
          >
            <option value="NOT_STARTED">Not started</option>
            <option value="IN_PROGRESS">In progress</option>
            <option value="BLOCKED">Blocked</option>
            <option value="AWAITING_REVIEW">Awaiting review</option>
            {data.status === "COMPLETED" ? <option value="COMPLETED">Completed</option> : null}
          </Select>
          {data.status === "COMPLETED" ? (
            <Button variant="secondary" onClick={() => setReopenOpen(true)} disabled={pending}>
              Reopen
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className="max-w-3xl space-y-5">
          <Card title="What's required">
            <p className="text-sm text-[var(--olng-text)]">
              {data.description?.trim()
                ? data.description
                : "No description was added for this discipline task."}
            </p>

            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--olng-gray)]">
                  Required documents
                </h3>
                <Button variant="secondary" disabled title={UPLOAD_TOOLTIP}>
                  Upload
                </Button>
              </div>
              {data.requiredDocuments.length === 0 ? (
                <p className="text-sm text-[var(--olng-gray)]">
                  No required documents for this discipline task.
                </p>
              ) : (
                <ul className="divide-y divide-[var(--border)]">
                  {data.requiredDocuments.map((document) => (
                    <li key={document.id} className="flex items-center gap-2 py-2 text-sm">
                      <span
                        aria-hidden="true"
                        style={{
                          color: document.isSatisfied
                            ? "var(--status-completed)"
                            : "var(--status-blocked)",
                        }}
                      >
                        {document.isSatisfied ? "✓" : "✕"}
                      </span>
                      <span className="flex-1 text-[var(--olng-navy)]">{document.name}</span>
                      {document.isMandatory ? (
                        <span className="text-xs text-[var(--olng-gray)]">Mandatory</span>
                      ) : null}
                      <span className="text-xs text-[var(--olng-text)]">
                        {document.isSatisfied
                          ? `Uploaded ${formatDate(document.satisfiedAt)}`
                          : "Not uploaded"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          <Card title="Depends on">
            {data.dependencies.length === 0 ? (
              <p className="text-sm text-[var(--olng-gray)]">
                Nothing else has to finish before this task.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {data.dependencies.map((dependency) => (
                  <li key={dependency.id} className="flex items-center gap-3 py-2 text-sm">
                    <Link
                      href={`/discipline-tasks/${dependency.id}`}
                      className="flex-1 text-[var(--olng-blue)] hover:underline"
                    >
                      {dependency.title}
                    </Link>
                    <span className="text-xs text-[var(--olng-gray)]">
                      {dependency.disciplineCode}
                    </span>
                    <StatusBadge status={dependency.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Tabs
            items={[
              {
                id: "comments",
                label: "Comments",
                content: (
                  <DisciplineTaskComments
                    disciplineTaskId={data.id}
                    mainTaskId={data.mainTaskId}
                    projectId={data.projectId}
                    members={mentionable}
                  />
                ),
              },
              {
                id: "documents",
                label: "Documents",
                content: (
                  <p className="py-6 text-center text-sm text-[var(--olng-text)]">
                    Coming in a later milestone.
                  </p>
                ),
              },
              {
                id: "activity",
                label: "Activity",
                content: <DisciplineTaskActivity disciplineTaskId={data.id} />,
              },
            ]}
          />

          {canControl && data.status !== "COMPLETED" ? (
            <div className="space-y-2">
              <Button
                className="min-h-11 w-full"
                loading={pending}
                disabled={!data.canComplete || pending}
                onClick={() =>
                  run(() => completeDisciplineTask({ id: data.id }), {
                    success: "Marked complete.",
                    failure: "Couldn't mark this complete. Try again.",
                    onSuccess: refresh,
                  })
                }
              >
                Mark complete
              </Button>
              {!data.canComplete ? (
                <p className="text-sm text-[var(--olng-text)]">
                  You can&apos;t mark this complete yet: {data.blockers.join(", ")}.
                </p>
              ) : null}
            </div>
          ) : null}

          {data.status === "COMPLETED" ? (
            <p className="text-sm text-[var(--status-completed)]">
              Completed{data.completedByName ? ` by ${data.completedByName}` : ""}
              {data.completedAt ? ` on ${formatDate(data.completedAt)}` : ""}.
            </p>
          ) : null}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <Card title="Details">
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-[var(--olng-gray)]">Assignee</dt>
                <dd className="mt-1">
                  {canReassign ? (
                    <Select
                      aria-label="Reassign this task"
                      value={data.assigneeId ?? ""}
                      disabled={pending}
                      onChange={(event) =>
                        run(
                          () =>
                            updateDisciplineTask({
                              id: data.id,
                              assigneeId: event.target.value || null,
                            }),
                          {
                            success: "Task reassigned.",
                            failure: "Couldn't reassign this task. Try again.",
                            onSuccess: refresh,
                          },
                        )
                      }
                    >
                      <option value="">No one yet</option>
                      {teammates.map((member) => (
                        <option key={member.userId} value={member.userId}>
                          {member.userName}
                        </option>
                      ))}
                    </Select>
                  ) : data.assigneeName ? (
                    <span className="flex items-center gap-2 text-[var(--olng-navy)]">
                      <Avatar name={data.assigneeName} size={24} />
                      {data.assigneeName}
                    </span>
                  ) : (
                    <span className="text-[var(--olng-gray)]">No one yet</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--olng-gray)]">Dates</dt>
                <dd className="mt-1">
                  {formatDate(data.startDate)} — {formatDate(data.deadline)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--olng-gray)]">Priority</dt>
                <dd className="mt-1">
                  <PriorityFlag priority={data.priority} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--olng-gray)]">Must be done</dt>
                <dd className="mt-1">
                  {data.isMandatory
                    ? "Yes — the main task waits on it"
                    : "No — the main task can finish without it"}
                </dd>
              </div>
              {data.completedAt ? (
                <div>
                  <dt className="text-xs text-[var(--olng-gray)]">Completed</dt>
                  <dd className="mt-1">
                    {data.completedByName ?? "Someone"} · {formatDate(data.completedAt)}
                  </dd>
                </div>
              ) : null}
            </dl>
          </Card>
        </aside>
      </div>

      <Modal
        open={blockOpen}
        size="sm"
        title="Mark as blocked"
        onClose={() => setBlockOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setBlockOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={pending}
              disabled={blockNote.trim().length === 0}
              onClick={() => {
                setStatus("BLOCKED", blockNote.trim());
                setBlockNote("");
                setBlockOpen(false);
              }}
            >
              Mark as blocked
            </Button>
          </>
        }
      >
        <Field label="What's blocking this task?">
          <Textarea
            value={blockNote}
            placeholder="e.g. Waiting on vendor drawing revision."
            onChange={(event) => setBlockNote(event.target.value)}
          />
        </Field>
      </Modal>

      <Modal
        open={reopenOpen}
        size="sm"
        title="Reopen this task"
        onClose={() => setReopenOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setReopenOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={pending}
              disabled={reopenReason.trim().length < 5}
              onClick={() =>
                run(() => reopenDisciplineTask({ id: data.id, reason: reopenReason.trim() }), {
                  success: "Task reopened.",
                  failure: "Couldn't reopen this task. Try again.",
                  onSuccess: () => {
                    refresh();
                    setReopenReason("");
                    setReopenOpen(false);
                  },
                })
              }
            >
              Reopen task
            </Button>
          </>
        }
      >
        <Field label="Why is this being reopened?" hint="At least five characters, for the record.">
          <Textarea
            value={reopenReason}
            onChange={(event) => setReopenReason(event.target.value)}
          />
        </Field>
      </Modal>
    </div>
  );
}
