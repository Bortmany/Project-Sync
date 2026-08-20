// Main tasks and discipline tasks — where the golden rule lives.
//
// A main task's status and progressPct are cached copies of what its discipline tasks say. Every
// mutation below that can change a discipline task recalculates them with deriveMainTask() inside the
// same transaction, and nothing else ever writes those two fields. A discipline task may only be
// completed when canCompleteDisciplineTask() allows it; the single legal bypass is a recorded override.

import type { Prisma } from "@/generated/prisma/client";
import { activeMainTasks, notDeleted, prisma } from "@/lib/db";
import { assertCan } from "@/lib/permissions";
import {
  canCompleteDisciplineTask,
  deriveMainTask,
  effectiveStatus,
  isOverdue,
  wouldCreateCycle,
} from "@/lib/progress";
import type {
  AddDependencyInput,
  CreateDisciplineTaskInput,
  CreateMainTaskInput,
  DisciplineTaskDTO,
  GanttDTO,
  MainTaskDTO,
  MainTaskListItemDTO,
  OverrideStatusInput,
  PriorityName,
  TaskStatusName,
  UpdateDisciplineTaskInput,
  UpdateMainTaskInput,
  UpdateTaskDatesInput,
  UpdateTaskStatusInput,
} from "@/lib/zod-schemas";
import {
  DisciplineTaskDTO as DisciplineTaskSchema,
  GanttDTO as GanttSchema,
  MainTaskDTO as MainTaskSchema,
  MainTaskListItemDTO as MainTaskListItemSchema,
} from "@/lib/zod-schemas";
import type { ActorContext } from "@/server/actor";
import { NotFoundError, ServiceError } from "@/server/errors";
import { checkDto, checkDtoList } from "@/server/serialize";
import { ACTIVITY, appendActivity } from "@/server/services/activity";
import { notify } from "@/server/services/notify";
import { assertCanViewProject } from "@/server/services/projects";

/** The filters the main-task list accepts. */
export type MainTaskFilters = {
  status?: TaskStatusName;
  disciplineId?: string;
  assigneeId?: string;
  priority?: PriorityName;
  q?: string;
};

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/** The main tasks of one project, filtered the way the board and list pages ask for. */
export async function listMainTasksForProject(
  actor: ActorContext,
  projectId: string,
  filters: MainTaskFilters = {},
): Promise<MainTaskListItemDTO[]> {
  await assertCanViewProject(actor, projectId);

  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { code: true },
  });
  const tasks = await activeMainTasks(projectId);
  if (tasks.length === 0) return [];

  const subtasks = await liveSubtasksFor(tasks.map((task) => task.id));
  const now = new Date();
  const needle = filters.q?.trim().toLowerCase();

  const items = tasks
    .map((task) => buildListItem(task, project.code, subtasks.get(task.id) ?? [], now))
    .filter((item, index) => {
      const own = subtasks.get(tasks[index].id) ?? [];
      if (filters.status && item.effectiveStatus !== filters.status) return false;
      if (filters.priority && item.priority !== filters.priority) return false;
      if (filters.disciplineId && !own.some((sub) => sub.disciplineId === filters.disciplineId)) return false;
      if (filters.assigneeId && !own.some((sub) => sub.assigneeId === filters.assigneeId)) return false;
      if (needle) {
        const haystack = `${tasks[index].title} ${tasks[index].description}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });

  return checkDtoList(MainTaskListItemSchema, items, "MainTaskListItemDTO");
}

/** One main task in full. */
export async function getMainTaskForActor(actor: ActorContext, mainTaskId: string): Promise<MainTaskDTO> {
  const task = await loadMainTask(mainTaskId);
  await assertCanViewProject(actor, task.projectId);
  return buildMainTaskDTO(mainTaskId);
}

/** One discipline task in full, including what is standing between it and being finished. */
export async function getDisciplineTaskForActor(
  actor: ActorContext,
  disciplineTaskId: string,
): Promise<DisciplineTaskDTO> {
  const task = await loadDisciplineTask(disciplineTaskId);
  await assertCanViewProject(actor, task.mainTask.projectId);
  return buildDisciplineTaskDTO(disciplineTaskId);
}

/**
 * A named set of main tasks as list rows. Global search calls this with ids it has already
 * limited to the projects the person may see — this function does not re-check that.
 */
export async function listMainTaskItems(mainTaskIds: string[]): Promise<MainTaskListItemDTO[]> {
  if (mainTaskIds.length === 0) return [];

  const tasks = await prisma.mainTask.findMany({
    where: { id: { in: mainTaskIds }, ...notDeleted },
    orderBy: { deadline: "asc" },
    include: { project: { select: { code: true } } },
  });
  if (tasks.length === 0) return [];

  const subtasks = await liveSubtasksFor(tasks.map((task) => task.id));
  const now = new Date();
  const items = tasks.map((task) =>
    buildListItem(task, task.project.code, subtasks.get(task.id) ?? [], now),
  );

  return checkDtoList(MainTaskListItemSchema, items, "MainTaskListItemDTO");
}

/** The whole project on one timeline: every live main task with the discipline tasks beneath it. */
export async function ganttForProject(actor: ActorContext, projectId: string): Promise<GanttDTO> {
  await assertCanViewProject(actor, projectId);
  return buildGantt(await activeMainTasks(projectId));
}

/** One main task on a timeline, with its own discipline tasks. Same shape as the project view. */
export async function ganttForMainTask(actor: ActorContext, mainTaskId: string): Promise<GanttDTO> {
  const task = await loadMainTask(mainTaskId);
  await assertCanViewProject(actor, task.projectId);
  return buildGantt([task]);
}

type GanttTaskRow = {
  id: string;
  title: string;
  startDate: Date | null;
  deadline: Date;
  status: TaskStatusName;
  statusOverride: TaskStatusName | null;
  progressPct: number;
};

/** Shared by both Gantt reads. The status shown on a bar is the effective one, override included. */
async function buildGantt(tasks: GanttTaskRow[]): Promise<GanttDTO> {
  if (tasks.length === 0) return checkDto(GanttSchema, { mainTasks: [] }, "GanttDTO");
  const subtasks = await liveSubtasksFor(tasks.map((task) => task.id));

  const mainTasks = tasks.map((task) => ({
    id: task.id,
    title: task.title,
    startDate: task.startDate,
    deadline: task.deadline,
    status: effectiveStatus(task.status, task.statusOverride),
    progressPct: task.progressPct,
    disciplineTasks: (subtasks.get(task.id) ?? []).map((subtask) => ({
      id: subtask.id,
      title: subtask.title,
      disciplineCode: subtask.discipline.code,
      disciplineColorHex: subtask.discipline.colorHex,
      assigneeName: subtask.assignee?.name ?? null,
      startDate: subtask.startDate,
      deadline: subtask.deadline,
      status: subtask.status,
    })),
  }));

  return checkDto(GanttSchema, { mainTasks }, "GanttDTO");
}

/* ------------------------------------------------------------------ */
/* Main task mutations                                                 */
/* ------------------------------------------------------------------ */

/** Creates a main task and, optionally, the discipline tasks that deliver it. */
export async function createMainTask(actor: ActorContext, input: CreateMainTaskInput): Promise<MainTaskDTO> {
  const project = await prisma.project.findFirst({ where: { id: input.projectId, ...notDeleted } });
  if (!project) throw new NotFoundError("We could not find that project.");
  assertCan(actor, "CREATE_MAIN_TASK", { projectId: project.id });

  const disciplineIds = [...new Set(input.disciplineTasks.map((task) => task.disciplineId))];
  const enabled = await enabledDisciplines(project.id);
  for (const disciplineId of disciplineIds) {
    if (!enabled.has(disciplineId)) {
      throw new ServiceError(
        "One of those disciplines is not switched on for this project. Switch it on before adding work for it.",
      );
    }
  }
  if (input.ownerId) await assertOnProject(project.id, input.ownerId, "owner");
  for (const task of input.disciplineTasks) {
    if (task.assigneeId) await assertOnProject(project.id, task.assigneeId, "assignee");
  }

  const deadline = utcMidnight(input.deadline);
  const mainTaskId = await prisma.$transaction(async (tx) => {
    const mainTask = await tx.mainTask.create({
      data: {
        projectId: project.id,
        title: input.title,
        description: input.description,
        priority: input.priority,
        startDate: utcMidnightOrNull(input.startDate) ?? null,
        deadline,
        createdById: actor.userId,
        ownerId: input.ownerId ?? null,
      },
    });

    let sortOrder = 0;
    for (const task of input.disciplineTasks) {
      const created = await tx.disciplineTask.create({
        data: {
          mainTaskId: mainTask.id,
          disciplineId: task.disciplineId,
          title: task.title,
          description: task.description ?? null,
          assigneeId: task.assigneeId ?? null,
          assignedById: task.assigneeId ? actor.userId : null,
          deadline: utcMidnight(task.deadline),
          isMandatory: task.isMandatory,
          sortOrder: sortOrder++,
          requiredDocuments: {
            create: task.requiredDocuments.map((doc) => ({ name: doc.name, isMandatory: doc.isMandatory })),
          },
        },
      });

      // Every discipline task's own audit trail starts at its creation, however it was created.
      await appendActivity(tx, {
        actorId: actor.userId,
        projectId: project.id,
        entityType: "DisciplineTask",
        entityId: created.id,
        action: ACTIVITY.TASK_CREATED,
        summary:
          `${actor.name} added "${created.title}" to "${input.title}"` +
          (task.assigneeId ? ` and assigned it to ${await nameOf(tx, task.assigneeId)}` : ""),
        metadata: {
          disciplineId: task.disciplineId,
          assigneeId: task.assigneeId ?? null,
          isMandatory: task.isMandatory,
          requiredDocuments: task.requiredDocuments.length,
        },
      });
    }

    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: project.id,
      entityType: "MainTask",
      entityId: mainTask.id,
      action: ACTIVITY.MAIN_TASK_CREATED,
      summary: `${actor.name} created the task "${mainTask.title}" with ${countWords(input.disciplineTasks.length, "discipline task")}`,
      metadata: { deadline, priority: input.priority },
    });

    await recomputeMainTask(tx, mainTask.id, actor, project.id);
    return mainTask.id;
  });

  const assignees = input.disciplineTasks
    .map((task) => task.assigneeId)
    .filter((id): id is string => Boolean(id) && id !== actor.userId);
  if (assignees.length > 0) {
    await notify(assignees, "ASSIGNED", {
      title: "New work assigned to you",
      body: `${actor.name} assigned you a discipline task under "${input.title}".`,
      linkUrl: `/tasks/${mainTaskId}`,
      actorId: actor.userId,
    });
  }

  return buildMainTaskDTO(mainTaskId);
}

/** Changes a main task's own details. Never its status or progress — those are derived. */
export async function updateMainTask(actor: ActorContext, input: UpdateMainTaskInput): Promise<MainTaskDTO> {
  const existing = await loadMainTask(input.id);
  assertCan(actor, "EDIT_MAIN_TASK", { projectId: existing.projectId });
  if (input.ownerId) await assertOnProject(existing.projectId, input.ownerId, "owner");
  const nextStart = utcMidnightOrNull(input.startDate);
  const nextDeadline = input.deadline === undefined ? undefined : utcMidnight(input.deadline);
  assertDatesOrdered(nextStart ?? existing.startDate, nextDeadline ?? existing.deadline);

  await prisma.$transaction(async (tx) => {
    const updated = await tx.mainTask.update({
      where: { id: existing.id },
      data: {
        title: input.title ?? undefined,
        description: input.description ?? undefined,
        priority: input.priority ?? undefined,
        startDate: nextStart === undefined ? undefined : nextStart,
        deadline: nextDeadline ?? undefined,
        ownerId: input.ownerId === undefined ? undefined : input.ownerId,
      },
    });

    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: existing.projectId,
      entityType: "MainTask",
      entityId: existing.id,
      action: ACTIVITY.MAIN_TASK_UPDATED,
      summary: `${actor.name} updated the task "${updated.title}"`,
      metadata: {
        before: { title: existing.title, priority: existing.priority, deadline: existing.deadline },
        after: { title: updated.title, priority: updated.priority, deadline: updated.deadline },
      },
    });
  });

  return buildMainTaskDTO(existing.id);
}

/**
 * The only legal way a main task's shown status leaves what its discipline tasks say.
 * Project managers and administrators only, always with a reason, always audited.
 */
export async function overrideMainTaskStatus(
  actor: ActorContext,
  input: OverrideStatusInput,
): Promise<MainTaskDTO> {
  const existing = await loadMainTask(input.id);
  assertCan(actor, "OVERRIDE_MAIN_TASK_STATUS", { projectId: existing.projectId });

  const reason = input.reason.trim();
  if (reason.length < 5) throw new ServiceError("Give a short reason (at least 5 characters).");

  await prisma.$transaction(async (tx) => {
    await tx.mainTask.update({
      where: { id: existing.id },
      data: {
        statusOverride: input.status,
        overrideReason: reason,
        overriddenById: actor.userId,
        overriddenAt: new Date(),
      },
    });

    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: existing.projectId,
      entityType: "MainTask",
      entityId: existing.id,
      action: ACTIVITY.OVERRIDE_APPLIED,
      summary: `${actor.name} set "${existing.title}" to ${statusWords(input.status)} by override — ${reason}`,
      metadata: {
        before: { derivedStatus: existing.status, statusOverride: existing.statusOverride },
        after: { statusOverride: input.status },
        reason,
      },
    });
  });

  await notify(await projectAudience(existing.projectId, actor.userId), "OVERRIDE_APPLIED", {
    title: "A task status was overridden",
    body: `${actor.name} set "${existing.title}" to ${statusWords(input.status)}. Reason: ${reason}`,
    linkUrl: `/tasks/${existing.id}`,
    actorId: actor.userId,
  });

  return buildMainTaskDTO(existing.id);
}

/** Removes an override so the main task goes back to telling the truth of its discipline tasks. */
export async function clearOverride(actor: ActorContext, input: { id: string }): Promise<MainTaskDTO> {
  const existing = await loadMainTask(input.id);
  assertCan(actor, "OVERRIDE_MAIN_TASK_STATUS", { projectId: existing.projectId });
  if (!existing.statusOverride) throw new ServiceError("That task does not have an override to remove.");

  await prisma.$transaction(async (tx) => {
    await tx.mainTask.update({
      where: { id: existing.id },
      data: { statusOverride: null, overrideReason: null, overriddenById: null, overriddenAt: null },
    });

    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: existing.projectId,
      entityType: "MainTask",
      entityId: existing.id,
      action: ACTIVITY.OVERRIDE_CLEARED,
      summary: `${actor.name} removed the override on "${existing.title}"`,
      metadata: { before: { statusOverride: existing.statusOverride, reason: existing.overrideReason } },
    });

    // The cached values are re-derived so the task immediately reflects its subtasks again.
    await recomputeMainTask(tx, existing.id, actor, existing.projectId);
  });

  return buildMainTaskDTO(existing.id);
}

/* ------------------------------------------------------------------ */
/* Discipline task mutations                                           */
/* ------------------------------------------------------------------ */

/** Adds one discipline's piece of work to a main task. */
export async function createDisciplineTask(
  actor: ActorContext,
  input: CreateDisciplineTaskInput,
): Promise<DisciplineTaskDTO> {
  const mainTask = await loadMainTask(input.mainTaskId);
  assertCan(actor, "CREATE_DISCIPLINE_TASK", {
    projectId: mainTask.projectId,
    disciplineId: input.disciplineId,
  });

  const enabled = await enabledDisciplines(mainTask.projectId);
  if (!enabled.has(input.disciplineId)) {
    throw new ServiceError(
      "That discipline is not switched on for this project. Switch it on before adding work for it.",
    );
  }
  if (input.assigneeId) await assertOnProject(mainTask.projectId, input.assigneeId, "assignee");

  const taskId = await prisma.$transaction(async (tx) => {
    await lockMainTask(tx, mainTask.id);
    const last = await tx.disciplineTask.findFirst({
      where: { mainTaskId: mainTask.id, ...notDeleted },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });

    const task = await tx.disciplineTask.create({
      data: {
        mainTaskId: mainTask.id,
        disciplineId: input.disciplineId,
        title: input.title,
        description: input.description ?? null,
        assigneeId: input.assigneeId ?? null,
        assignedById: input.assigneeId ? actor.userId : null,
        startDate: utcMidnightOrNull(input.startDate) ?? null,
        deadline: utcMidnight(input.deadline),
        priority: input.priority,
        isMandatory: input.isMandatory,
        sortOrder: (last?.sortOrder ?? -1) + 1,
        requiredDocuments: {
          create: input.requiredDocuments.map((doc) => ({ name: doc.name, isMandatory: doc.isMandatory })),
        },
      },
    });

    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: mainTask.projectId,
      entityType: "DisciplineTask",
      entityId: task.id,
      action: ACTIVITY.TASK_CREATED,
      summary: `${actor.name} added "${task.title}" to "${mainTask.title}"`,
      metadata: { disciplineId: input.disciplineId, deadline: task.deadline, isMandatory: input.isMandatory },
    });

    if (input.assigneeId) {
      await appendActivity(tx, {
        actorId: actor.userId,
        projectId: mainTask.projectId,
        entityType: "DisciplineTask",
        entityId: task.id,
        action: ACTIVITY.ASSIGNED,
        summary: `${actor.name} assigned "${task.title}" to ${await nameOf(tx, input.assigneeId)}`,
        metadata: { assigneeId: input.assigneeId },
      });
    }

    await recomputeMainTask(tx, mainTask.id, actor, mainTask.projectId);
    return task.id;
  });

  if (input.assigneeId && input.assigneeId !== actor.userId) {
    await notify([input.assigneeId], "ASSIGNED", {
      title: "New work assigned to you",
      body: `${actor.name} assigned you "${input.title}".`,
      linkUrl: `/discipline-tasks/${taskId}`,
      actorId: actor.userId,
    });
  }

  return buildDisciplineTaskDTO(taskId);
}

/** Edits a discipline task, including handing it to someone else. */
export async function updateDisciplineTask(
  actor: ActorContext,
  input: UpdateDisciplineTaskInput,
): Promise<DisciplineTaskDTO> {
  const existing = await loadDisciplineTask(input.id);
  const projectId = existing.mainTask.projectId;

  const reassigning = input.assigneeId !== undefined && (input.assigneeId ?? null) !== existing.assigneeId;
  const editingAnythingElse = Object.keys(input).some((key) => key !== "id" && key !== "assigneeId");

  if (reassigning) {
    assertCan(actor, "ASSIGN_DISCIPLINE_TASK", {
      projectId,
      disciplineId: existing.disciplineId,
      assigneeId: existing.assigneeId,
    });
    if (input.assigneeId) await assertOnProject(projectId, input.assigneeId, "assignee");
  }
  if (editingAnythingElse) {
    assertCan(actor, "EDIT_DISCIPLINE_TASK", { projectId, disciplineId: existing.disciplineId });
  }
  const nextStart = utcMidnightOrNull(input.startDate);
  const nextDeadline = input.deadline === undefined ? undefined : utcMidnight(input.deadline);
  assertDatesOrdered(nextStart ?? existing.startDate, nextDeadline ?? existing.deadline);

  await prisma.$transaction(async (tx) => {
    await lockMainTask(tx, existing.mainTaskId);
    const updated = await tx.disciplineTask.update({
      where: { id: existing.id },
      data: {
        title: input.title ?? undefined,
        description: input.description === undefined ? undefined : input.description,
        assigneeId: input.assigneeId === undefined ? undefined : input.assigneeId,
        assignedById: reassigning ? actor.userId : undefined,
        startDate: nextStart === undefined ? undefined : nextStart,
        deadline: nextDeadline ?? undefined,
        priority: input.priority ?? undefined,
        isMandatory: input.isMandatory ?? undefined,
        sortOrder: input.sortOrder ?? undefined,
      },
    });

    await appendActivity(tx, {
      actorId: actor.userId,
      projectId,
      entityType: "DisciplineTask",
      entityId: existing.id,
      action: ACTIVITY.TASK_UPDATED,
      summary: `${actor.name} updated "${updated.title}"`,
      metadata: {
        before: {
          title: existing.title,
          deadline: existing.deadline,
          priority: existing.priority,
          isMandatory: existing.isMandatory,
        },
        after: {
          title: updated.title,
          deadline: updated.deadline,
          priority: updated.priority,
          isMandatory: updated.isMandatory,
        },
      },
    });

    if (reassigning) {
      const toName = updated.assigneeId ? await nameOf(tx, updated.assigneeId) : "nobody";
      await appendActivity(tx, {
        actorId: actor.userId,
        projectId,
        entityType: "DisciplineTask",
        entityId: existing.id,
        action: ACTIVITY.ASSIGNED,
        summary: `${actor.name} reassigned "${updated.title}" to ${toName}`,
        metadata: { before: { assigneeId: existing.assigneeId }, after: { assigneeId: updated.assigneeId } },
      });
    }

    // isMandatory can change what the parent's status should be, so always re-derive.
    await recomputeMainTask(tx, existing.mainTaskId, actor, projectId);
  });

  if (reassigning && input.assigneeId && input.assigneeId !== actor.userId) {
    await notify([input.assigneeId], "ASSIGNED", {
      title: "Work handed to you",
      body: `${actor.name} assigned you "${input.title ?? existing.title}".`,
      linkUrl: `/discipline-tasks/${existing.id}`,
      actorId: actor.userId,
    });
  }

  return buildDisciplineTaskDTO(existing.id);
}

/** Moves a discipline task along. Dependencies must be closed first, and COMPLETED still goes through the gate. */
export async function updateDisciplineTaskStatus(
  actor: ActorContext,
  input: UpdateTaskStatusInput,
): Promise<DisciplineTaskDTO> {
  const existing = await loadDisciplineTask(input.id);
  const projectId = existing.mainTask.projectId;

  assertCan(actor, "UPDATE_DISCIPLINE_TASK_STATUS", {
    projectId,
    disciplineId: existing.disciplineId,
    assigneeId: existing.assigneeId,
  });

  if (input.status === existing.status) return buildDisciplineTaskDTO(existing.id);

  if (existing.status === "COMPLETED") {
    throw new ServiceError(
      "This task is already complete. Reopen it with a reason before changing its status.",
    );
  }

  if (input.status === "COMPLETED") {
    return completeDisciplineTask(actor, { id: existing.id }, input.note);
  }

  // The dependency rule: nothing starts while the work it waits on is still open.
  const startingWork = existing.status === "NOT_STARTED" || existing.status === "BLOCKED";
  if (startingWork && input.status !== "NOT_STARTED" && input.status !== "BLOCKED") {
    const waiting = await unmetDependencyTitles(existing.id);
    if (waiting.length > 0) {
      throw new ServiceError(
        `This task is waiting on earlier work: ${waiting.join(", ")}. It can start once ${waiting.length === 1 ? "that task is" : "those tasks are"} complete.`,
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    await lockMainTask(tx, existing.mainTaskId);
    await tx.disciplineTask.update({ where: { id: existing.id }, data: { status: input.status } });

    await appendActivity(tx, {
      actorId: actor.userId,
      projectId,
      entityType: "DisciplineTask",
      entityId: existing.id,
      action: ACTIVITY.STATUS_CHANGED,
      summary:
        `${actor.name} moved "${existing.title}" to ${statusWords(input.status)}` +
        (input.note ? ` — ${input.note}` : ""),
      metadata: { before: existing.status, after: input.status, note: input.note ?? null },
    });

    await recomputeMainTask(tx, existing.mainTaskId, actor, projectId);
  });

  await notify(await taskAudience(existing.id, actor.userId), "STATUS_CHANGED", {
    title: "A task moved",
    body: `${actor.name} moved "${existing.title}" to ${statusWords(input.status)}.`,
    linkUrl: `/discipline-tasks/${existing.id}`,
    actorId: actor.userId,
  });

  return buildDisciplineTaskDTO(existing.id);
}

/**
 * THE GATE. A discipline task is only complete when its mandatory documents are in and everything it
 * waits on is closed. There is no argument that overrides this here — only a main-task override does.
 */
export async function completeDisciplineTask(
  actor: ActorContext,
  input: { id: string },
  note?: string,
): Promise<DisciplineTaskDTO> {
  const existing = await loadDisciplineTask(input.id);
  const projectId = existing.mainTask.projectId;

  assertCan(actor, "COMPLETE_DISCIPLINE_TASK", {
    projectId,
    disciplineId: existing.disciplineId,
    assigneeId: existing.assigneeId,
  });

  if (existing.status === "COMPLETED") return buildDisciplineTaskDTO(existing.id);

  const completedNow = await prisma.$transaction(async (tx) => {
    // The gate is judged INSIDE the transaction, after the parent lock, so a document
    // removed or a predecessor reopened in flight can never slip a completion through.
    await lockMainTask(tx, existing.mainTaskId);

    const fresh = await tx.disciplineTask.findUniqueOrThrow({
      where: { id: existing.id },
      include: { requiredDocuments: true },
    });
    if (fresh.status === "COMPLETED") return false;

    const unmet = await tx.taskDependency.findMany({
      where: {
        successorId: existing.id,
        predecessor: { status: { not: "COMPLETED" }, ...notDeleted },
      },
      select: { predecessor: { select: { title: true } } },
    });
    const check = canCompleteDisciplineTask({
      requiredDocs: fresh.requiredDocuments.map((doc) => ({
        isMandatory: doc.isMandatory,
        documentId: doc.documentId,
        name: doc.name,
      })),
      unmetDependencies: unmet.map((edge) => edge.predecessor.title),
    });
    if (!check.ok) {
      throw new ServiceError(`This task cannot be completed yet. ${check.blockers.join(" ")}`);
    }

    await tx.disciplineTask.update({
      where: { id: existing.id },
      data: { status: "COMPLETED", completedAt: new Date(), completedById: actor.userId },
    });

    await appendActivity(tx, {
      actorId: actor.userId,
      projectId,
      entityType: "DisciplineTask",
      entityId: existing.id,
      action: ACTIVITY.COMPLETED,
      summary:
        `${actor.name} marked "${existing.title}" complete` + (note ? ` — ${note}` : ""),
      metadata: { before: existing.status, after: "COMPLETED", note: note ?? null },
    });

    await recomputeMainTask(tx, existing.mainTaskId, actor, projectId);
    return true;
  });

  // A lost race (someone else completed it first) writes nothing, so it must announce nothing.
  if (completedNow) {
    await notify(await taskAudience(existing.id, actor.userId), "STATUS_CHANGED", {
      title: "A task was completed",
      body: `${actor.name} marked "${existing.title}" complete.`,
      linkUrl: `/discipline-tasks/${existing.id}`,
      actorId: actor.userId,
    });
  }

  return buildDisciplineTaskDTO(existing.id);
}

/** Puts a completed task back in play. The reason is kept in the audit trail. */
export async function reopenDisciplineTask(
  actor: ActorContext,
  input: { id: string; reason: string },
): Promise<DisciplineTaskDTO> {
  const existing = await loadDisciplineTask(input.id);
  const projectId = existing.mainTask.projectId;

  assertCan(actor, "UPDATE_DISCIPLINE_TASK_STATUS", {
    projectId,
    disciplineId: existing.disciplineId,
    assigneeId: existing.assigneeId,
  });

  const reason = input.reason.trim();
  if (reason.length < 5) throw new ServiceError("Give a short reason (at least 5 characters).");
  if (existing.status !== "COMPLETED") throw new ServiceError("That task is not complete, so it cannot be reopened.");

  await prisma.$transaction(async (tx) => {
    await lockMainTask(tx, existing.mainTaskId);
    await tx.disciplineTask.update({
      where: { id: existing.id },
      data: { status: "IN_PROGRESS", completedAt: null, completedById: null },
    });

    await appendActivity(tx, {
      actorId: actor.userId,
      projectId,
      entityType: "DisciplineTask",
      entityId: existing.id,
      action: ACTIVITY.REOPENED,
      summary: `${actor.name} reopened "${existing.title}" — ${reason}`,
      metadata: { before: "COMPLETED", after: "IN_PROGRESS", reason },
    });

    await recomputeMainTask(tx, existing.mainTaskId, actor, projectId);
  });

  await notify(await taskAudience(existing.id, actor.userId), "STATUS_CHANGED", {
    title: "A completed task was reopened",
    body: `${actor.name} reopened "${existing.title}". Reason: ${reason}`,
    linkUrl: `/discipline-tasks/${existing.id}`,
    actorId: actor.userId,
  });

  return buildDisciplineTaskDTO(existing.id);
}

/** Says "this task waits on that one". Both must sit under the same main task, and loops are refused. */
export async function addDependency(actor: ActorContext, input: AddDependencyInput): Promise<DisciplineTaskDTO> {
  const successor = await loadDisciplineTask(input.successorId);
  const predecessor = await loadDisciplineTask(input.predecessorId);
  const projectId = successor.mainTask.projectId;

  assertCan(actor, "EDIT_DISCIPLINE_TASK", { projectId, disciplineId: successor.disciplineId });

  if (predecessor.id === successor.id) throw new ServiceError("A task cannot wait on itself.");
  if (predecessor.mainTaskId !== successor.mainTaskId) {
    throw new ServiceError("Both tasks have to belong to the same main task.");
  }

  const existingEdges = await prisma.taskDependency.findMany({
    where: { successor: { mainTaskId: successor.mainTaskId } },
    select: { predecessorId: true, successorId: true },
  });
  const edges = existingEdges.map((edge): [string, string] => [edge.predecessorId, edge.successorId]);
  if (wouldCreateCycle(edges, [predecessor.id, successor.id])) {
    throw new ServiceError("That would make two tasks wait on each other. Pick a different order.");
  }

  const alreadyThere = edges.some(
    ([from, to]) => from === predecessor.id && to === successor.id,
  );
  if (alreadyThere) return buildDisciplineTaskDTO(successor.id);

  await prisma.$transaction(async (tx) => {
    await lockMainTask(tx, successor.mainTaskId);
    await tx.taskDependency.create({
      data: { predecessorId: predecessor.id, successorId: successor.id },
    });

    await appendActivity(tx, {
      actorId: actor.userId,
      projectId,
      entityType: "DisciplineTask",
      entityId: successor.id,
      action: ACTIVITY.DEPENDENCY_ADDED,
      summary: `${actor.name} set "${successor.title}" to wait on "${predecessor.title}"`,
      metadata: { predecessorId: predecessor.id, successorId: successor.id },
    });
  });

  return buildDisciplineTaskDTO(successor.id);
}

/** Removes a "waits on" link. */
export async function removeDependency(
  actor: ActorContext,
  input: AddDependencyInput,
): Promise<DisciplineTaskDTO> {
  const successor = await loadDisciplineTask(input.successorId);
  const projectId = successor.mainTask.projectId;
  assertCan(actor, "EDIT_DISCIPLINE_TASK", { projectId, disciplineId: successor.disciplineId });

  const edge = await prisma.taskDependency.findUnique({
    where: { predecessorId_successorId: { predecessorId: input.predecessorId, successorId: successor.id } },
    include: { predecessor: { select: { title: true } } },
  });
  if (!edge) throw new NotFoundError("Those two tasks are not linked.");

  await prisma.$transaction(async (tx) => {
    await lockMainTask(tx, successor.mainTaskId);
    await tx.taskDependency.delete({ where: { id: edge.id } });

    await appendActivity(tx, {
      actorId: actor.userId,
      projectId,
      entityType: "DisciplineTask",
      entityId: successor.id,
      action: ACTIVITY.DEPENDENCY_REMOVED,
      summary: `${actor.name} removed the wait on "${edge.predecessor.title}" from "${successor.title}"`,
      metadata: { predecessorId: input.predecessorId, successorId: successor.id },
    });
  });

  return buildDisciplineTaskDTO(successor.id);
}

/** Moves a bar on the Gantt chart: new start and deadline, nothing else. */
export async function updateTaskDates(
  actor: ActorContext,
  input: UpdateTaskDatesInput,
): Promise<MainTaskDTO | DisciplineTaskDTO> {
  if (input.kind === "MAIN") {
    const existing = await loadMainTask(input.id);
    assertCan(actor, "EDIT_MAIN_TASK", { projectId: existing.projectId });
    const nextStart =
      utcMidnightOrNull(input.startDate === undefined ? existing.startDate : input.startDate) ?? null;
    const deadline = utcMidnight(input.deadline);
    assertDatesOrdered(nextStart, deadline);

    await prisma.$transaction(async (tx) => {
      await tx.mainTask.update({
        where: { id: existing.id },
        data: { startDate: nextStart, deadline },
      });
      await appendActivity(tx, {
        actorId: actor.userId,
        projectId: existing.projectId,
        entityType: "MainTask",
        entityId: existing.id,
        action: ACTIVITY.DATES_UPDATED,
        summary: `${actor.name} moved the dates for "${existing.title}"`,
        metadata: {
          before: { startDate: existing.startDate, deadline: existing.deadline },
          after: { startDate: nextStart, deadline },
        },
      });
    });

    return buildMainTaskDTO(existing.id);
  }

  const existing = await loadDisciplineTask(input.id);
  const projectId = existing.mainTask.projectId;
  assertCan(actor, "EDIT_DISCIPLINE_TASK", { projectId, disciplineId: existing.disciplineId });
  const nextStart =
    utcMidnightOrNull(input.startDate === undefined ? existing.startDate : input.startDate) ?? null;
  const deadline = utcMidnight(input.deadline);
  assertDatesOrdered(nextStart, deadline);

  await prisma.$transaction(async (tx) => {
    await lockMainTask(tx, existing.mainTaskId);
    await tx.disciplineTask.update({
      where: { id: existing.id },
      data: { startDate: nextStart, deadline },
    });
    await appendActivity(tx, {
      actorId: actor.userId,
      projectId,
      entityType: "DisciplineTask",
      entityId: existing.id,
      action: ACTIVITY.DATES_UPDATED,
      summary: `${actor.name} moved the dates for "${existing.title}"`,
      metadata: {
        before: { startDate: existing.startDate, deadline: existing.deadline },
        after: { startDate: nextStart, deadline },
      },
    });
  });

  return buildDisciplineTaskDTO(existing.id);
}

/* ------------------------------------------------------------------ */
/* The derivation itself                                               */
/* ------------------------------------------------------------------ */

/**
 * Serializes every transaction that changes a main task's discipline tasks: the row lock
 * makes concurrent completions/reopens queue up, so each derivation sees the other's commit.
 */
export async function lockMainTask(
  tx: Prisma.TransactionClient,
  mainTaskId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "MainTask" WHERE id = ${mainTaskId} FOR UPDATE`;
}

/**
 * Recalculates a main task's cached status and progress from its live discipline tasks.
 * Always called inside the transaction of the change that caused it — the two never drift apart.
 * The soft-delete filter is applied here directly because the helpers in db.ts cannot join a transaction.
 */
export async function recomputeMainTask(
  tx: Prisma.TransactionClient,
  mainTaskId: string,
  actor: ActorContext,
  projectId: string,
): Promise<{ status: TaskStatusName; progressPct: number }> {
  // Belt and braces: harmless if the caller already holds the lock, decisive if it doesn't.
  await lockMainTask(tx, mainTaskId);
  const before = await tx.mainTask.findUniqueOrThrow({
    where: { id: mainTaskId },
    select: { title: true, status: true, progressPct: true },
  });
  const subtasks = await tx.disciplineTask.findMany({
    where: { mainTaskId, ...notDeleted },
    select: { status: true, isMandatory: true, deletedAt: true },
  });

  const derived = deriveMainTask(subtasks);
  if (derived.status === before.status && derived.progressPct === before.progressPct) return derived;

  await tx.mainTask.update({
    where: { id: mainTaskId },
    data: { status: derived.status, progressPct: derived.progressPct },
  });

  await appendActivity(tx, {
    actorId: actor.userId,
    projectId,
    entityType: "MainTask",
    entityId: mainTaskId,
    action: ACTIVITY.STATUS_CHANGED,
    summary: `"${before.title}" is now ${statusWords(derived.status)} at ${derived.progressPct}%`,
    metadata: {
      before: { status: before.status, progressPct: before.progressPct },
      after: { status: derived.status, progressPct: derived.progressPct },
      derived: true,
    },
  });

  return derived;
}

/* ------------------------------------------------------------------ */
/* Loaders, serializers and small helpers                              */
/* ------------------------------------------------------------------ */

async function loadMainTask(id: string) {
  const task = await prisma.mainTask.findFirst({ where: { id, ...notDeleted } });
  if (!task) throw new NotFoundError("We could not find that task.");
  return task;
}

async function loadDisciplineTask(id: string) {
  const task = await prisma.disciplineTask.findFirst({
    where: { id, ...notDeleted },
    include: {
      mainTask: { select: { id: true, projectId: true, title: true } },
      requiredDocuments: true,
    },
  });
  if (!task) throw new NotFoundError("We could not find that task.");
  return task;
}

/** The titles of everything this task waits on that is not finished yet. */
async function unmetDependencyTitles(disciplineTaskId: string): Promise<string[]> {
  const edges = await prisma.taskDependency.findMany({
    where: { successorId: disciplineTaskId },
    include: { predecessor: { select: { title: true, status: true, deletedAt: true } } },
  });
  return edges
    .filter((edge) => !edge.predecessor.deletedAt && edge.predecessor.status !== "COMPLETED")
    .map((edge) => edge.predecessor.title);
}

/** Live discipline tasks for a set of main tasks, grouped by main task. */
async function liveSubtasksFor(mainTaskIds: string[]) {
  const rows = await prisma.disciplineTask.findMany({
    where: { mainTaskId: { in: mainTaskIds }, ...notDeleted },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { discipline: true, assignee: { select: { name: true } } },
  });

  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = grouped.get(row.mainTaskId) ?? [];
    list.push(row);
    grouped.set(row.mainTaskId, list);
  }
  return grouped;
}

type SubtaskRow = {
  id: string;
  title: string;
  disciplineId: string;
  status: TaskStatusName;
  deadline: Date;
  isMandatory: boolean;
  assignee: { name: string } | null;
  discipline: { code: string; colorHex: string; sortOrder: number };
};

/**
 * One card per discipline task: enough to show it and link straight through to it.
 * Overdue is derived here from the subtask's own deadline and status, never stored.
 */
function disciplineSummary(subtasks: SubtaskRow[], now: Date = new Date()) {
  return subtasks
    .slice()
    .sort((a, b) => a.discipline.sortOrder - b.discipline.sortOrder)
    .map((subtask) => ({
      disciplineTaskId: subtask.id,
      title: subtask.title,
      assigneeName: subtask.assignee?.name ?? null,
      deadline: subtask.deadline,
      isOverdue: isOverdue(subtask.deadline, subtask.status, now),
      disciplineId: subtask.disciplineId,
      code: subtask.discipline.code,
      colorHex: subtask.discipline.colorHex,
      status: subtask.status,
    }));
}

function buildListItem(
  task: {
    id: string;
    projectId: string;
    title: string;
    priority: PriorityName;
    deadline: Date;
    status: TaskStatusName;
    statusOverride: TaskStatusName | null;
    progressPct: number;
  },
  projectCode: string,
  subtasks: SubtaskRow[],
  now: Date,
): MainTaskListItemDTO {
  const shown = effectiveStatus(task.status, task.statusOverride);
  return {
    id: task.id,
    projectId: task.projectId,
    projectCode,
    title: task.title,
    priority: task.priority,
    deadline: task.deadline,
    effectiveStatus: shown,
    hasOverride: task.statusOverride !== null,
    progressPct: task.progressPct,
    isOverdue: isOverdue(task.deadline, shown, now),
    counts: {
      disciplineTasks: subtasks.length,
      completed: subtasks.filter((subtask) => subtask.status === "COMPLETED").length,
    },
    disciplineSummary: disciplineSummary(subtasks, now),
  };
}

/** Builds the full main-task DTO. Callers have already checked that the person may see it. */
export async function buildMainTaskDTO(mainTaskId: string): Promise<MainTaskDTO> {
  const task = await prisma.mainTask.findFirst({
    where: { id: mainTaskId, ...notDeleted },
    include: {
      project: { select: { code: true } },
      createdBy: { select: { name: true } },
      owner: { select: { name: true } },
      overriddenBy: { select: { name: true } },
      disciplineTasks: {
        where: notDeleted,
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        include: { discipline: true, assignee: { select: { name: true } } },
      },
    },
  });
  if (!task) throw new NotFoundError("We could not find that task.");

  const subtaskIds = task.disciplineTasks.map((subtask) => subtask.id);
  const [documents, comments] = await Promise.all([
    prisma.document.count({
      where: {
        ...notDeleted,
        OR: [{ mainTaskId: task.id }, { disciplineTaskId: { in: subtaskIds } }],
      },
    }),
    prisma.comment.count({
      where: {
        ...notDeleted,
        OR: [{ mainTaskId: task.id }, { disciplineTaskId: { in: subtaskIds } }],
      },
    }),
  ]);

  const shown = effectiveStatus(task.status, task.statusOverride);
  const dto: MainTaskDTO = {
    id: task.id,
    projectId: task.projectId,
    projectCode: task.project.code,
    title: task.title,
    description: task.description,
    priority: task.priority,
    startDate: task.startDate,
    deadline: task.deadline,
    status: task.status,
    effectiveStatus: shown,
    statusOverride: task.statusOverride,
    overrideReason: task.overrideReason,
    overriddenByName: task.overriddenBy?.name ?? null,
    overriddenAt: task.overriddenAt,
    progressPct: task.progressPct,
    isOverdue: isOverdue(task.deadline, shown),
    ownerId: task.ownerId,
    ownerName: task.owner?.name ?? null,
    createdById: task.createdById,
    createdByName: task.createdBy.name,
    createdAt: task.createdAt,
    disciplineSummary: disciplineSummary(task.disciplineTasks),
    counts: {
      disciplineTasks: task.disciplineTasks.length,
      completed: task.disciplineTasks.filter((subtask) => subtask.status === "COMPLETED").length,
      documents,
      comments,
    },
  };

  return checkDto(MainTaskSchema, dto, "MainTaskDTO");
}

/** Builds the full discipline-task DTO, including its blockers and whether it may be completed now. */
export async function buildDisciplineTaskDTO(disciplineTaskId: string): Promise<DisciplineTaskDTO> {
  const task = await prisma.disciplineTask.findFirst({
    where: { id: disciplineTaskId, ...notDeleted },
    include: {
      mainTask: { select: { id: true, title: true, projectId: true, project: { select: { code: true } } } },
      discipline: true,
      assignee: { select: { name: true } },
      completedBy: { select: { name: true } },
      requiredDocuments: { orderBy: { createdAt: "asc" } },
      predecessorEdges: {
        include: { predecessor: { include: { discipline: { select: { code: true } } } } },
      },
    },
  });
  if (!task) throw new NotFoundError("We could not find that task.");

  const dependencies = task.predecessorEdges
    .filter((edge) => !edge.predecessor.deletedAt)
    .map((edge) => ({
      id: edge.predecessor.id,
      title: edge.predecessor.title,
      status: edge.predecessor.status,
      disciplineCode: edge.predecessor.discipline.code,
    }));

  const check = canCompleteDisciplineTask({
    requiredDocs: task.requiredDocuments.map((doc) => ({
      isMandatory: doc.isMandatory,
      documentId: doc.documentId,
    })),
    unmetDependencies: dependencies
      .filter((dependency) => dependency.status !== "COMPLETED")
      .map((dependency) => dependency.title),
  });

  const dto: DisciplineTaskDTO = {
    id: task.id,
    mainTaskId: task.mainTaskId,
    mainTaskTitle: task.mainTask.title,
    projectId: task.mainTask.projectId,
    projectCode: task.mainTask.project.code,
    disciplineId: task.disciplineId,
    disciplineCode: task.discipline.code,
    disciplineName: task.discipline.name,
    disciplineColorHex: task.discipline.colorHex,
    title: task.title,
    description: task.description,
    assigneeId: task.assigneeId,
    assigneeName: task.assignee?.name ?? null,
    startDate: task.startDate,
    deadline: task.deadline,
    status: task.status,
    priority: task.priority,
    isMandatory: task.isMandatory,
    isOverdue: isOverdue(task.deadline, task.status),
    completedAt: task.completedAt,
    completedByName: task.completedBy?.name ?? null,
    sortOrder: task.sortOrder,
    requiredDocuments: task.requiredDocuments.map((doc) => ({
      id: doc.id,
      name: doc.name,
      description: doc.description,
      isMandatory: doc.isMandatory,
      documentId: doc.documentId,
      satisfiedAt: doc.satisfiedAt,
      isSatisfied: Boolean(doc.documentId),
    })),
    dependencies,
    blockers: check.blockers,
    canComplete: check.ok && task.status !== "COMPLETED",
  };

  return checkDto(DisciplineTaskSchema, dto, "DisciplineTaskDTO");
}

async function enabledDisciplines(projectId: string): Promise<Set<string>> {
  const rows = await prisma.projectDiscipline.findMany({ where: { projectId }, select: { disciplineId: true } });
  return new Set(rows.map((row) => row.disciplineId));
}

async function assertOnProject(projectId: string, userId: string, what: "owner" | "assignee"): Promise<void> {
  const member = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    include: { user: { select: { isActive: true } } },
  });
  if (!member) {
    throw new ServiceError(
      what === "owner"
        ? "The task owner has to be on the project. Add them as a member first."
        : "You can only assign work to someone on the project. Add them as a member first.",
    );
  }
  if (!member.user.isActive) {
    throw new ServiceError(
      "That person's account is deactivated — work given to them would sit unseen. Pick someone active.",
    );
  }
}

/** The resulting pair of dates must make sense whichever half of it was edited. */
function assertDatesOrdered(startDate: Date | null | undefined, deadline: Date): void {
  if (startDate && startDate > deadline) {
    throw new ServiceError("A task cannot end before it starts.");
  }
}

/**
 * Task dates are whole days, so every one of them is stored at UTC midnight — whatever time of day
 * arrived with it. A bar dragged on the timeline and the same day typed into a form then mean
 * exactly the same instant, and whether a task reads as overdue can never depend on how its date
 * was entered.
 */
function utcMidnight(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

/** The same, for a date that may be missing or deliberately cleared. */
function utcMidnightOrNull(value: Date | null | undefined): Date | null | undefined {
  return value == null ? value : utcMidnight(value);
}

async function nameOf(tx: Prisma.TransactionClient, userId: string): Promise<string> {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { name: true } });
  return user?.name ?? "someone";
}

/** Who cares about a discipline task changing: its assignee and the main task's owner. */
async function taskAudience(disciplineTaskId: string, exceptUserId: string): Promise<string[]> {
  const task = await prisma.disciplineTask.findUnique({
    where: { id: disciplineTaskId },
    select: { assigneeId: true, mainTask: { select: { ownerId: true } } },
  });
  const ids = [task?.assigneeId, task?.mainTask.ownerId].filter(
    (id): id is string => Boolean(id) && id !== exceptUserId,
  );
  return [...new Set(ids)];
}

/** Everyone on a project, for the rare change that concerns all of them. */
async function projectAudience(projectId: string, exceptUserId: string): Promise<string[]> {
  const members = await prisma.projectMember.findMany({ where: { projectId }, select: { userId: true } });
  return members.map((member) => member.userId).filter((userId) => userId !== exceptUserId);
}

/** Statuses as people say them, for audit summaries and messages. */
export function statusWords(status: TaskStatusName): string {
  switch (status) {
    case "NOT_STARTED":
      return "not started";
    case "IN_PROGRESS":
      return "in progress";
    case "BLOCKED":
      return "blocked";
    case "AWAITING_REVIEW":
      return "awaiting review";
    default:
      return "complete";
  }
}

function countWords(count: number, noun: string): string {
  return count === 1 ? `1 ${noun}` : `${count} ${noun}s`;
}
