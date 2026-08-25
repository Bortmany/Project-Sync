"use server";

// The sidebar's private to-do list: add a line, tick it off, throw it away. Thin wrappers — the
// "this is mine" check lives in the service, where every query is scoped to the signed-in person.
//
// These deliberately write no ActivityLog row: a private list is a personal preference, not a
// change to a project, and the audit trail records project work only (the same documented exception
// as marking a notification read).

import type {
  ActionResult,
  CreatePersonalTaskInput,
  DeletePersonalTaskInput,
  PersonalTaskDTO,
  TogglePersonalTaskInput,
} from "@/lib/zod-schemas";
import {
  CreatePersonalTaskInput as CreateSchema,
  DeletePersonalTaskInput as DeleteSchema,
  TogglePersonalTaskInput as ToggleSchema,
  toFieldErrors,
} from "@/lib/zod-schemas";
import { toFailure } from "@/server/errors";
import { beginMutation } from "@/server/actions/guard";
import * as personalTasks from "@/server/services/personal-tasks";

const CHECK_FIELDS = "Please check the highlighted fields.";

export async function createPersonalTask(
  input: CreatePersonalTaskInput,
): Promise<ActionResult<PersonalTaskDTO>> {
  const parsed = CreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };
  }

  const guard = await beginMutation("create-personal-task", 120);
  if (guard.failure) return guard.failure;

  try {
    return { ok: true, data: await personalTasks.createPersonalTask(guard.actor, parsed.data) };
  } catch (error) {
    return toFailure(error, { action: "createPersonalTask" });
  }
}

export async function togglePersonalTask(
  input: TogglePersonalTaskInput,
): Promise<ActionResult<PersonalTaskDTO>> {
  const parsed = ToggleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };
  }

  const guard = await beginMutation("toggle-personal-task", 240);
  if (guard.failure) return guard.failure;

  try {
    return { ok: true, data: await personalTasks.togglePersonalTask(guard.actor, parsed.data) };
  } catch (error) {
    return toFailure(error, { action: "togglePersonalTask" });
  }
}

export async function deletePersonalTask(
  input: DeletePersonalTaskInput,
): Promise<ActionResult<{ removed: true }>> {
  const parsed = DeleteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };
  }

  const guard = await beginMutation("delete-personal-task", 120);
  if (guard.failure) return guard.failure;

  try {
    return { ok: true, data: await personalTasks.deletePersonalTask(guard.actor, parsed.data) };
  } catch (error) {
    return toFailure(error, { action: "deletePersonalTask" });
  }
}
