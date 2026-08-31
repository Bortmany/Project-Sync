"use server";

// Server actions for discipline tasks, including the completion gate and the "waits on" links.
// Every one of these ends with the parent main task's status and progress re-derived by the service.

import { z } from "zod";
import type { ActionResult, DisciplineTaskDTO } from "@/lib/zod-schemas";
import {
  AddDependencyInput,
  ConfirmReviewInput,
  CreateDisciplineTaskInput,
  RejectReviewInput,
  UpdateDisciplineTaskInput,
  UpdateTaskStatusInput,
  toFieldErrors,
} from "@/lib/zod-schemas";
import { toFailure } from "@/server/errors";
import { beginMutation, revalidateTask } from "@/server/actions/guard";
import * as tasks from "@/server/services/tasks";

const CHECK_FIELDS = "Please check the highlighted fields.";

const id = z.string().min(1).max(40);
const ByIdInput = z.object({ id });
const ReopenInput = z.object({
  id,
  reason: z.string().trim().min(5, "Give a short reason (at least 5 characters).").max(500),
});

export async function createDisciplineTask(
  input: CreateDisciplineTaskInput,
): Promise<ActionResult<DisciplineTaskDTO>> {
  const parsed = CreateDisciplineTaskInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("create-discipline-task");
  if (guard.failure) return guard.failure;

  try {
    const task = await tasks.createDisciplineTask(guard.actor, parsed.data);
    revalidateTask(task.projectId, task.mainTaskId, task.id);
    return { ok: true, data: task };
  } catch (error) {
    return toFailure(error, { action: "createDisciplineTask" });
  }
}

export async function updateDisciplineTask(
  input: UpdateDisciplineTaskInput,
): Promise<ActionResult<DisciplineTaskDTO>> {
  const parsed = UpdateDisciplineTaskInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("update-discipline-task");
  if (guard.failure) return guard.failure;

  try {
    const task = await tasks.updateDisciplineTask(guard.actor, parsed.data);
    revalidateTask(task.projectId, task.mainTaskId, task.id);
    return { ok: true, data: task };
  } catch (error) {
    return toFailure(error, { action: "updateDisciplineTask" });
  }
}

export async function updateDisciplineTaskStatus(
  input: UpdateTaskStatusInput,
): Promise<ActionResult<DisciplineTaskDTO>> {
  const parsed = UpdateTaskStatusInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("update-discipline-task-status", 120);
  if (guard.failure) return guard.failure;

  try {
    const task = await tasks.updateDisciplineTaskStatus(guard.actor, parsed.data);
    revalidateTask(task.projectId, task.mainTaskId, task.id);
    return { ok: true, data: task };
  } catch (error) {
    return toFailure(error, { action: "updateDisciplineTaskStatus" });
  }
}

/** The gate: refused, in plain English, while a mandatory document or an earlier task is outstanding. */
export async function completeDisciplineTask(input: { id: string }): Promise<ActionResult<DisciplineTaskDTO>> {
  const parsed = ByIdInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("complete-discipline-task", 120);
  if (guard.failure) return guard.failure;

  try {
    const task = await tasks.completeDisciplineTask(guard.actor, parsed.data);
    revalidateTask(task.projectId, task.mainTaskId, task.id);
    return { ok: true, data: task };
  } catch (error) {
    return toFailure(error, { action: "completeDisciplineTask" });
  }
}

export async function reopenDisciplineTask(input: {
  id: string;
  reason: string;
}): Promise<ActionResult<DisciplineTaskDTO>> {
  const parsed = ReopenInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("reopen-discipline-task");
  if (guard.failure) return guard.failure;

  try {
    const task = await tasks.reopenDisciplineTask(guard.actor, parsed.data);
    revalidateTask(task.projectId, task.mainTaskId, task.id);
    return { ok: true, data: task };
  } catch (error) {
    return toFailure(error, { action: "reopenDisciplineTask" });
  }
}

/**
 * Signing a contractor's work off. This does not skip the completion gate — it runs it: required
 * documents, open dependencies and the stage gate are all judged exactly as usual, in the service.
 */
export async function confirmDisciplineTaskReview(
  input: ConfirmReviewInput,
): Promise<ActionResult<DisciplineTaskDTO>> {
  const parsed = ConfirmReviewInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("confirm-discipline-task-review", 120);
  if (guard.failure) return guard.failure;

  try {
    const task = await tasks.confirmDisciplineTaskReview(guard.actor, parsed.data);
    revalidateTask(task.projectId, task.mainTaskId, task.id);
    return { ok: true, data: task };
  } catch (error) {
    return toFailure(error, { action: "confirmDisciplineTaskReview" });
  }
}

/** Sending it back instead, with a note saying what needs changing. */
export async function rejectDisciplineTaskReview(
  input: RejectReviewInput,
): Promise<ActionResult<DisciplineTaskDTO>> {
  const parsed = RejectReviewInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("reject-discipline-task-review", 120);
  if (guard.failure) return guard.failure;

  try {
    const task = await tasks.rejectDisciplineTaskReview(guard.actor, parsed.data);
    revalidateTask(task.projectId, task.mainTaskId, task.id);
    return { ok: true, data: task };
  } catch (error) {
    return toFailure(error, { action: "rejectDisciplineTaskReview" });
  }
}

export async function addDependency(input: AddDependencyInput): Promise<ActionResult<DisciplineTaskDTO>> {
  const parsed = AddDependencyInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("add-dependency");
  if (guard.failure) return guard.failure;

  try {
    const task = await tasks.addDependency(guard.actor, parsed.data);
    revalidateTask(task.projectId, task.mainTaskId, task.id);
    return { ok: true, data: task };
  } catch (error) {
    return toFailure(error, { action: "addDependency" });
  }
}

export async function removeDependency(input: AddDependencyInput): Promise<ActionResult<DisciplineTaskDTO>> {
  const parsed = AddDependencyInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("remove-dependency");
  if (guard.failure) return guard.failure;

  try {
    const task = await tasks.removeDependency(guard.actor, parsed.data);
    revalidateTask(task.projectId, task.mainTaskId, task.id);
    return { ok: true, data: task };
  } catch (error) {
    return toFailure(error, { action: "removeDependency" });
  }
}
