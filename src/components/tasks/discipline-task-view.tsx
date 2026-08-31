// Discipline-task page — the engineer's workspace: what's required, what's blocking, and the one
// dominant "Mark complete" action.

"use client";

import Link from "next/link";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  completeDisciplineTask,
  confirmDisciplineTaskReview,
  rejectDisciplineTaskReview,
  reopenDisciplineTask,
  updateDisciplineTask,
  updateDisciplineTaskStatus,
} from "@/components/actions";
import { DisciplineTaskActivity } from "@/components/activity/activity-feeds";
import { DisciplineTaskComments } from "@/components/comments/comment-list";
import { DisciplineTaskDocuments } from "@/components/documents/discipline-task-documents";
import { RequiredDocsChecklist } from "@/components/documents/required-docs-checklist";
import { useAction } from "@/components/hooks/use-action";
import {
  isExternalUser,
  isLeadOrAboveOn,
  isManagerOn,
  useDisciplineTask,
  useMe,
  useProject,
} from "@/components/hooks/use-api";
import { FavoriteStar } from "@/components/shell/favorite-star";
import { formatDate } from "@/components/format";
import {
  Avatar,
  Breadcrumb,
  Button,
  Card,
  CompanyBadge,
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
import {
  completeButtonFor,
  statusChoicesFor,
  submitsForSignoff,
  type TaskActionContext,
} from "@/lib/task-actions";
import type { RequiredDocumentDTO, TaskStatusName } from "@/lib/zod-schemas";

const STATUS_LABEL: Record<TaskStatusName, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  AWAITING_REVIEW: "Awaiting review",
  COMPLETED: "Completed",
};

/**
 * The one-line count on the "What's required" card. Mandatory documents lead, because they are what
 * the completion gate waits for; optional ones follow in muted text so they never look like a
 * blocker. Nothing is shown when the task has no checklist at all.
 */
function RequiredDocsCount({ documents }: { documents: RequiredDocumentDTO[] }) {
  if (documents.length === 0) return null;

  const mandatory = documents.filter((document) => document.isMandatory);
  const optional = documents.filter((document) => !document.isMandatory);
  const optionalDone = optional.filter((document) => document.isSatisfied).length;

  if (mandatory.length === 0) {
    return (
      <span className="text-xs text-[var(--brand-gray)]">
        {optionalDone} of {optional.length} optional
      </span>
    );
  }

  const mandatoryDone = mandatory.filter((document) => document.isSatisfied).length;
  return (
    <span className="text-xs text-[var(--brand-text)]">
      {mandatoryDone} of {mandatory.length} complete
      {optional.length > 0 ? (
        <span className="text-[var(--brand-gray)]">
          {" · "}
          {optionalDone}/{optional.length} optional
        </span>
      ) : null}
    </span>
  );
}

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
  // What someone may do here follows their membership of THIS project, and a discipline lead only
  // leads their own discipline. The server checks the same thing again before anything changes.
  const leadsThisWork = isLeadOrAboveOn(me.data, project.data, data.disciplineId);
  const canControl = leadsThisWork || me.data?.id === data.assigneeId;
  // The sign-off panel: only somebody inside the company who leads this work, and never the
  // contractor who did it — the server refuses that too, whoever presses the button.
  const canSignOff =
    leadsThisWork && !isExternalUser(me.data) && data.status === "AWAITING_REVIEW";
  const canReassign = leadsThisWork;
  const canDeleteDocuments = isManagerOn(me.data, project.data);
  const teammates = (project.data?.members ?? []).filter(
    (member) => member.disciplineId === data.disciplineId,
  );
  const mentionable = (project.data?.members ?? []).map((member) => ({
    userId: member.userId,
    userName: member.userName,
  }));

  // The action bar's two halves, decided together so they can never say different things: a
  // contractor on a sign-off project submits their work instead of completing it, and the "Awaiting
  // review" status is not theirs to set by hand. Default to asking for a sign-off while the project
  // is still loading — the safer of the two, and the server decides in the end anyway.
  const actionContext: TaskActionContext = {
    isExternal: isExternalUser(me.data),
    signoffRequired: project.data?.externalSignoffRequired ?? true,
    status: data.status,
    canComplete: data.canComplete,
  };
  const statusChoices = statusChoicesFor(actionContext);
  const completeButton = completeButtonFor(actionContext);
  const handingIn = submitsForSignoff(actionContext);

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
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--brand-gray)]">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: data.disciplineColorHex }}
            aria-hidden="true"
          />
          {data.disciplineName}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 break-words text-xl font-semibold text-[var(--brand-primary)]">
            {data.title}
          </h1>
          <StatusBadge status={data.status} />
          <PriorityFlag priority={data.priority} />
          {data.isMandatory ? (
            <span className="rounded-full bg-[var(--page-bg)] px-2 py-0.5 text-xs text-[var(--brand-text)]">
              Mandatory
            </span>
          ) : null}
          <FavoriteStar targetType="DISCIPLINE_TASK" targetId={data.id} />
        </div>
        <p
          className="text-sm"
          style={{ color: data.isOverdue ? "var(--status-blocked)" : "var(--brand-text)" }}
        >
          Deadline {formatDate(data.deadline)}
          {data.isOverdue ? " — overdue" : ""}
        </p>
        <p className="text-sm">
          Part of:{" "}
          <Link
            href={`/tasks/${data.mainTaskId}`}
            className="font-semibold text-[var(--brand-primary)] hover:underline"
          >
            {data.mainTaskTitle} →
          </Link>
        </p>
      </header>

      {canSignOff ? <SignOffPanel taskId={data.id} title={data.title} onDone={refresh} /> : null}

      {/*
        The action bar. Everything about finishing this piece of work — the status control, the
        Mark complete button, and the plain-English reason when it is refused — sits here, directly
        under the header, so nobody has to scroll past the comments to close out their task.
      */}
      {canControl || data.status === "COMPLETED" ? (
        <div className="space-y-2 rounded-[var(--radius)] border border-[var(--border)] bg-white p-3">
          <div className="flex flex-wrap items-center gap-3">
            {canControl ? (
              <>
                <label className="text-xs text-[var(--brand-text)]" htmlFor="discipline-status">
                  Change status
                </label>
                {/* Select fills its container, so the width is set here rather than on the field. */}
                <div className="w-full sm:w-52">
                  <Select
                    id="discipline-status"
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
                    {statusChoices.map((status) => (
                      <option key={status} value={status}>
                        {STATUS_LABEL[status]}
                      </option>
                    ))}
                  </Select>
                </div>
              </>
            ) : null}

            {canControl && data.status !== "COMPLETED" ? (
              <Button
                className="min-h-11 w-full sm:ml-auto sm:w-auto"
                loading={pending}
                disabled={completeButton.disabled || pending}
                onClick={() =>
                  run(() => completeDisciplineTask({ id: data.id }), {
                    success: handingIn ? "Sent for sign-off." : "Marked complete.",
                    failure: handingIn
                      ? "Couldn't send this for sign-off. Try again."
                      : "Couldn't mark this complete. Try again.",
                    onSuccess: refresh,
                  })
                }
              >
                {completeButton.label}
              </Button>
            ) : null}

            {canControl && data.status === "COMPLETED" ? (
              <Button
                variant="secondary"
                className="w-full sm:ml-auto sm:w-auto"
                onClick={() => setReopenOpen(true)}
                disabled={pending}
              >
                Reopen
              </Button>
            ) : null}
          </div>

          {canControl && data.status !== "COMPLETED" && !data.canComplete ? (
            <p className="text-sm text-[var(--brand-text)]">
              {/* Each blocker is already a full sentence with its own full stop — don't add another. */}
              {handingIn ? (
                <>
                  You can still send this for sign-off. The person reviewing it will need:{" "}
                  {data.blockers.join(" ")}
                </>
              ) : (
                <>You can&apos;t mark this complete yet: {data.blockers.join(" ")}</>
              )}
            </p>
          ) : null}

          {data.status === "COMPLETED" ? (
            <p className="text-sm text-[var(--status-completed)]">
              Completed{data.completedByName ? ` by ${data.completedByName}` : ""}
              {data.completedAt ? ` on ${formatDate(data.completedAt)}` : ""}.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 max-w-3xl space-y-5">
          <Card
            title="What's required"
            action={<RequiredDocsCount documents={data.requiredDocuments} />}
          >
            <p className="text-sm text-[var(--brand-text)]">
              {data.description?.trim()
                ? data.description
                : "No description was added for this discipline task."}
            </p>

            <div className="mt-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--brand-gray)]">
                Required documents
              </h3>
              <RequiredDocsChecklist task={data} />
            </div>
          </Card>

          <Card title="Depends on">
            {data.dependencies.length === 0 ? (
              <p className="text-sm text-[var(--brand-gray)]">
                Nothing else has to finish before this task.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {data.dependencies.map((dependency) => (
                  <li
                    key={dependency.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm"
                  >
                    <Link
                      href={`/discipline-tasks/${dependency.id}`}
                      className="min-w-0 flex-1 basis-40 text-[var(--brand-primary)] hover:underline"
                    >
                      {dependency.title}
                    </Link>
                    <span className="text-xs text-[var(--brand-gray)]">
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
                content: <DisciplineTaskDocuments task={data} canDelete={canDeleteDocuments} />,
              },
              {
                id: "activity",
                label: "Activity",
                content: <DisciplineTaskActivity disciplineTaskId={data.id} />,
              },
            ]}
          />

        </div>

        <aside className="min-w-0 space-y-4 lg:sticky lg:top-4 lg:self-start">
          <Card title="Details">
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-[var(--brand-gray)]">Assignee</dt>
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
                    <span className="flex flex-wrap items-center gap-2 text-[var(--brand-ink)]">
                      <Avatar name={data.assigneeName} size={24} />
                      {data.assigneeName}
                      <CompanyBadge companyName={data.assigneeCompanyName} />
                    </span>
                  ) : (
                    <span className="text-[var(--brand-gray)]">No one yet</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--brand-gray)]">Dates</dt>
                <dd className="mt-1">
                  {formatDate(data.startDate)} — {formatDate(data.deadline)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--brand-gray)]">Priority</dt>
                <dd className="mt-1">
                  <PriorityFlag priority={data.priority} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--brand-gray)]">Must be done</dt>
                <dd className="mt-1">
                  {data.isMandatory
                    ? "Yes — the main task waits on it"
                    : "No — the main task can finish without it"}
                </dd>
              </div>
              {data.completedAt ? (
                <div>
                  <dt className="text-xs text-[var(--brand-gray)]">Completed</dt>
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

/**
 * "Needs your sign-off": what a discipline lead or manager sees on work a contractor has handed in.
 *
 * Confirming runs the REAL completion gate on the server — required documents, open dependencies
 * and the stage gate are all still judged, so this button can be refused in plain English exactly
 * as "Mark complete" can. Sending it back always carries a note saying what needs changing.
 */
function SignOffPanel({
  taskId,
  title,
  onDone,
}: {
  taskId: string;
  title: string;
  onDone: () => void;
}) {
  const { run, pending, error } = useAction();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [note, setNote] = useState("");
  const noteTooShort = note.trim().length < 5;

  return (
    <div className="space-y-3 rounded-[var(--radius)] border border-[var(--status-awaiting-review)] bg-white p-4">
      <div>
        <h2 className="text-sm font-semibold text-[var(--brand-ink)]">Needs your sign-off</h2>
        <p className="mt-1 text-sm text-[var(--brand-text)]">
          The contractor says this work is finished. Confirm it to complete the task, or send it back
          with a note saying what still needs doing.
        </p>
      </div>

      {error ? <ErrorBanner message={error} /> : null}

      <div className="flex flex-wrap gap-3">
        <Button
          className="min-h-11"
          loading={pending}
          disabled={pending}
          onClick={() =>
            run(() => confirmDisciplineTaskReview({ id: taskId }), {
              success: "Signed off and marked complete.",
              failure: "Couldn't sign this off. Try again.",
              onSuccess: onDone,
            })
          }
        >
          Confirm and complete
        </Button>
        <Button
          variant="secondary"
          className="min-h-11"
          disabled={pending}
          onClick={() => setRejectOpen(true)}
        >
          Send back
        </Button>
      </div>

      <Modal
        open={rejectOpen}
        title={`Send back "${title}"`}
        onClose={() => setRejectOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={pending}
              disabled={noteTooShort || pending}
              onClick={() =>
                run(() => rejectDisciplineTaskReview({ id: taskId, note: note.trim() }), {
                  success: "Sent back to the contractor.",
                  failure: "Couldn't send this back. Try again.",
                  onSuccess: () => {
                    setRejectOpen(false);
                    setNote("");
                    onDone();
                  },
                })
              }
            >
              Send back
            </Button>
          </>
        }
      >
        <Field
          label="What needs changing?"
          hint="The contractor sees this, so be specific. At least 5 characters."
          error={note.length > 0 && noteTooShort ? "Write at least 5 characters." : undefined}
        >
          <Textarea
            value={note}
            placeholder="e.g. The pressure test report is missing page 2."
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
      </Modal>
    </div>
  );
}
