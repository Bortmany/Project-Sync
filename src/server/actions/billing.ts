"use server";

// Server actions for Admin → Billing: the two buttons that send an administrator to the payment
// provider. Thin wrappers, as every action is: guard, service, result. The service does the
// authorisation, the audit row and the talking to the provider.
//
// Neither action takes an input, and neither returns anything but the one address the browser is
// about to navigate to. That address is never stored, never logged and never written to an audit
// row — it is minted for this press and this person.

import type { ActionResult, BillingRedirectDTO } from "@/lib/zod-schemas";
import { toFailure } from "@/server/errors";
import { beginMutation } from "@/server/actions/guard";
import * as billing from "@/server/services/billing";

/**
 * "Upgrade to Pro". Limited more tightly than an ordinary mutation — ten a minute per person —
 * because each press asks the payment provider to create something.
 */
export async function startUpgrade(): Promise<ActionResult<BillingRedirectDTO>> {
  const guard = await beginMutation("start-upgrade", 10);
  if (guard.failure) return guard.failure;

  try {
    return { ok: true, data: await billing.startUpgrade(guard.actor) };
  } catch (error) {
    return toFailure(error, { action: "startUpgrade" });
  }
}

/** "Manage billing". A fresh, single-use address from the provider on every press, never a cached one. */
export async function openBillingPortal(): Promise<ActionResult<BillingRedirectDTO>> {
  const guard = await beginMutation("open-billing-portal", 10);
  if (guard.failure) return guard.failure;

  try {
    return { ok: true, data: await billing.openBillingPortal(guard.actor) };
  } catch (error) {
    return toFailure(error, { action: "openBillingPortal" });
  }
}
