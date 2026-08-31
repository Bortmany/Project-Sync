// The stage-gate rule, on its own: which phases are locked, and what the refusal says.
// Locked is derived here and nowhere else — the services only ever ask this file.

import { describe, expect, it } from "vitest";
import {
  defaultPhaseForNewWork,
  phaseLockMessage,
  phaseLockedFor,
  sortPhases,
} from "@/lib/phase-lock";

type Row = {
  id: string;
  name: string;
  sortOrder: number;
  overridden?: boolean;
  taskCount: number;
  completedCount: number;
};

function states(rows: Row[]) {
  return phaseLockedFor(rows.map((row) => ({ overridden: false, ...row })));
}

/** The same helper under a name the default-phase block can use without shadowing. */
const states_ = states;

const locked = (rows: Row[], id: string) => states(rows).get(id)?.locked;

describe("phaseLockedFor", () => {
  it("never locks the first phase, whatever is in it", () => {
    const rows: Row[] = [
      { id: "a", name: "FEED", sortOrder: 0, taskCount: 3, completedCount: 0 },
      { id: "b", name: "Detail design", sortOrder: 1, taskCount: 2, completedCount: 0 },
    ];

    expect(locked(rows, "a")).toBe(false);
    expect(locked(rows, "b")).toBe(true);
  });

  it("locks every phase after the first one with open work", () => {
    const rows: Row[] = [
      { id: "a", name: "FEED", sortOrder: 0, taskCount: 2, completedCount: 2 },
      { id: "b", name: "Detail design", sortOrder: 1, taskCount: 4, completedCount: 1 },
      { id: "c", name: "Procurement", sortOrder: 2, taskCount: 1, completedCount: 0 },
      { id: "d", name: "Construction", sortOrder: 3, taskCount: 0, completedCount: 0 },
    ];

    expect(locked(rows, "a")).toBe(false);
    expect(locked(rows, "b")).toBe(false);
    expect(locked(rows, "c")).toBe(true);
    expect(locked(rows, "d")).toBe(true);
  });

  it("names the earliest unfinished phase as the one being waited for", () => {
    const rows: Row[] = [
      { id: "a", name: "FEED", sortOrder: 0, taskCount: 1, completedCount: 0 },
      { id: "b", name: "Detail design", sortOrder: 1, taskCount: 1, completedCount: 0 },
      { id: "c", name: "Procurement", sortOrder: 2, taskCount: 1, completedCount: 0 },
    ];

    // Both later phases wait on FEED — the first gate that is still shut, not the nearest one.
    expect(states(rows).get("b")?.lockedByPhaseName).toBe("FEED");
    expect(states(rows).get("c")?.lockedByPhaseName).toBe("FEED");
  });

  it("gates nothing on an empty earlier phase", () => {
    const rows: Row[] = [
      { id: "a", name: "FEED", sortOrder: 0, taskCount: 0, completedCount: 0 },
      { id: "b", name: "Detail design", sortOrder: 1, taskCount: 1, completedCount: 1 },
      { id: "c", name: "Procurement", sortOrder: 2, taskCount: 1, completedCount: 0 },
    ];

    expect(locked(rows, "b")).toBe(false);
    expect(locked(rows, "c")).toBe(false);
  });

  it("treats a phase with a recorded override as open for good", () => {
    const rows: Row[] = [
      { id: "a", name: "FEED", sortOrder: 0, taskCount: 2, completedCount: 0 },
      { id: "b", name: "Detail design", sortOrder: 1, overridden: true, taskCount: 1, completedCount: 0 },
      { id: "c", name: "Procurement", sortOrder: 2, taskCount: 1, completedCount: 0 },
    ];

    expect(locked(rows, "b")).toBe(false);
    // The override opens that one phase only: what comes after it is still gated by FEED.
    expect(locked(rows, "c")).toBe(true);
    expect(states(rows).get("b")?.lockedByPhaseName).toBeNull();
  });

  it("reads the order from sortOrder, not from the order it was handed", () => {
    const rows: Row[] = [
      { id: "c", name: "Procurement", sortOrder: 2, taskCount: 1, completedCount: 0 },
      { id: "a", name: "FEED", sortOrder: 0, taskCount: 1, completedCount: 0 },
      { id: "b", name: "Detail design", sortOrder: 1, taskCount: 1, completedCount: 1 },
    ];

    expect(locked(rows, "a")).toBe(false);
    expect(locked(rows, "b")).toBe(true);
    expect(locked(rows, "c")).toBe(true);
  });

  it("answers for a project with no phases at all", () => {
    expect(states([]).size).toBe(0);
  });

  it("orders two phases sharing a sortOrder by name, so the answer is never arbitrary", () => {
    const ordered = sortPhases([
      { name: "Beta", sortOrder: 1 },
      { name: "Alpha", sortOrder: 1 },
    ]);
    expect(ordered.map((row) => row.name)).toEqual(["Alpha", "Beta"]);
  });
});

describe("defaultPhaseForNewWork — where the new-task form starts", () => {
  /** The gate state the rest of the app would derive, so the two rules are tested together. */
  function withLocks(rows: Row[]) {
    const states = states_(rows);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      sortOrder: row.sortOrder,
      locked: states.get(row.id)?.locked ?? false,
      taskCount: row.taskCount,
      completedCount: row.completedCount,
    }));
  }

  it("picks the phase the team is working in, not the first unlocked one", () => {
    // FEED is finished, so it is unlocked AND first — the bug this test exists for was defaulting
    // every new task back into it, which gave it open work again and re-locked the whole project.
    const rows: Row[] = [
      { id: "feed", name: "FEED", sortOrder: 0, taskCount: 2, completedCount: 2 },
      { id: "detail", name: "Detail design", sortOrder: 1, taskCount: 3, completedCount: 1 },
      { id: "proc", name: "Procurement", sortOrder: 2, taskCount: 1, completedCount: 0 },
    ];

    expect(defaultPhaseForNewWork(withLocks(rows))).toBe("detail");
  });

  it("stays in the first phase while its own work is still open", () => {
    const rows: Row[] = [
      { id: "feed", name: "FEED", sortOrder: 0, taskCount: 2, completedCount: 1 },
      { id: "detail", name: "Detail design", sortOrder: 1, taskCount: 1, completedCount: 0 },
    ];

    expect(defaultPhaseForNewWork(withLocks(rows))).toBe("feed");
  });

  it("moves to the next stage when everything so far is complete", () => {
    const rows: Row[] = [
      { id: "feed", name: "FEED", sortOrder: 0, taskCount: 2, completedCount: 2 },
      { id: "detail", name: "Detail design", sortOrder: 1, taskCount: 0, completedCount: 0 },
      { id: "proc", name: "Procurement", sortOrder: 2, taskCount: 0, completedCount: 0 },
    ];

    expect(defaultPhaseForNewWork(withLocks(rows))).toBe("detail");
  });

  it("starts at the beginning on a project with no work at all", () => {
    const rows: Row[] = [
      { id: "feed", name: "FEED", sortOrder: 0, taskCount: 0, completedCount: 0 },
      { id: "detail", name: "Detail design", sortOrder: 1, taskCount: 0, completedCount: 0 },
    ];

    expect(defaultPhaseForNewWork(withLocks(rows))).toBe("feed");
  });

  it("never defaults into a locked phase", () => {
    const rows: Row[] = [
      { id: "feed", name: "FEED", sortOrder: 0, taskCount: 1, completedCount: 0 },
      { id: "detail", name: "Detail design", sortOrder: 1, taskCount: 5, completedCount: 1 },
    ];

    const chosen = defaultPhaseForNewWork(withLocks(rows));
    expect(chosen).toBe("feed");
    expect(withLocks(rows).find((phase) => phase.id === chosen)?.locked).toBe(false);
  });

  it("has nothing to choose on a project with no phases", () => {
    expect(defaultPhaseForNewWork([])).toBeNull();
  });
});

describe("phaseLockMessage", () => {
  it("names the phase, what it waits for, and who can let it through", () => {
    expect(phaseLockMessage("Construction", "Foundations")).toBe(
      "This task is in the 'Construction' phase, which is locked until 'Foundations' is complete. " +
        "An administrator or project manager can override the gate.",
    );
  });

  it("still reads plainly when no single phase can be named", () => {
    expect(phaseLockMessage("Construction", null)).toContain(
      "which is locked until the earlier phases are complete",
    );
  });
});
