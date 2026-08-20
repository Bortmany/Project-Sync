"use server";

// Server actions for main tasks. Thin wrappers: parse, guard, service, refresh, result.
// Nothing here writes a status or a percentage by hand — the service derives both.

import { z } from "zod";
import type { ActionResult, DisciplineTaskDTO, MainTaskDTO } from "@/lib/zod-schemas";
import {
  CreateMainTaskInput,
  OverrideStatusInput,
  UpdateMainTaskInput,
  UpdateTaskDatesInput,
  toFieldErrors,
} from "@/lib/zod-schemas";
import { toFailure } from "@/server/errors";
import { beginMutation, revalidateTask } from "@/server/actions/guard";
import * as tasks from "@/server/services/tasks";

const CHECK_FIELDS = "Please check the highlighted fields.";

const ByIdInput = z.object({ id: z.string().min(1).max(40) });

export async function createMainTask(input: CreateMainTaskInput): Promise<ActionResult<MainTaskDTO>> {
  const parsed = CreateMainTaskInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("create-main-task");
  if (guard.failure) return guard.failure;

  try {
    const task = await tasks.createMainTask(guard.actor, parsed.data);
    revalidateTask(task.projectId, task.id);
    return { ok: true, data: task };
  } catch (error) {
    return toFailure(error, { action: "createMainTask" });
  }
}

export async function updateMainTask(input: UpdateMainTaskInput): Promise<ActionResult<MainTaskDTO>> {
  const parsed = UpdateMainTaskInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("update-main-task");
  if (guard.failure) return guard.failure;

  try {
    const task = await tasks.updateMainTask(guard.actor, parsed.data);
    revalidateTask(task.projectId, task.id);
    return { ok: true, data: task };
  } catch (error) {
    return toFailure(error, { action: "updateMainTask" });
  }
}

/** The recorded, authorised bypass. Project managers and administrators only, reason always kept. */
export async function overrideMainTaskStatus(input: OverrideStatusInput): Promise<ActionResult<MainTaskDTO>> {
  const parsed = OverrideStatusInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("override-main-task-status", 20);
  if (guard.failure) return guard.failure;

  try {
    const task = await tasks.overrideMainTaskStatus(guard.actor, parsed.data);
    revalidateTask(task.projectId, task.id);
    return { ok: true, data: task };
  } catch (error) {
    return toFailure(error, { action: "overrideMainTaskStatus" });
  }
}

export async function clearOverride(input: { id: string }): Promise<ActionResult<MainTaskDTO>> {
  const parsed = ByIdInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("clear-override", 20);
  if (guard.failure) return guard.failure;

  try {
    const task = await tasks.clearOverride(guard.actor, parsed.data);
    revalidateTask(task.projectId, task.id);
    return { ok: true, data: task };
  } catch (error) {
    return toFailure(error, { action: "clearOverride" });
  }
}

/** Dragging a bar on the Gantt chart: new dates for a main task or a discipline task. */
export async function updateTaskDates(
  input: UpdateTaskDatesInput,
): Promise<ActionResult<MainTaskDTO | DisciplineTaskDTO>> {
  const parsed = UpdateTaskDatesInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("update-task-dates", 120);
  if (guard.failure) return guard.failure;

  try {
    const task = await tasks.updateTaskDates(guard.actor, parsed.data);
    if ("mainTaskId" in task) revalidateTask(task.projectId, task.mainTaskId, task.id);
    else revalidateTask(task.projectId, task.id);
    return { ok: true, data: task };
  } catch (error) {
    return toFailure(error, { action: "updateTaskDates" });
  }
}
