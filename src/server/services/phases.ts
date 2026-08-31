// Project phases — the stage gates.
//
// A phase is LOCKED while any phase before it still has open work, and locked is derived at read
// time from one grouped query, never stored (the same rule OVERDUE follows). What a locked phase
// refuses is completion-type work under it: discipline-task status changes and a main-task status
// override. Creating, editing and assigning tasks, comments and uploads stay open, so a team can
// prepare the next stage while the gate is still shut.
//
// The only legal way through a shut gate is the recorded override on the phase itself: who, why and
// when, plus a PHASE_OVERRIDE_APPLIED audit row written in the same transaction — the same shape as
// the main-task status override in tasks.ts, and limited to the same two roles.

import type { Prisma } from "@/generated/prisma/client";
import { notDeleted, prisma } from "@/lib/db";
import { assertCan } from "@/lib/permissions";
import { effectiveStatus } from "@/lib/progress";
import {
  phaseLockMessage,
  phaseLockedFor,
  sortPhases,
  type PhaseLockState,
} from "@/lib/phase-lock";
import type { CreatePhaseInput, PhaseDTO, RenamePhaseInput, ReorderPhasesInput } from "@/lib/zod-schemas";
import { PhaseDTO as PhaseSchema } from "@/lib/zod-schemas";
import type { ActorContext } from "@/server/actor";
import { NotFoundError, ServiceError } from "@/server/errors";
import { checkDto, checkDtoList } from "@/server/serialize";
import { ACTIVITY, appendActivity } from "@/server/services/activity";
import { notify } from "@/server/services/notify";
// One direction only: phases reach projects for the tenant loaders, never the other way round —
// createProject builds its own default phases (src/server/services/projects.ts).
import { assertCanViewProject, projectInOrg } from "@/server/services/projects";

/* ------------------------------------------------------------------ */
/* Deriving the gate                                                   */
/* ------------------------------------------------------------------ */

type PhaseRow = {
  id: string;
  projectId: string;
  name: string;
  sortOrder: number;
  overriddenById: string | null;
  overrideReason: string | null;
  overriddenAt: Date | null;
};

/**
 * Every phase of one project with its lock state worked out.
 *
 * Two queries whatever the size of the project: the phases themselves, and ONE groupBy over the
 * project's live main tasks. `statusOverride` is grouped alongside `status` because an authorised
 * main-task override is what that task's status really says — so a task completed by override
 * closes the gate behind it exactly as an honestly completed one does.
 *
 * Pass a transaction client to ask the question INSIDE a change that is still in flight — that is
 * how a move or a reorder can record, in the very same audit row, which gates it opened or shut.
 */
export async function phaseStatesFor(
  projectId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<Map<string, PhaseLockState>> {
  const phases = await client.projectPhase.findMany({ where: { projectId } });
  if (phases.length === 0) return new Map();

  const counts = await client.mainTask.groupBy({
    by: ["phaseId", "status", "statusOverride"],
    where: { projectId, phaseId: { not: null }, ...notDeleted },
    _count: { _all: true },
  });

  const totals = new Map<string, { taskCount: number; completedCount: number }>();
  for (const row of counts) {
    if (!row.phaseId) continue;
    const entry = totals.get(row.phaseId) ?? { taskCount: 0, completedCount: 0 };
    entry.taskCount += row._count._all;
    if (effectiveStatus(row.status, row.statusOverride) === "COMPLETED") {
      entry.completedCount += row._count._all;
    }
    totals.set(row.phaseId, entry);
  }

  return phaseLockedFor(
    phases.map((phase) => ({
      id: phase.id,
      name: phase.name,
      sortOrder: phase.sortOrder,
      overridden: phase.overriddenById !== null,
      taskCount: totals.get(phase.id)?.taskCount ?? 0,
      completedCount: totals.get(phase.id)?.completedCount ?? 0,
    })),
  );
}

/** One gate that changed state because of a change somebody made. */
export type GateChange = { phaseId: string; name: string; from: "locked" | "open"; to: "locked" | "open" };

/**
 * Which gates a change opened or shut, by comparing the state before it with the state after it.
 * A stage gate moving is the most consequential thing that can happen to a project's plan, so it is
 * never left to be inferred from the data later — it is named in the audit row that caused it.
 */
export function gateChangesBetween(
  before: Map<string, PhaseLockState>,
  after: Map<string, PhaseLockState>,
): GateChange[] {
  const changes: GateChange[] = [];
  for (const [phaseId, next] of after) {
    const previous = before.get(phaseId);
    if (!previous || previous.locked === next.locked) continue;
    changes.push({
      phaseId,
      name: next.name,
      from: previous.locked ? "locked" : "open",
      to: next.locked ? "locked" : "open",
    });
  }
  return changes;
}

/** The plain-English tail an audit summary carries when a change moved a gate. */
export function gateChangeWords(changes: GateChange[]): string {
  if (changes.length === 0) return "";
  const parts = changes.map(
    (change) => `${change.to === "open" ? "opened" : "closed"} the '${change.name}' gate`,
  );
  return ` — this ${parts.join(" and ")}`;
}

/**
 * THE GATE, as a precondition. Called before a completion-type transition is attempted, in the same
 * spirit as canCompleteDisciplineTask() — never after, and never instead of it. An unphased task
 * (phaseId null) is never gated, and a project with no phases at all has nothing to refuse.
 */
export async function assertPhaseUnlocked(
  projectId: string,
  phaseId: string | null | undefined,
): Promise<void> {
  if (!phaseId) return;

  const states = await phaseStatesFor(projectId);
  const state = states.get(phaseId);
  if (!state || !state.locked) return;

  throw new ServiceError(phaseLockMessage(state.name, state.lockedByPhaseName));
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/** A project's phases in gate order, each with its derived lock state and its progress. */
export async function listPhasesForProject(
  actor: ActorContext,
  projectId: string,
): Promise<PhaseDTO[]> {
  await assertCanViewProject(actor, projectId);

  const phases = await prisma.projectPhase.findMany({
    where: { projectId },
    include: { overriddenBy: { select: { name: true } } },
  });
  if (phases.length === 0) return [];

  const states = await phaseStatesFor(projectId);
  const items = sortPhases(phases).map((phase) => toPhaseDTO(phase, phase.overriddenBy?.name ?? null, states));

  return checkDtoList(PhaseSchema, items, "PhaseDTO");
}

function toPhaseDTO(
  phase: PhaseRow,
  overriddenByName: string | null,
  states: Map<string, PhaseLockState>,
): PhaseDTO {
  const state = states.get(phase.id);
  return {
    id: phase.id,
    projectId: phase.projectId,
    name: phase.name,
    sortOrder: phase.sortOrder,
    locked: state?.locked ?? false,
    lockedByPhaseName: state?.lockedByPhaseName ?? null,
    overridden: phase.overriddenById !== null,
    overrideReason: phase.overrideReason,
    overriddenByName,
    overriddenAt: phase.overriddenAt,
    taskCount: state?.taskCount ?? 0,
    completedCount: state?.completedCount ?? 0,
  };
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

/** Adds a phase at the end of the sequence. Administrators and project managers only. */
export async function createPhase(actor: ActorContext, input: CreatePhaseInput): Promise<PhaseDTO> {
  const project = await projectInOrg(actor, input.projectId);
  assertCan(actor, "EDIT_PROJECT", { projectId: project.id, orgId: project.orgId });

  const name = input.name.trim();
  await assertNameFree(project.id, name);

  const last = await prisma.projectPhase.findFirst({
    where: { projectId: project.id },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  const phaseId = await prisma.$transaction(async (tx) => {
    const phase = await tx.projectPhase.create({
      data: { projectId: project.id, name, sortOrder: (last?.sortOrder ?? -1) + 1 },
    });

    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: project.id,
      entityType: "ProjectPhase",
      entityId: phase.id,
      action: ACTIVITY.PHASE_CREATED,
      summary: `${actor.name} added the phase "${phase.name}"`,
      metadata: { sortOrder: phase.sortOrder },
    });

    return phase.id;
  });

  return buildPhaseDTO(phaseId);
}

/** Renames a phase. The gate itself is untouched — only what it is called. */
export async function renamePhase(actor: ActorContext, input: RenamePhaseInput): Promise<PhaseDTO> {
  const existing = await loadPhase(actor, input.id);
  assertCan(actor, "EDIT_PROJECT", {
    projectId: existing.projectId,
    orgId: existing.project.orgId,
  });

  const name = input.name.trim();
  if (name !== existing.name) await assertNameFree(existing.projectId, name);

  await prisma.$transaction(async (tx) => {
    await tx.projectPhase.update({ where: { id: existing.id }, data: { name } });

    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: existing.projectId,
      entityType: "ProjectPhase",
      entityId: existing.id,
      action: ACTIVITY.PHASE_RENAMED,
      summary: `${actor.name} renamed the phase "${existing.name}" to "${name}"`,
      metadata: { before: { name: existing.name }, after: { name } },
    });
  });

  return buildPhaseDTO(existing.id);
}

/**
 * Puts the phases in a new order. The whole list is sent every time: leaving one out would change
 * which gates apply without anyone saying so, and that is exactly the kind of silent change a stage
 * gate must never make.
 */
export async function reorderPhases(
  actor: ActorContext,
  input: ReorderPhasesInput,
): Promise<PhaseDTO[]> {
  const project = await projectInOrg(actor, input.projectId);
  assertCan(actor, "EDIT_PROJECT", { projectId: project.id, orgId: project.orgId });

  const phases = await prisma.projectPhase.findMany({
    where: { projectId: project.id },
    select: { id: true, name: true },
  });
  const known = new Set(phases.map((phase) => phase.id));
  const asked = new Set(input.phaseIds);

  if (asked.size !== input.phaseIds.length) {
    throw new ServiceError("That order lists the same phase twice. Send each phase once.");
  }
  if (asked.size !== known.size || input.phaseIds.some((phaseId) => !known.has(phaseId))) {
    throw new ServiceError(
      "That order does not match this project's phases. Refresh the page and try again.",
    );
  }

  const nameById = new Map(phases.map((phase) => [phase.id, phase.name]));
  // Reordering the gates changes which of them are shut. The audit row says which, in so many words.
  const before = await phaseStatesFor(project.id);

  await prisma.$transaction(async (tx) => {
    for (const [index, phaseId] of input.phaseIds.entries()) {
      await tx.projectPhase.update({ where: { id: phaseId }, data: { sortOrder: index } });
    }

    const changes = gateChangesBetween(before, await phaseStatesFor(project.id, tx));

    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: project.id,
      entityType: "ProjectPhase",
      entityId: project.id,
      action: ACTIVITY.PHASES_REORDERED,
      summary:
        `${actor.name} reordered the phases: ${input.phaseIds
          .map((phaseId) => nameById.get(phaseId) ?? "a phase")
          .join(" → ")}` + gateChangeWords(changes),
      metadata: { order: input.phaseIds, gateChanges: changes },
    });
  });

  return listPhasesForProject(actor, project.id);
}

/** Removes a phase — only once no main task sits in it, so nothing is ever silently unphased. */
export async function deletePhase(
  actor: ActorContext,
  input: { id: string },
): Promise<{ removed: true }> {
  const existing = await loadPhase(actor, input.id);
  assertCan(actor, "EDIT_PROJECT", {
    projectId: existing.projectId,
    orgId: existing.project.orgId,
  });

  // Soft-deleted tasks still point at the phase, so they are counted too: the database's Restrict
  // rule would refuse the delete anyway, and a plain-English refusal beats a foreign-key error.
  const tasks = await prisma.mainTask.count({ where: { phaseId: existing.id } });
  if (tasks > 0) {
    throw new ServiceError(
      `The phase "${existing.name}" still holds ${tasks === 1 ? "1 main task" : `${tasks} main tasks`}. ` +
        "Move that work to another phase, or set it to no phase, before deleting this one.",
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.projectPhase.delete({ where: { id: existing.id } });

    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: existing.projectId,
      entityType: "ProjectPhase",
      entityId: existing.id,
      action: ACTIVITY.PHASE_DELETED,
      summary: `${actor.name} deleted the empty phase "${existing.name}"`,
      metadata: { name: existing.name, sortOrder: existing.sortOrder },
    });
  });

  return { removed: true };
}

/**
 * THE ESCAPE HATCH. Opens a locked phase for good, with who, why and when recorded on the phase and
 * a PHASE_OVERRIDE_APPLIED row in the audit trail. Administrators and project managers only —
 * the same rule, the same reason length and the same permission as a main-task status override.
 */
export async function overridePhaseLock(
  actor: ActorContext,
  input: { id: string; reason: string },
): Promise<PhaseDTO> {
  const existing = await loadPhase(actor, input.id);
  assertCan(actor, "OVERRIDE_MAIN_TASK_STATUS", {
    projectId: existing.projectId,
    orgId: existing.project.orgId,
  });

  const reason = input.reason.trim();
  if (reason.length < 5) throw new ServiceError("Give a short reason (at least 5 characters).");
  if (existing.overriddenById) {
    throw new ServiceError(`The phase "${existing.name}" is already open by override.`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.projectPhase.update({
      where: { id: existing.id },
      data: { overriddenById: actor.userId, overrideReason: reason, overriddenAt: new Date() },
    });

    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: existing.projectId,
      entityType: "ProjectPhase",
      entityId: existing.id,
      action: ACTIVITY.PHASE_OVERRIDE_APPLIED,
      summary: `${actor.name} opened the locked phase "${existing.name}" by override — ${reason}`,
      metadata: { reason, phase: existing.name },
    });
  });

  // Everybody on the project hears about a gate being opened, exactly as they hear about a main
  // task being force-completed (overrideMainTaskStatus in tasks.ts) — same type, same shape, after
  // the transaction has committed. OVERRIDE_APPLIED is also the type the chat integrations map to
  // their "gate opened or override applied" toggle.
  await notify(actor, await projectAudience(existing.projectId, actor.userId), "OVERRIDE_APPLIED", {
    title: "A locked phase was opened",
    body: `${actor.name} opened the phase "${existing.name}" by override. Reason: ${reason}`,
    linkUrl: `/projects/${existing.projectId}`,
  });

  return buildPhaseDTO(existing.id);
}

/**
 * Everyone on a project, for the rare change that concerns all of them — EXCEPT the external
 * contractors. A project-wide announcement ("X overrode the status of «some other task»") names
 * work a contractor may not see, so a fan-out that included them would leak through the one door
 * the read scoping cannot close.
 */
async function projectAudience(projectId: string, exceptUserId: string): Promise<string[]> {
  const members = await prisma.projectMember.findMany({
    where: { projectId, user: { role: { not: "EXTERNAL" } } },
    select: { userId: true },
  });
  return members.map((member) => member.userId).filter((userId) => userId !== exceptUserId);
}

/* ------------------------------------------------------------------ */
/* Loaders and serializers                                             */
/* ------------------------------------------------------------------ */

/**
 * The tenant gate for every phase in this file: a phase in another company's project is not
 * refused, it does not exist. The project's own orgId comes back with it, so the permission check
 * is made against the row's organisation rather than against an assumption.
 */
async function loadPhase(actor: ActorContext, id: string) {
  const phase = await prisma.projectPhase.findFirst({
    where: { id, project: { orgId: actor.orgId, ...notDeleted } },
    include: { project: { select: { orgId: true } } },
  });
  if (!phase) throw new NotFoundError("We could not find that phase.");
  return phase;
}

async function assertNameFree(projectId: string, name: string): Promise<void> {
  const clash = await prisma.projectPhase.findUnique({
    where: { projectId_name: { projectId, name } },
    select: { id: true },
  });
  if (clash) {
    throw new ServiceError(`This project already has a phase called "${name}". Pick another name.`, {
      name: ["This project already has a phase with that name."],
    });
  }
}

/** Builds one phase DTO. Callers have already checked that the person may see its project. */
export async function buildPhaseDTO(phaseId: string): Promise<PhaseDTO> {
  const phase = await prisma.projectPhase.findUnique({
    where: { id: phaseId },
    include: { overriddenBy: { select: { name: true } } },
  });
  if (!phase) throw new NotFoundError("We could not find that phase.");

  const states = await phaseStatesFor(phase.projectId);
  return checkDto(PhaseSchema, toPhaseDTO(phase, phase.overriddenBy?.name ?? null, states), "PhaseDTO");
}
