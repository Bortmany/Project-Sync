// A small harness for the service tests: a clean test database between tests, plus the fixtures
// every scenario needs (people, a project, a main task with its discipline tasks).

import { prisma } from "@/lib/db";
import type { RoleName } from "@/lib/zod-schemas";
import { actorForUser, type ActorContext } from "@/server/actor";

const TABLES = [
  "ActivityLog",
  "Notification",
  "Favorite",
  "PersonalTask",
  "TaskDependency",
  "RequiredDocument",
  "DocumentVersion",
  "Document",
  "Comment",
  "DisciplineTask",
  "MainTask",
  "ProjectMember",
  "ProjectDiscipline",
  "Project",
  "Session",
  "User",
  "Discipline",
];

/** Empties every table. Only ever run against DATABASE_URL_TEST. */
export async function resetDatabase(): Promise<void> {
  const list = TABLES.map((table) => `"${table}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export async function makeUser(options: {
  name: string;
  role: RoleName;
  disciplineId?: string | null;
}): Promise<{ id: string; name: string }> {
  const user = await prisma.user.create({
    data: {
      email: `${options.name.toLowerCase().replace(/[^a-z]+/g, ".")}.${Date.now()}${Math.random()}@test.example`,
      name: options.name,
      passwordHash: "not-a-real-hash",
      role: options.role,
      disciplineId: options.disciplineId ?? null,
    },
  });
  return { id: user.id, name: user.name };
}

export async function makeDiscipline(code: string, sortOrder = 1): Promise<{ id: string; code: string }> {
  const discipline = await prisma.discipline.create({
    data: { code, name: `${code} discipline`, colorHex: "#00558C", sortOrder },
  });
  return { id: discipline.id, code: discipline.code };
}

export type Fixture = {
  disciplineId: string;
  otherDisciplineId: string;
  adminActor: ActorContext;
  pmActor: ActorContext;
  engineerActor: ActorContext;
  outsiderActor: ActorContext;
  projectId: string;
};

/**
 * A project with one discipline, an administrator, a project manager, an engineer on the project,
 * and one person who is on nothing at all.
 */
export async function makeProjectFixture(): Promise<Fixture> {
  const discipline = await makeDiscipline("MECH", 1);
  const otherDiscipline = await makeDiscipline("ELEC", 2);

  const admin = await makeUser({ name: "Nexus Administrator", role: "ADMIN" });
  const pm = await makeUser({ name: "Layla al-Riyami", role: "PROJECT_MANAGER" });
  const engineer = await makeUser({ name: "John Carter", role: "ENGINEER", disciplineId: discipline.id });
  const outsider = await makeUser({ name: "Priya Nair", role: "ENGINEER" });

  const project = await prisma.project.create({
    data: {
      name: "Test project",
      code: `TEST-${Math.floor(Math.random() * 1_000_000)}`,
      description: "A project for the service tests.",
      createdById: admin.id,
      disciplines: {
        create: [{ disciplineId: discipline.id }, { disciplineId: otherDiscipline.id }],
      },
      members: {
        create: [
          { userId: admin.id, projectRole: "ADMIN" },
          { userId: pm.id, projectRole: "PROJECT_MANAGER" },
          { userId: engineer.id, projectRole: "ENGINEER", disciplineId: discipline.id },
        ],
      },
    },
  });

  return {
    disciplineId: discipline.id,
    otherDisciplineId: otherDiscipline.id,
    adminActor: await actorForUser(admin.id),
    pmActor: await actorForUser(pm.id),
    engineerActor: await actorForUser(engineer.id),
    outsiderActor: await actorForUser(outsider.id),
    projectId: project.id,
  };
}

/** The live discipline tasks of a main task, in display order, keyed by title. */
export async function subtaskIdsByTitle(mainTaskId: string): Promise<Map<string, string>> {
  const rows = await prisma.disciplineTask.findMany({
    where: { mainTaskId, deletedAt: null },
    orderBy: { sortOrder: "asc" },
    select: { id: true, title: true },
  });
  return new Map(rows.map((row) => [row.title, row.id]));
}

export const inThirtyDays = (): Date => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
