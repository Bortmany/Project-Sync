// The one-click status report: ONE `ReportData` object, then a PDF or a PowerPoint drawn from it.
//
// Nothing here invents a number. Every figure is read from the same place the screens read it:
//  - progress, blocked tasks, locked phases ........ `projectBrief()` (and the header's own average)
//  - the timeline and the late list ................ the Gantt read, with the shared `isLate()` rule
//  - late counts ................................... `lateCountsByProject()` (the header badge's figure)
//  - required documents ............................ `requiredDocCountsFor()` (the timeline's figure)
// so the file, the header, the Brief tab and the timeline agree on the same day.
//
// THE EXTERNAL RULE: a contractor's request is "not found", answered before anything is read.
// THE TENANT RULE: every read below goes through `projectBrief`/`ganttForProject`/`listPhasesForProject`
// (each one `assertCanViewProject`, so another company's project is "not found") or is keyed on ids
// those reads returned, with `orgId` from the session.
//
// A report is built on the spot and streamed. Nothing is written to disk. The ONE thing written is
// the audit row, in its own transaction after the file exists, and never for a refused or failed
// request. The audit row names who exported which project in which format — never the contents.

import { prisma } from "@/lib/db";
import { daysLate, isLate } from "@/lib/late";
import { ForbiddenError } from "@/lib/permissions";
import { byUser, limit, type RateLimitResult } from "@/lib/rate-limit";
import type { TaskStatusName } from "@/lib/zod-schemas";
import { isExternal, type ActorContext } from "@/server/actor";
import { NotFoundError } from "@/server/errors";
import { ACTIVITY, appendActivity } from "@/server/services/activity";
import { projectBrief } from "@/server/services/briefs";
import { lateCountsByProject } from "@/server/services/late";
import { listPhasesForProject } from "@/server/services/phases";
import { averageProgress } from "@/server/services/projects";
import { ganttForProject, requiredDocCountsFor } from "@/server/services/tasks";

export type ReportFormat = "pdf" | "pptx";

/** Caps, so a huge project still makes a readable file. Every number still counts everything. */
export const REPORT_TIMELINE_MAIN_TASK_CAP = 40;
export const REPORT_MISSING_DOCS_CAP = 25;

/** Exports a person may take per minute, on top of the ordinary read limit. */
export const REPORT_EXPORTS_PER_MINUTE = 10;
export const REPORT_EXPORT_WINDOW_MS = 60_000;

/**
 * The ceiling on top of `guardRead`: each report reads a whole project and draws a file. Lives here
 * so it is proved in the service tests; the route turns a refusal into the house 429 + Retry-After.
 */
export function reportExportThrottle(userId: string): RateLimitResult {
  return limit(byUser(userId, "report-export"), REPORT_EXPORTS_PER_MINUTE, REPORT_EXPORT_WINDOW_MS);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "30 Sep 2026", in UTC — the clock deadlines are written on. */
export function reportDate(date: Date): string {
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** The file-name date, "2026-09-30". */
export function reportFileDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export type ReportTimelineDiscipline = {
  id: string;
  title: string;
  status: TaskStatusName;
  startDate: Date | null;
  deadline: Date;
  late: boolean;
  daysLate: number | null;
};

export type ReportTimelineMainTask = {
  id: string;
  title: string;
  phaseId: string | null;
  status: TaskStatusName;
  startDate: Date | null;
  deadline: Date;
  late: boolean;
  daysLate: number | null;
  /** ALL the discipline tasks; the drawing shows a few and says "+N more". */
  disciplineTasks: ReportTimelineDiscipline[];
};

export type ReportLateItem = {
  kind: "Main" | "Discipline";
  title: string;
  disciplineCode: string | null;
  assigneeName: string | null;
  deadline: Date;
  daysLate: number;
};

export type ReportBlockedTask = {
  title: string;
  assigneeName: string | null;
  blockedBy: { title: string; assigneeName: string | null }[];
};

export type ReportLockedPhase = {
  name: string;
  waitingOn: string | null;
  /** The open main tasks of the phase doing the blocking (never the locked phase's own). */
  openTaskCount: number;
};

export type ReportMissingDoc = {
  name: string;
  taskTitle: string;
  disciplineCode: string;
  assigneeName: string | null;
};

export type ReportData = {
  generatedAt: Date;
  project: { id: string; name: string; code: string };
  progress: { pct: number; completed: number; total: number };
  /** Late, both kinds — the header badge's figure. */
  late: { main: number; discipline: number };
  blocked: number;
  /** Mandatory required documents on discipline tasks that are still open. */
  documents: {
    required: number;
    inPlace: number;
    missing: number;
    byDiscipline: { disciplineCode: string; required: number; inPlace: number }[];
    missingList: ReportMissingDoc[];
    missingMore: number;
  };
  timeline: {
    /** Drawn rows, in phase order then deadline order. */
    mainTasks: ReportTimelineMainTask[];
    moreMainTasks: number;
    phases: { id: string; name: string }[];
    rangeStart: Date | null;
    rangeEnd: Date | null;
  };
  lateItems: ReportLateItem[];
  blockedTasks: ReportBlockedTask[];
  blockedMore: number;
  lockedPhases: ReportLockedPhase[];
};

/**
 * Everything the report says, for one project, as this person may read it.
 * Not found for a contractor (before any read), for another company's project and for a project the
 * person does not belong to. Never "forbidden".
 */
export async function buildReportData(
  actor: ActorContext,
  projectId: string,
  now: Date = new Date(),
): Promise<ReportData> {
  // THE EXTERNAL RULE, first: before a single row is read.
  if (isExternal(actor)) throw new NotFoundError("We could not find that project.");

  // `projectBrief` runs `assertCanViewProject`. Another company's project is already "not found";
  // a colleague who is simply not on this project is refused there, and for the report that refusal
  // is turned into the same "not found" — a miss is never "forbidden", so the report never confirms
  // that a project exists.
  const brief = await projectBrief(actor, projectId, now).catch((error: unknown) => {
    if (error instanceof ForbiddenError) throw new NotFoundError("We could not find that project.");
    throw error;
  });
  const [gantt, phases, lateByProject] = await Promise.all([
    ganttForProject(actor, projectId),
    listPhasesForProject(actor, projectId),
    lateCountsByProject(actor.orgId, [projectId], now),
  ]);
  const lateCounts = lateByProject.get(projectId) ?? { lateMain: 0, lateDiscipline: 0 };

  /* ---------------- progress: the header's own figure ---------------- */
  const allMain = gantt.mainTasks;
  const completedMain = allMain.filter((task) => task.status === "COMPLETED").length;
  const pct = averageProgress(allMain, completedMain);

  /* ---------------- timeline + late list (from the Gantt) ---------------- */
  const phaseOrder = new Map(phases.map((phase, index) => [phase.id, index]));
  const lateMainIds = allMain
    .filter((task) => isLate({ deadline: task.deadline, status: task.status }, now))
    .map((task) => task.id);

  // Owner names of the late main tasks, in one query (the Gantt carries none).
  const owners = lateMainIds.length
    ? await prisma.mainTask.findMany({
        where: { id: { in: lateMainIds }, projectId, project: { orgId: actor.orgId } },
        select: { id: true, owner: { select: { name: true } } },
      })
    : [];
  const ownerName = new Map(owners.map((row) => [row.id, row.owner?.name ?? null]));

  const lateItems: ReportLateItem[] = [];
  const timelineAll: ReportTimelineMainTask[] = allMain.map((task) => {
    const mainLate = isLate({ deadline: task.deadline, status: task.status }, now);
    if (mainLate) {
      lateItems.push({
        kind: "Main",
        title: task.title,
        disciplineCode: null,
        assigneeName: ownerName.get(task.id) ?? null,
        deadline: task.deadline,
        daysLate: daysLate(task.deadline, now),
      });
    }
    return {
      id: task.id,
      title: task.title,
      phaseId: task.phaseId ?? null,
      status: task.status,
      startDate: task.startDate,
      deadline: task.deadline,
      late: mainLate,
      daysLate: mainLate ? daysLate(task.deadline, now) : null,
      disciplineTasks: task.disciplineTasks.map((sub) => {
        const subLate = isLate({ deadline: sub.deadline, status: sub.status }, now);
        if (subLate) {
          lateItems.push({
            kind: "Discipline",
            title: sub.title,
            disciplineCode: sub.disciplineCode,
            assigneeName: sub.assigneeName,
            deadline: sub.deadline,
            daysLate: daysLate(sub.deadline, now),
          });
        }
        return {
          id: sub.id,
          title: sub.title,
          status: sub.status,
          startDate: sub.startDate,
          deadline: sub.deadline,
          late: subLate,
          daysLate: subLate ? daysLate(sub.deadline, now) : null,
        };
      }),
    };
  });
  // Newest slip first: the fewest days late at the top.
  lateItems.sort(
    (a, b) =>
      a.daysLate - b.daysLate ||
      a.title.localeCompare(b.title) ||
      a.kind.localeCompare(b.kind),
  );

  // Rows grouped by phase (gate order, unphased last), each group in deadline order (the Gantt's).
  const grouped = timelineAll
    .map((task, index) => ({ task, index }))
    .sort((a, b) => {
      const pa = a.task.phaseId ? (phaseOrder.get(a.task.phaseId) ?? phases.length) : phases.length;
      const pb = b.task.phaseId ? (phaseOrder.get(b.task.phaseId) ?? phases.length) : phases.length;
      return pa - pb || a.index - b.index;
    })
    .map((entry) => entry.task);

  // The scale covers ALL rows (and today) so it does not change with the cap.
  let rangeStart: number | null = null;
  let rangeEnd: number | null = null;
  const widen = (date: Date | null) => {
    if (!date) return;
    const t = date.getTime();
    if (rangeStart === null || t < rangeStart) rangeStart = t;
    if (rangeEnd === null || t > rangeEnd) rangeEnd = t;
  };
  for (const task of timelineAll) {
    widen(task.startDate ?? task.deadline);
    widen(task.deadline);
    for (const sub of task.disciplineTasks) {
      widen(sub.startDate ?? sub.deadline);
      widen(sub.deadline);
    }
  }
  if (timelineAll.length > 0) widen(now);

  /* ---------------- documents (open discipline tasks only) ---------------- */
  type OpenSub = { id: string; title: string; disciplineCode: string; assigneeName: string | null };
  const openSubs: OpenSub[] = [];
  for (const task of allMain) {
    for (const sub of task.disciplineTasks) {
      if (sub.status !== "COMPLETED") {
        openSubs.push({
          id: sub.id,
          title: sub.title,
          disciplineCode: sub.disciplineCode,
          assigneeName: sub.assigneeName,
        });
      }
    }
  }
  const openIds = openSubs.map((sub) => sub.id);
  const docCounts = await requiredDocCountsFor(openIds);

  let required = 0;
  let inPlace = 0;
  const perDiscipline = new Map<string, { required: number; inPlace: number }>();
  for (const sub of openSubs) {
    const counts = docCounts.get(sub.id);
    if (!counts) continue;
    required += counts.total;
    inPlace += counts.satisfied;
    const row = perDiscipline.get(sub.disciplineCode) ?? { required: 0, inPlace: 0 };
    row.required += counts.total;
    row.inPlace += counts.satisfied;
    perDiscipline.set(sub.disciplineCode, row);
  }
  const missing = required - inPlace;

  // The names of what is missing: one query for the whole project, never one per task.
  const missingRows =
    missing > 0
      ? await prisma.requiredDocument.findMany({
          where: { disciplineTaskId: { in: openIds }, isMandatory: true, documentId: null },
          select: { name: true, disciplineTaskId: true },
        })
      : [];
  const subById = new Map(openSubs.map((sub) => [sub.id, sub]));
  const subOrder = new Map(openSubs.map((sub, index) => [sub.id, index]));
  const missingAll: ReportMissingDoc[] = missingRows
    .slice()
    .sort(
      (a, b) =>
        (subOrder.get(a.disciplineTaskId) ?? 0) - (subOrder.get(b.disciplineTaskId) ?? 0) ||
        a.name.localeCompare(b.name),
    )
    .map((row) => {
      const sub = subById.get(row.disciplineTaskId);
      return {
        name: row.name,
        taskTitle: sub?.title ?? "",
        disciplineCode: sub?.disciplineCode ?? "",
        assigneeName: sub?.assigneeName ?? null,
      };
    });

  /* ---------------- blockers and locked phases (from the Brief) ---------------- */
  const phaseByName = new Map<string, (typeof phases)[number]>();
  for (const phase of phases) if (!phaseByName.has(phase.name)) phaseByName.set(phase.name, phase);

  const lockedPhases: ReportLockedPhase[] = brief.lockedPhases.map((locked) => {
    const blocking = locked.lockedByPhaseName ? phaseByName.get(locked.lockedByPhaseName) : undefined;
    return {
      name: locked.name,
      waitingOn: locked.lockedByPhaseName,
      // The BLOCKING phase's open count — "Construction is locked, waiting on FEED, which still
      // has 9 main tasks open" — never the locked phase's own.
      openTaskCount: blocking ? blocking.taskCount - blocking.completedCount : locked.openTaskCount,
    };
  });

  return {
    generatedAt: now,
    project: { id: brief.projectId, name: brief.projectName, code: brief.projectCode },
    progress: { pct, completed: brief.progress.completed, total: brief.progress.total },
    late: { main: lateCounts.lateMain, discipline: lateCounts.lateDiscipline },
    blocked: brief.blockedTotal,
    documents: {
      required,
      inPlace,
      missing,
      byDiscipline: [...perDiscipline.entries()]
        .map(([disciplineCode, row]) => ({ disciplineCode, ...row }))
        .sort((a, b) => a.disciplineCode.localeCompare(b.disciplineCode)),
      missingList: missingAll.slice(0, REPORT_MISSING_DOCS_CAP),
      missingMore: Math.max(0, missing - REPORT_MISSING_DOCS_CAP),
    },
    timeline: {
      mainTasks: grouped.slice(0, REPORT_TIMELINE_MAIN_TASK_CAP),
      moreMainTasks: Math.max(0, grouped.length - REPORT_TIMELINE_MAIN_TASK_CAP),
      phases: phases.map((phase) => ({ id: phase.id, name: phase.name })),
      rangeStart: rangeStart === null ? null : new Date(rangeStart),
      rangeEnd: rangeEnd === null ? null : new Date(rangeEnd),
    },
    lateItems,
    blockedTasks: brief.blockedTasks.map((task) => ({
      title: task.title,
      assigneeName: task.assigneeName,
      blockedBy: task.blockedBy,
    })),
    blockedMore: Math.max(0, brief.blockedTotal - brief.blockedTasks.length),
    lockedPhases,
  };
}

/** "Mech/Elec-2" -> a safe file-name piece: letters, digits, dot, dash, underscore only. */
export function reportFilename(code: string, date: Date, format: ReportFormat): string {
  const safe = code.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "project";
  return `${safe}-status-${reportFileDate(date)}.${format}`;
}

export const REPORT_CONTENT_TYPE: Record<ReportFormat, string> = {
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export type BuiltReport = {
  body: Buffer;
  filename: string;
  contentType: string;
  data: ReportData;
};

/** Builds the file. Reads only — writes nothing anywhere. */
export async function buildStatusReport(
  actor: ActorContext,
  projectId: string,
  format: ReportFormat,
  now: Date = new Date(),
): Promise<BuiltReport> {
  const data = await buildReportData(actor, projectId, now);
  // Imported here so the drawing libraries load only when somebody actually exports.
  const body =
    format === "pdf"
      ? await (await import("@/server/report/pdf")).renderPdf(data)
      : await (await import("@/server/report/pptx")).renderPptx(data);
  return {
    body,
    filename: reportFilename(data.project.code, now, format),
    contentType: REPORT_CONTENT_TYPE[format],
    data,
  };
}

/**
 * Records that somebody took a report. Called ONLY after the file was built, in its own
 * transaction, exactly as `downloadMyData` records `PERSONAL_EXPORT`.
 */
export async function recordReportExport(
  actor: ActorContext,
  project: { id: string; name: string; code: string },
  format: ReportFormat,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: project.id,
      entityType: "Project",
      entityId: project.id,
      action: ACTIVITY.REPORT_EXPORTED,
      summary: `${actor.name} exported a status report for ${project.code} as ${format === "pdf" ? "PDF" : "PowerPoint"}`,
      metadata: { format },
    });
  });
}

/** Build, then record. The route's whole job in one call; a failure in the build writes nothing. */
export async function exportStatusReport(
  actor: ActorContext,
  projectId: string,
  format: ReportFormat,
  now: Date = new Date(),
): Promise<BuiltReport> {
  const built = await buildStatusReport(actor, projectId, format, now);
  await recordReportExport(actor, built.data.project, format);
  return built;
}
