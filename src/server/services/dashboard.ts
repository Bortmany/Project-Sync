// The home screen: one pass over the projects this person may see, then everything derived at read time.
//
// ONE set of numbers: every tile is `matchesTile()` over the same rows the list behind it shows
// (`listTileWork()`), so a tile and its list cannot disagree. "Late" is the shared late rule
// (src/lib/late.ts); "Upcoming" is the next 14 days with nothing late ever in it.

import { notDeleted, prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { dayWindow, daysLate } from "@/lib/late";
import { effectiveStatus, isOverdue } from "@/lib/progress";
import type { DashboardDTO } from "@/lib/zod-schemas";
import { DashboardDTO as DashboardSchema } from "@/lib/zod-schemas";
import { externalTaskScope, isExternal, type ActorContext } from "@/server/actor";
import { checkDto } from "@/server/serialize";
import { recentActivityForProjects } from "@/server/services/activity";
import { projectsVisibleTo } from "@/server/services/projects";
import { listAwaitingMySignoff } from "@/server/services/tasks";

const DAY_MS = 24 * 60 * 60 * 1000;
const UPCOMING_DAYS = 14;
const MY_TASKS_LIMIT = 25;
const UPCOMING_LIMIT = 20;
const LATE_LIMIT = 20;
/** The longest list a tile's page draws; the tile itself always counts the whole set. */
const TILE_LIST_LIMIT = 500;

export type TileKey = "all" | "in-progress" | "completed" | "blocked" | "late" | "upcoming";
export const TILE_KEYS: TileKey[] = ["all", "in-progress", "completed", "blocked", "late", "upcoming"];

type DashboardStatus = "NOT_STARTED" | "IN_PROGRESS" | "BLOCKED" | "AWAITING_REVIEW" | "COMPLETED";

/** One row of "the work I can see": a main task or a discipline task, already judged. */
export type WorkRow = {
  id: string;
  kind: "MAIN" | "DISCIPLINE";
  title: string;
  projectCode: string;
  deadline: Date;
  status: DashboardStatus;
  isOverdue: boolean;
};

export type DashboardWorkItem = DashboardDTO["upcomingDeadlines"][number];

/**
 * THE rule a tile and the list behind it both use.
 *  - late: the shared late rule (deadline day passed, not complete, by effective status).
 *  - upcoming: not complete, not late, deadline within the next 14 days (today counts).
 */
export function matchesTile(row: WorkRow, tile: TileKey, now: Date): boolean {
  switch (tile) {
    case "all":
      return true;
    case "in-progress":
      return row.status === "IN_PROGRESS";
    case "completed":
      return row.status === "COMPLETED";
    case "blocked":
      return row.status === "BLOCKED";
    case "late":
      return row.isOverdue;
    case "upcoming":
      return (
        row.status !== "COMPLETED" &&
        !row.isOverdue &&
        row.deadline.getTime() <= now.getTime() + UPCOMING_DAYS * DAY_MS
      );
  }
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

function toItem(row: WorkRow, now: Date): DashboardWorkItem {
  const { startOfDay } = dayWindow(now);
  return {
    ...row,
    daysLate: row.isOverdue ? daysLate(row.deadline, now) : null,
    daysUntil: row.isOverdue ? null : Math.max(0, daysBetween(startOfDay, row.deadline)),
  };
}

type Project = { id: string; code: string };

/* ------------------------------------------------------------------ */
/* The database half of matchesTile()                                  */
/* ------------------------------------------------------------------ */
// `matchesTile()` stays THE rule. These two functions draw the very same conditions in the
// database (effective status: a main task's override wins; deadline against `overdueCutoff`), so a
// tile's number is counted there instead of by loading every task. dashboard.service.test.ts pins
// that the count and the list behind it can never disagree.

type StatusFilter = "NOT_STARTED" | "IN_PROGRESS" | "BLOCKED" | "AWAITING_REVIEW" | "COMPLETED";

function mainIs(status: StatusFilter): Prisma.MainTaskWhereInput {
  return { OR: [{ statusOverride: null, status }, { statusOverride: status }] };
}

const mainNotCompleted: Prisma.MainTaskWhereInput = {
  OR: [
    { statusOverride: null, status: { not: "COMPLETED" } },
    { statusOverride: { not: null }, NOT: { statusOverride: "COMPLETED" } },
  ],
};

function mainTileWhere(tile: TileKey, now: Date): Prisma.MainTaskWhereInput {
  const { overdueCutoff } = dayWindow(now);
  switch (tile) {
    case "all":
      return {};
    case "in-progress":
      return mainIs("IN_PROGRESS");
    case "completed":
      return mainIs("COMPLETED");
    case "blocked":
      return mainIs("BLOCKED");
    case "late":
      return { deadline: { lte: overdueCutoff }, AND: [mainNotCompleted] };
    case "upcoming":
      return {
        deadline: { gt: overdueCutoff, lte: new Date(now.getTime() + UPCOMING_DAYS * DAY_MS) },
        AND: [mainNotCompleted],
      };
  }
}

function disciplineTileWhere(tile: TileKey, now: Date): Prisma.DisciplineTaskWhereInput {
  const { overdueCutoff } = dayWindow(now);
  switch (tile) {
    case "all":
      return {};
    case "in-progress":
      return { status: "IN_PROGRESS" };
    case "completed":
      return { status: "COMPLETED" };
    case "blocked":
      return { status: "BLOCKED" };
    case "late":
      return { deadline: { lte: overdueCutoff }, status: { not: "COMPLETED" } };
    case "upcoming":
      return {
        deadline: { gt: overdueCutoff, lte: new Date(now.getTime() + UPCOMING_DAYS * DAY_MS) },
        status: { not: "COMPLETED" },
      };
  }
}

/** The rows this person may count, as database filters. A contractor counts only their own discipline tasks. */
function scopes(actor: ActorContext, projects: Project[]) {
  const projectScope = {
    projectId: { in: projects.map((project) => project.id) },
    project: { orgId: actor.orgId },
    ...notDeleted,
  };
  return {
    external: isExternal(actor),
    main: projectScope satisfies Prisma.MainTaskWhereInput,
    discipline: {
      ...notDeleted,
      ...externalTaskScope(actor),
      mainTask: projectScope,
    } satisfies Prisma.DisciplineTaskWhereInput,
  };
}

/** One tile's number: database counts over the same rows and conditions as its list. */
async function countTile(
  actor: ActorContext,
  projects: Project[],
  tile: TileKey,
  now: Date,
): Promise<number> {
  const scope = scopes(actor, projects);
  const [main, discipline] = await Promise.all([
    scope.external
      ? 0
      : prisma.mainTask.count({ where: { AND: [scope.main, mainTileWhere(tile, now)] } }),
    prisma.disciplineTask.count({
      where: { AND: [scope.discipline, disciplineTileWhere(tile, now)] },
    }),
  ]);
  return main + discipline;
}

/**
 * The first `limit` rows of a tile, oldest deadline first — only these rows are read, and only the
 * columns drawn. Each kind is cut at `limit` before the two are merged, so the merged head is exact.
 */
async function loadTileRows(
  actor: ActorContext,
  projects: Project[],
  tile: TileKey,
  now: Date,
  limit: number,
): Promise<WorkRow[]> {
  const projectCodes = new Map(projects.map((project) => [project.id, project.code]));
  const scope = scopes(actor, projects);
  const order = [{ deadline: "asc" as const }, { id: "asc" as const }];
  const [mainTasks, disciplineTasks] = await Promise.all([
    scope.external
      ? []
      : prisma.mainTask.findMany({
          where: { AND: [scope.main, mainTileWhere(tile, now)] },
          orderBy: order,
          take: limit,
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
      where: { AND: [scope.discipline, disciplineTileWhere(tile, now)] },
      orderBy: order,
      take: limit,
      select: {
        id: true,
        title: true,
        deadline: true,
        status: true,
        mainTask: { select: { projectId: true } },
      },
    }),
  ]);
  const rows: WorkRow[] = [
    ...mainTasks.map((task): WorkRow => {
      const status = effectiveStatus(task.status, task.statusOverride);
      return {
        id: task.id,
        kind: "MAIN",
        title: task.title,
        projectCode: projectCodes.get(task.projectId) ?? "",
        deadline: task.deadline,
        status,
        isOverdue: isOverdue(task.deadline, status, now),
      };
    }),
    ...disciplineTasks.map(
      (task): WorkRow => ({
        id: task.id,
        kind: "DISCIPLINE",
        title: task.title,
        projectCode: projectCodes.get(task.mainTask.projectId) ?? "",
        deadline: task.deadline,
        status: task.status,
        isOverdue: isOverdue(task.deadline, task.status, now),
      }),
    ),
  ];
  // The single rule judges every row once more: the database filter is only the fast path to it.
  return byDeadline(rows.filter((row) => matchesTile(row, tile, now))).slice(0, limit);
}

/** Oldest deadline first: for Late that is most days late first, for Upcoming soonest first. */
function byDeadline(rows: WorkRow[]): WorkRow[] {
  return [...rows].sort((a, b) => a.deadline.getTime() - b.deadline.getTime());
}

/** All six tiles' numbers, each counted in the database by `countTile`. */
async function countAllTiles(actor: ActorContext, projects: Project[], now: Date) {
  const [total, inProgress, completed, blocked, overdue, dueSoon] = await Promise.all(
    TILE_KEYS.map((tile) => countTile(actor, projects, tile, now)),
  );
  return { total, inProgress, completed, blocked, overdue, dueSoon };
}

/** The list a tile opens: the same filter the tile's number is, over the same rows. */
export async function listTileWork(
  actor: ActorContext,
  tile: TileKey,
  now: Date = new Date(),
): Promise<{ scope: "COMPANY" | "OWN"; total: number; items: DashboardWorkItem[] }> {
  const scope = isExternal(actor) ? "OWN" : "COMPANY";
  const projects = await projectsVisibleTo(actor);
  if (projects.length === 0) return { scope, total: 0, items: [] };
  const [total, rows] = await Promise.all([
    countTile(actor, projects, tile, now),
    loadTileRows(actor, projects, tile, now, TILE_LIST_LIMIT),
  ]);
  return { scope, total, items: rows.map((row) => toItem(row, now)) };
}

/** Everything the dashboard shows, scoped to the projects this person may see. */
export async function getDashboardForActor(
  actor: ActorContext,
  now: Date = new Date(),
): Promise<DashboardDTO> {
  const projects = await projectsVisibleTo(actor);
  const projectIds = projects.map((project) => project.id);
  // A contractor's home screen is a view of THEIR work: every count, bar and deadline below is
  // narrowed to the discipline tasks assigned to them, and the project-wide activity feed is not
  // theirs to read at all.
  const external = isExternal(actor);
  const ownWork = externalTaskScope(actor);
  const projectCodes = new Map(projects.map((project) => [project.id, project.code]));

  if (projectIds.length === 0) return checkDto(DashboardSchema, emptyDashboard(actor), "DashboardDTO");

  // Cross-project reads: the soft-delete filter from db.ts is applied by hand because the
  // per-project helpers would mean one query per project here.
  const [counts, lateRows, upcomingRows, myTasks, disciplineRows, recentActivity, signoffQueue] =
    await Promise.all([
    countAllTiles(actor, projects, now),
    loadTileRows(actor, projects, "late", now, LATE_LIMIT),
    loadTileRows(actor, projects, "upcoming", now, UPCOMING_LIMIT),
    prisma.disciplineTask.findMany({
      where: {
        assigneeId: actor.userId,
        status: { not: "COMPLETED" },
        ...notDeleted,
        mainTask: { projectId: { in: projectIds }, project: { orgId: actor.orgId }, ...notDeleted },
      },
      orderBy: { deadline: "asc" },
      take: MY_TASKS_LIMIT,
      include: {
        discipline: { select: { code: true, colorHex: true } },
        mainTask: { select: { id: true, projectId: true } },
      },
    }),
    // Counted in the database, not in Node: the per-discipline bars only need totals, and pulling
    // every discipline task of every project into memory to count them would grow without limit.
    // A contractor gets no bars at all: "Discipline progress" is a department's standing, which is
    // a summary of work they may not see, so their variant carries no discipline aggregate.
    external
      ? []
      : prisma.disciplineTask.groupBy({
          by: ["disciplineId", "status"],
          where: {
            ...notDeleted,
            ...ownWork,
            mainTask: { projectId: { in: projectIds }, project: { orgId: actor.orgId }, ...notDeleted },
          },
          _count: { _all: true },
        }),
    external ? [] : recentActivityForProjects(projectIds, 15),
    // "Needs your sign-off" — the same rule that will judge the confirmation decides the queue.
    listAwaitingMySignoff(actor),
  ]);

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

  const dto: DashboardDTO = {
    scope: external ? "OWN" : "COMPANY",
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
    lateTasks: lateRows.map((row) => toItem(row, now)),
    upcomingDeadlines: upcomingRows.map((row) => toItem(row, now)),
    recentActivity,
  };

  return checkDto(DashboardSchema, dto, "DashboardDTO");
}

function emptyDashboard(actor: ActorContext): DashboardDTO {
  return {
    scope: isExternal(actor) ? "OWN" : "COMPANY",
    counts: { total: 0, inProgress: 0, completed: 0, blocked: 0, overdue: 0, dueSoon: 0 },
    myTasks: [],
    awaitingMySignoff: [],
    disciplineProgress: [],
    lateTasks: [],
    upcomingDeadlines: [],
    recentActivity: [],
  };
}
