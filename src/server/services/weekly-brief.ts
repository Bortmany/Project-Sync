// The weekly brief: once a week, early Monday morning UTC, one summary of the past seven days —
// how far each active project has come, what became late, which gates opened and how many required
// documents are still missing. It goes to a company's chat channel (company-wide, like the daily
// digest) and, separately, to each person who asked for it by email (only the projects THEY may see).
//
// Three rules govern this file:
//  1. **Nothing is stored and nothing is written.** Every number is worked out from rows the app
//     already holds, through the same shared functions the screens use: progress from
//     `progressSince()` (the very function the project Brief's "Where we stand" panel reads, so the
//     two cannot disagree), late from `lateCountsByProject()`, gates from `gateOpenMoments()` and
//     missing documents from `requiredDocCountsFor()`. No snapshot, no history table.
//  2. **Every read is scoped by `orgId`.** The company card is looked up by the company id alone,
//     like the daily digest; a person's email is scoped to their own company AND to the projects
//     they belong to (an administrator: all of their own company's) — never wider.
//  3. **The send line is Monday 05:00 UTC.** A server that was down sends late, but only until 05:00
//     UTC Tuesday; after that the week is skipped, because a "this week" summary arriving on a
//     Thursday would be wrong. Missing a week costs a summary, never correctness.

import { notDeleted, prisma } from "@/lib/db";
import { emailBodyText, emailDate } from "@/lib/email-text";
import { dayWindow } from "@/lib/late";
import {
  BRIEF_BODY_LIMIT,
  DIGEST_PROJECT_LIMIT,
  PROGRESS_LOOKBACK_MS,
  completionMoments,
  gateOpenMoments,
  lateSentence,
  progressSince,
} from "@/server/services/briefs";
import { blockedCountsByProject, blockedTotal } from "@/server/services/blocked";
import { lateCountsByProject } from "@/server/services/late";
import { requiredDocCountsFor } from "@/server/services/tasks";
import type { ChatMessage } from "@/server/services/webhooks";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** The hour, UTC, on Monday after which the first sweep sends the week's brief. */
export const WEEKLY_HOUR_UTC = 5;

/** How long after the send line a late server may still send. After this the week is skipped. */
export const WEEKLY_CATCH_UP_MS = DAY_MS;

/** The longest a project name is printed in a line, so twelve lines always fit the card. */
const NAME_MAX = 60;

/** The longest the "Gates opened this week" line gets. */
const GATES_LINE_MAX = 400;

/**
 * This week's send line — 05:00 UTC on the Monday of the week `now` falls in — or null when `now`
 * is outside the window in which that week's brief may go: before the line (Monday early morning),
 * or from 05:00 UTC Tuesday on (the week is skipped). A channel or person is due when their last
 * stamp is null or before the returned line.
 */
export function weeklyBoundary(now: Date): Date | null {
  const sinceMonday = (now.getUTCDay() + 6) % 7; // Monday = 0 … Sunday = 6
  const line = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - sinceMonday, WEEKLY_HOUR_UTC),
  );
  const at = now.getTime();
  if (at < line.getTime() || at >= line.getTime() + WEEKLY_CATCH_UP_MS) return null;
  return line;
}

/* ------------------------------------------------------------------ */
/* The numbers                                                         */
/* ------------------------------------------------------------------ */

export type WeeklyLine = {
  projectId: string;
  code: string;
  name: string;
  pct: number;
  /** Progress a week ago, or null when the project had no work then to compare with. */
  pctThen: number | null;
  lateMain: number;
  lateDiscipline: number;
  /** Still-open work whose deadline day ended inside the last seven days. */
  newlyLate: number;
  blocked: number;
  docsMissing: number;
};

type WeeklyProject = { line: WeeklyLine; gates: string[] };

/** Per-run memory of what has been worked out, so people in the same project share one answer. */
export type WeeklyCache = Map<string, WeeklyProject>;

export type WeeklyBrief = {
  lines: WeeklyLine[];
  /** One entry per gate that opened this week, in the order of the lines. */
  gates: { code: string; phase: string }[];
  /** Active projects the lines do not name. */
  moreProjects: number;
  /** All active projects in scope, named or not. */
  total: number;
};

type ProjectRef = { id: string; name: string; code: string };

const OPEN_MAIN = [
  { statusOverride: null, status: { not: "COMPLETED" as const } },
  { statusOverride: { not: null }, NOT: { statusOverride: "COMPLETED" as const } },
];

/** Works out, for the projects not yet in `cache`, everything the brief says about them. */
async function fillCache(
  orgId: string,
  projects: ProjectRef[],
  now: Date,
  cache: WeeklyCache,
): Promise<void> {
  const missing = projects.filter((project) => !cache.has(project.id));
  if (missing.length === 0) return;

  const ids = missing.map((project) => project.id);
  const since = new Date(now.getTime() - PROGRESS_LOOKBACK_MS);
  const { overdueCutoff } = dayWindow(now);
  // "Became late this week": the deadline day ended after `since` and is over now.
  const windowStart = new Date(overdueCutoff.getTime() - WEEK_MS);
  const scope = { projectId: { in: ids }, project: { orgId, ...notDeleted }, ...notDeleted };

  const [progress, late, newMain, newDiscipline, blockedCounts, openDiscipline, phases, tasks] =
    await Promise.all([
      progressSince(orgId, ids, since),
      lateCountsByProject(orgId, ids, now),
      prisma.mainTask.groupBy({
        by: ["projectId"],
        where: { ...scope, deadline: { gt: windowStart, lte: overdueCutoff }, OR: OPEN_MAIN },
        _count: { _all: true },
      }),
      prisma.disciplineTask.findMany({
        where: {
          ...notDeleted,
          status: { not: "COMPLETED" },
          deadline: { gt: windowStart, lte: overdueCutoff },
          mainTask: scope,
        },
        select: { mainTask: { select: { projectId: true } } },
      }),
      // The one shared "blocked" rule: main and discipline tasks together, as the dashboard counts.
      blockedCountsByProject(orgId, ids),
      // Open, live discipline tasks: the only ones whose missing documents are still to be chased.
      prisma.disciplineTask.findMany({
        where: { ...notDeleted, status: { not: "COMPLETED" }, mainTask: scope },
        select: { id: true, mainTask: { select: { projectId: true } } },
      }),
      prisma.projectPhase.findMany({
        where: { projectId: { in: ids }, project: { orgId } },
        select: { id: true, projectId: true, name: true, sortOrder: true, overriddenAt: true },
      }),
      prisma.mainTask.findMany({
        where: scope,
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

  const perProject = (rows: { mainTask: { projectId: string } }[]) => {
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.mainTask.projectId, (counts.get(row.mainTask.projectId) ?? 0) + 1);
    return counts;
  };
  const newDisciplineBy = perProject(newDiscipline);
  const newMainBy = new Map(newMain.map((row) => [row.projectId, row._count._all]));

  const docCounts = await requiredDocCountsFor(openDiscipline.map((row) => row.id));
  const docsBy = new Map<string, number>();
  for (const row of openDiscipline) {
    const counts = docCounts.get(row.id);
    if (!counts) continue;
    const absent = counts.total - counts.satisfied;
    if (absent > 0) docsBy.set(row.mainTask.projectId, (docsBy.get(row.mainTask.projectId) ?? 0) + absent);
  }

  const moments = await completionMoments(tasks);

  for (const project of missing) {
    const progressNow = progress.get(project.id);
    const counts = late.get(project.id) ?? { lateMain: 0, lateDiscipline: 0 };

    const own = tasks.filter((task) => task.projectId === project.id);
    const opened = gateOpenMoments(
      phases.filter((phase) => phase.projectId === project.id),
      own,
      moments,
    );
    const gates = phases
      .filter((phase) => phase.projectId === project.id)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .filter((phase) => {
        const at = opened.get(phase.id) ?? null;
        return at !== null && at >= since && at <= now;
      })
      .map((phase) => phase.name);

    cache.set(project.id, {
      gates,
      line: {
        projectId: project.id,
        code: project.code,
        name: project.name,
        pct: progressNow?.progressNow ?? 0,
        pctThen: progressNow && progressNow.totalThen > 0 ? progressNow.progressThen : null,
        lateMain: counts.lateMain,
        lateDiscipline: counts.lateDiscipline,
        newlyLate: (newMainBy.get(project.id) ?? 0) + (newDisciplineBy.get(project.id) ?? 0),
        blocked: blockedTotal(blockedCounts.get(project.id) ?? { blockedMain: 0, blockedDiscipline: 0 }),
        docsMissing: docsBy.get(project.id) ?? 0,
      },
    });
  }
}

async function buildBrief(
  orgId: string,
  where: Record<string, unknown>,
  now: Date,
  cache: WeeklyCache,
): Promise<WeeklyBrief | null> {
  const full = { orgId, status: "ACTIVE" as const, ...notDeleted, ...where };
  const [projects, total] = await Promise.all([
    prisma.project.findMany({
      where: full,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: DIGEST_PROJECT_LIMIT,
      select: { id: true, name: true, code: true },
    }),
    prisma.project.count({ where: full }),
  ]);
  if (projects.length === 0) return null;

  await fillCache(orgId, projects, now, cache);

  const lines: WeeklyLine[] = [];
  const gates: { code: string; phase: string }[] = [];
  for (const project of projects) {
    const entry = cache.get(project.id);
    if (!entry) continue;
    lines.push(entry.line);
    for (const phase of entry.gates) gates.push({ code: project.code, phase });
  }
  return { lines, gates, moreProjects: Math.max(0, total - projects.length), total };
}

/**
 * A company's whole brief, for its chat channel. Scoped by `orgId` alone, like the daily digest.
 * Null when the company has no active project — which is how nothing gets sent.
 */
export function orgWeeklyBrief(
  orgId: string,
  now: Date = new Date(),
  cache: WeeklyCache = new Map(),
): Promise<WeeklyBrief | null> {
  return buildBrief(orgId, {}, now, cache);
}

/**
 * One person's brief: only the active projects of THEIR company that they may see — a member's own
 * memberships, or every project of the company for an administrator. Null when they see none.
 * Never called for a contractor (the sender refuses them first).
 */
export function personWeeklyBrief(
  orgId: string,
  person: { id: string; role: string },
  now: Date = new Date(),
  cache: WeeklyCache = new Map(),
): Promise<WeeklyBrief | null> {
  const where = person.role === "ADMIN" ? {} : { members: { some: { userId: person.id } } };
  return buildBrief(orgId, where, now, cache);
}

/* ------------------------------------------------------------------ */
/* The words                                                           */
/* ------------------------------------------------------------------ */

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function shortName(name: string): string {
  const oneLine = name.replace(/\s+/g, " ").trim();
  return oneLine.length <= NAME_MAX ? oneLine : `${oneLine.slice(0, NAME_MAX - 1)}…`;
}

/** `CODE Name — 64% (58% a week ago) · 2 main tasks and 5 discipline tasks late (2 new this week) · …` */
export function weeklyLineText(line: WeeklyLine): string {
  const progress =
    line.pctThen === null
      ? `${line.pct}% (no work yet a week ago)`
      : line.pct === line.pctThen
        ? `${line.pct}%, unchanged`
        : `${line.pct}% (${line.pctThen}% a week ago)`;
  const lateWords = lateSentence(line.lateMain, line.lateDiscipline, "late");
  const late = line.newlyLate > 0 ? `${lateWords} (${line.newlyLate} new this week)` : lateWords;
  const docs =
    line.docsMissing === 0
      ? "no documents missing"
      : `${plural(line.docsMissing, "document")} missing`;
  return `${line.code} ${shortName(line.name)} — ${[progress, late, `${line.blocked} blocked`, docs].join(" · ")}`;
}

function gatesLine(brief: WeeklyBrief): string | null {
  if (brief.gates.length === 0) return null;
  const text = `Gates opened this week: ${brief.gates
    .map((gate) => `${gate.code} — ${shortName(gate.phase)}`)
    .join("; ")}`;
  return text.length <= GATES_LINE_MAX ? text : `${text.slice(0, GATES_LINE_MAX - 1)}…`;
}

function titleFor(brief: WeeklyBrief): string {
  return `This week's brief — ${plural(brief.total, "active project")}`;
}

function bodyLines(brief: WeeklyBrief, bullet: string): string[] {
  const lines = brief.lines.map((line) => `${bullet}${weeklyLineText(line)}`);
  if (brief.moreProjects > 0) {
    lines.push(`${bullet}and ${plural(brief.moreProjects, "more active project")}`);
  }
  const gates = gatesLine(brief);
  if (gates) lines.push("", gates);
  return lines;
}

/** The company's chat card. Plain text; the payload builders escape it, so a name never links. */
export function weeklyBriefMessage(brief: WeeklyBrief): ChatMessage {
  return {
    title: titleFor(brief),
    body: bodyLines(brief, "• ").join("\n"),
    linkUrl: "/dashboard",
    bodyLimit: BRIEF_BODY_LIMIT,
  };
}

/** One person's email: a subject and a plain-text body with every typed web address neutralised. */
export function weeklyBriefEmailContent(
  brief: WeeklyBrief,
  now: Date,
): { subject: string; body: string } {
  const text = [
    `Where your projects stand, compared with a week ago (${emailDate(now)}).`,
    "",
    ...bodyLines(brief, "- "),
  ].join("\n");
  return { subject: titleFor(brief), body: emailBodyText(text, 20_000) };
}
