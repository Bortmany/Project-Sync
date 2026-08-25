// The bridge from the session cookie to an actor. Only request-time code (routes, server actions) imports this.

import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type { ActorContext } from "@/server/actor";

/** The signed-in person as an actor, or null when nobody is signed in. */
export async function currentActor(): Promise<ActorContext | null> {
  const user = await getSessionUser();
  if (!user) return null;

  const memberships = await prisma.projectMember.findMany({
    where: { userId: user.id },
    select: { projectId: true, projectRole: true, disciplineId: true },
  });

  return {
    userId: user.id,
    role: user.role,
    name: user.name,
    email: user.email,
    memberships,
  };
}

/** The plain-English message shown when a request arrives without a valid session. */
export const SIGNED_OUT_MESSAGE = "Please sign in to continue.";
