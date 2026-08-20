// Pure rules for the golden guarantee: a main task's status and progress are always the truth of its discipline tasks.

export type TaskStatusValue =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "BLOCKED"
  | "AWAITING_REVIEW"
  | "COMPLETED";

export type SubtaskForDerivation = {
  status: TaskStatusValue;
  isMandatory: boolean;
  deletedAt?: Date | null;
};

export type DerivedMainTask = { progressPct: number; status: TaskStatusValue };

/**
 * Derives a main task's progress and status from its discipline tasks.
 * Soft-deleted subtasks are ignored completely.
 */
export function deriveMainTask(subtasks: SubtaskForDerivation[]): DerivedMainTask {
  const live = subtasks.filter((task) => !task.deletedAt);
  if (live.length === 0) return { progressPct: 0, status: "NOT_STARTED" };

  const completed = live.filter((task) => task.status === "COMPLETED");
  // 100% is reserved for "everything is complete" — a floor plus a 99 cap stops
  // 199/200 finished from rounding up into a number that contradicts the status.
  const progressPct =
    completed.length === live.length
      ? 100
      : Math.min(99, Math.floor((100 * completed.length) / live.length));

  if (completed.length === live.length) return { progressPct, status: "COMPLETED" };
  if (live.some((task) => task.status === "BLOCKED")) return { progressPct, status: "BLOCKED" };

  const mandatory = live.filter((task) => task.isMandatory);
  const allMandatoryDone =
    mandatory.length > 0 && mandatory.every((task) => task.status === "COMPLETED");
  if (allMandatoryDone) return { progressPct, status: "AWAITING_REVIEW" };

  if (live.some((task) => task.status !== "NOT_STARTED")) return { progressPct, status: "IN_PROGRESS" };
  return { progressPct, status: "NOT_STARTED" };
}

/** An authorised override always wins over the derived status — that is the only legitimate bypass. */
export function effectiveStatus(
  derived: TaskStatusValue,
  override?: TaskStatusValue | null,
): TaskStatusValue {
  return override ?? derived;
}

/** Overdue is derived, never stored: past its deadline and not finished. */
export function isOverdue(
  deadline: Date,
  status: TaskStatusValue,
  now: Date = new Date(),
): boolean {
  return deadline.getTime() < now.getTime() && status !== "COMPLETED";
}

export type CompletionCheckInput = {
  requiredDocs: { isMandatory: boolean; documentId?: string | null; name?: string }[];
  unmetDependencies: string[];
};

export type CompletionCheck = { ok: boolean; blockers: string[] };

/** Says, in plain English, whether a discipline task may be marked complete yet. */
export function canCompleteDisciplineTask(input: CompletionCheckInput): CompletionCheck {
  const blockers: string[] = [];

  const missing = input.requiredDocs.filter((doc) => doc.isMandatory && !doc.documentId);
  const named = missing.map((doc) => doc.name).filter((name): name is string => Boolean(name));
  const names = named.length === missing.length ? `: ${named.join(", ")}` : "";
  if (missing.length === 1) blockers.push(`1 required document is still missing${names}.`);
  if (missing.length > 1) blockers.push(`${missing.length} required documents are still missing${names}.`);

  const open = input.unmetDependencies.length;
  if (open === 1) blockers.push(`Waiting on 1 earlier task: ${input.unmetDependencies[0]}.`);
  if (open > 1) blockers.push(`Waiting on ${open} earlier tasks: ${input.unmetDependencies.join(", ")}.`);

  return { ok: blockers.length === 0, blockers };
}

/** Depth-first check: would adding this dependency create a loop of tasks waiting on each other? */
export function wouldCreateCycle(
  edges: [string, string][],
  newEdge: [string, string],
): boolean {
  const [from, to] = newEdge;
  if (from === to) return true;

  const outgoing = new Map<string, string[]>();
  for (const [predecessor, successor] of [...edges, newEdge]) {
    const list = outgoing.get(predecessor) ?? [];
    list.push(successor);
    outgoing.set(predecessor, list);
  }

  const seen = new Set<string>();
  const stack: string[] = [to];
  while (stack.length > 0) {
    const node = stack.pop() as string;
    if (node === from) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    stack.push(...(outgoing.get(node) ?? []));
  }
  return false;
}
