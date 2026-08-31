// The phase rail: a project's stage gates in order, above its task list.
//
// Each segment shows how much of that phase is done and whether the gate is shut. Locked is worked
// out on the server (src/lib/phase-lock.ts) and arrives on the DTO — this file only draws it. The
// controls below are a courtesy: the server refuses a change whatever the screen shows.

"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  createPhase,
  deletePhase,
  overridePhaseLock,
  renamePhase,
  reorderPhases,
} from "@/components/actions";
import { fieldError, useAction } from "@/components/hooks/use-action";
import { usePhases } from "@/components/hooks/use-api";
import { formatDate } from "@/components/format";
import { LockIcon } from "@/components/shell/icons";
import {
  Button,
  ErrorBanner,
  Field,
  Input,
  Modal,
  ProgressBar,
  Skeleton,
  Textarea,
} from "@/components/ui";
import type { PhaseDTO } from "@/lib/zod-schemas";

/** "Everything with no phase" — never gated, and only shown when there is something in it. */
export const UNPHASED = "UNPHASED";

function pct(phase: { taskCount: number; completedCount: number }): number {
  if (phase.taskCount === 0) return 0;
  return Math.round((100 * phase.completedCount) / phase.taskCount);
}

function OverridePhaseDialog({
  phase,
  open,
  onClose,
  onDone,
}: {
  phase: PhaseDTO;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { run, pending, error, fieldErrors } = useAction();
  const [reason, setReason] = useState("");

  return (
    <Modal
      open={open}
      size="sm"
      title={`Override the gate on ${phase.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={pending}
            onClick={() =>
              run(() => overridePhaseLock({ id: phase.id, reason: reason.trim() }), {
                success: `The ${phase.name} phase is now open by override.`,
                failure: "Couldn't apply the override. Try again.",
                onSuccess: () => {
                  setReason("");
                  onDone();
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
          {phase.name} is locked until{" "}
          {phase.lockedByPhaseName ? `${phase.lockedByPhaseName} is` : "the earlier phases are"}{" "}
          complete. Overriding opens it permanently and records your reason in the audit trail. Work
          in this phase can then be completed while the earlier phase is still open.
        </p>
        <Field label="Reason" error={fieldError(fieldErrors, "reason")}>
          <Textarea
            value={reason}
            placeholder="Why is this phase starting before the previous one is finished?"
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}

function AddPhaseDialog({
  projectId,
  open,
  onClose,
  onDone,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { run, pending, error, fieldErrors } = useAction();
  const [name, setName] = useState("");

  return (
    <Modal
      open={open}
      size="sm"
      title="Add a phase"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={pending}
            disabled={!name.trim()}
            onClick={() =>
              run(() => createPhase({ projectId, name: name.trim() }), {
                success: `Phase '${name.trim()}' added.`,
                failure: "Couldn't add this phase. Try again.",
                onSuccess: () => {
                  setName("");
                  onDone();
                  onClose();
                },
              })
            }
          >
            Add phase
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error ? <ErrorBanner message={error} /> : null}
        <p className="text-sm text-[var(--brand-text)]">
          New phases go at the end of the sequence. Use the arrows on a phase to move it.
        </p>
        <Field label="Name" error={fieldError(fieldErrors, "name")}>
          <Input
            value={name}
            placeholder="e.g. Pre-commissioning"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}

function RenamePhaseDialog({
  phase,
  open,
  onClose,
  onDone,
}: {
  phase: PhaseDTO;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { run, pending, error, fieldErrors } = useAction();
  const [name, setName] = useState(phase.name);

  return (
    <Modal
      open={open}
      size="sm"
      title={`Rename ${phase.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={pending}
            disabled={!name.trim() || name.trim() === phase.name}
            onClick={() =>
              run(() => renamePhase({ id: phase.id, name: name.trim() }), {
                success: "Phase renamed.",
                failure: "Couldn't rename this phase. Try again.",
                onSuccess: () => {
                  onDone();
                  onClose();
                },
              })
            }
          >
            Save name
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error ? <ErrorBanner message={error} /> : null}
        <Field label="Name" error={fieldError(fieldErrors, "name")}>
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

export function PhaseRail({
  projectId,
  canManage,
  unphasedCount,
  selected,
  onSelect,
}: {
  projectId: string;
  canManage: boolean;
  /** Live main tasks with no phase, counted from the list the tasks tab already has. */
  unphasedCount: number;
  selected: string | null;
  onSelect: (phaseId: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const phases = usePhases(projectId);
  const { run, pending } = useAction();
  const [addOpen, setAddOpen] = useState(false);
  const [renaming, setRenaming] = useState<PhaseDTO | null>(null);
  const [overriding, setOverriding] = useState<PhaseDTO | null>(null);
  /** Deleting is destructive and sits next to the reorder arrows, so it always asks first. */
  const [confirmDelete, setConfirmDelete] = useState<PhaseDTO | null>(null);

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["project", projectId, "phases"] });
    void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
  }

  if (phases.isPending) return <Skeleton className="h-16 w-full" />;
  if (phases.isError) {
    return (
      <ErrorBanner
        message="Couldn't load the phases. Try refreshing the page."
        onRetry={() => void phases.refetch()}
      />
    );
  }

  const rows = phases.data ?? [];
  if (rows.length === 0 && unphasedCount === 0) {
    return canManage ? (
      <div className="flex items-center justify-between rounded-[var(--radius)] border border-dashed border-[var(--border)] p-3 text-sm text-[var(--brand-text)]">
        <span>
          This project has no phases. Add them to gate the work: a phase stays locked until the
          phase before it is complete.
        </span>
        <Button variant="secondary" onClick={() => setAddOpen(true)}>
          Add phase
        </Button>
        <AddPhaseDialog
          projectId={projectId}
          open={addOpen}
          onClose={() => setAddOpen(false)}
          onDone={refresh}
        />
      </div>
    ) : null;
  }

  function move(phase: PhaseDTO, by: -1 | 1) {
    const order = rows.map((row) => row.id);
    const from = order.indexOf(phase.id);
    const to = from + by;
    if (from < 0 || to < 0 || to >= order.length) return;
    order.splice(to, 0, order.splice(from, 1)[0]);

    run(() => reorderPhases({ projectId, phaseIds: order }), {
      success: "Phase order updated.",
      failure: "Couldn't change the order. Try again.",
      onSuccess: refresh,
    });
  }

  function remove(phase: PhaseDTO) {
    run(() => deletePhase({ id: phase.id }), {
      success: `Phase '${phase.name}' deleted.`,
      failure: "Couldn't delete this phase. Try again.",
      onSuccess: () => {
        if (selected === phase.id) onSelect(null);
        setConfirmDelete(null);
        refresh();
      },
    });
  }

  return (
    <section className="space-y-2" aria-label="Project phases">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--brand-gray)]">
          Phases
        </h3>
        <div className="flex items-center gap-2">
          {selected ? (
            <button
              type="button"
              onClick={() => onSelect(null)}
              className="text-xs font-semibold text-[var(--brand-primary)] underline underline-offset-2"
            >
              Show every phase
            </button>
          ) : null}
          {canManage ? (
            <Button variant="ghost" onClick={() => setAddOpen(true)}>
              + Add phase
            </Button>
          ) : null}
        </div>
      </div>

      <ol className="flex flex-wrap gap-2">
        {rows.map((phase, index) => {
          const isSelected = selected === phase.id;
          return (
            <li
              key={phase.id}
              className={`min-w-52 flex-1 rounded-[var(--radius)] border p-3 ${
                isSelected ? "border-[var(--brand-primary)]" : "border-[var(--border)]"
              } ${phase.locked ? "bg-[var(--page-bg)]" : "bg-white"}`}
            >
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  onClick={() => onSelect(isSelected ? null : phase.id)}
                  aria-pressed={isSelected}
                  className="min-w-0 flex-1 text-left"
                >
                  <span
                    className="flex items-center gap-1.5 text-sm font-semibold"
                    style={{
                      color: phase.locked ? "var(--brand-gray)" : "var(--brand-ink)",
                    }}
                    title={phase.name}
                  >
                    <span className="shrink-0 text-[10px] text-[var(--brand-gray)]">
                      {index + 1}
                    </span>
                    {/* Truncate rather than let a long name ("Commissioning") push into the Rename
                        control on a narrow card — the full name stays on the hover title. */}
                    <span className="min-w-0 truncate">{phase.name}</span>
                    {phase.locked ? (
                      <LockIcon className="shrink-0 text-[var(--brand-gray)]" />
                    ) : null}
                  </span>
                  <span className="mt-0.5 block text-xs text-[var(--brand-text)]">
                    {phase.completedCount}/{phase.taskCount} main tasks complete
                  </span>
                </button>

                {canManage ? (
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      aria-label={`Move ${phase.name} earlier`}
                      disabled={index === 0 || pending}
                      onClick={() => move(phase, -1)}
                      className="rounded px-1 text-xs text-[var(--brand-gray)] hover:text-[var(--brand-ink)] disabled:opacity-40"
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${phase.name} later`}
                      disabled={index === rows.length - 1 || pending}
                      onClick={() => move(phase, 1)}
                      className="rounded px-1 text-xs text-[var(--brand-gray)] hover:text-[var(--brand-ink)] disabled:opacity-40"
                    >
                      →
                    </button>
                    <button
                      type="button"
                      aria-label={`Rename ${phase.name}`}
                      onClick={() => setRenaming(phase)}
                      className="rounded px-1 text-xs font-semibold text-[var(--brand-primary)] hover:underline"
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${phase.name}`}
                      disabled={pending}
                      onClick={() => setConfirmDelete(phase)}
                      className="rounded px-1 text-xs text-[var(--brand-gray)] hover:text-[var(--status-blocked)] disabled:opacity-40"
                    >
                      ×
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="mt-2">
                <ProgressBar pct={pct(phase)} />
              </div>

              {phase.locked ? (
                <p className="mt-2 text-xs text-[var(--brand-gray)]">
                  Locked until{" "}
                  {phase.lockedByPhaseName
                    ? `'${phase.lockedByPhaseName}'`
                    : "the earlier phases"}{" "}
                  {phase.lockedByPhaseName ? "is" : "are"} complete. Work can be prepared here;
                  nothing can be completed.
                  {canManage ? (
                    <>
                      {" "}
                      <button
                        type="button"
                        onClick={() => setOverriding(phase)}
                        className="font-semibold text-[var(--brand-primary)] underline underline-offset-2"
                      >
                        Override the gate
                      </button>
                    </>
                  ) : null}
                </p>
              ) : phase.overridden ? (
                <p
                  className="mt-2 text-xs text-[var(--brand-text)]"
                  title={`Overridden by ${phase.overriddenByName ?? "someone"} — reason: ${
                    phase.overrideReason ?? "not recorded"
                  }`}
                >
                  Open by override
                  {phase.overriddenByName ? ` — ${phase.overriddenByName}` : ""}
                  {phase.overriddenAt ? `, ${formatDate(phase.overriddenAt)}` : ""}
                </p>
              ) : null}
            </li>
          );
        })}

        {unphasedCount > 0 ? (
          <li
            className={`min-w-52 flex-1 rounded-[var(--radius)] border border-dashed p-3 ${
              selected === UNPHASED ? "border-[var(--brand-primary)]" : "border-[var(--border)]"
            }`}
          >
            <button
              type="button"
              onClick={() => onSelect(selected === UNPHASED ? null : UNPHASED)}
              aria-pressed={selected === UNPHASED}
              className="text-left"
            >
              <span className="text-sm font-semibold text-[var(--brand-ink)]">Unphased</span>
              <span className="mt-0.5 block text-xs text-[var(--brand-text)]">
                {unphasedCount} main {unphasedCount === 1 ? "task" : "tasks"} outside the gates —
                never locked
              </span>
            </button>
          </li>
        ) : null}
      </ol>

      {canManage ? (
        <>
          <AddPhaseDialog
            projectId={projectId}
            open={addOpen}
            onClose={() => setAddOpen(false)}
            onDone={refresh}
          />
          {renaming ? (
            <RenamePhaseDialog
              key={renaming.id}
              phase={renaming}
              open
              onClose={() => setRenaming(null)}
              onDone={refresh}
            />
          ) : null}
          {overriding ? (
            <OverridePhaseDialog
              key={overriding.id}
              phase={overriding}
              open
              onClose={() => setOverriding(null)}
              onDone={refresh}
            />
          ) : null}

          <Modal
            open={confirmDelete !== null}
            size="sm"
            title="Delete phase"
            onClose={() => setConfirmDelete(null)}
            footer={
              <>
                <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  loading={pending}
                  disabled={(confirmDelete?.taskCount ?? 0) > 0}
                  onClick={() => {
                    if (confirmDelete) remove(confirmDelete);
                  }}
                >
                  Delete phase
                </Button>
              </>
            }
          >
            <p>
              Delete the phase {confirmDelete?.name}? The gate it holds goes with it, so the phases
              after it will be judged against the one before it instead.
            </p>
            {(confirmDelete?.taskCount ?? 0) > 0 ? (
              <p className="mt-2 text-xs text-[var(--status-blocked)]">
                This phase still holds {confirmDelete?.taskCount} main{" "}
                {confirmDelete?.taskCount === 1 ? "task" : "tasks"}. Move that work to another phase,
                or to no phase, before deleting it.
              </p>
            ) : null}
          </Modal>
        </>
      ) : null}
    </section>
  );
}
