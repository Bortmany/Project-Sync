// Daily briefs: "Your day" for one person, "Where we stand" for one project, and the once-a-day
// chat digest for a whole company. Every number here is COMPUTED from what the app already records
// — there is no new column behind a brief, no snapshot table and no stored history.
//
// Three rules govern this file:
//  1. **Nothing is stored and nothing is written.** A brief is a read. Overdue is still derived by
//     `isOverdue()`, a locked phase is still derived by `phaseLockedFor()`, and a main task's status
//     is still the truth of its discipline tasks. A brief only ever reads those answers.
//  2. **Every read is scoped.** The personal brief only sees projects `visibleProjects()` allows and
//     rows belonging to the actor; the project brief goes through `assertCanViewProject`; the digest
//     is looked up by `orgId` alone, exactly as the sweep's fan-out is.
//  3. **Bounded, and batched by project.** Each section has a cap and a true count beside it, and
//     nothing in here runs a query per row: phases, completion moments and dependency edges are all
//     read for a whole set of projects at once.

import { notDeleted, prisma } from "@/lib/db";
import { phaseLockedFor, sortPhases, type PhaseLockState } from "@/lib/phase-lock";
import { effectiveStatus, isOverdue, type TaskStatusValue } from "@/lib/progress";
import type {
  BriefBlockedTaskDTO,
  BriefItemDTO,
  BriefLockedPhaseDTO,
  BriefOverdueByDisciplineDTO,
  BriefSectionDTO,
  BriefDTO,
  ProjectBriefDTO,
} from "@/lib/zod-schemas";
import {
  BriefDTO as BriefSchema,
  ProjectBriefDTO as ProjectBriefSchema,
} from "@/lib/zod-schemas";
import { isExternal, type ActorContext } from "@/server/actor";
import { NotFoundError } from "@/server/errors";
import { checkDto } from "@/server/serialize";
import { ACTIVITY } from "@/server/services/activity";
import { phaseStatesFor } from "@/server/services/phases";
import { assertCanViewProject, visibleProjects } from "@/server/services/projects";
import type { ChatMessage } from "@/server/services/webhooks";

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far back "newly unblocked" and "mentions" look. Stated on the page in so many words. */
export const BRIEF_WINDOW_MS = DAY_MS;

/** How far back the project brief compares progress to. */
export const PROGRESS_LOOKBACK_MS = 7 * DAY_MS;

/** The longest list any one section of a brief shows. `total` beside it is the real number. */
export const SECTION_LIMIT = 10;

/** The most of a person's open tasks the "newly unblocked" derivation will examine in one read. */
export const UNBLOCKED_SCAN_LIMIT = 200;

/**
 * The most projects the gate half of "newly unblocked" will work out gates for. Deriving a gate
 * needs a whole project's main tasks, so this is what stops an administrator's brief reading every
 * project in the company.
 */
export const UNBLOCKED_PROJECT_LIMIT = 10;

/** The most reopen audit rows the seven-day comparison reads. Reopening is rare by design. */
export const REOPEN_SCAN_LIMIT = 500;

/** The most projects one digest message names, so a card can never outgrow the chat cap. */
export const DIGEST_PROJECT_LIMIT = 12;

/* ------------------------------------------------------------------ */
/* Small shared pieces                                                 */
/* ------------------------------------------------------------------ */

/**
 * The moment a deadline stops being "today". Deadlines are saved at UTC midnight and mean "by the
 * end of that day" (`isOverdue`), so the day window is worked out in UTC too — the same clock the
 * deadlines themselves were written on.
 */
function dayWindow(now: Date): { startOfDay: Date; endOfDay: Date; overdueCutoff: Date } {
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return {
    startOfDay,
    endOfDay: new Date(startOfDay.getTime() + DAY_MS),
    // isOverdue() is `deadline + one day <= now`, so this is the same line drawn in the database.
    overdueCutoff: new Date(now.getTime() - DAY_MS),
  };
}

/** Whole days past the deadline day — 1 the morning after, never 0. */
function daysOver(deadline: Date, now: Date): number {
  return Math.max(1, Math.floor((now.getTime() - deadline.getTime()) / DAY_MS));
}

const emptySection = (): BriefSectionDTO => ({ items: [], total: 0 });

type MainTaskShape = {
  id: string;
  projectId: string;
  phaseId: string | null;
  status: TaskStatusValue;
  statusOverride: TaskStatusValue | null;
  overriddenAt: Date | null;
};

/**
 * When each completed main task of these projects actually finished — derived, not stored.
 *
 * A main task carries no completion timestamp of its own (the schema is frozen), and it does not
 * need one: the golden rule says its status is the truth of its discipline tasks, so the moment it
 * finished is the moment the LAST of those finished. A task completed by an authorised override
 * finished when the override was recorded.
 *
 * Returns only the tasks that are complete. `null` means "complete, but the moment is not
 * recoverable" — old data — and callers treat that as "finished before the window", never as new.
 *
 * One grouped query for the whole set, whatever the number of projects.
 */
export async function completionMoments(tasks: MainTaskShape[]): Promise<Map<string, Date | null>> {
  const completed = tasks.filter(
    (task) => effectiveStatus(task.status, task.statusOverride) === "COMPLETED",
  );
  if (completed.length === 0) return new Map();

  const derived = completed.filter((task) => task.statusOverride !== "COMPLETED");
  const lastSubtask =
    derived.length === 0
      ? []
      : await prisma.disciplineTask.groupBy({
          by: ["mainTaskId"],
          where: { mainTaskId: { in: derived.map((task) => task.id) }, ...notDeleted },
          _max: { completedAt: true },
        });
  const lastByTask = new Map(lastSubtask.map((row) => [row.mainTaskId, row._max.completedAt]));

  const moments = new Map<string, Date | null>();
  for (const task of completed) {
    moments.set(
      task.id,
      task.statusOverride === "COMPLETED"
        ? task.overriddenAt
        : (lastByTask.get(task.id) ?? null),
    );
  }
  return moments;
}

/**
 * When each phase's gate opened, for the phases that are open now. Null means "it was never shut"
 * (nothing before it ever held work) or "it is still shut", so a caller can treat a real date as
 * proof the gate moved.
 *
 * The gate opened when the last main task before it was completed — or, where an administrator
 * recorded an override, at the moment of that override, because that is what opened it.
 */
export function gateOpenMoments(
  phases: { id: string; name: string; sortOrder: number; overriddenAt: Date | null }[],
  tasks: MainTaskShape[],
  moments: Map<string, Date | null>,
): Map<string, Date | null> {
  const ordered = sortPhases(phases);
  const opened = new Map<string, Date | null>();

  for (const [index, phase] of ordered.entries()) {
    if (phase.overriddenAt) {
      opened.set(phase.id, phase.overriddenAt);
      continue;
    }

    const earlierIds = new Set(ordered.slice(0, index).map((earlier) => earlier.id));
    const earlierTasks = tasks.filter((task) => task.phaseId && earlierIds.has(task.phaseId));
    // Nothing before it ever held work, so this gate was never shut and never "opened".
    if (earlierTasks.length === 0) {
      opened.set(phase.id, null);
      continue;
    }
    // Still shut.
    if (earlierTasks.some((task) => !moments.has(task.id))) {
      opened.set(phase.id, null);
      continue;
    }

    let latest: Date | null = null;
    for (const task of earlierTasks) {
      const at = moments.get(task.id) ?? null;
      if (at && (!latest || at > latest)) latest = at;
    }
    opened.set(phase.id, latest);
  }

  return opened;
}

/* ------------------------------------------------------------------ */
/* "Your day" — the personal brief                                     */
/* ------------------------------------------------------------------ */

/**
 * One person's day, computed. Five sections, each with its own window stated on the page:
 * due today, overdue, newly unblocked in the last 24 hours, mentions in the last 24 hours, and the
 * main tasks they own that are waiting for their review.
 *
 * Everything is scoped twice over: to the projects this person may see, and to rows that are theirs
 * (assigned to them, owned by them, or addressed to them).
 */
export async function personBrief(actor: ActorContext, now: Date = new Date()): Promise<BriefDTO> {
  const since = new Date(now.getTime() - BRIEF_WINDOW_MS);
  const projectCodes = await visibleProjects(actor);
  const projectIds = [...projectCodes.keys()];

  if (projectIds.length === 0) {
    return checkDto(
      BriefSchema,
      {
        generatedAt: now,
        since,
        dueToday: emptySection(),
        overdue: emptySection(),
        newlyUnblocked: emptySection(),
        mentions: await mentionsSection(actor, since),
        awaitingReview: emptySection(),
      },
      "BriefDTO",
    );
  }

  const { startOfDay, endOfDay, overdueCutoff } = dayWindow(now);
  const mine = {
    assigneeId: actor.userId,
    ...notDeleted,
    status: { not: "COMPLETED" as const },
    mainTask: { projectId: { in: projectIds }, ...notDeleted },
  };

  const listInclude = {
    discipline: { select: { code: true } },
    mainTask: { select: { projectId: true } },
  } as const;

  const [dueRows, dueTotal, overdueRows, overdueTotal, reviewRows, reviewTotal, mentions] =
    await Promise.all([
      prisma.disciplineTask.findMany({
        where: { ...mine, deadline: { gte: startOfDay, lt: endOfDay } },
        orderBy: [{ deadline: "asc" }, { title: "asc" }],
        take: SECTION_LIMIT,
        include: listInclude,
      }),
      prisma.disciplineTask.count({ where: { ...mine, deadline: { gte: startOfDay, lt: endOfDay } } }),
      prisma.disciplineTask.findMany({
        where: { ...mine, deadline: { lte: overdueCutoff } },
        orderBy: [{ deadline: "asc" }, { title: "asc" }],
        take: SECTION_LIMIT,
        include: listInclude,
      }),
      prisma.disciplineTask.count({ where: { ...mine, deadline: { lte: overdueCutoff } } }),
      prisma.mainTask.findMany({
        where: awaitingReviewWhere(actor.userId, projectIds),
        orderBy: [{ deadline: "asc" }, { title: "asc" }],
        take: SECTION_LIMIT,
        select: { id: true, title: true, projectId: true, deadline: true, progressPct: true },
      }),
      prisma.mainTask.count({ where: awaitingReviewWhere(actor.userId, projectIds) }),
      mentionsSection(actor, since),
    ]);

  const codeOf = (projectId: string): string => projectCodes.get(projectId) ?? "";

  const dto: BriefDTO = {
    generatedAt: now,
    since,
    dueToday: {
      items: dueRows.map((task) => ({
        id: task.id,
        title: task.title,
        linkUrl: `/discipline-tasks/${task.id}`,
        projectCode: codeOf(task.mainTask.projectId),
        disciplineCode: task.discipline.code,
        deadline: task.deadline,
        daysOverdue: null,
        note: null,
        at: null,
      })),
      total: dueTotal,
    },
    overdue: {
      items: overdueRows.map((task) => ({
        id: task.id,
        title: task.title,
        linkUrl: `/discipline-tasks/${task.id}`,
        projectCode: codeOf(task.mainTask.projectId),
        disciplineCode: task.discipline.code,
        deadline: task.deadline,
        daysOverdue: daysOver(task.deadline, now),
        note: null,
        at: null,
      })),
      total: overdueTotal,
    },
    newlyUnblocked: await newlyUnblockedSection(actor, projectCodes, since, now),
    mentions,
    awaitingReview: {
      items: reviewRows.map((task) => ({
        id: task.id,
        title: task.title,
        linkUrl: `/tasks/${task.id}`,
        projectCode: codeOf(task.projectId),
        disciplineCode: null,
        deadline: task.deadline,
        daysOverdue: null,
        note: `${task.progressPct}% complete`,
        at: null,
      })),
      total: reviewTotal,
    },
  };

  return checkDto(BriefSchema, dto, "BriefDTO");
}

/**
 * Main tasks this person owns that are waiting for a review. The effective status is what counts, so
 * a task pushed to AWAITING_REVIEW by an authorised override belongs here just as much as a derived
 * one — and a task overridden to something else does not.
 */
function awaitingReviewWhere(userId: string, projectIds: string[]) {
  return {
    ownerId: userId,
    projectId: { in: projectIds },
    ...notDeleted,
    OR: [
      { statusOverride: "AWAITING_REVIEW" as const },
      { statusOverride: null, status: "AWAITING_REVIEW" as const },
    ],
  };
}

/** The person's own mentions from the last 24 hours. Their notifications, nobody else's. */
async function mentionsSection(actor: ActorContext, since: Date): Promise<BriefSectionDTO> {
  const where = { userId: actor.userId, type: "MENTIONED" as const, createdAt: { gte: since } };

  const [rows, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: SECTION_LIMIT,
      include: { actor: { select: { name: true } } },
    }),
    prisma.notification.count({ where }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      title: row.body,
      linkUrl: row.linkUrl,
      projectCode: "",
      disciplineCode: null,
      deadline: null,
      daysOverdue: null,
      note: row.actor?.name ? `From ${row.actor.name}` : null,
      at: row.createdAt,
    })),
    total,
  };
}

/**
 * Work of this person's that became possible to start in the last 24 hours, derived from the state
 * that is already there — no new column, and nothing recorded when it happened.
 *
 * Two ways a task becomes newly unblocked:
 *  - **Its last dependency closed.** Every live task it waits on is complete, and the most recent of
 *    those completions is inside the window (`DisciplineTask.completedAt`).
 *  - **Its phase gate opened.** The main task sits in a phase that is open now, and that gate opened
 *    inside the window — the last main task before it finishing, or an administrator's recorded
 *    override (`ProjectPhase.overriddenAt`).
 *
 * Bounded and batched: one scan of this person's open work, then three reads that cover every
 * project in that scan at once.
 */
async function newlyUnblockedSection(
  actor: ActorContext,
  projectCodes: Map<string, string>,
  since: Date,
  now: Date,
): Promise<BriefSectionDTO> {
  const candidates = await prisma.disciplineTask.findMany({
    where: {
      assigneeId: actor.userId,
      ...notDeleted,
      status: { not: "COMPLETED" },
      mainTask: { projectId: { in: [...projectCodes.keys()] }, ...notDeleted },
    },
    orderBy: [{ deadline: "asc" }, { title: "asc" }],
    take: UNBLOCKED_SCAN_LIMIT,
    include: {
      discipline: { select: { code: true } },
      mainTask: { select: { projectId: true, phaseId: true } },
      predecessorEdges: {
        include: {
          predecessor: { select: { title: true, status: true, completedAt: true, deletedAt: true } },
        },
      },
    },
  });
  if (candidates.length === 0) return emptySection();

  // The gate half needs a whole project's main tasks to work out which gates are open, so it is
  // bounded by the number of PROJECTS it will do that for — an administrator can be a member of
  // every project in the company. The scan is ordered by deadline, so these are the projects this
  // person's nearest work sits in. A gate opening in an eleventh project costs a line on one
  // brief — a nudge, never correctness.
  const phasedProjectIds = [
    ...new Set(
      candidates
        .filter((task) => task.mainTask.phaseId !== null)
        .map((task) => task.mainTask.projectId),
    ),
  ].slice(0, UNBLOCKED_PROJECT_LIMIT);

  // The gate half of the derivation, read for every project in the scan at once.
  const gateOpenedAt = new Map<string, Date | null>();
  const gateStates = new Map<string, PhaseLockState>();
  if (phasedProjectIds.length > 0) {
    const [phases, projectTasks] = await Promise.all([
      prisma.projectPhase.findMany({
        where: { projectId: { in: phasedProjectIds } },
        select: { id: true, projectId: true, name: true, sortOrder: true, overriddenAt: true, overriddenById: true },
      }),
      prisma.mainTask.findMany({
        where: { projectId: { in: phasedProjectIds }, ...notDeleted },
        select: {
          id: true,
          projectId: true,
          phaseId: true,
          status: true,
          statusOverride: true,
          overriddenAt: true,
        },
      }),
    ]);
    const moments = await completionMoments(projectTasks);

    for (const projectId of phasedProjectIds) {
      const own = phases.filter((phase) => phase.projectId === projectId);
      const ownTasks = projectTasks.filter((task) => task.projectId === projectId);
      for (const [phaseId, at] of gateOpenMoments(own, ownTasks, moments)) {
        gateOpenedAt.set(phaseId, at);
      }
      for (const [phaseId, state] of phaseLockedFor(
        own.map((phase) => {
          const inPhase = ownTasks.filter((task) => task.phaseId === phase.id);
          return {
            id: phase.id,
            name: phase.name,
            sortOrder: phase.sortOrder,
            overridden: phase.overriddenById !== null,
            taskCount: inPhase.length,
            completedCount: inPhase.filter(
              (task) => effectiveStatus(task.status, task.statusOverride) === "COMPLETED",
            ).length,
          };
        }),
      )) {
        gateStates.set(phaseId, state);
      }
    }
  }

  const items: BriefItemDTO[] = [];
  for (const task of candidates) {
    const live = task.predecessorEdges.filter((edge) => !edge.predecessor.deletedAt);
    const allClosed =
      live.length > 0 && live.every((edge) => edge.predecessor.status === "COMPLETED");
    let closedAt: Date | null = null;
    let lastTitle = "";
    if (allClosed) {
      for (const edge of live) {
        const at = edge.predecessor.completedAt;
        if (at && (!closedAt || at > closedAt)) {
          closedAt = at;
          lastTitle = edge.predecessor.title;
        }
      }
    }

    const phaseId = task.mainTask.phaseId;
    const phaseState = phaseId ? gateStates.get(phaseId) : undefined;
    const openedAt = phaseId && phaseState && !phaseState.locked ? (gateOpenedAt.get(phaseId) ?? null) : null;

    const byDependency = closedAt !== null && closedAt >= since;
    // A gate opening only frees work that has nothing else holding it: with a live predecessor still
    // open, the app would refuse this task anyway, so calling it "newly unblocked" would be a lie.
    const freeOfDependencies = live.length === 0 || allClosed;
    const byGate = freeOfDependencies && openedAt !== null && openedAt >= since;
    if (!byDependency && !byGate) continue;

    // When both happened, the later one is what actually freed the work.
    const gateWins = byGate && (!byDependency || (openedAt as Date) > (closedAt as Date));

    items.push({
      id: task.id,
      title: task.title,
      linkUrl: `/discipline-tasks/${task.id}`,
      projectCode: projectCodes.get(task.mainTask.projectId) ?? "",
      disciplineCode: task.discipline.code,
      deadline: task.deadline,
      daysOverdue: isOverdue(task.deadline, task.status, now) ? daysOver(task.deadline, now) : null,
      note: gateWins
        ? `The "${phaseState?.name ?? "next"}" gate opened`
        : `Waiting on "${lastTitle}", which is now complete`,
      at: gateWins ? openedAt : closedAt,
    });
  }

  items.sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));

  // The scan itself is capped, so this count is what the scan found — never a promise about work
  // beyond the 200 open tasks it looked at.
  return { items: items.slice(0, SECTION_LIMIT), total: items.length };
}

/* ------------------------------------------------------------------ */
/* "Where we stand" — the project brief                                */
/* ------------------------------------------------------------------ */

/**
 * One project, computed: how far it has come in the last seven days, what is holding it up right
 * now, and what has to happen for the next gate to open.
 *
 * Organisation-scoped through `assertCanViewProject`, which goes through `projectInOrg` — another
 * company's project is not found rather than refused. Every member of the project may read it.
 */
export async function projectBrief(
  actor: ActorContext,
  projectId: string,
  now: Date = new Date(),
): Promise<ProjectBriefDTO> {
  // "Where we stand" is the whole project's story — its blockers, its gates, everybody's progress.
  // That is a company briefing, so for a contractor it does not exist. Their own day still works:
  // /api/my-tasks/brief is per person and needs no narrowing.
  if (isExternal(actor)) throw new NotFoundError("We could not find that project.");

  await assertCanViewProject(actor, projectId);

  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId: actor.orgId, ...notDeleted },
    select: { id: true, name: true, code: true },
  });
  if (!project) throw new NotFoundError("We could not find that project.");

  const since = new Date(now.getTime() - PROGRESS_LOOKBACK_MS);
  const { overdueCutoff } = dayWindow(now);

  const [tasks, phases, blockedRows, blockedTotal, overdueRows, reopenRows] = await Promise.all([
    prisma.mainTask.findMany({
      where: { projectId: project.id, ...notDeleted },
      orderBy: [{ deadline: "asc" }, { title: "asc" }],
      select: {
        id: true,
        title: true,
        projectId: true,
        phaseId: true,
        status: true,
        statusOverride: true,
        overriddenAt: true,
        deadline: true,
        progressPct: true,
        createdAt: true,
      },
    }),
    prisma.projectPhase.findMany({
      where: { projectId: project.id },
      select: { id: true, name: true, sortOrder: true, overriddenAt: true },
    }),
    prisma.disciplineTask.findMany({
      where: {
        status: "BLOCKED",
        ...notDeleted,
        mainTask: { projectId: project.id, ...notDeleted },
      },
      orderBy: [{ deadline: "asc" }, { title: "asc" }],
      take: SECTION_LIMIT,
      include: {
        discipline: { select: { code: true } },
        mainTask: { select: { title: true } },
        predecessorEdges: {
          include: { predecessor: { select: { title: true, status: true, deletedAt: true } } },
        },
      },
    }),
    prisma.disciplineTask.count({
      where: {
        status: "BLOCKED",
        ...notDeleted,
        mainTask: { projectId: project.id, ...notDeleted },
      },
    }),
    // Grouped in the database: overdue work per discipline, never one query per discipline.
    prisma.disciplineTask.groupBy({
      by: ["disciplineId"],
      where: {
        ...notDeleted,
        status: { not: "COMPLETED" },
        deadline: { lte: overdueCutoff },
        mainTask: { projectId: project.id, ...notDeleted },
      },
      _count: { _all: true },
    }),
    // Work that was reopened inside the window. A reopened task was, by definition, complete just
    // before somebody reopened it — without this, finishing it again would be counted as fresh
    // progress that never happened.
    prisma.activityLog.findMany({
      where: {
        projectId: project.id,
        entityType: "DisciplineTask",
        action: ACTIVITY.REOPENED,
        createdAt: { gte: since },
      },
      select: { entityId: true },
      take: REOPEN_SCAN_LIMIT,
    }),
  ]);

  const moments = await completionMoments(tasks);
  const total = tasks.length;
  const completed = moments.size;

  const reopenedMainTaskIds = await mainTasksBehind(reopenRows.map((row) => row.entityId));

  // The comparison is only ever made between things that existed then: a main task created inside
  // the window is left out of BOTH numbers, so adding work to a project cannot make its progress
  // appear to fall.
  const existedThen = tasks.filter((task) => task.createdAt <= since);
  const totalThen = existedThen.length;
  const completedThen = existedThen.filter((task) => {
    // Reopened inside the window: it was complete before that, whatever it looks like now. Counting
    // it as complete THEN is the honest, conservative reading — a task finished for the first time
    // inside the window and then reopened and finished again is the one case this understates.
    if (reopenedMainTaskIds.has(task.id)) return true;
    if (!moments.has(task.id)) return false;
    // Complete now, and the moment is already behind the window (a moment we cannot recover counts
    // as old, so progress is never overstated).
    const at = moments.get(task.id) ?? null;
    return at === null || at <= since;
  }).length;

  const disciplines =
    overdueRows.length === 0
      ? []
      : await prisma.discipline.findMany({
          where: { id: { in: overdueRows.map((row) => row.disciplineId) }, orgId: actor.orgId },
          select: { id: true, code: true, colorHex: true, sortOrder: true },
        });

  const overdueByDiscipline: BriefOverdueByDisciplineDTO[] = disciplines
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((discipline) => ({
      disciplineCode: discipline.code,
      disciplineColorHex: discipline.colorHex,
      count: overdueRows.find((row) => row.disciplineId === discipline.id)?._count._all ?? 0,
    }));

  const blockedTasks: BriefBlockedTaskDTO[] = blockedRows.map((task) => ({
    id: task.id,
    title: task.title,
    linkUrl: `/discipline-tasks/${task.id}`,
    disciplineCode: task.discipline.code,
    mainTaskTitle: task.mainTask.title,
    unmetDependencies: task.predecessorEdges
      .filter((edge) => !edge.predecessor.deletedAt && edge.predecessor.status !== "COMPLETED")
      .map((edge) => edge.predecessor.title),
  }));

  const states = await phaseStatesFor(project.id);
  const lockedPhases: BriefLockedPhaseDTO[] = sortPhases([...states.values()])
    .filter((state) => state.locked)
    .map((state) => ({
      id: state.id,
      name: state.name,
      lockedByPhaseName: state.lockedByPhaseName,
      openTaskCount: state.taskCount - state.completedCount,
    }));

  const openTasks = tasks.filter(
    (task) => effectiveStatus(task.status, task.statusOverride) !== "COMPLETED",
  );

  // What keeps the next gate shut: the open work of the earliest phase that still has any.
  const gatePhase = sortPhases(phases).find((phase) =>
    openTasks.some((task) => task.phaseId === phase.id),
  );
  const gateTasks = gatePhase ? openTasks.filter((task) => task.phaseId === gatePhase.id) : [];

  const toItem = (task: (typeof tasks)[number]): BriefItemDTO => ({
    id: task.id,
    title: task.title,
    linkUrl: `/tasks/${task.id}`,
    projectCode: project.code,
    disciplineCode: null,
    deadline: task.deadline,
    daysOverdue: isOverdue(task.deadline, effectiveStatus(task.status, task.statusOverride), now)
      ? daysOver(task.deadline, now)
      : null,
    note: `${task.progressPct}% complete`,
    at: null,
  });

  const dto: ProjectBriefDTO = {
    projectId: project.id,
    projectCode: project.code,
    projectName: project.name,
    generatedAt: now,
    progress: {
      completed,
      total,
      pct: percent(completed, total),
      completedThen,
      totalThen,
      pctThen: percent(completedThen, totalThen),
      since,
    },
    blockedTasks,
    blockedTotal,
    lockedPhases,
    overdueByDiscipline,
    overdueTotal: overdueRows.reduce((sum, row) => sum + row._count._all, 0),
    nextGate: gatePhase
      ? {
          phaseId: gatePhase.id,
          phaseName: gatePhase.name,
          items: gateTasks.slice(0, SECTION_LIMIT).map(toItem),
          total: gateTasks.length,
        }
      : null,
    // Unphased work is never gated, so it has to speak for itself: the nearest deadlines.
    nearestDeadlines: openTasks
      .filter((task) => task.phaseId === null)
      .slice(0, SECTION_LIMIT)
      .map(toItem),
  };

  return checkDto(ProjectBriefSchema, dto, "ProjectBriefDTO");
}

/** The main tasks these discipline tasks belong to. One bounded read, never one per row. */
async function mainTasksBehind(disciplineTaskIds: string[]): Promise<Set<string>> {
  if (disciplineTaskIds.length === 0) return new Set();
  const rows = await prisma.disciplineTask.findMany({
    where: { id: { in: [...new Set(disciplineTaskIds)] } },
    select: { mainTaskId: true },
  });
  return new Set(rows.map((row) => row.mainTaskId));
}

function percent(part: number, whole: number): number {
  if (whole === 0) return 0;
  if (part >= whole) return 100;
  return Math.min(99, Math.floor((100 * part) / whole));
}

/* ------------------------------------------------------------------ */
/* The chat digest                                                     */
/* ------------------------------------------------------------------ */

/** One project's line in a company's digest. */
export type DigestLine = {
  code: string;
  name: string;
  pct: number;
  overdue: number;
  blocked: number;
  nextGate: string | null;
};

export type OrgDigest = { lines: DigestLine[]; moreProjects: number };

/**
 * Effective-status filters, written as the database sees them (an authorised override is the truth).
 *
 * Both are written as positive OR branches on purpose. `NOT (statusOverride = 'COMPLETED' OR …)`
 * looks equivalent and is not: `statusOverride` is nullable, `NULL = 'COMPLETED'` is NULL rather
 * than false, and `NOT NULL` is NULL — so a "not complete" filter written that way silently drops
 * every task that has no override at all, which is nearly all of them. Each branch below pins the
 * column to a known state first.
 */
const COMPLETE_WHERE = {
  OR: [
    { statusOverride: "COMPLETED" as const },
    { statusOverride: null, status: "COMPLETED" as const },
  ],
};
const OPEN_WHERE = {
  OR: [
    // Overridden to something that is not "complete".
    { statusOverride: { not: null, notIn: ["COMPLETED" as const] } },
    // No override: the derived status is the truth.
    { statusOverride: null, status: { not: "COMPLETED" as const } },
  ],
};

/**
 * One company's active projects, in a shape a chat card can print in one line each: how far along,
 * how much is late, how much is blocked, and which gate is next.
 *
 * Scoped by `orgId` alone and by nothing else — exactly like the notification fan-out, and for the
 * same reason: the sweep has no signed-in person to speak for. Returns null when the company has no
 * active project, which is how no digest gets sent.
 *
 * **Every number is counted in the database, not off a capped scan.** An earlier version read the
 * main tasks and took the first N of them; past that cap Postgres is free to return whichever rows
 * it likes, and a project with plenty of late work could have posted "0 overdue". Counts have no
 * cap, so a busy company's digest is as true as a quiet one's; only the number of project LINES is
 * capped, and the card says how many were left out.
 */
export async function orgDigest(orgId: string, now: Date = new Date()): Promise<OrgDigest | null> {
  const projects = await prisma.project.findMany({
    where: { orgId, status: "ACTIVE", ...notDeleted },
    orderBy: { createdAt: "desc" },
    take: DIGEST_PROJECT_LIMIT + 1,
    select: { id: true, name: true, code: true },
  });
  if (projects.length === 0) return null;

  const shown = projects.slice(0, DIGEST_PROJECT_LIMIT);
  const projectIds = shown.map((project) => project.id);
  const { overdueCutoff } = dayWindow(now);
  const inProjects = { projectId: { in: projectIds }, ...notDeleted };

  const [totals, completed, overdue, openPhases, phases, blockedRows] = await Promise.all([
    prisma.mainTask.groupBy({ by: ["projectId"], where: inProjects, _count: { _all: true } }),
    prisma.mainTask.groupBy({
      by: ["projectId"],
      where: { ...inProjects, ...COMPLETE_WHERE },
      _count: { _all: true },
    }),
    // Overdue is derived at read time everywhere; this is the same line drawn in the database —
    // open work whose deadline day has fully passed. The same number the project page shows.
    prisma.mainTask.groupBy({
      by: ["projectId"],
      where: { ...inProjects, ...OPEN_WHERE, deadline: { lte: overdueCutoff } },
      _count: { _all: true },
    }),
    // Which phases still hold open work — that is all the next gate needs.
    prisma.mainTask.groupBy({
      by: ["projectId", "phaseId"],
      where: { ...inProjects, ...OPEN_WHERE, phaseId: { not: null } },
      _count: { _all: true },
    }),
    prisma.projectPhase.findMany({
      where: { projectId: { in: projectIds } },
      select: { id: true, projectId: true, name: true, sortOrder: true },
    }),
    // One row per main task that has blocked work under it — bounded by the work itself, not by a
    // cap that could drop a project's blockers on the floor.
    prisma.disciplineTask.groupBy({
      by: ["mainTaskId"],
      where: {
        status: "BLOCKED",
        ...notDeleted,
        mainTask: { projectId: { in: projectIds }, ...notDeleted },
      },
      _count: { _all: true },
    }),
  ]);

  const owners = await prisma.mainTask.findMany({
    where: { id: { in: blockedRows.map((row) => row.mainTaskId) } },
    select: { id: true, projectId: true },
  });
  const projectOfTask = new Map(owners.map((task) => [task.id, task.projectId]));
  const blockedByProject = new Map<string, number>();
  for (const row of blockedRows) {
    const projectId = projectOfTask.get(row.mainTaskId);
    if (!projectId) continue;
    blockedByProject.set(projectId, (blockedByProject.get(projectId) ?? 0) + row._count._all);
  }

  const countIn = (rows: { projectId: string; _count: { _all: number } }[], projectId: string) =>
    rows.find((row) => row.projectId === projectId)?._count._all ?? 0;

  const lines: DigestLine[] = shown.map((project) => {
    const open = new Set(
      openPhases
        .filter((row) => row.projectId === project.id && row.phaseId)
        .map((row) => row.phaseId as string),
    );
    const gate = sortPhases(phases.filter((phase) => phase.projectId === project.id)).find((phase) =>
      open.has(phase.id),
    );

    return {
      code: project.code,
      name: project.name,
      pct: percent(countIn(completed, project.id), countIn(totals, project.id)),
      overdue: countIn(overdue, project.id),
      blocked: blockedByProject.get(project.id) ?? 0,
      nextGate: gate?.name ?? null,
    };
  });

  return { lines, moreProjects: Math.max(0, projects.length - shown.length) };
}

/**
 * The digest as a chat card: one line per active project — how far along, how much is late, how
 * much is blocked, and which gate is next. Plain text; the payload builders escape it, so a project
 * name can never become a link in somebody's channel.
 */
export function digestMessage(digest: OrgDigest): ChatMessage {
  const lines = digest.lines.map((line) => {
    const parts = [
      `${line.pct}%`,
      `${line.overdue} overdue`,
      `${line.blocked} blocked`,
      line.nextGate ? `next gate: ${line.nextGate}` : "no gate open",
    ];
    return `• ${line.code} ${line.name} — ${parts.join(" · ")}`;
  });

  if (digest.moreProjects > 0) {
    lines.push(
      `• and ${digest.moreProjects} more active ${digest.moreProjects === 1 ? "project" : "projects"}`,
    );
  }

  return {
    title: `Today's brief — ${digest.lines.length} active ${
      digest.lines.length === 1 ? "project" : "projects"
    }`,
    body: lines.join("\n"),
    linkUrl: "/dashboard",
  };
}
