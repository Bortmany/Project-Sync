// The home screen: one query pass over the projects this person belongs to, then everything derived at read time.

import { notDeleted, prisma } from "@/lib/db";
import { effectiveStatus, isOverdue } from "@/lib/progress";
import type { DashboardDTO } from "@/lib/zod-schemas";
import { DashboardDTO as DashboardSchema } from "@/lib/zod-schemas";
import { externalTaskScope, isExternal, type ActorContext } from "@/server/actor";
import { checkDto } from "@/server/serialize";
import { recentActivityForProjects } from "@/server/services/activity";
import { projectsVisibleTo } from "@/server/services/projects";
import { listAwaitingMySignoff } from "@/server/services/tasks";

const DAY_MS = 24 * 60 * 60 * 1000;
const DUE_SOON_DAYS = 7;
const UPCOMING_DAYS = 14;
const MY_TASKS_LIMIT = 25;
const UPCOMING_LIMIT = 20;

/** Everything the dashboard shows, scoped to the projects this person may see. */
export async function getDashboardForActor(actor: ActorContext): Promise<DashboardDTO> {
  const projects = await projectsVisibleTo(actor);
  const projectIds = projects.map((project) => project.id);
  // A contractor's home screen is a view of THEIR work: every count, bar and deadline below is
  // narrowed to the discipline tasks assigned to them, and the project-wide activity feed is not
  // theirs to read at all.
  const external = isExternal(actor);
  const ownWork = externalTaskScope(actor);
  const projectCodes = new Map(projects.map((project) => [project.id, project.code]));

  if (projectIds.length === 0) return checkDto(DashboardSchema, emptyDashboard(), "DashboardDTO");

  const now = new Date();
  const dueSoonCutoff = new Date(now.getTime() + DUE_SOON_DAYS * DAY_MS);
  const upcomingCutoff = new Date(now.getTime() + UPCOMING_DAYS * DAY_MS);

  // Cross-project reads: the soft-delete filter from db.ts is applied by hand because the
  // per-project helpers would mean one query per project here.
  const [mainTasks, myTasks, upcomingSubtasks, disciplineRows, recentActivity, signoffQueue] =
    await Promise.all([
    prisma.mainTask.findMany({
      where: {
        projectId: { in: projectIds },
        ...notDeleted,
        ...(external ? { disciplineTasks: { some: { ...ownWork, ...notDeleted } } } : {}),
      },
      orderBy: { deadline: "asc" },
      select: {
        id: true,
        projectId: true,
        title: true,
        deadline: true,
        status: true,
        statusOverride: true,
      },
    }),
    prisma.disciplineTask.findMany({
      where: {
        assigneeId: actor.userId,
        status: { not: "COMPLETED" },
        ...notDeleted,
        mainTask: { projectId: { in: projectIds }, ...notDeleted },
      },
      orderBy: { deadline: "asc" },
      take: MY_TASKS_LIMIT,
      include: {
        discipline: { select: { code: true, colorHex: true } },
        mainTask: { select: { id: true, projectId: true } },
      },
    }),
    prisma.disciplineTask.findMany({
      where: {
        deadline: { lte: upcomingCutoff },
        status: { not: "COMPLETED" },
        ...notDeleted,
        ...ownWork,
        mainTask: { projectId: { in: projectIds }, ...notDeleted },
      },
      orderBy: { deadline: "asc" },
      take: UPCOMING_LIMIT,
      include: { mainTask: { select: { projectId: true } } },
    }),
    // Counted in the database, not in Node: the per-discipline bars only need totals, and pulling
    // every discipline task of every project into memory to count them would grow without limit.
    prisma.disciplineTask.groupBy({
      by: ["disciplineId", "status"],
      where: {
        ...notDeleted,
        ...ownWork,
        mainTask: { projectId: { in: projectIds }, ...notDeleted },
      },
      _count: { _all: true },
    }),
    external ? [] : recentActivityForProjects(projectIds, 15),
    // "Needs your sign-off" — the same rule that will judge the confirmation decides the queue.
    listAwaitingMySignoff(actor),
  ]);

  const shownStatus = (task: { status: DashboardStatus; statusOverride: DashboardStatus | null }) =>
    effectiveStatus(task.status, task.statusOverride);

  const counts = {
    total: mainTasks.length,
    inProgress: mainTasks.filter((task) => shownStatus(task) === "IN_PROGRESS").length,
    completed: mainTasks.filter((task) => shownStatus(task) === "COMPLETED").length,
    blocked: mainTasks.filter((task) => shownStatus(task) === "BLOCKED").length,
    overdue: mainTasks.filter((task) => isOverdue(task.deadline, shownStatus(task), now)).length,
    dueSoon: mainTasks.filter(
      (task) =>
        shownStatus(task) !== "COMPLETED" &&
        task.deadline >= now &&
        task.deadline <= dueSoonCutoff,
    ).length,
  };

  // The discipline catalogue is a handful of rows; only the ones with work on these projects.
  // Every project here already belongs to the actor's company, so the org filter is belt and braces.
  const disciplines = await prisma.discipline.findMany({
    where: {
      id: { in: [...new Set(disciplineRows.map((row) => row.disciplineId))] },
      orgId: actor.orgId,
    },
    select: { id: true, code: true, name: true, colorHex: true, sortOrder: true },
  });

  const disciplineTotals = new Map<
    string,
    { code: string; name: string; colorHex: string; sortOrder: number; total: number; done: number }
  >();
  for (const discipline of disciplines) {
    disciplineTotals.set(discipline.id, {
      code: discipline.code,
      name: discipline.name,
      colorHex: discipline.colorHex,
      sortOrder: discipline.sortOrder,
      total: 0,
      done: 0,
    });
  }
  for (const row of disciplineRows) {
    const entry = disciplineTotals.get(row.disciplineId);
    if (!entry) continue;
    entry.total += row._count._all;
    if (row.status === "COMPLETED") entry.done += row._count._all;
  }

  const upcoming = [
    ...mainTasks
      .filter(
        (task) =>
          shownStatus(task) !== "COMPLETED" && task.deadline <= upcomingCutoff,
      )
      .map((task) => ({
        id: task.id,
        kind: "MAIN" as const,
        title: task.title,
        projectCode: projectCodes.get(task.projectId) ?? "",
        deadline: task.deadline,
        status: shownStatus(task),
        isOverdue: isOverdue(task.deadline, shownStatus(task), now),
      })),
    ...upcomingSubtasks.map((task) => ({
      id: task.id,
      kind: "DISCIPLINE" as const,
      title: task.title,
      projectCode: projectCodes.get(task.mainTask.projectId) ?? "",
      deadline: task.deadline,
      status: task.status,
      isOverdue: isOverdue(task.deadline, task.status, now),
    })),
  ]
    .sort((a, b) => a.deadline.getTime() - b.deadline.getTime())
    .slice(0, UPCOMING_LIMIT);

  const dto: DashboardDTO = {
    counts,
    myTasks: myTasks.map((task) => ({
      id: task.id,
      title: task.title,
      projectCode: projectCodes.get(task.mainTask.projectId) ?? "",
      mainTaskId: task.mainTaskId,
      disciplineCode: task.discipline.code,
      disciplineColorHex: task.discipline.colorHex,
      status: task.status,
      priority: task.priority,
      deadline: task.deadline,
      isOverdue: isOverdue(task.deadline, task.status, now),
    })),
    awaitingMySignoff: signoffQueue.map((task) => ({
      id: task.id,
      title: task.title,
      projectCode: task.projectCode,
      mainTaskId: task.mainTaskId,
      disciplineCode: task.disciplineCode,
      disciplineColorHex: task.disciplineColorHex,
      deadline: task.deadline,
      isOverdue: task.isOverdue,
      assigneeName: task.assigneeName ?? null,
      assigneeCompanyName: task.assigneeCompanyName ?? null,
    })),
    disciplineProgress: [...disciplineTotals.entries()]
      .sort((a, b) => a[1].sortOrder - b[1].sortOrder)
      .map(([disciplineId, entry]) => ({
        disciplineId,
        code: entry.code,
        name: entry.name,
        colorHex: entry.colorHex,
        pct: entry.total === 0 ? 0 : Math.round((100 * entry.done) / entry.total),
      })),
    upcomingDeadlines: upcoming,
    recentActivity,
  };

  return checkDto(DashboardSchema, dto, "DashboardDTO");
}

type DashboardStatus = "NOT_STARTED" | "IN_PROGRESS" | "BLOCKED" | "AWAITING_REVIEW" | "COMPLETED";

function emptyDashboard(): DashboardDTO {
  return {
    counts: { total: 0, inProgress: 0, completed: 0, blocked: 0, overdue: 0, dueSoon: 0 },
    myTasks: [],
    awaitingMySignoff: [],
    disciplineProgress: [],
    upcomingDeadlines: [],
    recentActivity: [],
  };
}
