"use server";

// Server actions for the stage gates. Thin wrappers, like every other action module: parse the
// input, check who is asking, hand the work to the service, refresh the affected pages, return the
// standard result shape. Nothing here decides whether a phase is locked — that is derived in the
// service from src/lib/phase-lock.ts.

import type { ActionResult, MainTaskDTO, PhaseDTO } from "@/lib/zod-schemas";
import {
  CreatePhaseInput,
  DeletePhaseInput,
  OverridePhaseLockInput,
  RenamePhaseInput,
  ReorderPhasesInput,
  SetMainTaskPhaseInput,
  toFieldErrors,
} from "@/lib/zod-schemas";
import { toFailure } from "@/server/errors";
import { beginMutation, revalidateProject, revalidateTask } from "@/server/actions/guard";
import * as phases from "@/server/services/phases";
import * as tasks from "@/server/services/tasks";

const CHECK_FIELDS = "Please check the highlighted fields.";

export async function createPhase(input: CreatePhaseInput): Promise<ActionResult<PhaseDTO>> {
  const parsed = CreatePhaseInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("create-phase", 20);
  if (guard.failure) return guard.failure;

  try {
    const phase = await phases.createPhase(guard.actor, parsed.data);
    revalidateProject(phase.projectId);
    return { ok: true, data: phase };
  } catch (error) {
    return toFailure(error, { action: "createPhase" });
  }
}

export async function renamePhase(input: RenamePhaseInput): Promise<ActionResult<PhaseDTO>> {
  const parsed = RenamePhaseInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("rename-phase", 20);
  if (guard.failure) return guard.failure;

  try {
    const phase = await phases.renamePhase(guard.actor, parsed.data);
    revalidateProject(phase.projectId);
    return { ok: true, data: phase };
  } catch (error) {
    return toFailure(error, { action: "renamePhase" });
  }
}

/** The full ordered list of phase ids — reordering changes which gates apply, so nothing is implied. */
export async function reorderPhases(input: ReorderPhasesInput): Promise<ActionResult<PhaseDTO[]>> {
  const parsed = ReorderPhasesInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("reorder-phases", 20);
  if (guard.failure) return guard.failure;

  try {
    const ordered = await phases.reorderPhases(guard.actor, parsed.data);
    revalidateProject(parsed.data.projectId);
    return { ok: true, data: ordered };
  } catch (error) {
    return toFailure(error, { action: "reorderPhases" });
  }
}

export async function deletePhase(input: { id: string }): Promise<ActionResult<{ removed: true }>> {
  const parsed = DeletePhaseInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("delete-phase", 20);
  if (guard.failure) return guard.failure;

  try {
    // A phase can only be deleted while it is empty, so no task page's content changes with it —
    // the phase rail refreshes itself through its own query key.
    const result = await phases.deletePhase(guard.actor, parsed.data);
    return { ok: true, data: result };
  } catch (error) {
    return toFailure(error, { action: "deletePhase" });
  }
}

/** The recorded, authorised way past a stage gate. Administrators and project managers only. */
export async function overridePhaseLock(
  input: OverridePhaseLockInput,
): Promise<ActionResult<PhaseDTO>> {
  const parsed = OverridePhaseLockInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("override-phase-lock", 20);
  if (guard.failure) return guard.failure;

  try {
    const phase = await phases.overridePhaseLock(guard.actor, parsed.data);
    revalidateProject(phase.projectId);
    return { ok: true, data: phase };
  } catch (error) {
    return toFailure(error, { action: "overridePhaseLock" });
  }
}

/** Moves a main task between phases (or out of them). Allowed even into a locked phase. */
export async function setMainTaskPhase(
  input: SetMainTaskPhaseInput,
): Promise<ActionResult<MainTaskDTO>> {
  const parsed = SetMainTaskPhaseInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("set-main-task-phase");
  if (guard.failure) return guard.failure;

  try {
    const task = await tasks.setMainTaskPhase(guard.actor, parsed.data);
    revalidateTask(task.projectId, task.id);
    return { ok: true, data: task };
  } catch (error) {
    return toFailure(error, { action: "setMainTaskPhase" });
  }
}
