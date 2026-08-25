// "My tasks": everything assigned to the signed-in person across every project they belong to —
// the full list the dashboard's short version comes from, completed work included, plus the same
// work on a timeline.
//
// Scoping is the whole point of this file. The only rows it will ever return are discipline tasks
// assigned to the actor inside projects the actor may see (an administrator sees every project;
// everyone else sees the ones they are a member of), and nothing soft-deleted at any level.

import { notDeleted, prisma } from "@/lib/db";
import { effectiveStatus, isOverdue } from "@/lib/progress";
import type { GanttDTO, MyTaskItemDTO, MyTasksDTO, TaskStatusName } from "@/lib/zod-schemas";
import { GanttDTO as GanttSchema, MyTasksDTO as MyTasksSchema } from "@/lib/zod-schemas";
import type { ActorContext } from "@/server/actor";
import { checkDto } from "@/server/serialize";
import { visibleProjects } from "@/server/services/projects";

/** The longest list of open work one screen will render. `truncated` tells the UI when there is more. */
const LIST_LIMIT = 200;

/**
 * How much finished work rides along behind the open work. It is a separate window on purpose: a
 * person with hundreds of completed tasks must never have their live queue pushed off the screen by
 * their own history.
 */
const COMPLETED_LIMIT = 50;

/**
 * The furthest back the personal timeline reaches for finished work, and the most bars it will ever
 * draw. Without a bound this read grows with a person's whole career.
 */
const GANTT_COMPLETED_DAYS = 90;
const GANTT_LIMIT = 300;

const EMPTY_TOTALS: MyTasksDTO["totals"] = {
  NOT_STARTED: 0,
  IN_PROGRESS: 0,
  BLOCKED: 0,
  AWAITING_REVIEW: 0,
  COMPLETED: 0,
};

/** The one filter both reads share: mine, live, and inside a project I may see. */
const mineIn = (projectIds: string[], userId: string) => ({
  assigneeId: userId,
  ...notDeleted,
  mainTask: { projectId: { in: projectIds }, ...notDeleted },
});

/** Everything the list rows need, in one place because two reads now share it. */
const LIST_INCLUDE = {
  discipline: { select: { code: true, colorHex: true } },
  mainTask: { select: { id: true, projectId: true } },
} as const;

/**
 * Everything assigned to this person, soonest deadline first — completed tasks included, because
 * this screen is the record of the work, not just the queue.
 *
 * Open work and finished work are fetched in **two separate windows** so that history can never eat
 * the list: up to 200 open tasks by deadline, then the 50 most recently finished. One combined read
 * would let a long back-catalogue crowd out the work someone still has to do.
 *
 * The counts per status are done in the database over the whole set, not by counting the rows we
 * happened to return, so they stay true when either window is cut short.
 */
export async function listMyTasks(actor: ActorContext): Promise<MyTasksDTO> {
  const projectCodes = await visibleProjects(actor);
  const projectIds = [...projectCodes.keys()];

  if (projectIds.length === 0) {
    return checkDto(MyTasksSchema, { tasks: [], totals: { ...EMPTY_TOTALS }, truncated: false }, "MyTasksDTO");
  }

  const where = mineIn(projectIds, actor.userId);

  const [openRows, completedRows, statusRows] = await Promise.all([
    prisma.disciplineTask.findMany({
      where: { ...where, status: { not: "COMPLETED" } },
      orderBy: { deadline: "asc" },
      take: LIST_LIMIT,
      include: LIST_INCLUDE,
    }),
    prisma.disciplineTask.findMany({
      where: { ...where, status: "COMPLETED" },
      orderBy: { completedAt: "desc" },
      take: COMPLETED_LIMIT,
      include: LIST_INCLUDE,
    }),
    // Counted in Postgres, uncapped: the status tiles must be the truth even when the list is not
    // the whole story.
    prisma.disciplineTask.groupBy({ by: ["status"], where, _count: { _all: true } }),
  ]);

  const rows = [...openRows, ...completedRows];

  const totals = { ...EMPTY_TOTALS };
  for (const row of statusRows) {
    totals[row.status] = row._count._all;
  }
  // Either window filling up means there is more than the screen is showing.
  const truncated = openRows.length === LIST_LIMIT || completedRows.length === COMPLETED_LIMIT;

  const now = new Date();
  const tasks: MyTaskItemDTO[] = rows.map((task) => ({
    id: task.id,
    title: task.title,
    projectCode: projectCodes.get(task.mainTask.projectId) ?? "",
    mainTaskId: task.mainTaskId,
    disciplineCode: task.discipline.code,
    disciplineColorHex: task.discipline.colorHex,
    status: task.status,
    priority: task.priority,
    startDate: task.startDate,
    deadline: task.deadline,
    isOverdue: isOverdue(task.deadline, task.status, now),
  }));

  return checkDto(MyTasksSchema, { tasks, totals, truncated }, "MyTasksDTO");
}

/**
 * The same work on a timeline: my discipline tasks grouped under the main tasks they belong to.
 * Only main tasks with at least one task of mine appear, and only my tasks appear beneath them —
 * this is a personal view, not the project's Gantt (`/api/projects/[id]/gantt` is that one).
 *
 * The DTO is built here rather than through `buildGantt` in tasks.ts because that helper deliberately
 * loads *every* live subtask of a main task, which is the opposite of what this view wants.
 */
export async function ganttForMyTasks(actor: ActorContext): Promise<GanttDTO> {
  const projectIds = [...(await visibleProjects(actor)).keys()];
  if (projectIds.length === 0) return checkDto(GanttSchema, { mainTasks: [] }, "GanttDTO");

  // Bounded on purpose: a timeline is about now, so it carries every open task of mine plus only
  // the finished ones whose deadline fell inside the last 90 days, and never more than 300 bars.
  // Without that, this read would grow with a person's entire history.
  const since = new Date(Date.now() - GANTT_COMPLETED_DAYS * 24 * 60 * 60 * 1000);

  const mine = await prisma.disciplineTask.findMany({
    where: {
      ...mineIn(projectIds, actor.userId),
      OR: [{ status: { not: "COMPLETED" } }, { deadline: { gte: since } }],
    },
    // Deadline first so the 300 we keep are the nearest ones; the other two keys only break ties,
    // which keeps the order under one main task the same as everywhere else in the app.
    orderBy: [{ deadline: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    take: GANTT_LIMIT,
    include: {
      discipline: { select: { code: true, colorHex: true } },
      assignee: { select: { name: true } },
    },
  });

  if (mine.length === 0) return checkDto(GanttSchema, { mainTasks: [] }, "GanttDTO");

  const mainTasks = await prisma.mainTask.findMany({
    where: { id: { in: [...new Set(mine.map((task) => task.mainTaskId))] }, ...notDeleted },
    orderBy: { deadline: "asc" },
    select: {
      id: true,
      title: true,
      startDate: true,
      deadline: true,
      status: true,
      statusOverride: true,
      progressPct: true,
    },
  });

  const byMainTask = new Map<string, typeof mine>();
  for (const task of mine) {
    byMainTask.set(task.mainTaskId, [...(byMainTask.get(task.mainTaskId) ?? []), task]);
  }

  const dto: GanttDTO = {
    mainTasks: mainTasks.map((mainTask) => ({
      id: mainTask.id,
      title: mainTask.title,
      startDate: mainTask.startDate,
      deadline: mainTask.deadline,
      // The bar shows the effective status, override included — exactly as the project Gantt does.
      status: effectiveStatus(
        mainTask.status as TaskStatusName,
        mainTask.statusOverride as TaskStatusName | null,
      ),
      progressPct: mainTask.progressPct,
      disciplineTasks: (byMainTask.get(mainTask.id) ?? []).map((task) => ({
        id: task.id,
        title: task.title,
        disciplineCode: task.discipline.code,
        disciplineColorHex: task.discipline.colorHex,
        assigneeName: task.assignee?.name ?? null,
        startDate: task.startDate,
        deadline: task.deadline,
        status: task.status,
      })),
    })),
  };

  return checkDto(GanttSchema, dto, "GanttDTO");
}
