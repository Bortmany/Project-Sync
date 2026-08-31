"use server";

// Server actions for Admin → Integrations: the Slack and Teams webhook addresses.
// Thin wrappers: parse, guard, service, refresh, result. The service does the authorisation and is
// the only place the saved address is ever read — nothing here returns it.

import type {
  ActionResult,
  IntegrationKindInput,
  IntegrationTestResultDTO,
  OrgIntegrationDTO,
  SaveIntegrationInput,
  SetEventTogglesInput,
  SetIntegrationEnabledInput,
} from "@/lib/zod-schemas";
import {
  IntegrationKindInput as KindInputSchema,
  SaveIntegrationInput as SaveInputSchema,
  SetEventTogglesInput as TogglesInputSchema,
  SetIntegrationEnabledInput as EnabledInputSchema,
  toFieldErrors,
} from "@/lib/zod-schemas";
import { toFailure } from "@/server/errors";
import { beginMutation, revalidateAdmin } from "@/server/actions/guard";
import * as integrations from "@/server/services/integrations";

const CHECK_FIELDS = "Please check the highlighted fields.";

/** Saves a pasted webhook address. Replacing one means pasting the new address in full. */
export async function saveIntegration(
  input: SaveIntegrationInput,
): Promise<ActionResult<OrgIntegrationDTO>> {
  const parsed = SaveInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("save-integration", 20);
  if (guard.failure) return guard.failure;

  try {
    const saved = await integrations.saveIntegration(guard.actor, parsed.data);
    revalidateAdmin();
    return { ok: true, data: saved };
  } catch (error) {
    return toFailure(error, { action: "saveIntegration" });
  }
}

export async function setIntegrationEnabled(
  input: SetIntegrationEnabledInput,
): Promise<ActionResult<OrgIntegrationDTO>> {
  const parsed = EnabledInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("set-integration-enabled", 30);
  if (guard.failure) return guard.failure;

  try {
    const updated = await integrations.setIntegrationEnabled(guard.actor, parsed.data);
    revalidateAdmin();
    return { ok: true, data: updated };
  } catch (error) {
    return toFailure(error, { action: "setIntegrationEnabled" });
  }
}

export async function setEventToggles(
  input: SetEventTogglesInput,
): Promise<ActionResult<OrgIntegrationDTO>> {
  const parsed = TogglesInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("set-integration-events", 40);
  if (guard.failure) return guard.failure;

  try {
    const updated = await integrations.setEventToggles(guard.actor, parsed.data);
    revalidateAdmin();
    return { ok: true, data: updated };
  } catch (error) {
    return toFailure(error, { action: "setEventToggles" });
  }
}

/**
 * Sends one test card. Limited far more tightly than the other mutations — five a minute per
 * person — because every press posts into somebody's chat channel and chat tools rate limit hard.
 */
export async function sendTestMessage(
  input: IntegrationKindInput,
): Promise<ActionResult<IntegrationTestResultDTO>> {
  const parsed = KindInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("send-integration-test", 5);
  if (guard.failure) return guard.failure;

  try {
    const result = await integrations.sendIntegrationTest(guard.actor, parsed.data);
    return { ok: true, data: result };
  } catch (error) {
    return toFailure(error, { action: "sendTestMessage" });
  }
}

/** Removes the connection, address and all. The audit rows of it having existed stay. */
export async function deleteIntegration(
  input: IntegrationKindInput,
): Promise<ActionResult<{ removed: true }>> {
  const parsed = KindInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("delete-integration", 20);
  if (guard.failure) return guard.failure;

  try {
    const removed = await integrations.deleteIntegration(guard.actor, parsed.data);
    revalidateAdmin();
    return { ok: true, data: removed };
  } catch (error) {
    return toFailure(error, { action: "deleteIntegration" });
  }
}
