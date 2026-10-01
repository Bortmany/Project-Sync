// Whether a page draws Ask Tielora at all. ONE yes/no per page, decided on the server when the page
// is built, so a screen never guesses and a hidden button is never a CSS trick (THE EXTERNAL RULE).
//
// The answer is yes only when ALL of these hold, checked in this order:
//   1. the person is internal: a contractor (EXTERNAL) is "no" before anything else is looked at, so
//      the answer tells a contractor nothing about whether AI is configured;
//   2. the role may ask (ASK_ASSISTANT);
//   3. this deployment has the AI key (dormant means no panel, no card, no gap);
//   4. the person's own company has switched Ask Tielora on (their row, never anyone else's).
//
// Nothing here calls the provider, spends anything or writes anything.

import { can } from "@/lib/permissions";
import { isExternal, type ActorContext } from "@/server/actor";
import type { AiSettingsDTO } from "@/lib/zod-schemas";
import { aiConfigured, aiOrgState, atAllowanceFor, nextMonthStart, usageThisMonth } from "@/server/services/ai";
import { aiSettingsFor } from "@/server/services/ai-settings";
import { projectsVisibleTo } from "@/server/services/projects";

/** A project the dashboard chooser may offer: only ever one the person can already see. */
export type AskProject = { id: string; code: string; name: string };

/** True when Ask Tielora should be drawn for this person on a project page. */
export async function askTieloraAvailable(actor: ActorContext): Promise<boolean> {
  if (isExternal(actor)) return false;
  if (!can(actor, "ASK_ASSISTANT")) return false;
  if (!aiConfigured()) return false;
  const state = await aiOrgState(actor.orgId);
  return state?.aiAssistant === true;
}

/**
 * The dashboard's chooser list, or null when the card must not be drawn (any reason above, or the
 * person is on no project, so there is nothing to ask about). Same visibility as every other list.
 */
export async function askTieloraProjects(actor: ActorContext): Promise<AskProject[] | null> {
  if (!(await askTieloraAvailable(actor))) return null;
  const projects = await projectsVisibleTo(actor);
  if (projects.length === 0) return null;
  return projects
    .map((project) => ({ id: project.id, code: project.code, name: project.name }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** What the AI card on Admin → Integrations draws: the switches and this month's standing. */
export type AiCardData = {
  settings: AiSettingsDTO;
  /** Dollars used so far this month, worked out from the stored tokens at read time. */
  usedUsd: number;
  /** Server-computed with the same rule the ask route refuses by. */
  atAllowance: boolean;
  /** The first of next month, UTC: when the allowance starts again. */
  resetsOn: Date;
};

/**
 * The AI card's data for an administrator's own company, or null on a deployment with no key (the
 * card is then not drawn at all). `aiSettingsFor` is the administrator-only gate.
 */
export async function aiCardFor(actor: ActorContext): Promise<AiCardData | null> {
  if (!aiConfigured()) return null;
  const settings = await aiSettingsFor(actor);
  const now = new Date();
  const usage = await usageThisMonth(actor.orgId, now);
  return {
    settings,
    usedUsd: usage.usedUsd,
    atAllowance: atAllowanceFor(usage.usedUsd, settings.monthlyUsd),
    resetsOn: nextMonthStart(now) };
}
