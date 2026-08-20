// The first half of the mutation chain, shared by every server action: signed in, then rate limited.
// (This file is not a "use server" module on purpose — it exports helpers, not actions.)

import { revalidatePath } from "next/cache";
import { byUser, limit } from "@/lib/rate-limit";
import type { ActionResult } from "@/lib/zod-schemas";
import type { ActorContext } from "@/server/actor";
import { SIGNED_OUT_MESSAGE, currentActor } from "@/server/session";

/** Mutations per person per minute, per kind of mutation. */
const MUTATION_LIMIT = 60;
const MUTATION_WINDOW_MS = 60_000;

type Guarded =
  | { actor: ActorContext; failure?: undefined }
  | { actor?: undefined; failure: ActionResult<never> };

/** Signed-in check plus rate limit. Returns the actor, or the failure to hand straight back. */
export async function beginMutation(scope: string, max = MUTATION_LIMIT): Promise<Guarded> {
  const actor = await currentActor();
  if (!actor) return { failure: { ok: false, error: SIGNED_OUT_MESSAGE } };

  const throttle = limit(byUser(actor.userId, scope), max, MUTATION_WINDOW_MS);
  if (!throttle.ok) {
    return {
      failure: {
        ok: false,
        error: `That is a lot of changes at once. Please wait ${throttle.retryAfterSec} seconds and try again.`,
      },
    };
  }

  return { actor };
}

/** Refreshes the pages a project change is visible on. */
export function revalidateProject(projectId: string): void {
  revalidatePath("/dashboard");
  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
}

/** Refreshes the pages a task change is visible on. */
export function revalidateTask(projectId: string, mainTaskId: string, disciplineTaskId?: string): void {
  revalidateProject(projectId);
  revalidatePath(`/tasks/${mainTaskId}`);
  if (disciplineTaskId) revalidatePath(`/discipline-tasks/${disciplineTaskId}`);
}
