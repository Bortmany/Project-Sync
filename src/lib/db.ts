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

/** Projects that still exist, newest first. Never use prisma.project.findMany directly for listings. */
export function activeProjects(where: { status?: "ACTIVE" | "ON_HOLD" | "COMPLETED" | "ARCHIVED" } = {}) {
  return prisma.project.findMany({
    where: { ...notDeleted, ...where },
    orderBy: { createdAt: "desc" },
  });
}

/** Projects a specific person belongs to (admins get the full list via activeProjects). */
export function activeProjectsForUser(userId: string) {
  return prisma.project.findMany({
    where: { ...notDeleted, members: { some: { userId } } },
    orderBy: { createdAt: "desc" },
  });
}

/** Live main tasks of a project, soonest deadline first. */
export function activeMainTasks(projectId: string) {
  return prisma.mainTask.findMany({
    where: { projectId, ...notDeleted },
    orderBy: { deadline: "asc" },
  });
}

/** Live discipline tasks of a main task, in display order. */
export function activeDisciplineTasks(mainTaskId: string) {
  return prisma.disciplineTask.findMany({
    where: { mainTaskId, ...notDeleted },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
}

/** Live documents of a project. */
export function activeDocuments(projectId: string) {
  return prisma.document.findMany({
    where: { projectId, ...notDeleted },
    orderBy: { createdAt: "desc" },
  });
}

/** Live comments on a main task or a discipline task. */
export function activeComments(target: { mainTaskId?: string; disciplineTaskId?: string }) {
  return prisma.comment.findMany({
    where: { ...target, ...notDeleted },
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
