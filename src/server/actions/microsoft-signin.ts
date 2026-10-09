"use server";

// Server action for Admin → Integrations → Microsoft 365 → "Sign in with Microsoft".
// Switching it ON is a browser journey to Microsoft and back (/api/auth/microsoft/enable), so
// switching it OFF is the only half that can be a server action. It takes no input at all — the
// company is always the signed-in administrator's own — and the service audits it.

import type { ActionResult } from "@/lib/zod-schemas";
import { toFailure } from "@/server/errors";
import { beginMutation, revalidateAdmin } from "@/server/actions/guard";
import * as microsoftSignIn from "@/server/services/microsoft-signin";

/** Forgets the company's Microsoft tenant and every person's Microsoft link. Nobody is signed out. */
export async function disableMicrosoftSignIn(): Promise<ActionResult<{ removed: true }>> {
  const guard = await beginMutation("disable-microsoft-signin", 10);
  if (guard.failure) return guard.failure;

  try {
    const removed = await microsoftSignIn.disableMicrosoftSignIn(guard.actor);
    revalidateAdmin();
    return { ok: true, data: removed };
  } catch (error) {
    return toFailure(error, { action: "disableMicrosoftSignIn" });
  }
}
