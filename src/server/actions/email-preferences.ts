"use server";

// The Email card on Your account: the signed-in person's own alert and brief email choices.
// A thin wrapper, as every action is: parse, guard (signed in + rate limit), service, refresh,
// result. No id and no `assertCan` — the only account it can reach is the session's, exactly as
// `deleteMyAccount` works. The service writes the audit row inside its own transaction.

import { revalidatePath } from "next/cache";
import type {
  ActionResult,
  EmailPreferencesDTO,
  EmailPreferencesInput,
} from "@/lib/zod-schemas";
import {
  EmailPreferencesInput as EmailPreferencesInputSchema,
  toFieldErrors,
} from "@/lib/zod-schemas";
import { toFailure } from "@/server/errors";
import { beginMutation } from "@/server/actions/guard";
import * as emailPreferences from "@/server/services/email-preferences";

/** Presses per person per minute. Generous: each switch saves the moment it is pressed. */
const PREFERENCES_LIMIT = 30;

/** Saves one or more of the three switches. Answers the card's fresh state. */
export async function setEmailPreferences(
  input: EmailPreferencesInput,
): Promise<ActionResult<EmailPreferencesDTO>> {
  const parsed = EmailPreferencesInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Couldn't save that. Try again.",
      fieldErrors: toFieldErrors(parsed.error),
    };
  }

  const guard = await beginMutation("email-preferences", PREFERENCES_LIMIT);
  if (guard.failure) return guard.failure;

  try {
    const saved = await emailPreferences.setEmailPreferences(guard.actor, parsed.data);
    revalidatePath("/account");
    return { ok: true, data: saved };
  } catch (error) {
    return toFailure(error, { action: "setEmailPreferences" });
  }
}
