"use server";

// Server actions for the Admin section: people and the discipline catalogue.
// Thin wrappers: parse, guard, service, refresh, result. The services do the authorisation.

import { z } from "zod";
import type { ActionResult, DisciplineDTO, UserDTO } from "@/lib/zod-schemas";
import {
  CreateDisciplineInput,
  CreateUserInput,
  UpdateDisciplineInput,
  UpdateUserInput,
  toFieldErrors,
} from "@/lib/zod-schemas";
import { toFailure } from "@/server/errors";
import { beginMutation, revalidateAdmin } from "@/server/actions/guard";
import * as admin from "@/server/services/admin";

const CHECK_FIELDS = "Please check the highlighted fields.";

const ByIdInput = z.object({ id: z.string().min(1).max(40) });

/** Creates an account. The password comes in from the admin's form and is never returned or logged. */
export async function createUser(input: CreateUserInput): Promise<ActionResult<UserDTO>> {
  const parsed = CreateUserInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("create-user", 20);
  if (guard.failure) return guard.failure;

  try {
    const user = await admin.createUser(guard.actor, parsed.data);
    revalidateAdmin();
    return { ok: true, data: user };
  } catch (error) {
    return toFailure(error, { action: "createUser" });
  }
}

export async function updateUser(input: UpdateUserInput): Promise<ActionResult<UserDTO>> {
  const parsed = UpdateUserInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("update-user", 40);
  if (guard.failure) return guard.failure;

  try {
    const user = await admin.updateUser(guard.actor, parsed.data);
    revalidateAdmin();
    return { ok: true, data: user };
  } catch (error) {
    return toFailure(error, { action: "updateUser" });
  }
}

/** Switches sign-in off. Nothing is deleted — the person's history stays on record. */
export async function deactivateUser(input: { id: string }): Promise<ActionResult<UserDTO>> {
  const parsed = ByIdInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("deactivate-user", 20);
  if (guard.failure) return guard.failure;

  try {
    const user = await admin.deactivateUser(guard.actor, parsed.data);
    revalidateAdmin();
    return { ok: true, data: user };
  } catch (error) {
    return toFailure(error, { action: "deactivateUser" });
  }
}

export async function createDiscipline(
  input: CreateDisciplineInput,
): Promise<ActionResult<DisciplineDTO>> {
  const parsed = CreateDisciplineInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("create-discipline", 20);
  if (guard.failure) return guard.failure;

  try {
    const discipline = await admin.createDiscipline(guard.actor, parsed.data);
    revalidateAdmin();
    return { ok: true, data: discipline };
  } catch (error) {
    return toFailure(error, { action: "createDiscipline" });
  }
}

export async function updateDiscipline(
  input: UpdateDisciplineInput,
): Promise<ActionResult<DisciplineDTO>> {
  const parsed = UpdateDisciplineInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("update-discipline", 40);
  if (guard.failure) return guard.failure;

  try {
    const discipline = await admin.updateDiscipline(guard.actor, parsed.data);
    revalidateAdmin();
    return { ok: true, data: discipline };
  } catch (error) {
    return toFailure(error, { action: "updateDiscipline" });
  }
}
