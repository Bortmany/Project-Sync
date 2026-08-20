// Projects: who is on them, which disciplines they run, and everything that may be changed about them.
// Every mutation here: assertCan → transaction → audit row in the same transaction → typed result.

import { assertCan } from "@/lib/permissions";
import { activeMainTasks, activeProjects, activeProjectsForUser, notDeleted, prisma } from "@/lib/db";
import { effectiveStatus, isOverdue } from "@/lib/progress";
import type {
  CreateProjectInput,
  ProjectDTO,
  ProjectDisciplineDTO,
  ProjectListItemDTO,
  ProjectMemberDTO,
  UpdateProjectInput,
  UpsertMemberInput,
  UpsertProjectDisciplineInput,
} from "@/lib/zod-schemas";
import {
  ProjectDTO as ProjectSchema,
  ProjectListItemDTO as ProjectListItemSchema,
  ProjectMemberDTO as ProjectMemberSchema,
  ProjectDisciplineDTO as ProjectDisciplineSchema,
} from "@/lib/zod-schemas";
import type { ActorContext } from "@/server/actor";
import { NotFoundError, ServiceError } from "@/server/errors";
import { checkDto, checkDtoList } from "@/server/serialize";
import { ACTIVITY, appendActivity } from "@/server/services/activity";

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/** The one place "may this person see this project?" is answered. Admins see everything. */
export async function assertCanViewProject(actor: ActorContext, projectId: string): Promise<void> {
  const project = await prisma.project.findFirst({ where: { id: projectId, ...notDeleted }, select: { id: true } });
  if (!project) throw new NotFoundError("We could not find that project.");
  assertCan(actor, "VIEW_PROJECT", { projectId });
}

/** Projects the signed-in person may see: their own memberships, or all of them for an administrator. */
export async function listProjectsForActor(actor: ActorContext): Promise<ProjectListItemDTO[]> {
  const projects = actor.role === "ADMIN" ? await activeProjects() : await activeProjectsForUser(actor.userId);
  if (projects.length === 0) return [];

  const projectIds = projects.map((project) => project.id);
  const disciplines = await prisma.projectDiscipline.findMany({
    where: { projectId: { in: projectIds } },
    include: { discipline: true },
  });

  const taskLists = await Promise.all(projects.map((project) => activeMainTasks(project.id)));
  const now = new Date();

  const items = projects.map((project, index): ProjectListItemDTO => {
    const tasks = taskLists[index];
    const completed = tasks.filter(
      (task) => effectiveStatus(task.status, task.statusOverride) === "COMPLETED",
    ).length;
    const overdue = tasks.filter((task) =>
      isOverdue(task.deadline, effectiveStatus(task.status, task.statusOverride), now),
    ).length;

    return {
      id: project.id,
      name: project.name,
      code: project.code,
      status: project.status,
      targetDate: project.targetDate,
      progressPct: averageProgress(tasks, completed),
      mainTaskCount: tasks.length,
      overdueCount: overdue,
      disciplines: disciplines
        .filter((row) => row.projectId === project.id)
        .sort((a, b) => a.discipline.sortOrder - b.discipline.sortOrder)
        .map((row) => ({ id: row.discipline.id, code: row.discipline.code, colorHex: row.discipline.colorHex })),
    };
  });

  return checkDtoList(ProjectListItemSchema, items, "ProjectListItemDTO");
}

/** One project in full, with its disciplines, members and headline counts. */
export async function getProjectForActor(actor: ActorContext, projectId: string): Promise<ProjectDTO> {
  await assertCanViewProject(actor, projectId);
  return buildProjectDTO(projectId);
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

/** Starts a project, switches on its disciplines and puts its people on it — all in one transaction. */
export async function createProject(actor: ActorContext, input: CreateProjectInput): Promise<ProjectDTO> {
  assertCan(actor, "CREATE_PROJECT");

  const clash = await prisma.project.findUnique({ where: { code: input.code }, select: { id: true } });
  if (clash) {
    throw new ServiceError("A project with that code already exists. Choose another code.", {
      code: ["A project with that code already exists."],
    });
  }

  const disciplineIds = [...new Set(input.disciplineIds)];
  await assertDisciplinesExist(disciplineIds);

  const members = withCreatorAsManager(actor, input.members);
  await assertUsersAreActive(members.map((member) => member.userId));
  for (const member of members) {
    if (member.disciplineId && !disciplineIds.includes(member.disciplineId)) {
      throw new ServiceError(
        "Everyone on the project must belong to a discipline the project runs. Switch that discipline on first.",
      );
    }
  }

  const projectId = await prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        name: input.name,
        code: input.code,
        description: input.description,
        startDate: input.startDate ?? null,
        targetDate: input.targetDate ?? null,
        createdById: actor.userId,
        disciplines: { create: disciplineIds.map((disciplineId) => ({ disciplineId })) },
        members: {
          create: members.map((member) => ({
            userId: member.userId,
            projectRole: member.projectRole,
            disciplineId: member.disciplineId ?? null,
          })),
        },
      },
    });

    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: project.id,
      entityType: "Project",
      entityId: project.id,
      action: ACTIVITY.PROJECT_CREATED,
      summary: `${actor.name} created the project ${project.name}`,
      metadata: { code: project.code, disciplines: disciplineIds.length, members: members.length },
    });

    return project.id;
  });

  return buildProjectDTO(projectId);
}

/** Changes a project's details. Progress and status of its tasks are untouched — those are derived. */
export async function updateProject(actor: ActorContext, input: UpdateProjectInput): Promise<ProjectDTO> {
  const existing = await prisma.project.findFirst({ where: { id: input.id, ...notDeleted } });
  if (!existing) throw new NotFoundError("We could not find that project.");
  assertCan(actor, "EDIT_PROJECT", { projectId: existing.id });

  await prisma.$transaction(async (tx) => {
    const updated = await tx.project.update({
      where: { id: existing.id },
      data: {
        name: input.name ?? undefined,
        description: input.description ?? undefined,
        status: input.status ?? undefined,
        startDate: input.startDate === undefined ? undefined : input.startDate,
        targetDate: input.targetDate === undefined ? undefined : input.targetDate,
      },
    });

    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: existing.id,
      entityType: "Project",
      entityId: existing.id,
      action: ACTIVITY.PROJECT_UPDATED,
      summary: `${actor.name} updated the project details for ${updated.name}`,
      metadata: {
        before: { name: existing.name, status: existing.status, targetDate: existing.targetDate },
        after: { name: updated.name, status: updated.status, targetDate: updated.targetDate },
      },
    });
  });

  return buildProjectDTO(existing.id);
}

/** Adds someone to a project, or changes the role or discipline they hold on it. */
export async function upsertMember(actor: ActorContext, input: UpsertMemberInput): Promise<ProjectMemberDTO> {
  const project = await prisma.project.findFirst({ where: { id: input.projectId, ...notDeleted } });
  if (!project) throw new NotFoundError("We could not find that project.");
  assertCan(actor, "MANAGE_MEMBERS", { projectId: project.id });

  const [user] = await assertUsersAreActive([input.userId]);
  if (input.disciplineId) await assertDisciplineEnabled(project.id, input.disciplineId);

  const existing = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: project.id, userId: input.userId } },
  });

  const memberId = await prisma.$transaction(async (tx) => {
    const member = await tx.projectMember.upsert({
      where: { projectId_userId: { projectId: project.id, userId: input.userId } },
      update: { projectRole: input.projectRole, disciplineId: input.disciplineId ?? null },
      create: {
        projectId: project.id,
        userId: input.userId,
        projectRole: input.projectRole,
        disciplineId: input.disciplineId ?? null,
      },
    });

    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: project.id,
      entityType: "ProjectMember",
      entityId: member.id,
      action: existing ? ACTIVITY.MEMBER_UPDATED : ACTIVITY.MEMBER_ADDED,
      summary: existing
        ? `${actor.name} changed ${user.name}'s role on ${project.name} to ${roleWords(input.projectRole)}`
        : `${actor.name} added ${user.name} to ${project.name} as ${roleWords(input.projectRole)}`,
      metadata: {
        before: existing ? { projectRole: existing.projectRole, disciplineId: existing.disciplineId } : null,
        after: { projectRole: member.projectRole, disciplineId: member.disciplineId },
      },
    });

    return member.id;
  });

  return buildMemberDTO(memberId);
}

/** Takes someone off a project. The last project manager may not be removed. */
export async function removeMember(
  actor: ActorContext,
  input: { projectId: string; userId: string },
): Promise<{ removed: true }> {
  const project = await prisma.project.findFirst({ where: { id: input.projectId, ...notDeleted } });
  if (!project) throw new NotFoundError("We could not find that project.");
  assertCan(actor, "MANAGE_MEMBERS", { projectId: project.id });

  const member = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: project.id, userId: input.userId } },
    include: { user: { select: { name: true } } },
  });
  if (!member) throw new NotFoundError("That person is not on this project.");

  if (member.projectRole === "PROJECT_MANAGER") {
    const managers = await prisma.projectMember.count({
      where: { projectId: project.id, projectRole: "PROJECT_MANAGER" },
    });
    if (managers <= 1) {
      throw new ServiceError(
        "This is the only project manager on the project. Add another one before removing this person.",
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    // Someone who leaves also stops leading a discipline here.
    await tx.projectDiscipline.updateMany({
      where: { projectId: project.id, leadId: input.userId },
      data: { leadId: null },
    });
    await tx.projectMember.delete({ where: { id: member.id } });

    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: project.id,
      entityType: "ProjectMember",
      entityId: member.id,
      action: ACTIVITY.MEMBER_REMOVED,
      summary: `${actor.name} removed ${member.user.name} from ${project.name}`,
      metadata: { userId: input.userId, projectRole: member.projectRole },
    });
  });

  return { removed: true };
}

/** Switches a discipline on for a project, or changes who leads it. */
export async function upsertProjectDiscipline(
  actor: ActorContext,
  input: UpsertProjectDisciplineInput,
): Promise<ProjectDisciplineDTO> {
  const project = await prisma.project.findFirst({ where: { id: input.projectId, ...notDeleted } });
  if (!project) throw new NotFoundError("We could not find that project.");
  assertCan(actor, "MANAGE_PROJECT_DISCIPLINES", { projectId: project.id });

  const discipline = await prisma.discipline.findUnique({ where: { id: input.disciplineId } });
  if (!discipline) throw new NotFoundError("We could not find that discipline.");

  if (input.leadId) {
    const lead = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: project.id, userId: input.leadId } },
    });
    if (!lead) throw new ServiceError("The discipline lead has to be on the project first. Add them as a member.");
  }

  const existing = await prisma.projectDiscipline.findUnique({
    where: { projectId_disciplineId: { projectId: project.id, disciplineId: discipline.id } },
  });

  const rowId = await prisma.$transaction(async (tx) => {
    const row = await tx.projectDiscipline.upsert({
      where: { projectId_disciplineId: { projectId: project.id, disciplineId: discipline.id } },
      update: { leadId: input.leadId ?? null },
      create: { projectId: project.id, disciplineId: discipline.id, leadId: input.leadId ?? null },
    });

    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: project.id,
      entityType: "ProjectDiscipline",
      entityId: row.id,
      action: existing ? ACTIVITY.DISCIPLINE_LEAD_CHANGED : ACTIVITY.DISCIPLINE_ENABLED,
      summary: existing
        ? `${actor.name} changed who leads ${discipline.name} on ${project.name}`
        : `${actor.name} switched on ${discipline.name} for ${project.name}`,
      metadata: { before: existing ? { leadId: existing.leadId } : null, after: { leadId: row.leadId } },
    });

    return row.id;
  });

  return buildProjectDisciplineDTO(rowId);
}

/** Switches a discipline off — refused while that discipline still has live work on the project. */
export async function removeProjectDiscipline(
  actor: ActorContext,
  input: { projectId: string; disciplineId: string },
): Promise<{ removed: true }> {
  const project = await prisma.project.findFirst({ where: { id: input.projectId, ...notDeleted } });
  if (!project) throw new NotFoundError("We could not find that project.");
  assertCan(actor, "MANAGE_PROJECT_DISCIPLINES", { projectId: project.id });

  const row = await prisma.projectDiscipline.findUnique({
    where: { projectId_disciplineId: { projectId: project.id, disciplineId: input.disciplineId } },
    include: { discipline: true },
  });
  if (!row) throw new NotFoundError("That discipline is not switched on for this project.");

  const liveTasks = await prisma.disciplineTask.count({
    where: {
      disciplineId: input.disciplineId,
      ...notDeleted,
      mainTask: { projectId: project.id, ...notDeleted },
    },
  });
  if (liveTasks > 0) {
    throw new ServiceError(
      `${row.discipline.name} still has ${liveTasks === 1 ? "1 task" : `${liveTasks} tasks`} on this project. ` +
        "Move or remove that work before switching the discipline off.",
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.projectMember.updateMany({
      where: { projectId: project.id, disciplineId: input.disciplineId },
      data: { disciplineId: null },
    });
    await tx.projectDiscipline.delete({ where: { id: row.id } });

    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: project.id,
      entityType: "ProjectDiscipline",
      entityId: row.id,
      action: ACTIVITY.DISCIPLINE_REMOVED,
      summary: `${actor.name} switched off ${row.discipline.name} for ${project.name}`,
      metadata: { disciplineId: input.disciplineId },
    });
  });

  return { removed: true };
}

/* ------------------------------------------------------------------ */
/* Serializers and small helpers                                       */
/* ------------------------------------------------------------------ */

/** Builds the full project DTO. Callers have already checked that the person may see it. */
export async function buildProjectDTO(projectId: string): Promise<ProjectDTO> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, ...notDeleted },
    include: {
      createdBy: { select: { name: true } },
      disciplines: { include: { discipline: true, lead: { select: { name: true } } } },
      members: {
        include: {
          user: { select: { name: true, email: true } },
          discipline: { select: { code: true } },
        },
      },
    },
  });
  if (!project) throw new NotFoundError("We could not find that project.");

  const tasks = await activeMainTasks(project.id);
  const now = new Date();
  const completed = tasks.filter(
    (task) => effectiveStatus(task.status, task.statusOverride) === "COMPLETED",
  ).length;
  const overdue = tasks.filter((task) =>
    isOverdue(task.deadline, effectiveStatus(task.status, task.statusOverride), now),
  ).length;

  const dto: ProjectDTO = {
    id: project.id,
    name: project.name,
    code: project.code,
    description: project.description,
    status: project.status,
    startDate: project.startDate,
    targetDate: project.targetDate,
    createdById: project.createdById,
    createdByName: project.createdBy.name,
    createdAt: project.createdAt,
    disciplines: project.disciplines
      .slice()
      .sort((a, b) => a.discipline.sortOrder - b.discipline.sortOrder)
      .map((row) => ({
        id: row.id,
        projectId: row.projectId,
        disciplineId: row.disciplineId,
        code: row.discipline.code,
        name: row.discipline.name,
        colorHex: row.discipline.colorHex,
        leadId: row.leadId,
        leadName: row.lead?.name ?? null,
      })),
    members: project.members
      .slice()
      .sort((a, b) => a.user.name.localeCompare(b.user.name))
      .map((member) => ({
        id: member.id,
        projectId: member.projectId,
        userId: member.userId,
        userName: member.user.name,
        userEmail: member.user.email,
        projectRole: member.projectRole,
        disciplineId: member.disciplineId,
        disciplineCode: member.discipline?.code ?? null,
      })),
    counts: { mainTasks: tasks.length, completed, overdue },
    progressPct: averageProgress(tasks, completed),
  };

  return checkDto(ProjectSchema, dto, "ProjectDTO");
}

async function buildMemberDTO(memberId: string): Promise<ProjectMemberDTO> {
  const member = await prisma.projectMember.findUnique({
    where: { id: memberId },
    include: { user: { select: { name: true, email: true } }, discipline: { select: { code: true } } },
  });
  if (!member) throw new NotFoundError("That person is not on this project.");

  return checkDto(
    ProjectMemberSchema,
    {
      id: member.id,
      projectId: member.projectId,
      userId: member.userId,
      userName: member.user.name,
      userEmail: member.user.email,
      projectRole: member.projectRole,
      disciplineId: member.disciplineId,
      disciplineCode: member.discipline?.code ?? null,
    },
    "ProjectMemberDTO",
  );
}

async function buildProjectDisciplineDTO(rowId: string): Promise<ProjectDisciplineDTO> {
  const row = await prisma.projectDiscipline.findUnique({
    where: { id: rowId },
    include: { discipline: true, lead: { select: { name: true } } },
  });
  if (!row) throw new NotFoundError("That discipline is not switched on for this project.");

  return checkDto(
    ProjectDisciplineSchema,
    {
      id: row.id,
      projectId: row.projectId,
      disciplineId: row.disciplineId,
      code: row.discipline.code,
      name: row.discipline.name,
      colorHex: row.discipline.colorHex,
      leadId: row.leadId,
      leadName: row.lead?.name ?? null,
    },
    "ProjectDisciplineDTO",
  );
}

/** A project's headline percentage: the average of its main tasks' own derived progress. */
function averageProgress(tasks: { progressPct: number }[], completedCount: number): number {
  if (tasks.length === 0) return 0;
  if (completedCount === tasks.length) return 100;
  return Math.round(tasks.reduce((sum, task) => sum + task.progressPct, 0) / tasks.length);
}

function withCreatorAsManager(actor: ActorContext, members: CreateProjectInput["members"]) {
  const listed = members.some((member) => member.userId === actor.userId);
  if (listed) return members;
  // Whoever starts a project runs it, unless they already gave themselves another role.
  return [...members, { userId: actor.userId, projectRole: "PROJECT_MANAGER" as const, disciplineId: null }];
}

async function assertDisciplinesExist(disciplineIds: string[]): Promise<void> {
  if (disciplineIds.length === 0) return;
  const found = await prisma.discipline.count({ where: { id: { in: disciplineIds } } });
  if (found !== disciplineIds.length) throw new ServiceError("One of those disciplines no longer exists.");
}

async function assertDisciplineEnabled(projectId: string, disciplineId: string): Promise<void> {
  const enabled = await prisma.projectDiscipline.findUnique({
    where: { projectId_disciplineId: { projectId, disciplineId } },
  });
  if (!enabled) {
    throw new ServiceError("That discipline is not switched on for this project. Switch it on first.");
  }
}

async function assertUsersAreActive(userIds: string[]) {
  const unique = [...new Set(userIds)];
  const users = await prisma.user.findMany({
    where: { id: { in: unique }, isActive: true },
    select: { id: true, name: true },
  });
  if (users.length !== unique.length) {
    throw new ServiceError("One of those people is no longer active in Nexus.");
  }
  return users;
}

/** Role names as people say them, for audit summaries. */
function roleWords(role: ProjectMemberDTO["projectRole"]): string {
  switch (role) {
    case "ADMIN":
      return "administrator";
    case "PROJECT_MANAGER":
      return "project manager";
    case "DISCIPLINE_LEAD":
      return "discipline lead";
    default:
      return "engineer";
  }
}
