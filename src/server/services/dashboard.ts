// The home screen: one query pass over the projects this person belongs to, then everything derived at read time.

import { activeProjects, activeProjectsForUser, notDeleted, prisma } from "@/lib/db";
import { effectiveStatus, isOverdue } from "@/lib/progress";
import type { DashboardDTO } from "@/lib/zod-schemas";
import { DashboardDTO as DashboardSchema } from "@/lib/zod-schemas";
import type { ActorContext } from "@/server/actor";
import { checkDto } from "@/server/serialize";
import { recentActivityForProjects } from "@/server/services/activity";

const DAY_MS = 24 * 60 * 60 * 1000;
const DUE_SOON_DAYS = 7;
const UPCOMING_DAYS = 14;
const MY_TASKS_LIMIT = 25;
const UPCOMING_LIMIT = 20;

/** Everything the dashboard shows, scoped to the projects this person may see. */
export async function getDashboardForActor(actor: ActorContext): Promise<DashboardDTO> {
  const projects = actor.role === "ADMIN" ? await activeProjects() : await activeProjectsForUser(actor.userId);
  const projectIds = projects.map((project) => project.id);
  const projectCodes = new Map(projects.map((project) => [project.id, project.code]));

  if (projectIds.length === 0) return checkDto(DashboardSchema, emptyDashboard(), "DashboardDTO");

  const now = new Date();
  const dueSoonCutoff = new Date(now.getTime() + DUE_SOON_DAYS * DAY_MS);
  const upcomingCutoff = new Date(now.getTime() + UPCOMING_DAYS * DAY_MS);

  // Cross-project reads: the soft-delete filter from db.ts is applied by hand because the
  // per-project helpers would mean one query per project here.
  const [mainTasks, myTasks, upcomingSubtasks, disciplineRows, recentActivity] = await Promise.all([
    prisma.mainTask.findMany({
      where: { projectId: { in: projectIds }, ...notDeleted },
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
        mainTask: { projectId: { in: projectIds }, ...notDeleted },
      },
      orderBy: { deadline: "asc" },
      take: UPCOMING_LIMIT,
      include: { mainTask: { select: { projectId: true } } },
    }),
    prisma.disciplineTask.findMany({
      where: { ...notDeleted, mainTask: { projectId: { in: projectIds }, ...notDeleted } },
      select: { status: true, discipline: true },
    }),
    recentActivityForProjects(projectIds, 15),
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

  const disciplineTotals = new Map<
    string,
    { code: string; name: string; colorHex: string; sortOrder: number; total: number; done: number }
  >();
  for (const row of disciplineRows) {
    const entry = disciplineTotals.get(row.discipline.id) ?? {
      code: row.discipline.code,
      name: row.discipline.name,
      colorHex: row.discipline.colorHex,
      sortOrder: row.discipline.sortOrder,
      total: 0,
      done: 0,
    };
    entry.total += 1;
    if (row.status === "COMPLETED") entry.done += 1;
    disciplineTotals.set(row.discipline.id, entry);
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
    disciplineProgress: [],
    upcomingDeadlines: [],
    recentActivity: [],
  };
}
