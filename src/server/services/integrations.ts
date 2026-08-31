// Admin → Integrations: where an administrator connects their own company's Slack or Teams channel.
//
// The tenant rule, applied here: every read and every write below is looked up by
// `{ orgId: actor.orgId, kind }`, so another company's integration is NOT FOUND rather than
// forbidden, and an administrator is the administrator of their own company only.
//
// The webhook address is a bearer secret. It goes in, it is stored, and it is never handed back:
// no read returns it, no audit row records it, no log line mentions it. Changing it means pasting
// it again — which is also why there is no "edit the address" path that keeps the old one.

import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/permissions";
import type {
  IntegrationKindName,
  IntegrationTestResultDTO,
  OrgIntegrationDTO,
  SaveIntegrationInput,
  SetEventTogglesInput,
  SetIntegrationEnabledInput,
} from "@/lib/zod-schemas";
import {
  DEFAULT_EVENT_TOGGLES,
  IntegrationEventToggles as TogglesSchema,
  IntegrationKindSchema,
  OrgIntegrationDTO as OrgIntegrationSchema,
  IntegrationTestResultDTO as TestResultSchema,
  maskWebhookUrl,
  webhookUrlProblem,
} from "@/lib/zod-schemas";
import type { ActorContext } from "@/server/actor";
import { NotFoundError, ServiceError } from "@/server/errors";
import { checkDto, checkDtoList } from "@/server/serialize";
import { ACTIVITY, appendActivity } from "@/server/services/activity";
import { sendTestMessage } from "@/server/services/webhooks";

/** Every kind the screen shows a card for, in the order it shows them. */
const ALL_KINDS: IntegrationKindName[] = ["SLACK", "TEAMS"];

const KIND_LABEL: Record<IntegrationKindName, string> = {
  SLACK: "Slack",
  TEAMS: "Microsoft Teams",
};

type IntegrationRow = {
  kind: string;
  webhookUrl: string;
  enabled: boolean;
  eventToggles: unknown;
  updatedAt: Date;
};

/** The row as the screen sees it — masked address, never the real one. */
function toDTO(kind: IntegrationKindName, row: IntegrationRow | undefined): OrgIntegrationDTO {
  if (!row) {
    return {
      kind,
      configured: false,
      enabled: false,
      webhookUrlMasked: null,
      eventToggles: DEFAULT_EVENT_TOGGLES,
      updatedAt: null,
    };
  }
  const toggles = TogglesSchema.safeParse(row.eventToggles);
  return {
    kind,
    configured: true,
    enabled: row.enabled,
    webhookUrlMasked: maskWebhookUrl(row.webhookUrl),
    eventToggles: toggles.success ? toggles.data : DEFAULT_EVENT_TOGGLES,
    updatedAt: row.updatedAt,
  };
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/** One card per kind, configured or not. Never returns a webhook address. */
export async function listIntegrationsForAdmin(actor: ActorContext): Promise<OrgIntegrationDTO[]> {
  assertCan(actor, "MANAGE_INTEGRATIONS");

  const rows = await prisma.orgIntegration.findMany({
    where: { orgId: actor.orgId },
    select: { kind: true, webhookUrl: true, enabled: true, eventToggles: true, updatedAt: true },
  });

  const byKind = new Map(rows.map((row) => [row.kind, row]));
  const items = ALL_KINDS.map((kind) => toDTO(kind, byKind.get(kind)));

  return checkDtoList(OrgIntegrationSchema, items, "OrgIntegrationDTO");
}

/**
 * What /api/health reports: how many organisations have each kind switched on. Numbers only —
 * no addresses, no organisation names, nothing anyone could use. Dormant reads {"slack":0,"teams":0}.
 */
export async function integrationCounts(): Promise<Record<string, number>> {
  const grouped = await prisma.orgIntegration.groupBy({
    by: ["kind"],
    where: { enabled: true },
    _count: { _all: true },
  });

  const counts: Record<string, number> = { slack: 0, teams: 0 };
  for (const row of grouped) {
    const parsed = IntegrationKindSchema.safeParse(row.kind);
    if (parsed.success) counts[parsed.data.toLowerCase()] = row._count._all;
  }
  return counts;
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

/** The actor's own row for this kind, or nothing. Another company's row is never visible here. */
async function ownIntegration(actor: ActorContext, kind: IntegrationKindName) {
  return prisma.orgIntegration.findFirst({
    where: { orgId: actor.orgId, kind },
    select: {
      id: true,
      kind: true,
      webhookUrl: true,
      enabled: true,
      eventToggles: true,
      updatedAt: true,
    },
  });
}

/**
 * Saves (or replaces) the address for one kind. The pasted value is validated against the per-kind
 * host allowlist before it is stored, and the audit row records the kind — never the address.
 */
export async function saveIntegration(
  actor: ActorContext,
  input: SaveIntegrationInput,
): Promise<OrgIntegrationDTO> {
  assertCan(actor, "MANAGE_INTEGRATIONS");

  // Belt and braces: the input schema already refused a bad address, and the delivery path checks
  // the stored value again before it calls anything.
  const problem = webhookUrlProblem(input.kind, input.webhookUrl);
  if (problem) throw new ServiceError(problem, { webhookUrl: [problem] });

  const existing = await ownIntegration(actor, input.kind);

  // Replacing an address must not quietly re-open events this company had switched off: only a
  // brand-new connection falls back to "everything on". An existing row keeps what it had unless
  // the caller says otherwise (and a row whose Json somehow does not parse is treated as new).
  const existingToggles = existing ? TogglesSchema.safeParse(existing.eventToggles) : null;
  const toggles =
    input.eventToggles ??
    (existingToggles?.success ? existingToggles.data : DEFAULT_EVENT_TOGGLES);

  const saved = await prisma.$transaction(async (tx) => {
    const row = existing
      ? await tx.orgIntegration.update({
          where: { id: existing.id },
          data: { webhookUrl: input.webhookUrl, eventToggles: toggles },
          select: { kind: true, webhookUrl: true, enabled: true, eventToggles: true, updatedAt: true },
        })
      : await tx.orgIntegration.create({
          data: {
            orgId: actor.orgId,
            kind: input.kind,
            webhookUrl: input.webhookUrl,
            enabled: false,
            eventToggles: toggles,
            createdById: actor.userId,
          },
          select: { kind: true, webhookUrl: true, enabled: true, eventToggles: true, updatedAt: true },
        });

    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: null,
      entityType: "OrgIntegration",
      entityId: `${actor.orgId}:${input.kind}`,
      action: existing ? ACTIVITY.INTEGRATION_UPDATED : ACTIVITY.INTEGRATION_CONNECTED,
      summary: `${actor.name} ${existing ? "replaced" : "saved"} the ${KIND_LABEL[input.kind]} webhook address`,
      // Kind, switch and toggles. The address is deliberately absent.
      metadata: { kind: input.kind, enabled: row.enabled, eventToggles: toggles },
    });

    return row;
  });

  return checkDto(OrgIntegrationSchema, toDTO(input.kind, saved), "OrgIntegrationDTO");
}

/** Switches a connected channel on or off. Nothing is deleted — the address stays saved. */
export async function setIntegrationEnabled(
  actor: ActorContext,
  input: SetIntegrationEnabledInput,
): Promise<OrgIntegrationDTO> {
  assertCan(actor, "MANAGE_INTEGRATIONS");

  const existing = await ownIntegration(actor, input.kind);
  if (!existing) {
    throw new NotFoundError(`Save a ${KIND_LABEL[input.kind]} webhook address first.`);
  }
  if (existing.enabled === input.enabled) {
    return checkDto(OrgIntegrationSchema, toDTO(input.kind, existing), "OrgIntegrationDTO");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.orgIntegration.update({
      where: { id: existing.id },
      data: { enabled: input.enabled },
      select: { kind: true, webhookUrl: true, enabled: true, eventToggles: true, updatedAt: true },
    });

    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: null,
      entityType: "OrgIntegration",
      entityId: `${actor.orgId}:${input.kind}`,
      action: input.enabled ? ACTIVITY.INTEGRATION_ENABLED : ACTIVITY.INTEGRATION_DISABLED,
      summary: `${actor.name} switched ${KIND_LABEL[input.kind]} notifications ${
        input.enabled ? "on" : "off"
      }`,
      metadata: { kind: input.kind, enabled: input.enabled },
    });

    return row;
  });

  return checkDto(OrgIntegrationSchema, toDTO(input.kind, updated), "OrgIntegrationDTO");
}

/** Chooses which events go to the channel. All five are always saved together. */
export async function setEventToggles(
  actor: ActorContext,
  input: SetEventTogglesInput,
): Promise<OrgIntegrationDTO> {
  assertCan(actor, "MANAGE_INTEGRATIONS");

  const existing = await ownIntegration(actor, input.kind);
  if (!existing) {
    throw new NotFoundError(`Save a ${KIND_LABEL[input.kind]} webhook address first.`);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.orgIntegration.update({
      where: { id: existing.id },
      data: { eventToggles: input.eventToggles },
      select: { kind: true, webhookUrl: true, enabled: true, eventToggles: true, updatedAt: true },
    });

    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: null,
      entityType: "OrgIntegration",
      entityId: `${actor.orgId}:${input.kind}`,
      action: ACTIVITY.INTEGRATION_EVENTS_CHANGED,
      summary: `${actor.name} changed which events go to ${KIND_LABEL[input.kind]}`,
      metadata: { kind: input.kind, eventToggles: input.eventToggles },
    });

    return row;
  });

  return checkDto(OrgIntegrationSchema, toDTO(input.kind, updated), "OrgIntegrationDTO");
}

/**
 * Posts one test card, using the saved address and exactly the same builder a real notification
 * uses. The result says whether it arrived, in plain English; the chat tool's own error body is
 * never passed through, and neither is the address.
 */
export async function sendIntegrationTest(
  actor: ActorContext,
  input: { kind: IntegrationKindName },
): Promise<IntegrationTestResultDTO> {
  assertCan(actor, "MANAGE_INTEGRATIONS");

  const existing = await ownIntegration(actor, input.kind);
  if (!existing) {
    throw new NotFoundError(`Save a ${KIND_LABEL[input.kind]} webhook address first.`);
  }

  const organization = await prisma.organization.findUnique({
    where: { id: actor.orgId },
    select: { name: true },
  });

  const outcome = await sendTestMessage(
    input.kind,
    existing.webhookUrl,
    organization?.name ?? "your company",
  );

  await prisma.$transaction(async (tx) => {
    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: null,
      entityType: "OrgIntegration",
      entityId: `${actor.orgId}:${input.kind}`,
      action: ACTIVITY.INTEGRATION_TEST_SENT,
      summary: `${actor.name} sent a test message to ${KIND_LABEL[input.kind]}${
        outcome.ok ? "" : " (it did not arrive)"
      }`,
      metadata: { kind: input.kind, delivered: outcome.ok },
    });
  });

  return checkDto(
    TestResultSchema,
    {
      kind: input.kind,
      delivered: outcome.ok,
      message: outcome.ok
        ? `Test message sent to ${KIND_LABEL[input.kind]}. Check the channel.`
        : `We could not send the test message — ${outcome.reason}. Check the address and try again.`,
    },
    "IntegrationTestResultDTO",
  );
}

/** Removes the connection entirely, address and all. The audit row of it happening stays forever. */
export async function deleteIntegration(
  actor: ActorContext,
  input: { kind: IntegrationKindName },
): Promise<{ removed: true }> {
  assertCan(actor, "MANAGE_INTEGRATIONS");

  const existing = await ownIntegration(actor, input.kind);
  if (!existing) {
    throw new NotFoundError(`There is no ${KIND_LABEL[input.kind]} connection to remove.`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.orgIntegration.delete({ where: { id: existing.id } });
    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: null,
      entityType: "OrgIntegration",
      entityId: `${actor.orgId}:${input.kind}`,
      action: ACTIVITY.INTEGRATION_REMOVED,
      summary: `${actor.name} removed the ${KIND_LABEL[input.kind]} connection`,
      metadata: { kind: input.kind },
    });
  });

  return { removed: true };
}
