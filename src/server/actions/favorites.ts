"use server";

// Starring and un-starring, from one button. Thin wrapper — the "may this person see it?" check
// lives in the service.
//
// This deliberately writes no ActivityLog row: a favorite is a personal preference, not a change to
// a project, and the audit trail records project work only (the same documented exception as
// marking a notification read).

import type { ActionResult, ToggleFavoriteInput } from "@/lib/zod-schemas";
import { ToggleFavoriteInput as ToggleFavoriteSchema, toFieldErrors } from "@/lib/zod-schemas";
import { toFailure } from "@/server/errors";
import { beginMutation } from "@/server/actions/guard";
import * as favorites from "@/server/services/favorites";

const CHECK_FIELDS = "Please check the highlighted fields.";

export async function toggleFavorite(
  input: ToggleFavoriteInput,
): Promise<ActionResult<{ favorited: boolean }>> {
  const parsed = ToggleFavoriteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };
  }

  const guard = await beginMutation("toggle-favorite", 120);
  if (guard.failure) return guard.failure;

  try {
    return { ok: true, data: await favorites.toggleFavorite(guard.actor, parsed.data) };
  } catch (error) {
    return toFailure(error, { action: "toggleFavorite" });
  }
}
