// A small harness for the service tests: a clean test database between tests, plus the fixtures
// every scenario needs (an organisation, people, a project, a main task with its discipline tasks).
//
// Everything belongs to an organisation now. A test that does not care which one gets the default
// company created on demand after each reset; a test that DOES care (the org-isolation suite) makes
// its own with makeOrg() and passes the id in.

import { prisma } from "@/lib/db";
import type { RoleName } from "@/lib/zod-schemas";
import { actorForUser, type ActorContext } from "@/server/actor";

const TABLES = [
  "ActivityLog",
  "Notification",
  "PostDismissal",
  "PostAck",
  "Post",
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
  "OrgIntegration",
  "MicrosoftConnection",
  "EmailToken",
  "Session",
  "User",
  "Discipline",
  "Organization",
];

/** Empties every table. Only ever run against DATABASE_URL_TEST. */
export async function resetDatabase(): Promise<void> {
  const list = TABLES.map((table) => `"${table}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  defaultOrgId = null;
}

/** A company of its own. Two of these side by side are how the isolation suite proves separation. */
export async function makeOrg(name = "Tielora Test Company"): Promise<{ id: string; name: string }> {
  const org = await prisma.organization.create({
    data: {
      name,
      slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Math.floor(Math.random() * 1_000_000_000)}`,
      industryTemplate: "OIL_AND_GAS",
    },
  });
  return { id: org.id, name: org.name };
}

/** The company a test gets when it does not say. One per reset, made the first time it is needed. */
let defaultOrgId: string | null = null;

export async function defaultOrg(): Promise<string> {
  if (!defaultOrgId) defaultOrgId = (await makeOrg()).id;
  return defaultOrgId;
}

export async function makeUser(options: {
  name: string;
  role: RoleName;
  disciplineId?: string | null;
  orgId?: string;
}): Promise<{ id: string; name: string; orgId: string }> {
  const orgId = options.orgId ?? (await defaultOrg());
  const user = await prisma.user.create({
    data: {
      orgId,
      email: `${options.name.toLowerCase().replace(/[^a-z]+/g, ".")}.${Date.now()}${Math.random()}@test.example`,
      name: options.name,
      passwordHash: "not-a-real-hash",
      role: options.role,
      disciplineId: options.disciplineId ?? null,
    },
  });
  return { id: user.id, name: user.name, orgId: user.orgId };
}

export async function makeDiscipline(
  code: string,
  sortOrder = 1,
  orgId?: string,
): Promise<{ id: string; code: string }> {
  const discipline = await prisma.discipline.create({
    data: {
      orgId: orgId ?? (await defaultOrg()),
      code,
      name: `${code} discipline`,
      colorHex: "#2E5AAC",
      sortOrder,
    },
  });
  return { id: discipline.id, code: discipline.code };
}

export type Fixture = {
  orgId: string;
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
export async function makeProjectFixture(orgIdIn?: string): Promise<Fixture> {
  const orgId = orgIdIn ?? (await defaultOrg());
  const discipline = await makeDiscipline("MECH", 1, orgId);
  const otherDiscipline = await makeDiscipline("ELEC", 2, orgId);

  const admin = await makeUser({ name: "Tielora Administrator", role: "ADMIN", orgId });
  const pm = await makeUser({ name: "Layla al-Riyami", role: "PROJECT_MANAGER", orgId });
  const engineer = await makeUser({
    name: "John Carter",
    role: "ENGINEER",
    disciplineId: discipline.id,
    orgId,
  });
  const outsider = await makeUser({ name: "Priya Nair", role: "ENGINEER", orgId });

  const project = await prisma.project.create({
    data: {
      orgId,
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
    orgId,
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
