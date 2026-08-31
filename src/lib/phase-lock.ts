// Pure rules for the stage gate: which of a project's phases are locked right now.
//
// Locked is DERIVED, never stored — exactly like OVERDUE in progress.ts. One phase's state is a
// function of the phases before it, so the whole answer is worked out here from counts the caller
// has already read in one grouped query. No database access lives in this file.

export type PhaseForLock = {
  id: string;
  name: string;
  sortOrder: number;
  /** True once the phase carries a recorded, authorised override — it is then never locked again. */
  overridden: boolean;
  /** Live main tasks in this phase. */
  taskCount: number;
  /** How many of those are complete (an authorised main-task override counts as complete). */
  completedCount: number;
};

export type PhaseLockState = PhaseForLock & {
  locked: boolean;
  /** The earliest phase before this one with work still open — what the gate is waiting for. */
  lockedByPhaseName: string | null;
};

/** Phases in the order they are gated: by sortOrder, then by name so the answer is never arbitrary. */
export function sortPhases<T extends { sortOrder: number; name: string }>(phases: T[]): T[] {
  return [...phases].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

/**
 * The lock state of every phase in one project, keyed by phase id.
 *
 * A phase is locked when some phase with a lower sortOrder still has at least one main task that is
 * not complete. The first phase is therefore never locked, an empty earlier phase gates nothing, and
 * a phase with a recorded override is unlocked permanently.
 */
export function phaseLockedFor(phases: PhaseForLock[]): Map<string, PhaseLockState> {
  const ordered = sortPhases(phases);
  const states = new Map<string, PhaseLockState>();

  // The first earlier phase with open work. Once one is found it gates everything after it.
  let blocking: string | null = null;

  for (const phase of ordered) {
    const locked = blocking !== null && !phase.overridden;
    states.set(phase.id, {
      ...phase,
      locked,
      lockedByPhaseName: locked ? blocking : null,
    });

    if (blocking === null && phase.completedCount < phase.taskCount) blocking = phase.name;
  }

  return states;
}

export type PhaseChoice = {
  id: string;
  name: string;
  sortOrder: number;
  locked: boolean;
  taskCount: number;
  completedCount: number;
};

/**
 * Where new work should land by default: the phase the team is actually working in.
 *
 * "The first unlocked phase" is NOT that answer — the first phase is never locked, so once it is
 * finished every new task would drop back into it, give it open work again and re-lock every phase
 * behind it for everybody. The rule instead is:
 *
 *  1. the first unlocked phase that still has work open — where the team is now; otherwise
 *  2. the first unlocked phase after the last phase that has any work at all — the next stage up,
 *     when everything so far is finished; otherwise
 *  3. the first phase, for a project where no work exists yet.
 *
 * Returns null only when there are no phases to choose from.
 */
export function defaultPhaseForNewWork(phases: PhaseChoice[]): string | null {
  const ordered = sortPhases(phases);
  if (ordered.length === 0) return null;

  const open = ordered.find((phase) => !phase.locked && phase.completedCount < phase.taskCount);
  if (open) return open.id;

  const unlocked = ordered.filter((phase) => !phase.locked);
  if (unlocked.length === 0) return null;

  const lastWithWork = ordered.reduce(
    (last, phase, index) => (phase.taskCount > 0 ? index : last),
    -1,
  );
  if (lastWithWork === -1) return ordered[0].id;

  const next = ordered.slice(lastWithWork + 1).find((phase) => !phase.locked);
  return (next ?? unlocked[unlocked.length - 1]).id;
}

/**
 * The refusal a person reads when a gate stops them. Precise on purpose: it names the phase they
 * are in, the phase it is waiting for, and who can let it through.
 */
export function phaseLockMessage(phaseName: string, blockedByPhaseName: string | null): string {
  const waitingFor = blockedByPhaseName
    ? `which is locked until '${blockedByPhaseName}' is complete`
    : "which is locked until the earlier phases are complete";
  return (
    `This task is in the '${phaseName}' phase, ${waitingFor}. ` +
    "An administrator or project manager can override the gate."
  );
}
