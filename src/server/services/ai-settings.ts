// The two AI switches on Admin → Integrations, and the read the AI card draws.
//
// The tenant rule, applied: both functions only ever touch `actor.orgId`'s own row, and only an
// administrator (MANAGE_INTEGRATIONS) reaches them, so an administrator is the administrator of
// their OWN company and nobody else's. Both switches start off for every company, and neither can
// be changed at all while this deployment has no AI key (the card is not drawn then either).
//
// A change that changes something is audited (`AI_SETTINGS_CHANGED`) inside the same transaction;
// pressing a switch to the value it already has writes nothing.

import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/permissions";
import { limitsFor } from "@/lib/plan-limits";
import type { AiSettingsDTO, SetAiSettingsInput } from "@/lib/zod-schemas";
import { AiSettingsDTO as AiSettingsSchema } from "@/lib/zod-schemas";
import type { ActorContext } from "@/server/actor";
import { NotFoundError, ServiceError } from "@/server/errors";
import { checkDto } from "@/server/serialize";
import { ACTIVITY, appendActivity } from "@/server/services/activity";
import { AI_NOT_SET_UP, aiConfigured, aiOrgState } from "@/server/services/ai";

/** What the AI card draws. Only ever the signed-in administrator's own company. */
export async function aiSettingsFor(actor: ActorContext): Promise<AiSettingsDTO> {
  assertCan(actor, "MANAGE_INTEGRATIONS");
  const state = await aiOrgState(actor.orgId);
  if (!state) throw new NotFoundError("We could not find that workspace.");
  return checkDto(
    AiSettingsSchema,
    {
      configured: aiConfigured(),
      aiAssistant: state.aiAssistant,
      aiBriefs: state.aiBriefs,
      monthlyUsd: limitsFor(state.plan).aiMonthlyUsd,
    },
    "AiSettingsDTO",
  );
}

const WORDS = { aiAssistant: "Ask Tielora", aiBriefs: "AI-written briefs" } as const;

/** Switches Ask Tielora and/or AI-written briefs on or off for the administrator's own company. */
export async function setAiSettings(
  actor: ActorContext,
  input: SetAiSettingsInput,
): Promise<AiSettingsDTO> {
  assertCan(actor, "MANAGE_INTEGRATIONS");
  if (!aiConfigured()) throw new ServiceError(AI_NOT_SET_UP);

  await prisma.$transaction(async (tx) => {
    const current = await tx.organization.findUnique({
      where: { id: actor.orgId },
      select: { aiAssistant: true, aiBriefs: true },
    });
    if (!current) throw new NotFoundError("We could not find that workspace.");

    const changed: Partial<Record<keyof typeof WORDS, boolean>> = {};
    for (const field of ["aiAssistant", "aiBriefs"] as const) {
      const next = input[field];
      if (next !== undefined && next !== current[field]) changed[field] = next;
    }
    if (Object.keys(changed).length === 0) return;

    await tx.organization.update({ where: { id: actor.orgId }, data: changed });
    const parts = (Object.keys(changed) as (keyof typeof WORDS)[]).map(
      (field) => `switched ${changed[field] ? "on" : "off"} ${WORDS[field]}`,
    );
    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: null,
      entityType: "Organization",
      entityId: actor.orgId,
      action: ACTIVITY.AI_SETTINGS_CHANGED,
      summary: `${actor.name} ${parts.join(" and ")}`,
      metadata: { changed },
    });
  });

  return aiSettingsFor(actor);
}
