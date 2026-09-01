"use server";

// Server actions for two-factor sign-in: setting it up, finishing it, replacing the recovery codes,
// turning it off, and an administrator's reset for somebody whose phone is gone.
// Thin wrappers, as every action is: parse, guard, service, refresh, result. The service does the
// authorisation, the proof, the transactions and the audit rows.
//
// Nothing here ever logs, audits or returns the secret. The QR code and the manual key leave once,
// in the answer to `beginTwoFactorEnrollment`; the recovery codes leave once, in the answer to
// `confirmTwoFactorEnrollment` or `regenerateRecoveryCodes`.

import { revalidatePath } from "next/cache";
import type {
  ActionResult,
  AdminResetTwoFactorInput,
  ConfirmTwoFactorInput,
  TwoFactorCodesDTO,
  TwoFactorEnrollmentDTO,
  TwoFactorProofInput,
  TwoFactorStatusDTO,
} from "@/lib/zod-schemas";
import {
  AdminResetTwoFactorInput as AdminResetTwoFactorSchema,
  ConfirmTwoFactorInput as ConfirmTwoFactorSchema,
  TwoFactorProofInput as TwoFactorProofSchema,
  toFieldErrors,
} from "@/lib/zod-schemas";
import { toFailure } from "@/server/errors";
import { beginMutation, revalidateAdmin } from "@/server/actions/guard";
import * as admin from "@/server/services/admin";
import * as twoFactor from "@/server/services/two-factor";

const CHECK_FIELDS = "Please check the highlighted fields.";

/** Starts enrolment: a fresh secret, a QR code and the same key in letters. Nothing is switched on. */
export async function beginTwoFactorEnrollment(): Promise<ActionResult<TwoFactorEnrollmentDTO>> {
  const guard = await beginMutation("begin-two-factor", 10);
  if (guard.failure) return guard.failure;

  try {
    return { ok: true, data: await twoFactor.beginTwoFactorEnrollment(guard.actor) };
  } catch (error) {
    return toFailure(error, { action: "beginTwoFactorEnrollment" });
  }
}

/**
 * Finishes enrolment with the first working code, and hands back the eight recovery codes — the one
 * and only time they are readable.
 */
export async function confirmTwoFactorEnrollment(
  input: ConfirmTwoFactorInput,
): Promise<ActionResult<TwoFactorCodesDTO>> {
  const parsed = ConfirmTwoFactorSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };
  }

  const guard = await beginMutation("confirm-two-factor", 10);
  if (guard.failure) return guard.failure;

  try {
    const codes = await twoFactor.confirmTwoFactorEnrollment(guard.actor, parsed.data);
    revalidatePath("/account");
    return { ok: true, data: codes };
  } catch (error) {
    return toFailure(error, { action: "confirmTwoFactorEnrollment" });
  }
}

/** Switches it off. A live code or an unused recovery code — never the password on its own. */
export async function disableTwoFactor(
  input: TwoFactorProofInput,
): Promise<ActionResult<TwoFactorStatusDTO>> {
  const parsed = TwoFactorProofSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };
  }

  const guard = await beginMutation("disable-two-factor", 10);
  if (guard.failure) return guard.failure;

  try {
    const status = await twoFactor.disableTwoFactor(guard.actor, parsed.data);
    revalidatePath("/account");
    return { ok: true, data: status };
  } catch (error) {
    return toFailure(error, { action: "disableTwoFactor" });
  }
}

/** Eight fresh recovery codes. Every earlier one stops working the moment this commits. */
export async function regenerateRecoveryCodes(
  input: TwoFactorProofInput,
): Promise<ActionResult<TwoFactorCodesDTO>> {
  const parsed = TwoFactorProofSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };
  }

  const guard = await beginMutation("regenerate-recovery-codes", 10);
  if (guard.failure) return guard.failure;

  try {
    const codes = await twoFactor.regenerateRecoveryCodes(guard.actor, parsed.data);
    revalidatePath("/account");
    return { ok: true, data: codes };
  } catch (error) {
    return toFailure(error, { action: "regenerateRecoveryCodes" });
  }
}

/**
 * An administrator turning somebody else's two-factor off. Their own account is refused — that one
 * belongs on their own account page, with a code.
 */
export async function adminResetTwoFactor(
  input: AdminResetTwoFactorInput,
): Promise<ActionResult<{ reset: true }>> {
  const parsed = AdminResetTwoFactorSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };
  }

  const guard = await beginMutation("admin-reset-two-factor", 10);
  if (guard.failure) return guard.failure;

  try {
    await admin.adminResetTwoFactor(guard.actor, parsed.data);
    revalidateAdmin();
    return { ok: true, data: { reset: true } };
  } catch (error) {
    return toFailure(error, { action: "adminResetTwoFactor" });
  }
}
