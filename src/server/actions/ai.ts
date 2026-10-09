"use server";

// The AI card on Admin → Integrations: the two switches. A thin wrapper, as every action is:
// parse, guard (signed in + rate limit), service, refresh, result. The service does the
// authorisation (administrator, own company only), the "not set up" refusal and the audit row.

import { revalidatePath } from "next/cache";
import type { ActionResult, AiSettingsDTO, SetAiSettingsInput } from "@/lib/zod-schemas";
import { SetAiSettingsInput as SetAiSettingsInputSchema, toFieldErrors } from "@/lib/zod-schemas";
import { beginMutation } from "@/server/actions/guard";
import { toFailure } from "@/server/errors";
import * as aiSettings from "@/server/services/ai-settings";

/** Presses per person per minute: each switch saves the moment it is pressed. */
const AI_SETTINGS_LIMIT = 10;

/** Switches Ask Tielora and/or AI-written briefs on or off. Answers the card's fresh state. */
export async function setAiSettings(input: SetAiSettingsInput): Promise<ActionResult<AiSettingsDTO>> {
  const parsed = SetAiSettingsInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Couldn't save that. Try again.", fieldErrors: toFieldErrors(parsed.error) };
  }

  const guard = await beginMutation("ai-settings", AI_SETTINGS_LIMIT);
  if (guard.failure) return guard.failure;

  try {
    const saved = await aiSettings.setAiSettings(guard.actor, parsed.data);
    revalidatePath("/admin/integrations");
    revalidatePath("/dashboard");
    return { ok: true, data: saved };
  } catch (error) {
    return toFailure(error, { action: "setAiSettings" });
  }
}
