// Who is acting. Services never trust a caller-supplied identity — they take one of these, built here.
// This module deliberately avoids next/headers so the seed and the service tests can build an actor too.

import { prisma } from "@/lib/db";
import type { Actor } from "@/lib/permissions";
import { NotFoundError } from "@/server/errors";

/** A permissions Actor plus the display name used in audit summaries. */
export type ActorContext = Actor & { name: string; email: string };

/** Builds the actor for a person id: their global role plus every project they belong to. */
export async function actorForUser(userId: string): Promise<ActorContext> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, orgId: true, name: true, email: true, role: true, isActive: true },
  });
  if (!user || !user.isActive) throw new NotFoundError("We could not find that person.");

  const memberships = await prisma.projectMember.findMany({
    where: { userId },
    select: { projectId: true, projectRole: true, disciplineId: true },
  });

  return {
    userId: user.id,
    orgId: user.orgId,
    role: user.role,
    name: user.name,
    email: user.email,
    memberships,
  };
}

/** True when this person belongs to the project (admins are treated as members everywhere else). */
export function isMemberOf(actor: ActorContext, projectId: string): boolean {
  return actor.memberships.some((membership) => membership.projectId === projectId);
}

/**
 * True when this person is a contractor from another company.
 *
 * THE EXTERNAL RULE, the read-side twin of the tenant rule: a contractor sees the discipline tasks
 * assigned to them and the smallest amount of parent context needed to understand them — never
 * another task, never the team roster, never a project they hold no work on. Anything else they ask
 * for is NOT FOUND, never "forbidden", so they never learn an id is real.
 */
export function isExternal(actor: ActorContext): boolean {
  return actor.role === "EXTERNAL";
}

/**
 * The one filter fragment that carries that rule into a query: `{ assigneeId }` for a contractor,
 * nothing at all for everybody else. Spread it into any DisciplineTask `where` clause —
 * `where: { ...notDeleted, ...externalTaskScope(actor) }` — and the listing narrows itself.
 */
export function externalTaskScope(actor: ActorContext): { assigneeId?: string } {
  return isExternal(actor) ? { assigneeId: actor.userId } : {};
}
