// The Prisma client singleton plus the soft-delete-safe query helpers every listing must go through.

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
}

function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString, max: Number(process.env.DB_POOL_MAX ?? 10) });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/** Reusable "not soft-deleted" filter. */
export const notDeleted = { deletedAt: null } as const;

/**
 * THE TENANT CHOKE POINT.
 *
 * Every helper below takes the acting person's `orgId` as its FIRST argument and filters on it — a
 * listing cannot be written through this file without saying whose company it is for. That is
 * deliberate: a service author who forgets that organisations exist gets a compile error here rather
 * than a leak in production. `orgId` always comes from the session (`actor.orgId`), never from a
 * request body.
 */

/** Projects that still exist in this organisation, newest first. Never use prisma.project.findMany directly for listings. */
export function activeProjects(
  orgId: string,
  where: { status?: "ACTIVE" | "ON_HOLD" | "COMPLETED" | "ARCHIVED" } = {},
) {
  return prisma.project.findMany({
    where: { orgId, ...notDeleted, ...where },
    orderBy: { createdAt: "desc" },
  });
}

/** Projects a specific person belongs to (admins get their organisation's full list via activeProjects). */
export function activeProjectsForUser(orgId: string, userId: string) {
  return prisma.project.findMany({
    where: { orgId, ...notDeleted, members: { some: { userId } } },
    orderBy: { createdAt: "desc" },
  });
}

/** Live main tasks of a project, soonest deadline first. Another organisation's project yields nothing. */
export function activeMainTasks(orgId: string, projectId: string) {
  return prisma.mainTask.findMany({
    where: { projectId, project: { orgId }, ...notDeleted },
    orderBy: { deadline: "asc" },
  });
}

/** Live discipline tasks of a main task, in display order. */
export function activeDisciplineTasks(orgId: string, mainTaskId: string) {
  return prisma.disciplineTask.findMany({
    where: { mainTaskId, mainTask: { project: { orgId } }, ...notDeleted },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
}

/** Live documents of a project. */
export function activeDocuments(orgId: string, projectId: string) {
  return prisma.document.findMany({
    where: { projectId, project: { orgId }, ...notDeleted },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Live comments on a main task or a discipline task — exactly one of the two.
 * Called with neither, this used to fall through to "discipline task with no id", which quietly
 * matches nothing; it now says so out loud, because a listing that silently returns [] is how a
 * missing filter hides.
 */
export function activeComments(
  orgId: string,
  target: { mainTaskId?: string; disciplineTaskId?: string },
) {
  if (!target.mainTaskId && !target.disciplineTaskId) {
    throw new Error("activeComments needs a mainTaskId or a disciplineTaskId.");
  }

  return prisma.comment.findMany({
    where: {
      ...target,
      ...notDeleted,
      ...(target.mainTaskId
        ? { mainTask: { project: { orgId } } }
        : { disciplineTask: { mainTask: { project: { orgId } } } }),
    },
    orderBy: { createdAt: "asc" },
  });
}

/** Simple database reachability check for /api/health. */
export async function pingDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
