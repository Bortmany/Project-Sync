// Page-level "does this exist for you?" checks. A page that names one record by id asks the same
// service the API uses; an answer of "not found" — a nonexistent id, another company's id, or work a
// contractor does not hold — becomes the app's ordinary not-found page, identical in every case so
// the page cannot be used to tell which ids are real. Any other failure is left to throw, so a genuine
// fault still reaches the error screen rather than being passed off as a missing page.

import { notFound } from "next/navigation";
import { ForbiddenError } from "@/lib/permissions";
import { isExternal, type ActorContext } from "@/server/actor";
import { NotFoundError } from "@/server/errors";
import { currentActor } from "@/server/session";
import { getProjectForActor } from "@/server/services/projects";
import { getDisciplineTaskForActor, getMainTaskForActor } from "@/server/services/tasks";

async function orNotFound(check: (actor: ActorContext) => Promise<unknown>): Promise<void> {
  const actor = await currentActor();
  // Signed out is the shell's business (it redirects to sign-in before any page renders).
  if (!actor) return;
  try {
    await check(actor);
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) notFound();
    throw error;
  }
}

export const requireProjectVisible = (id: string) => orNotFound((actor) => getProjectForActor(actor, id));
export const requireMainTaskVisible = (id: string) => orNotFound((actor) => getMainTaskForActor(actor, id));
export const requireDisciplineTaskVisible = (id: string) =>
  orNotFound((actor) => getDisciplineTaskForActor(actor, id));

/**
 * THE EXTERNAL RULE for the Admin section: a contractor has no Admin area at all, so every Admin
 * page is the ordinary not-found page for them — the same one a path that was never there gives.
 */
export async function hideAdminFromContractors(): Promise<void> {
  const actor = await currentActor();
  if (actor && isExternal(actor)) notFound();
}
