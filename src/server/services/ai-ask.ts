// Ask Tielora: the service behind POST /api/ai/ask.
//
// THE TWO RULES THAT MAKE THIS SAFE, and where each lives:
//  - THE EXTERNAL RULE: a contractor is "not found" as the very first thing, before the key check,
//    the company switch, the rate limit or any load, so they also learn nothing about whether AI
//    exists here. The route does it first and so does this function.
//  - THE TENANT RULE: the model only ever sees facts loaded by the existing scoped loaders using the
//    SIGNED-IN person's own ActorContext. `projectBrief` for one project (another company's, or one
//    the person is not on, or one that does not exist, is "I can't find that project." with no
//    provider call, no spend and no audit row), and `projectsVisibleTo` + `orgDigest` narrowed to
//    exactly those project ids for "all my projects". The model never chooses what to load.
//
// The assistant only READS. It never writes project data; the only rows this file writes are the
// company's spend counter and ONE audit row per provider call, in the same transaction.
//
// What the model is shown: titles, codes, dates, percentages and counts. No people's names or
// emails, no comments, no document names. `projectBrief` carries assignee names; they are dropped
// here, field by field, on the way to the prompt.

import { prisma } from "@/lib/db";
import { assertCan, ForbiddenError } from "@/lib/permissions";
import { byUser, limit } from "@/lib/rate-limit";
import type { AiAnswerDTO, AskTieloraInput, ProjectBriefDTO } from "@/lib/zod-schemas";
import { AiAnswerDTO as AiAnswerSchema } from "@/lib/zod-schemas";
import { isExternal, type ActorContext } from "@/server/actor";
import { NotFoundError, ServiceError } from "@/server/errors";
import { checkDto } from "@/server/serialize";
import { ACTIVITY, appendActivity } from "@/server/services/activity";
import {
  AI_NOT_SET_UP,
  AI_NOT_SWITCHED_ON,
  AI_PROJECT_NOT_FOUND,
  ASK_MAX_TOKENS,
  ASK_TIMEOUT_MS,
  aiCapRefusal,
  aiConfigured,
  aiOrgState,
  buildPrompt,
  callModel,
  recordAiUsage,
  withinAllowance,
  worstCaseUsd,
  type AiFactRecord,
} from "@/server/services/ai";
import { orgDigest, projectBrief, type OrgDigest } from "@/server/services/briefs";
import { projectsVisibleTo } from "@/server/services/projects";

/* ------------------------------------------------------------------ */
/* Rate limits                                                         */
/* ------------------------------------------------------------------ */

/** Said on every 429: the same sentence whichever of the three limits was hit. */
export const AI_TOO_FAST = "You are asking quickly. Try again in a moment.";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Per person: 5 a minute and 60 an hour. Per company: 300 a day, keyed on the SESSION's company. */
export const AI_ASK_LIMITS = { perMinute: 5, perHour: 60, companyPerDay: 300 } as const;

/** The per-person, per-minute limiter's key scope and window. The route applies this one itself. */
export const AI_ASK_SCOPE = "ai-ask";
export const AI_ASK_MINUTE_MS = MINUTE_MS;

/**
 * The two longer ceilings: per person per hour, and per company per day (keyed on the company id
 * from the SESSION, never from the request). Checked after the per-minute one passes.
 */
export function askLongerThrottle(actor: { userId: string; orgId: string }): {
  ok: boolean;
  retryAfterSec: number;
} {
  const hour = limit(byUser(actor.userId, `${AI_ASK_SCOPE}-hour`), AI_ASK_LIMITS.perHour, HOUR_MS);
  if (!hour.ok) return hour;
  return limit(`org:${AI_ASK_SCOPE}:${actor.orgId}`, AI_ASK_LIMITS.companyPerDay, DAY_MS);
}

/**
 * All three ceilings, checked in order. A denial stops the check there, so a person who is too
 * quick does not also burn their hourly or their company's daily allowance.
 */
export function askThrottle(actor: { userId: string; orgId: string }): {
  ok: boolean;
  retryAfterSec: number;
} {
  const minute = limit(byUser(actor.userId, AI_ASK_SCOPE), AI_ASK_LIMITS.perMinute, AI_ASK_MINUTE_MS);
  return minute.ok ? askLongerThrottle(actor) : minute;
}

/* ------------------------------------------------------------------ */
/* Turning loader output into fact records                             */
/* ------------------------------------------------------------------ */

const day = (date: Date | null): string | null => (date ? date.toISOString().slice(0, 10) : null);

/**
 * One project's brief as fact records. Field by field on purpose: titles, codes, dates,
 * percentages and counts only. `assigneeName`, `blockedBy`, link addresses and ids are NOT carried.
 */
export function projectFacts(brief: ProjectBriefDTO): AiFactRecord[] {
  const records: AiFactRecord[] = [
    [
      ["record", "project"],
      ["code", brief.projectCode],
      ["name", brief.projectName],
      ["percent complete", brief.progress.pct],
      ["main tasks complete", brief.progress.completed],
      ["main tasks total", brief.progress.total],
      ["percent complete a week ago", brief.progress.totalThen > 0 ? brief.progress.pctThen : null],
      ["overdue discipline tasks", brief.overdueTotal],
      ["blocked tasks", brief.blockedTotal],
    ],
  ];

  for (const task of brief.blockedTasks) {
    records.push([
      ["record", task.kind === "MAIN" ? "blocked main task" : "blocked discipline task"],
      ["title", task.title],
      ["discipline", task.disciplineCode],
      ["main task", task.mainTaskTitle],
      ["still waiting on", task.unmetDependencies.join("; ") || null],
    ]);
  }
  for (const phase of brief.lockedPhases) {
    records.push([
      ["record", "locked phase"],
      ["phase", phase.name],
      ["waiting on phase", phase.lockedByPhaseName],
      ["main tasks still open in that phase", phase.openTaskCount],
    ]);
  }
  for (const row of brief.overdueByDiscipline) {
    records.push([
      ["record", "overdue work by discipline"],
      ["discipline", row.disciplineCode],
      ["overdue discipline tasks", row.count],
    ]);
  }
  if (brief.nextGate) {
    records.push([
      ["record", "next gate"],
      ["phase", brief.nextGate.phaseName],
      ["main tasks still open", brief.nextGate.total],
    ]);
    for (const item of brief.nextGate.items) {
      records.push([
        ["record", "main task holding the next gate"],
        ["title", item.title],
        ["deadline", day(item.deadline)],
        ["days overdue", item.daysOverdue],
        ["progress", item.note],
      ]);
    }
  }
  for (const item of brief.nearestDeadlines) {
    records.push([
      ["record", "main task with no phase"],
      ["title", item.title],
      ["deadline", day(item.deadline)],
      ["days overdue", item.daysOverdue],
      ["progress", item.note],
    ]);
  }
  return records;
}

/** The dashboard's "all my projects" facts: one record per project line the digest produced. */
export function dashboardFacts(digest: OrgDigest): AiFactRecord[] {
  const records: AiFactRecord[] = digest.lines.map((line) => [
    ["record", "project"],
    ["code", line.code],
    ["name", line.name],
    ["percent complete", line.pct],
    ["overdue main tasks", line.lateMain],
    ["overdue discipline tasks", line.lateDiscipline],
    ["blocked tasks", line.blocked],
    ["next gate", line.nextGate],
  ]);
  if (digest.moreProjects > 0) {
    records.push([
      ["record", "projects not listed"],
      ["more active projects", digest.moreProjects],
    ]);
  }
  return records;
}

/* ------------------------------------------------------------------ */
/* Asking                                                              */
/* ------------------------------------------------------------------ */

type Loaded = {
  kind: "project" | "dashboard";
  records: AiFactRecord[];
  projectsCovered: number;
  /** Names for the "Based on" line, written by the server from its own records. */
  basedOn: string[];
};

/** Loads facts through the scoped loaders, with the signed-in actor. Never with the model's say-so. */
async function loadFacts(actor: ActorContext, projectId: string | undefined, now: Date): Promise<Loaded> {
  if (projectId !== undefined) {
    let brief: ProjectBriefDTO;
    try {
      brief = await projectBrief(actor, projectId, now);
    } catch (error) {
      // Another company's project, one this person is not on, and one that does not exist all give
      // the identical sentence: nothing is sent, nothing is spent, nothing is recorded.
      if (error instanceof NotFoundError || error instanceof ForbiddenError) {
        throw new NotFoundError(AI_PROJECT_NOT_FOUND);
      }
      throw error;
    }
    return {
      kind: "project",
      records: projectFacts(brief),
      projectsCovered: 1,
      basedOn: [`${brief.projectCode} ${brief.projectName}`],
    };
  }

  const visible = await projectsVisibleTo(actor);
  if (visible.length === 0) {
    throw new ServiceError("You are not on any projects yet, so there is nothing to ask about.");
  }
  // The digest is narrowed to exactly the projects this person may see: a member never gets the
  // line of a project they are not on, and nobody gets another company's (orgId is applied too).
  const digest = await orgDigest(actor.orgId, now, { onlyProjectIds: visible.map((project) => project.id) });
  if (!digest) throw new ServiceError("There are no active projects to ask about yet.");

  const basedOn = digest.lines.map((line) => `${line.code} ${line.name}`);
  if (digest.moreProjects > 0) {
    basedOn.push(`and ${digest.moreProjects} more active ${digest.moreProjects === 1 ? "project" : "projects"}`);
  }
  return {
    kind: "dashboard",
    records: dashboardFacts(digest),
    projectsCovered: digest.lines.length + digest.moreProjects,
    basedOn,
  };
}

/**
 * Answers one question about the signed-in person's own projects.
 *
 * Order: contractor (not found) -> permission -> configured -> company switch -> load facts ->
 * cap -> call -> record spend and write ONE audit row in the same transaction. Refusals before the
 * call write nothing. The question and the answer are never stored anywhere.
 */
export async function askTielora(
  actor: ActorContext,
  input: AskTieloraInput,
  now: Date = new Date(),
): Promise<AiAnswerDTO> {
  // THE EXTERNAL RULE: first, before anything else is looked at.
  if (isExternal(actor)) throw new NotFoundError("We could not find that.");
  assertCan(actor, "ASK_ASSISTANT");

  if (!aiConfigured()) throw new ServiceError(AI_NOT_SET_UP);

  const state = await aiOrgState(actor.orgId);
  if (!state || !state.aiAssistant) throw new ServiceError(AI_NOT_SWITCHED_ON);

  const loaded = await loadFacts(actor, input.projectId, now);

  const prompt = buildPrompt({
    purpose: "question",
    question: input.question,
    today: now,
    records: loaded.records,
  });

  // Checked BEFORE the call, against the worst case of this one request.
  if (!(await withinAllowance(actor.orgId, state.plan, worstCaseUsd(prompt.estimatedInputTokens, ASK_MAX_TOKENS), now))) {
    throw new ServiceError(aiCapRefusal(actor.role));
  }

  const result = await callModel(actor.orgId, prompt, { maxTokens: ASK_MAX_TOKENS, timeoutMs: ASK_TIMEOUT_MS });

  // The call went out, so the spend and the audit row are written together, whatever came back.
  await prisma.$transaction(async (tx) => {
    await recordAiUsage(tx, actor.orgId, now, {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    });
    await appendActivity(tx, {
      actorId: actor.userId,
      // No project id, so it never appears in a project's activity feed.
      projectId: null,
      entityType: "Organization",
      entityId: actor.orgId,
      action: ACTIVITY.AI_QUESTION_ASKED,
      summary: `${actor.name} asked Ask Tielora a question about ${
        loaded.kind === "project" ? "one project" : "their projects"
      }`,
      // Counts and words only: never the question, the answer, a project id or any project fact.
      metadata: {
        kind: loaded.kind,
        projectsCovered: loaded.projectsCovered,
        outcome: result.ok ? "answered" : "failed",
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      },
    });
  });

  if (!result.ok) throw new ServiceError(result.message);

  return checkDto(AiAnswerSchema, { answer: result.text, basedOn: loaded.basedOn }, "AiAnswerDTO");
}
