// Main-task detail: the derived status and progress up top, the discipline cards in the middle,
// and the role-gated actions in the right rail.

"use client";

import Link from "next/link";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  clearOverride,
  createDisciplineTask,
  overrideMainTaskStatus,
  updateMainTask,
} from "@/components/actions";
import { MainTaskActivity } from "@/components/activity/activity-feeds";
import { MainTaskComments } from "@/components/comments/comment-list";
import { MainTaskDocumentsTab } from "@/components/documents/main-task-documents";
import { MainTaskTimelineTab } from "@/components/gantt/timeline-tab";
import { fieldError, useAction } from "@/components/hooks/use-action";
import {
  isManagerOn,
  useMainTask,
  useMe,
  useProject,
} from "@/components/hooks/use-api";
import { FavoriteStar } from "@/components/shell/favorite-star";
import { formatDate, toDateInputValue } from "@/components/format";
import { ChevronRightIcon } from "@/components/shell/icons";
import {
  Avatar,
  Breadcrumb,
  Button,
  Card,
  DateInput,
  DisciplineDot,
  EmptyState,
  ErrorBanner,
  Field,
  Input,
  Modal,
  PriorityFlag,
  ProgressBar,
  Select,
  Skeleton,
  SkeletonRows,
  StatusBadge,
  Tabs,
  Textarea,
} from "@/components/ui";
import type { MainTaskDTO, PriorityName, ProjectDTO, TaskStatusName } from "@/lib/zod-schemas";

const PRIORITIES: { value: PriorityName; label: string }[] = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
  { value: "CRITICAL", label: "Critical" },
];

function EditDetailsDialog({
  task,
  project,
  open,
  onClose,
}: {
  task: MainTaskDTO;
  project: ProjectDTO | undefined;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { run, pending, error, fieldErrors } = useAction();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [priority, setPriority] = useState<PriorityName>(task.priority);
  const [startDate, setStartDate] = useState(toDateInputValue(task.startDate));
  const [deadline, setDeadline] = useState(toDateInputValue(task.deadline));
  const [ownerId, setOwnerId] = useState(task.ownerId ?? "");

  const dateOrderError =
    startDate && deadline && deadline < startDate
      ? "Deadline can't be before the start date."
      : undefined;

  return (
    <Modal
      open={open}
      title="Edit task details"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={pending}
            disabled={!title.trim() || !deadline || Boolean(dateOrderError)}
            onClick={() =>
              run(
                () =>
                  updateMainTask({
                    id: task.id,
                    title: title.trim(),
                    description: description.trim(),
                    priority,
                    startDate: startDate ? new Date(startDate) : null,
                    deadline: new Date(deadline),
                    ownerId: ownerId || null,
                  }),
                {
                  success: "Task updated.",
                  failure: "Couldn't save these changes. Try again.",
                  onSuccess: () => {
                    void queryClient.invalidateQueries({ queryKey: ["task", task.id] });
                    void queryClient.invalidateQueries({ queryKey: ["project", task.projectId] });
                    onClose();
                  },
                },
              )
            }
          >
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error ? <ErrorBanner message="Couldn't save these changes. Try again." /> : null}
        <Field label="Title" error={fieldError(fieldErrors, "title")}>
          <Input value={title} onChange={(event) => setTitle(event.target.value)} />
        </Field>
        <Field label="Description">
          <Textarea value={description} onChange={(event) => setDescription(event.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Priority">
            <Select
              value={priority}
              onChange={(event) => setPriority(event.target.value as PriorityName)}
            >
              {PRIORITIES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Start date">
            <DateInput value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </Field>
          <Field label="Deadline" error={dateOrderError}>
            <DateInput
              value={deadline}
              min={startDate || undefined}
              onChange={(event) => setDeadline(event.target.value)}
            />
          </Field>
        </div>
        <Field label="Owner">
          <Select value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
            <option value="">No owner</option>
            {(project?.members ?? []).map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.userName}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

function OverrideDialog({
  task,
  open,
  onClose,
}: {
  task: MainTaskDTO;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { run, pending, error, fieldErrors } = useAction();
  const [status, setStatus] = useState<TaskStatusName>("COMPLETED");
  const [reason, setReason] = useState("");

  const remaining = task.counts.disciplineTasks - task.counts.completed;

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["task", task.id] });
    void queryClient.invalidateQueries({ queryKey: ["project", task.projectId] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  }

  return (
    <Modal
      open={open}
      title="Override task status"
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={pending}
            onClick={() =>
              run(() => overrideMainTaskStatus({ id: task.id, status, reason: reason.trim() }), {
                success: `Status overridden to ${status === "COMPLETED" ? "Completed" : status === "BLOCKED" ? "Blocked" : "In progress"}.`,
                failure: "Couldn't apply the override. Try again.",
                onSuccess: () => {
                  refresh();
                  setReason("");
                  onClose();
                },
              })
            }
          >
            Apply override
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error ? <ErrorBanner message={error} /> : null}
        <p>
          This task follows its discipline tasks: {remaining} of {task.counts.disciplineTasks} are
          still open. Overriding forces the status and records your reason in the audit trail.
        </p>
        <Field label="New status">
          <Select
            value={status}
            onChange={(event) => setStatus(event.target.value as TaskStatusName)}
          >
            <option value="COMPLETED">Completed</option>
            <option value="IN_PROGRESS">In progress</option>
            <option value="BLOCKED">Blocked</option>
          </Select>
        </Field>
        <Field label="Reason" error={fieldError(fieldErrors, "reason")}>
          <Textarea
            value={reason}
            placeholder="Why are you overriding the normal completion rules?"
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        {task.statusOverride ? (
          <Button
            variant="secondary"
            loading={pending}
            onClick={() =>
              run(() => clearOverride({ id: task.id }), {
                success: "Override cleared.",
                failure: "Couldn't clear the override. Try again.",
                onSuccess: () => {
                  refresh();
                  onClose();
                },
              })
            }
          >
            Clear override
          </Button>
        ) : null}
      </div>
    </Modal>
  );
}

function AddDisciplineTaskDialog({
  task,
  project,
  open,
  onClose,
}: {
  task: MainTaskDTO;
  project: ProjectDTO | undefined;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { run, pending, error, fieldErrors } = useAction();
  const [disciplineId, setDisciplineId] = useState("");
  const [title, setTitle] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [deadline, setDeadline] = useState(toDateInputValue(task.deadline));
  const [isMandatory, setIsMandatory] = useState(true);

  const members = (project?.members ?? []).filter(
    (member) => member.disciplineId === disciplineId,
  );

  return (
    <Modal
      open={open}
      title="Add a discipline task"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={pending}
            disabled={!disciplineId || !title.trim() || !deadline}
            onClick={() =>
              run(
                () =>
                  createDisciplineTask({
                    mainTaskId: task.id,
                    disciplineId,
                    title: title.trim(),
                    assigneeId: assigneeId || null,
                    deadline: new Date(deadline),
                    priority: task.priority,
                    isMandatory,
                    requiredDocuments: [],
                  }),
                {
                  success: "Discipline task added.",
                  failure: "Couldn't add this discipline task. Try again.",
                  onSuccess: () => {
                    void queryClient.invalidateQueries({ queryKey: ["task", task.id] });
                    void queryClient.invalidateQueries({ queryKey: ["project", task.projectId] });
                    setTitle("");
                    setAssigneeId("");
                    setDisciplineId("");
                    onClose();
                  },
                },
              )
            }
          >
            Add task
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error ? <ErrorBanner message="Couldn't add this discipline task. Try again." /> : null}
        <Field label="Discipline">
          <Select
            value={disciplineId}
            onChange={(event) => {
              setDisciplineId(event.target.value);
              const discipline = project?.disciplines.find(
                (item) => item.disciplineId === event.target.value,
              );
              setTitle(discipline ? `${discipline.name} — ${task.title}` : task.title);
            }}
          >
            <option value="">Choose a discipline…</option>
            {(project?.disciplines ?? []).map((discipline) => (
              <option key={discipline.id} value={discipline.disciplineId}>
                {discipline.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Title" error={fieldError(fieldErrors, "title")}>
          <Input value={title} onChange={(event) => setTitle(event.target.value)} />
        </Field>
        <Field label="Assignee">
          <Select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>
            <option value="">No one yet</option>
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.userName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Deadline">
          <DateInput value={deadline} onChange={(event) => setDeadline(event.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isMandatory}
            onChange={(event) => setIsMandatory(event.target.checked)}
          />
          This discipline must finish before the main task can be complete
        </label>
      </div>
    </Modal>
  );
}

export function MainTaskView({ taskId }: { taskId: string }) {
  const me = useMe();
  const task = useMainTask(taskId);
  const project = useProject(task.data?.projectId ?? "");
  const [editOpen, setEditOpen] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

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
        <Skeleton className="h-3 w-56" />
        <Skeleton className="h-7 w-96" />
        <SkeletonRows rows={5} />
      </div>
    );
  }

  const data = task.data;
  // Managing follows this project's team list, not the org-wide role — a project manager elsewhere
  // is an ordinary member here. The server enforces the same rule.
  const canManage = isManagerOn(me.data, project.data);
  const mentionable = (project.data?.members ?? []).map((member) => ({
    userId: member.userId,
    userName: member.userName,
  }));

  return (
    <div className="space-y-5">
      <Breadcrumb
        items={[
          { label: "Projects", href: "/projects" },
          { label: project.data?.name ?? data.projectCode, href: `/projects/${data.projectId}` },
          { label: data.title },
        ]}
      />

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 break-words text-xl font-semibold text-[var(--brand-primary)]">
            {data.title}
          </h1>
          <StatusBadge status={data.effectiveStatus} overridden={Boolean(data.statusOverride)} />
          {data.statusOverride ? (
            <span
              className="rounded-full bg-[var(--brand-stone)] px-2 py-0.5 text-xs font-semibold text-[var(--brand-ink)]"
              title={`Overridden by ${data.overriddenByName ?? "someone"} — reason: ${
                data.overrideReason ?? "not recorded"
              }`}
            >
              Overridden
            </span>
          ) : null}
          <PriorityFlag priority={data.priority} />
          <FavoriteStar targetType="MAIN_TASK" targetId={data.id} />
        </div>

        <div className="max-w-md space-y-1">
          <p className="text-sm text-[var(--brand-text)]">
            {data.counts.completed} of {data.counts.disciplineTasks} disciplines complete ·{" "}
            {data.progressPct}%
          </p>
          <ProgressBar pct={data.progressPct} />
        </div>

        <p
          className="text-sm"
          style={{ color: data.isOverdue ? "var(--status-blocked)" : "var(--brand-text)" }}
        >
          Deadline {formatDate(data.deadline)}
          {data.isOverdue ? " — overdue" : ""}
        </p>
      </header>

      {/*
        The action bar. Everything someone running this task can do sits directly under the header,
        the same way the discipline-task page works, instead of hiding in the right rail below the
        fold. The dialogs themselves stay mounted further down.
      */}
      {canManage ? (
        <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-white p-3">
          <Button variant="secondary" onClick={() => setEditOpen(true)}>
            Edit details
          </Button>
          <Button variant="secondary" onClick={() => setOverrideOpen(true)}>
            Override status
          </Button>
          <Button className="sm:ml-auto" onClick={() => setAddOpen(true)}>
            Add discipline task
          </Button>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className="min-w-0 space-y-5">
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-[var(--brand-ink)]">Discipline progress</h2>

            {data.disciplineSummary.length === 0 ? (
              <EmptyState
                message="No discipline tasks yet. Add one to get the work moving."
                action={
                  canManage ? (
                    <Button onClick={() => setAddOpen(true)}>+ Add discipline task</Button>
                  ) : undefined
                }
              />
            ) : (
              <ul className="space-y-2">
                {data.disciplineSummary.map((item) => (
                  <li key={item.disciplineTaskId}>
                    <Link
                      href={`/discipline-tasks/${item.disciplineTaskId}`}
                      className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius)] border border-[var(--border)] bg-white p-3 transition-colors hover:border-[var(--brand-primary)] hover:bg-[var(--page-bg)] ${
                        item.status === "BLOCKED" ? "border-l-4 border-l-[var(--status-blocked)]" : ""
                      }`}
                    >
                      <DisciplineDot colorHex={item.colorHex} code={item.code} showCode />
                      <span className="w-full min-w-0 basis-full text-sm font-semibold text-[var(--brand-ink)] sm:w-auto sm:flex-1 sm:basis-40">
                        {item.title}
                      </span>
                      {item.assigneeName ? (
                        <span className="inline-flex min-w-0 max-w-full items-center gap-2 text-xs text-[var(--brand-text)]">
                          <Avatar name={item.assigneeName} size={24} />
                          <span className="truncate">{item.assigneeName}</span>
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--brand-gray)]">Unassigned</span>
                      )}
                      <span
                        className="text-xs"
                        style={{
                          color: item.isOverdue ? "var(--status-blocked)" : "var(--brand-text)",
                        }}
                      >
                        {formatDate(item.deadline)}
                      </span>
                      {item.requiredDocsTotal > 0 ? (
                        <span
                          className="text-xs"
                          style={{
                            // Red only while documents are genuinely still missing. A completed
                            // task is settled, so its count is just a fact, not a warning.
                            color:
                              item.requiredDocsSatisfied < item.requiredDocsTotal &&
                              item.status !== "COMPLETED"
                                ? "var(--status-blocked)"
                                : "var(--brand-gray)",
                          }}
                        >
                          {item.requiredDocsSatisfied}/{item.requiredDocsTotal} documents
                        </span>
                      ) : null}
                      <StatusBadge status={item.status} />
                      <ChevronRightIcon className="shrink-0 text-[var(--brand-gray)]" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <Tabs
            items={[
              {
                id: "documents",
                label: "Documents",
                content: <MainTaskDocumentsTab task={data} canDelete={canManage} />,
              },
              {
                id: "comments",
                label: "Comments",
                content: (
                  <MainTaskComments
                    mainTaskId={data.id}
                    projectId={data.projectId}
                    members={mentionable}
                  />
                ),
              },
              {
                id: "activity",
                label: "Activity",
                content: <MainTaskActivity mainTaskId={data.id} />,
              },
              {
                id: "timeline",
                label: "Timeline",
                content: <MainTaskTimelineTab taskId={data.id} projectId={data.projectId} />,
              },
            ]}
          />
        </div>

        <aside className="min-w-0 space-y-4 lg:sticky lg:top-4 lg:self-start">
          <Card title="Details">
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-[var(--brand-gray)]">Owner</dt>
                <dd className="mt-1 flex items-center gap-2 text-[var(--brand-ink)]">
                  {data.ownerName ? (
                    <>
                      <Avatar name={data.ownerName} size={24} />
                      {data.ownerName}
                    </>
                  ) : (
                    <span className="text-[var(--brand-gray)]">No owner</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--brand-gray)]">Created</dt>
                <dd className="mt-1">
                  {data.createdByName} · {formatDate(data.createdAt)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--brand-gray)]">Dates</dt>
                <dd className="mt-1">
                  {formatDate(data.startDate)} — {formatDate(data.deadline)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--brand-gray)]">Disciplines involved</dt>
                <dd className="mt-1 space-y-1">
                  {data.disciplineSummary.map((item) => (
                    <span key={item.disciplineId} className="flex items-center gap-2">
                      <DisciplineDot colorHex={item.colorHex} code={item.code} showCode />
                      <StatusBadge status={item.status} />
                    </span>
                  ))}
                </dd>
              </div>
            </dl>
          </Card>

        </aside>
      </div>

      {canManage ? (
        <>
          <EditDetailsDialog
            task={data}
            project={project.data}
            open={editOpen}
            onClose={() => setEditOpen(false)}
          />
          <OverrideDialog task={data} open={overrideOpen} onClose={() => setOverrideOpen(false)} />
          <AddDisciplineTaskDialog
            task={data}
            project={project.data}
            open={addOpen}
            onClose={() => setAddOpen(false)}
          />
        </>
      ) : null}
    </div>
  );
}
