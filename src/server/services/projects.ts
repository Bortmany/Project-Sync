// Projects: who is on them, which disciplines they run, and everything that may be changed about them.
// Every mutation here: assertCan → transaction → audit row in the same transaction → typed result.

import { assertCan } from "@/lib/permissions";
import {
  activeMainTasks,
  activeProjects,
  activeProjectsForExternal,
  activeProjectsForUser,
  notDeleted,
  prisma,
} from "@/lib/db";
import { effectiveStatus, isOverdue } from "@/lib/progress";
import type {
  CreateProjectInput,
  SetExternalSignoffInput,
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
import type { Prisma } from "@/generated/prisma/client";
import { isExternal, type ActorContext } from "@/server/actor";
import { NotFoundError, ServiceError } from "@/server/errors";
import { phasesForTemplate, templateNameOf } from "@/server/industry-templates";
import { checkDto, checkDtoList } from "@/server/serialize";
import { ACTIVITY, appendActivity } from "@/server/services/activity";

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/**
 * The one place "may this person see this project?" is answered — and the read side's tenant gate.
 * Another company's project is not refused, it simply does not exist: the lookup is filtered by the
 * actor's organisation, so an outsider learns nothing about whether the id is real.
 * Inside one company, admins still see everything.
 */
export async function assertCanViewProject(actor: ActorContext, projectId: string): Promise<void> {
  const project = await projectInOrg(actor, projectId);

  // THE EXTERNAL RULE, second half, and it is answered BEFORE the permission rules so the answer is
  // always "not found". Being a member is not enough for a contractor: they may only look at a
  // project they hold live work on. A project they do not simply does not exist for them — the same
  // answer another company's project gives, for the same reason.
  if (isExternal(actor)) {
    if (!(await hasAssignedWork(actor, project.id))) {
      throw new NotFoundError("We could not find that project.");
    }
  }

  assertCan(actor, "VIEW_PROJECT", { projectId: project.id, orgId: project.orgId });
}

/** Does this person hold at least one live discipline task on this project? */
export async function hasAssignedWork(actor: ActorContext, projectId: string): Promise<boolean> {
  const count = await prisma.disciplineTask.count({
    where: {
      assigneeId: actor.userId,
      ...notDeleted,
      mainTask: { ...notDeleted, projectId, project: { orgId: actor.orgId, ...notDeleted } },
    },
  });
  return count > 0;
}

/**
 * Loads a live project that belongs to the actor's organisation, or says it does not exist.
 * Every service that needs a project starts here, so no mutation can ever reach across companies.
 */
export async function projectInOrg(
  actor: ActorContext,
  projectId: string,
): Promise<{ id: string; orgId: string }> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId: actor.orgId, ...notDeleted },
    select: { id: true, orgId: true },
  });
  if (!project) throw new NotFoundError("We could not find that project.");
  return project;
}

/**
 * The projects this person may see, as ids mapped to their codes for display. Same answer as
 * assertCanViewProject, asked once for a whole listing instead of row by row: an administrator sees
 * every live project, everybody else only the ones they are a member of. Cross-project listings
 * ("my tasks", the sidebar's shortcuts) filter against this set.
 */
export async function visibleProjects(actor: ActorContext): Promise<Map<string, string>> {
  const projects = await projectsVisibleTo(actor);
  return new Map(projects.map((project) => [project.id, project.code]));
}

/**
 * The three answers to "which projects?", in one place so no caller has to remember the third:
 * an administrator's whole company, a colleague's memberships, and a contractor's own work.
 */
export async function projectsVisibleTo(actor: ActorContext) {
  if (isExternal(actor)) return activeProjectsForExternal(actor.orgId, actor.userId);
  if (actor.role === "ADMIN") return activeProjects(actor.orgId);
  return activeProjectsForUser(actor.orgId, actor.userId);
}

/** Projects the signed-in person may see: their own memberships, or all of them for an administrator. */
export async function listProjectsForActor(actor: ActorContext): Promise<ProjectListItemDTO[]> {
  return buildProjectListItems(await projectsVisibleTo(actor), actor);
}

type ProjectRow = {
  id: string;
  name: string;
  code: string;
  status: ProjectListItemDTO["status"];
  targetDate: Date | null;
};

/**
 * Turns project rows into list cards. Callers pass rows they have already limited to what the
 * person may see — global search reuses this so its project rows look exactly like the list page's.
 */
export async function buildProjectListItems(
  projects: ProjectRow[],
  viewer?: ActorContext,
): Promise<ProjectListItemDTO[]> {
  if (projects.length === 0) return [];

  // A contractor's card counts THEIR work only — the number of tasks on a project, and how many of
  // them are late, is the company's business, not a supplier's.
  const external = viewer ? isExternal(viewer) : false;
  const projectIds = projects.map((project) => project.id);
  const disciplines = await prisma.projectDiscipline.findMany({
    where: {
      projectId: { in: projectIds },
      ...(external && viewer
        ? {
            discipline: {
              disciplineTasks: {
                some: {
                  assigneeId: viewer.userId,
                  ...notDeleted,
                  mainTask: { projectId: { in: projectIds }, ...notDeleted },
                },
              },
            },
          }
        : {}),
    },
    include: { discipline: true },
  });

  // Cross-project read: the soft-delete filter from db.ts is applied by hand because the
  // per-project helper would mean one query per project on this page (the dashboard does the same).
  const allTasks = await prisma.mainTask.findMany({
    where: {
      projectId: { in: projectIds },
      ...notDeleted,
      ...(external && viewer
        ? { disciplineTasks: { some: { assigneeId: viewer.userId, ...notDeleted } } }
        : {}),
    },
    orderBy: { deadline: "asc" },
    select: { projectId: true, deadline: true, status: true, statusOverride: true, progressPct: true },
  });
  const tasksByProject = new Map<string, typeof allTasks>();
  for (const task of allTasks) {
    const list = tasksByProject.get(task.projectId) ?? [];
    list.push(task);
    tasksByProject.set(task.projectId, list);
  }
  const now = new Date();

  const items = projects.map((project): ProjectListItemDTO => {
    const tasks = tasksByProject.get(project.id) ?? [];
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
  return buildProjectDTO(projectId, actor);
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

/** Starts a project, switches on its disciplines and puts its people on it — all in one transaction. */
export async function createProject(actor: ActorContext, input: CreateProjectInput): Promise<ProjectDTO> {
  assertCan(actor, "CREATE_PROJECT");

  // Project codes are unique inside a company, not across the product: another customer's "PH-1"
  // is none of this company's business.
  const clash = await prisma.project.findUnique({
    where: { orgId_code: { orgId: actor.orgId, code: input.code } },
    select: { id: true },
  });
  if (clash) {
    throw new ServiceError("A project with that code already exists. Choose another code.", {
      code: ["A project with that code already exists."],
    });
  }

  const disciplineIds = [...new Set(input.disciplineIds)];
  await assertDisciplinesExist(actor, disciplineIds);

  const members = withCreatorAsManager(actor, input.members);
  const people = await assertUsersAreActive(actor, members.map((member) => member.userId));
  for (const member of members) {
    assertProjectRoleMatchesPerson(people, member.userId, member.projectRole);
  }
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
        orgId: actor.orgId,
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

    // The stage gates a project starts with, from the company's industry template. They arrive in
    // the same transaction as the project, so a project is never briefly ungated.
    const phases = await createDefaultPhases(tx, project.id, actor.orgId);

    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: project.id,
      entityType: "Project",
      entityId: project.id,
      action: ACTIVITY.PROJECT_CREATED,
      summary:
        `${actor.name} created the project ${project.name}` +
        (phases.length > 0 ? ` with ${phases.length} phases: ${phases.join(" → ")}` : ""),
      metadata: {
        code: project.code,
        disciplines: disciplineIds.length,
        members: members.length,
        phases,
      },
    });

    return project.id;
  });

  return buildProjectDTO(projectId);
}

/** Changes a project's details. Progress and status of its tasks are untouched — those are derived. */
export async function updateProject(actor: ActorContext, input: UpdateProjectInput): Promise<ProjectDTO> {
  const existing = await prisma.project.findFirst({
    where: { id: input.id, orgId: actor.orgId, ...notDeleted },
  });
  if (!existing) throw new NotFoundError("We could not find that project.");
  assertCan(actor, "EDIT_PROJECT", { projectId: existing.id, orgId: existing.orgId });

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

/**
 * Switches the contractor sign-off on or off for one project. Anyone who may edit the project may
 * change it, and the change is audited like any other project setting — turning a check off is
 * exactly the kind of decision an audit trail exists to record.
 */
export async function setExternalSignoffRequired(
  actor: ActorContext,
  input: SetExternalSignoffInput,
): Promise<ProjectDTO> {
  const existing = await prisma.project.findFirst({
    where: { id: input.projectId, orgId: actor.orgId, ...notDeleted },
  });
  if (!existing) throw new NotFoundError("We could not find that project.");
  assertCan(actor, "EDIT_PROJECT", { projectId: existing.id, orgId: existing.orgId });

  if (existing.externalSignoffRequired === input.required) return buildProjectDTO(existing.id, actor);

  await prisma.$transaction(async (tx) => {
    await tx.project.update({
      where: { id: existing.id },
      data: { externalSignoffRequired: input.required },
    });

    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: existing.id,
      entityType: "Project",
      entityId: existing.id,
      action: ACTIVITY.PROJECT_UPDATED,
      summary: input.required
        ? `${actor.name} turned on contractor sign-off for ${existing.name}`
        : `${actor.name} turned off contractor sign-off for ${existing.name}`,
      metadata: {
        before: { externalSignoffRequired: existing.externalSignoffRequired },
        after: { externalSignoffRequired: input.required },
      },
    });
  });

  return buildProjectDTO(existing.id, actor);
}

/** Adds someone to a project, or changes the role or discipline they hold on it. */
export async function upsertMember(actor: ActorContext, input: UpsertMemberInput): Promise<ProjectMemberDTO> {
  const project = await prisma.project.findFirst({
    where: { id: input.projectId, orgId: actor.orgId, ...notDeleted },
  });
  if (!project) throw new NotFoundError("We could not find that project.");
  assertCan(actor, "MANAGE_MEMBERS", { projectId: project.id, orgId: project.orgId });

  const [user] = await assertUsersAreActive(actor, [input.userId]);
  assertProjectRoleMatchesPerson([user], input.userId, input.projectRole);
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
  const project = await prisma.project.findFirst({
    where: { id: input.projectId, orgId: actor.orgId, ...notDeleted },
  });
  if (!project) throw new NotFoundError("We could not find that project.");
  assertCan(actor, "MANAGE_MEMBERS", { projectId: project.id, orgId: project.orgId });

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
  const project = await prisma.project.findFirst({
    where: { id: input.projectId, orgId: actor.orgId, ...notDeleted },
  });
  if (!project) throw new NotFoundError("We could not find that project.");
  assertCan(actor, "MANAGE_PROJECT_DISCIPLINES", { projectId: project.id, orgId: project.orgId });

  const discipline = await prisma.discipline.findFirst({
    where: { id: input.disciplineId, orgId: actor.orgId },
  });
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
  const project = await prisma.project.findFirst({
    where: { id: input.projectId, orgId: actor.orgId, ...notDeleted },
  });
  if (!project) throw new NotFoundError("We could not find that project.");
  assertCan(actor, "MANAGE_PROJECT_DISCIPLINES", { projectId: project.id, orgId: project.orgId });

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

/**
 * Builds the full project DTO. Callers have already checked that the person may see it.
 *
 * Pass the viewer and a contractor gets the FILTERED variant: no team roster at all, only the
 * disciplines their own work sits in, and headline counts over their own main tasks. Without a
 * viewer (the mutation paths, which only a manager or administrator can reach) it is unchanged.
 */
export async function buildProjectDTO(
  projectId: string,
  viewer?: ActorContext,
): Promise<ProjectDTO> {
  const external = viewer ? isExternal(viewer) : false;
  const project = await prisma.project.findFirst({
    where: { id: projectId, ...notDeleted },
    include: {
      createdBy: { select: { name: true } },
      disciplines: { include: { discipline: true, lead: { select: { name: true } } } },
      members: {
        include: {
          user: { select: { name: true, email: true, companyName: true } },
          discipline: { select: { code: true } },
        },
      },
    },
  });
  if (!project) throw new NotFoundError("We could not find that project.");

  const tasks =
    external && viewer
      ? await prisma.mainTask.findMany({
          where: {
            projectId: project.id,
            ...notDeleted,
            disciplineTasks: { some: { assigneeId: viewer.userId, ...notDeleted } },
          },
          orderBy: { deadline: "asc" },
        })
      : await activeMainTasks(project.orgId, project.id);
  const myDisciplineIds = external && viewer ? await disciplineIdsWorkedBy(viewer, project.id) : null;
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
    externalSignoffRequired: project.externalSignoffRequired,
    disciplines: project.disciplines
      .slice()
      .filter((row) => !myDisciplineIds || myDisciplineIds.has(row.disciplineId))
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
    // A contractor never sees who else is on the project.
    members: (external ? [] : project.members)
      .slice()
      .sort((a, b) => a.user.name.localeCompare(b.user.name))
      .map((member) => ({
        id: member.id,
        projectId: member.projectId,
        userId: member.userId,
        userName: member.user.name,
        userEmail: member.user.email,
        companyName: member.user.companyName,
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
    include: {
      user: { select: { name: true, email: true, companyName: true } },
      discipline: { select: { code: true } },
    },
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
      companyName: member.user.companyName,
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

/**
 * The stage gates a brand-new project starts with, from its company's industry template
 * (src/server/industry-templates.ts). Written inside createProject's own transaction, so a project
 * and its gates arrive together. Projects created before phases existed have none, everything in
 * them is unphased, and nothing is gated — there is nothing to backfill.
 */
async function createDefaultPhases(
  tx: Prisma.TransactionClient,
  projectId: string,
  orgId: string,
): Promise<string[]> {
  const org = await tx.organization.findUnique({
    where: { id: orgId },
    select: { industryTemplate: true },
  });
  const names = phasesForTemplate(templateNameOf(org?.industryTemplate ?? "GENERIC"));

  for (const [index, name] of names.entries()) {
    await tx.projectPhase.create({ data: { projectId, name, sortOrder: index } });
  }
  return names;
}

/** The disciplines this person actually holds live work in, on one project. */
async function disciplineIdsWorkedBy(actor: ActorContext, projectId: string): Promise<Set<string>> {
  const rows = await prisma.disciplineTask.findMany({
    where: {
      assigneeId: actor.userId,
      ...notDeleted,
      mainTask: { projectId, ...notDeleted },
    },
    select: { disciplineId: true },
    distinct: ["disciplineId"],
  });
  return new Set(rows.map((row) => row.disciplineId));
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

/** Every discipline named must exist INSIDE this company — another company's is simply "gone". */
async function assertDisciplinesExist(actor: ActorContext, disciplineIds: string[]): Promise<void> {
  if (disciplineIds.length === 0) return;
  const found = await prisma.discipline.count({
    where: { id: { in: disciplineIds }, orgId: actor.orgId },
  });
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

/** Everyone put on a project must be an active colleague in the SAME company. */
async function assertUsersAreActive(actor: ActorContext, userIds: string[]) {
  const unique = [...new Set(userIds)];
  const users = await prisma.user.findMany({
    where: { id: { in: unique }, orgId: actor.orgId, isActive: true },
    select: { id: true, name: true, role: true },
  });
  if (users.length !== unique.length) {
    throw new ServiceError("One of those people is no longer active in Tielora.");
  }
  return users;
}

/**
 * A contractor is a contractor on every project, and nobody else can be given a contractor's
 * seat. The permission rules already refuse to escalate an EXTERNAL, so this is belt and braces —
 * it keeps the stored ProjectMember rows saying the same thing the rules do.
 */
function assertProjectRoleMatchesPerson(
  people: { id: string; role: string }[],
  userId: string,
  projectRole: string,
): void {
  const person = people.find((candidate) => candidate.id === userId);
  if (!person) return;
  if (person.role === "EXTERNAL" && projectRole !== "EXTERNAL") {
    throw new ServiceError(
      "An external contractor can only join a project as an external contractor.",
      { projectRole: ["Contractors join as External."] },
    );
  }
  if (person.role !== "EXTERNAL" && projectRole === "EXTERNAL") {
    throw new ServiceError(
      "Only an external contractor can hold the External role on a project.",
      { projectRole: ["Pick a role for a colleague."] },
    );
  }
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
    case "EXTERNAL":
      return "external contractor";
    default:
      return "engineer";
  }
}
