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
