// The "Depends on" card on a discipline task: which earlier tasks this one has to wait for, and —
// for administrators and project managers — the control to add or remove one.
//
// The control is a courtesy. addDependency / removeDependency check permission, tenant, loops and
// the same-main-task rule again on the server and write the audit row; a refusal is shown here in
// the server's own plain English.

"use client";

import Link from "next/link";
import { useState } from "react";
import { addDependency, removeDependency } from "@/components/actions";
import { useAction } from "@/components/hooks/use-action";
import { useMainTask } from "@/components/hooks/use-api";
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Input,
  Modal,
  SkeletonRows,
  StatusBadge,
} from "@/components/ui";
import type { DisciplineTaskDTO } from "@/lib/zod-schemas";

type Dependency = DisciplineTaskDTO["dependencies"][number];

export function DependenciesCard({
  task,
  canEdit,
  onChanged,
}: {
  task: DisciplineTaskDTO;
  /** Administrators and project managers of this project. Everyone else sees the list read-only. */
  canEdit: boolean;
  /** Refresh whatever shows this task once a dependency has been added or removed. */
  onChanged: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [removing, setRemoving] = useState<Dependency | null>(null);

  return (
    <Card
      title="Depends on"
      action={
        canEdit ? (
          <Button variant="secondary" className="min-h-11" onClick={() => setPickerOpen(true)}>
            Add dependency
          </Button>
        ) : undefined
      }
    >
      {task.dependencies.length === 0 && (task.waitingOnCount ?? 0) > 0 ? (
        // A contractor is told how many earlier tasks are open, never which ones (THE EXTERNAL RULE).
        <p className="text-sm text-[var(--brand-text)]">
          Waiting on {task.waitingOnCount} earlier {task.waitingOnCount === 1 ? "task" : "tasks"}.
        </p>
      ) : task.dependencies.length === 0 ? (
        <p className="text-sm text-[var(--brand-gray)]">
          Nothing else has to finish before this task.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {task.dependencies.map((dependency) => (
            <li
              key={dependency.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm"
            >
              <Link
                href={`/discipline-tasks/${dependency.id}`}
                className="min-w-0 flex-1 basis-40 break-words text-[var(--brand-primary)] hover:underline"
              >
                {dependency.title}
              </Link>
              <span className="text-xs text-[var(--brand-gray)]">{dependency.disciplineCode}</span>
              <StatusBadge status={dependency.status} />
              {canEdit ? (
                <Button
                  variant="ghost"
                  className="min-h-11"
                  aria-label={`Remove the wait on ${dependency.title}`}
                  onClick={() => setRemoving(dependency)}
                >
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canEdit ? (
        <>
          {/* Mounted only while open, so the task list is not fetched until somebody asks. */}
          {pickerOpen ? (
            <AddDependencyDialog
              task={task}
              onClose={() => setPickerOpen(false)}
              onChanged={onChanged}
            />
          ) : null}
          <RemoveDependencyDialog
            task={task}
            dependency={removing}
            onClose={() => setRemoving(null)}
            onChanged={onChanged}
          />
        </>
      ) : null}
    </Card>
  );
}

/** The picker: the other discipline tasks under the same main task, searchable by title. */
function AddDependencyDialog({
  task,
  onClose,
  onChanged,
}: {
  task: DisciplineTaskDTO;
  onClose: () => void;
  onChanged: () => void;
}) {
  // The main task's own read, which already lists its discipline tasks. No new route.
  const mainTask = useMainTask(task.mainTaskId);
  const { run, pending, error, reset } = useAction();
  const [search, setSearch] = useState("");
  const [chosenId, setChosenId] = useState<string | null>(null);

  function close() {
    if (pending) return;
    setSearch("");
    setChosenId(null);
    reset();
    onClose();
  }

  // Never the task itself, never one that is already listed.
  const taken = new Set([task.id, ...task.dependencies.map((dependency) => dependency.id)]);
  const candidates = (mainTask.data?.disciplineSummary ?? []).filter(
    (item) => !taken.has(item.disciplineTaskId),
  );
  const term = search.trim().toLowerCase();
  const shown = term
    ? candidates.filter(
        (item) =>
          item.title.toLowerCase().includes(term) ||
          item.code.toLowerCase().includes(term) ||
          (item.assigneeName ?? "").toLowerCase().includes(term),
      )
    : candidates;

  return (
    <Modal
      open
      size="md"
      title="Add dependency"
      onClose={close}
      footer={
        <>
          <Button variant="ghost" className="min-h-11" disabled={pending} onClick={close}>
            Cancel
          </Button>
          <Button
            className="min-h-11"
            loading={pending}
            disabled={!chosenId || pending}
            onClick={() =>
              chosenId &&
              run(() => addDependency({ predecessorId: chosenId, successorId: task.id }), {
                success: "Dependency added.",
                failure: "Couldn't add this dependency. Try again.",
                onSuccess: () => {
                  onChanged();
                  setSearch("");
                  setChosenId(null);
                  onClose();
                },
              })
            }
          >
            Add dependency
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-[var(--brand-text)]">
          Pick the task that has to finish before &ldquo;{task.title}&rdquo; can be completed. You
          can choose from the other tasks under &ldquo;{task.mainTaskTitle}&rdquo;.
        </p>

        {error ? <ErrorBanner message={error} /> : null}

        {mainTask.isError ? (
          <ErrorBanner
            message="Couldn't load the other tasks. Try again."
            onRetry={() => void mainTask.refetch()}
          />
        ) : mainTask.isPending ? (
          <SkeletonRows rows={3} height="h-11" />
        ) : candidates.length === 0 ? (
          <EmptyState message="There are no other tasks under this main task to wait on. Add another discipline task first." />
        ) : (
          <>
            <Input
              type="search"
              aria-label="Search tasks by title"
              placeholder="Search by title, discipline or person"
              value={search}
              disabled={pending}
              onChange={(event) => setSearch(event.target.value)}
            />
            {shown.length === 0 ? (
              <p className="text-sm text-[var(--brand-gray)]">No task matches that search.</p>
            ) : (
              <ul className="max-h-72 divide-y divide-[var(--border)] overflow-y-auto rounded-[var(--radius)] border border-[var(--border)]">
                {shown.map((item) => {
                  const chosen = chosenId === item.disciplineTaskId;
                  return (
                    <li key={item.disciplineTaskId}>
                      <button
                        type="button"
                        aria-pressed={chosen}
                        disabled={pending}
                        onClick={() => setChosenId(item.disciplineTaskId)}
                        className={`flex min-h-11 w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left text-sm hover:bg-[var(--page-bg)] ${
                          chosen ? "bg-[var(--page-bg)] ring-2 ring-inset ring-[var(--brand-primary)]" : ""
                        }`}
                      >
                        <span className="min-w-0 flex-1 basis-40 break-words text-[var(--brand-ink)]">
                          {item.title}
                        </span>
                        <span className="text-xs text-[var(--brand-gray)]">{item.code}</span>
                        <span className="text-xs text-[var(--brand-text)]">
                          {item.assigneeName ?? "No one yet"}
                        </span>
                        <StatusBadge status={item.status} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function RemoveDependencyDialog({
  task,
  dependency,
  onClose,
  onChanged,
}: {
  task: DisciplineTaskDTO;
  dependency: Dependency | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { run, pending, error, reset } = useAction();

  function close() {
    if (pending) return;
    reset();
    onClose();
  }

  return (
    <Modal
      open={dependency !== null}
      size="sm"
      title="Remove this dependency?"
      onClose={close}
      footer={
        <>
          <Button variant="ghost" className="min-h-11" disabled={pending} onClick={close}>
            Cancel
          </Button>
          <Button
            variant="danger"
            className="min-h-11"
            loading={pending}
            disabled={pending}
            onClick={() =>
              dependency &&
              run(() => removeDependency({ predecessorId: dependency.id, successorId: task.id }), {
                success: "Dependency removed.",
                failure: "Couldn't remove this dependency. Try again.",
                onSuccess: () => {
                  onChanged();
                  onClose();
                },
              })
            }
          >
            Remove
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error ? <ErrorBanner message={error} /> : null}
        <p className="text-sm text-[var(--brand-text)]">
          &ldquo;{task.title}&rdquo; will no longer have to wait for &ldquo;{dependency?.title}
          &rdquo;. The change is recorded in the task&apos;s activity.
        </p>
      </div>
    </Modal>
  );
}
