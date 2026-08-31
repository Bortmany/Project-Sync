"use server";

// The two "send that email again" actions, both of which need somebody signed in.
// Thin wrappers: parse, guard (which is where the per-person rate limit lives), service, result.
// Neither ever returns a link, a token or an address — only that we tried.

import type { ActionResult, EmailSentDTO } from "@/lib/zod-schemas";
import { ResendInviteInput, toFieldErrors } from "@/lib/zod-schemas";
import { toFailure } from "@/server/errors";
import { beginMutation, revalidateAdmin } from "@/server/actions/guard";
import * as account from "@/server/services/account";

const CHECK_FIELDS = "Please check the highlighted fields.";

/** Presses per person per minute. Each one puts a real message in somebody's inbox. */
const RESEND_LIMIT = 3;

/** "Resend verification email", from the banner. Only ever your own address. */
export async function resendVerificationEmail(): Promise<ActionResult<EmailSentDTO>> {
  const guard = await beginMutation("resend-verification", RESEND_LIMIT);
  if (guard.failure) return guard.failure;

  try {
    return { ok: true, data: await account.resendVerification(guard.actor) };
  } catch (error) {
    return toFailure(error, { action: "resendVerificationEmail" });
  }
}

/** "Resend invite email", from Admin → Users. Administrators, in their own company only. */
export async function resendInvite(input: ResendInviteInput): Promise<ActionResult<EmailSentDTO>> {
  const parsed = ResendInviteInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };
  }

  const guard = await beginMutation("resend-invite", RESEND_LIMIT);
  if (guard.failure) return guard.failure;

  try {
    const sent = await account.resendInvite(guard.actor, parsed.data);
    revalidateAdmin();
    return { ok: true, data: sent };
  } catch (error) {
    return toFailure(error, { action: "resendInvite" });
  }
}
