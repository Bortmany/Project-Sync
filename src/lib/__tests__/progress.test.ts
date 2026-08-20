// Golden-rule tests: a main task's progress and status must always be the truth of its discipline tasks.

import { describe, expect, it } from "vitest";
import {
  canCompleteDisciplineTask,
  deriveMainTask,
  effectiveStatus,
  isOverdue,
  wouldCreateCycle,
  type SubtaskForDerivation,
  type TaskStatusValue,
} from "@/lib/progress";

function sub(
  status: TaskStatusValue,
  isMandatory = true,
  deletedAt: Date | null = null,
): SubtaskForDerivation {
  return { status, isMandatory, deletedAt };
}

describe("deriveMainTask", () => {
  it("reports 3 of 5 complete as 60 percent", () => {
    const result = deriveMainTask([
      sub("COMPLETED"),
      sub("COMPLETED"),
      sub("COMPLETED"),
      sub("IN_PROGRESS"),
      sub("NOT_STARTED"),
    ]);
    expect(result.progressPct).toBe(60);
    expect(result.status).toBe("IN_PROGRESS");
  });

  it("never shows 100 percent while any task is open, however many are finished", () => {
    const nearlyDone = [
      ...Array.from({ length: 199 }, () => sub("COMPLETED")),
      sub("IN_PROGRESS"),
    ];
    const result = deriveMainTask(nearlyDone);
    expect(result.progressPct).toBe(99);
    expect(result.status).not.toBe("COMPLETED");
  });

  it("is COMPLETED only when every discipline task is complete", () => {
    expect(deriveMainTask([sub("COMPLETED"), sub("COMPLETED")])).toEqual({
      progressPct: 100,
      status: "COMPLETED",
    });
    expect(deriveMainTask([sub("COMPLETED"), sub("AWAITING_REVIEW")]).status).not.toBe("COMPLETED");
  });

  it("never completes while a mandatory task is open, even if optional ones finished", () => {
    const result = deriveMainTask([
      sub("COMPLETED", false),
      sub("COMPLETED", false),
      sub("IN_PROGRESS", true),
    ]);
    expect(result.status).toBe("IN_PROGRESS");
    expect(result.progressPct).toBe(66);
  });

  it("is AWAITING_REVIEW when all mandatory work is done and only optional work is open", () => {
    const result = deriveMainTask([
      sub("COMPLETED", true),
      sub("COMPLETED", true),
      sub("NOT_STARTED", false),
    ]);
    expect(result.status).toBe("AWAITING_REVIEW");
    expect(result.progressPct).toBe(66);
  });

  it("is BLOCKED when any task is blocked, even if mandatory work is otherwise done", () => {
    expect(deriveMainTask([sub("COMPLETED"), sub("BLOCKED")]).status).toBe("BLOCKED");
    expect(deriveMainTask([sub("COMPLETED", true), sub("BLOCKED", false)]).status).toBe("BLOCKED");
  });

  it("is NOT_STARTED at zero percent when nothing has started", () => {
    expect(deriveMainTask([sub("NOT_STARTED"), sub("NOT_STARTED")])).toEqual({
      progressPct: 0,
      status: "NOT_STARTED",
    });
  });

  it("treats a task with no discipline tasks as not started", () => {
    expect(deriveMainTask([])).toEqual({ progressPct: 0, status: "NOT_STARTED" });
  });

  it("ignores soft-deleted discipline tasks completely", () => {
    const result = deriveMainTask([
      sub("COMPLETED"),
      sub("COMPLETED"),
      sub("NOT_STARTED", true, new Date("2026-01-01")),
    ]);
    expect(result).toEqual({ progressPct: 100, status: "COMPLETED" });
  });

  it("counts only live tasks when working out the percentage", () => {
    const result = deriveMainTask([
      sub("COMPLETED"),
      sub("IN_PROGRESS"),
      sub("NOT_STARTED", true, new Date("2026-01-01")),
      sub("NOT_STARTED", true, new Date("2026-01-01")),
    ]);
    expect(result.progressPct).toBe(50);
  });
});

describe("effectiveStatus", () => {
  it("uses the derived status when there is no override", () => {
    expect(effectiveStatus("IN_PROGRESS", null)).toBe("IN_PROGRESS");
    expect(effectiveStatus("BLOCKED", undefined)).toBe("BLOCKED");
  });

  it("lets a recorded override win — the only permitted bypass", () => {
    expect(effectiveStatus("IN_PROGRESS", "COMPLETED")).toBe("COMPLETED");
    expect(effectiveStatus("COMPLETED", "BLOCKED")).toBe("BLOCKED");
  });
});

describe("isOverdue", () => {
  const now = new Date("2026-08-20T12:00:00Z");

  it("is overdue once the deadline has passed and the work is unfinished", () => {
    expect(isOverdue(new Date("2026-08-19T12:00:00Z"), "IN_PROGRESS", now)).toBe(true);
  });

  it("is not overdue on the exact deadline moment", () => {
    expect(isOverdue(new Date("2026-08-20T12:00:00Z"), "IN_PROGRESS", now)).toBe(false);
  });

  it("is overdue one millisecond after the deadline", () => {
    expect(isOverdue(new Date("2026-08-20T11:59:59.999Z"), "NOT_STARTED", now)).toBe(true);
  });

  it("is never overdue once the task is complete, even if finished late", () => {
    expect(isOverdue(new Date("2026-01-01T00:00:00Z"), "COMPLETED", now)).toBe(false);
  });

  it("is not overdue before the deadline", () => {
    expect(isOverdue(new Date("2026-09-30T00:00:00Z"), "BLOCKED", now)).toBe(false);
  });

  it("is not overdue when it is due later today", () => {
    // The rule is a moment, not a day: a task due at 5pm is not late at noon.
    expect(isOverdue(new Date("2026-08-20T17:00:00Z"), "NOT_STARTED", now)).toBe(false);
    expect(isOverdue(new Date("2026-08-20T23:59:59.999Z"), "IN_PROGRESS", now)).toBe(false);
  });

  it("is overdue for something due earlier today", () => {
    expect(isOverdue(new Date("2026-08-20T09:00:00Z"), "IN_PROGRESS", now)).toBe(true);
  });

  it("is overdue whatever the open status says, including awaiting review", () => {
    const yesterday = new Date("2026-08-19T12:00:00Z");
    for (const status of ["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "AWAITING_REVIEW"] as const) {
      expect({ status, overdue: isOverdue(yesterday, status, now) }).toEqual({ status, overdue: true });
    }
  });
});

describe("canCompleteDisciplineTask", () => {
  it("allows completion when nothing is outstanding", () => {
    expect(
      canCompleteDisciplineTask({
        requiredDocs: [{ isMandatory: true, documentId: "doc1" }],
        unmetDependencies: [],
      }),
    ).toEqual({ ok: true, blockers: [] });
  });

  it("blocks on a missing mandatory document and says so in plain English", () => {
    const result = canCompleteDisciplineTask({
      requiredDocs: [{ isMandatory: true, documentId: null }],
      unmetDependencies: [],
    });
    expect(result.ok).toBe(false);
    expect(result.blockers).toEqual(["1 required document is still missing."]);
  });

  it("counts several missing documents in one message", () => {
    const result = canCompleteDisciplineTask({
      requiredDocs: [
        { isMandatory: true, documentId: null },
        { isMandatory: true, documentId: null },
        { isMandatory: false, documentId: null },
      ],
      unmetDependencies: [],
    });
    expect(result.blockers).toEqual(["2 required documents are still missing."]);
  });

  it("ignores optional documents that have not been uploaded", () => {
    expect(
      canCompleteDisciplineTask({
        requiredDocs: [{ isMandatory: false, documentId: null }],
        unmetDependencies: [],
      }).ok,
    ).toBe(true);
  });

  it("blocks while an earlier task is still open and names it", () => {
    const result = canCompleteDisciplineTask({
      requiredDocs: [],
      unmetDependencies: ["Piping layout sign-off"],
    });
    expect(result.ok).toBe(false);
    expect(result.blockers).toEqual(["Waiting on 1 earlier task: Piping layout sign-off."]);
  });

  it("names the missing required documents, not just how many there are", () => {
    const result = canCompleteDisciplineTask({
      requiredDocs: [
        { isMandatory: true, documentId: null, name: "Mechanical review checklist" },
        { isMandatory: true, documentId: null, name: "Marked-up drawing" },
        { isMandatory: true, documentId: "doc1", name: "Equipment register" },
      ],
      unmetDependencies: [],
    });
    expect(result.ok).toBe(false);
    expect(result.blockers).toEqual([
      "2 required documents are still missing: Mechanical review checklist, Marked-up drawing.",
    ]);
  });

  it("lists every blocker at once", () => {
    const result = canCompleteDisciplineTask({
      requiredDocs: [{ isMandatory: true, documentId: null }],
      unmetDependencies: ["Cable schedule", "Loop drawings"],
    });
    expect(result.ok).toBe(false);
    expect(result.blockers).toHaveLength(2);
    expect(result.blockers[1]).toContain("Cable schedule, Loop drawings");
  });
});

describe("wouldCreateCycle", () => {
  it("rejects a task depending on itself", () => {
    expect(wouldCreateCycle([], ["a", "a"])).toBe(true);
  });

  it("allows a straight chain", () => {
    expect(wouldCreateCycle([["a", "b"]], ["b", "c"])).toBe(false);
  });

  it("spots a direct loop back", () => {
    expect(wouldCreateCycle([["a", "b"]], ["b", "a"])).toBe(true);
  });

  it("spots a loop several steps away", () => {
    const edges: [string, string][] = [
      ["a", "b"],
      ["b", "c"],
      ["c", "d"],
    ];
    expect(wouldCreateCycle(edges, ["d", "a"])).toBe(true);
    expect(wouldCreateCycle(edges, ["d", "e"])).toBe(false);
  });

  it("allows two branches that join without looping", () => {
    const edges: [string, string][] = [
      ["a", "b"],
      ["a", "c"],
    ];
    expect(wouldCreateCycle(edges, ["b", "d"])).toBe(false);
    expect(wouldCreateCycle(edges, ["c", "d"])).toBe(false);
  });
});
