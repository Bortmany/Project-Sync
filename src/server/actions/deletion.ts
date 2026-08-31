"use server";

// Server actions for the deleting half of data rights: your own account, and the whole workspace.
// Thin wrappers, as every action is: parse, guard, service, refresh, result. The services do the
// authorisation, the sole-administrator rule, the typed confirmations and the audit rows.

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE } from "@/lib/auth";
import type {
  AccountDeletedDTO,
  ActionResult,
  DeleteMyAccountInput,
  RequestWorkspaceDeletionInput,
  WorkspaceDeletionDTO,
} from "@/lib/zod-schemas";
import {
  DeleteMyAccountInput as DeleteMyAccountSchema,
  RequestWorkspaceDeletionInput as RequestWorkspaceDeletionSchema,
  toFieldErrors,
} from "@/lib/zod-schemas";
import { toFailure } from "@/server/errors";
import { beginMutation, revalidateAdmin } from "@/server/actions/guard";
import * as accountDeletion from "@/server/services/account-deletion";
import * as workspaceDeletion from "@/server/services/workspace-deletion";

const CHECK_FIELDS = "Please check the highlighted fields.";

/**
 * Deletes the signed-in person's own account, and nobody else's.
 *
 * Limited to three presses a minute per person: it is a once-in-a-lifetime action, and the ceiling
 * only exists so a stuck browser cannot hammer it.
 *
 * The service has already dropped every session the account held — that is what signs them out
 * everywhere — so all that is left here is to clear the cookie in front of us, which stops this
 * browser sending a token that no longer matches anything. The screen then sends them to
 * `/login?done=account-deleted`.
 */
export async function deleteMyAccount(
  input: DeleteMyAccountInput,
): Promise<ActionResult<AccountDeletedDTO>> {
  const parsed = DeleteMyAccountSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };
  }

  const guard = await beginMutation("delete-my-account", 3);
  if (guard.failure) return guard.failure;

  try {
    const done = await accountDeletion.deleteMyAccount(guard.actor, parsed.data);
    (await cookies()).delete(SESSION_COOKIE);
    return { ok: true, data: done };
  } catch (error) {
    return toFailure(error, { action: "deleteMyAccount" });
  }
}

/** Schedules the whole workspace for deletion, seven days out. ADMIN, with the name typed exactly. */
export async function requestWorkspaceDeletion(
  input: RequestWorkspaceDeletionInput,
): Promise<ActionResult<WorkspaceDeletionDTO>> {
  const parsed = RequestWorkspaceDeletionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };
  }

  const guard = await beginMutation("request-workspace-deletion", 5);
  if (guard.failure) return guard.failure;

  try {
    const status = await workspaceDeletion.requestWorkspaceDeletion(guard.actor, parsed.data);
    revalidateAfterDeletionChange();
    return { ok: true, data: status };
  } catch (error) {
    return toFailure(error, { action: "requestWorkspaceDeletion" });
  }
}

/**
 * Calls it off. Any administrator of the company may, from the danger card or from the banner, and
 * the limit is deliberately looser than the request's: undoing a dangerous thing should never be
 * the press that gets refused.
 */
export async function cancelWorkspaceDeletion(): Promise<ActionResult<WorkspaceDeletionDTO>> {
  const guard = await beginMutation("cancel-workspace-deletion", 20);
  if (guard.failure) return guard.failure;

  try {
    const status = await workspaceDeletion.cancelWorkspaceDeletion(guard.actor);
    revalidateAfterDeletionChange();
    return { ok: true, data: status };
  } catch (error) {
    return toFailure(error, { action: "cancelWorkspaceDeletion" });
  }
}

/**
 * The admin screens, plus the whole signed-in shell: the pending-deletion banner is rendered in
 * `src/app/(app)/layout.tsx`, so appearing and disappearing means refreshing the layout itself
 * rather than any one page.
 */
function revalidateAfterDeletionChange(): void {
  revalidateAdmin();
  revalidatePath("/", "layout");
}
