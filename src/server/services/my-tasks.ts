// "My tasks": everything assigned to the signed-in person across every project they belong to —
// the full list the dashboard's short version comes from, completed work included, plus the same
// work on a timeline.
//
// Scoping is the whole point of this file. The only rows it will ever return are discipline tasks
// assigned to the actor inside projects the actor may see (an administrator sees every project;
// everyone else sees the ones they are a member of), and nothing soft-deleted at any level.

import { activeProjects, activeProjectsForUser, notDeleted, prisma } from "@/lib/db";
import { effectiveStatus, isOverdue } from "@/lib/progress";
import type { GanttDTO, MyTaskItemDTO, MyTasksDTO, TaskStatusName } from "@/lib/zod-schemas";
import { GanttDTO as GanttSchema, MyTasksDTO as MyTasksSchema } from "@/lib/zod-schemas";
import type { ActorContext } from "@/server/actor";
import { checkDto } from "@/server/serialize";

/** The longest list one screen will render. `truncated` tells the UI when there is more. */
const LIST_LIMIT = 200;

const EMPTY_TOTALS: MyTasksDTO["totals"] = {
  NOT_STARTED: 0,
  IN_PROGRESS: 0,
  BLOCKED: 0,
  AWAITING_REVIEW: 0,
  COMPLETED: 0,
};

/** The projects this person may see, as ids plus their codes for display. */
async function visibleProjects(actor: ActorContext): Promise<Map<string, string>> {
  const projects = actor.role === "ADMIN" ? await activeProjects() : await activeProjectsForUser(actor.userId);
  return new Map(projects.map((project) => [project.id, project.code]));
}

/** The one filter both reads share: mine, live, and inside a project I may see. */
const mineIn = (projectIds: string[], userId: string) => ({
  assigneeId: userId,
  ...notDeleted,
  mainTask: { projectId: { in: projectIds }, ...notDeleted },
});

/**
 * Everything assigned to this person, soonest deadline first — completed tasks included, because
 * this screen is the record of the work, not just the queue.
 *
 * The counts per status are done in the database over the whole set, not by counting the rows we
 * happened to return, so they stay true when the list itself is cut short at 200.
 */
export async function listMyTasks(actor: ActorContext): Promise<MyTasksDTO> {
  const projectCodes = await visibleProjects(actor);
  const projectIds = [...projectCodes.keys()];

  if (projectIds.length === 0) {
    return checkDto(MyTasksSchema, { tasks: [], totals: { ...EMPTY_TOTALS }, truncated: false }, "MyTasksDTO");
  }

  const where = mineIn(projectIds, actor.userId);

  const [rows, statusRows] = await Promise.all([
    prisma.disciplineTask.findMany({
      where,
      orderBy: { deadline: "asc" },
      take: LIST_LIMIT,
      include: {
        discipline: { select: { code: true, colorHex: true } },
        mainTask: { select: { id: true, projectId: true } },
      },
    }),
    // Counted in Postgres, uncapped: the status tiles must be the truth even when the list is not
    // the whole story.
    prisma.disciplineTask.groupBy({ by: ["status"], where, _count: { _all: true } }),
  ]);

  const totals = { ...EMPTY_TOTALS };
  let overall = 0;
  for (const row of statusRows) {
    totals[row.status] = row._count._all;
    overall += row._count._all;
  }

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

  return checkDto(
    MyTasksSchema,
    { tasks, totals, truncated: overall > tasks.length },
    "MyTasksDTO",
  );
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

  const mine = await prisma.disciplineTask.findMany({
    where: mineIn(projectIds, actor.userId),
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
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
