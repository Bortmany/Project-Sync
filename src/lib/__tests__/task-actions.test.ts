// The action bar's two halves, proved together: what the "Change status" dropdown lists, and what
// the dominant button says and whether it may be pressed.
//
// The rule being kept honest here is the contractor's ONE road to a sign-off. A contractor on a
// sign-off project hands work in with the button — which records the submission and tells the lead
// — so "Awaiting review" is not also offered as a raw status they can set by hand. The server keeps
// the other end of the same promise (updateDisciplineTaskStatus treats a contractor's direct move
// to AWAITING_REVIEW as a submission), so neither door skips the notification.

import { describe, expect, it } from "vitest";
import {
  completeButtonFor,
  statusChoicesFor,
  submitsForSignoff,
  type TaskActionContext,
} from "@/lib/task-actions";

function context(overrides: Partial<TaskActionContext> = {}): TaskActionContext {
  return {
    isExternal: false,
    signoffRequired: true,
    status: "IN_PROGRESS",
    canComplete: true,
    ...overrides,
  };
}

describe("a colleague's action bar is unchanged", () => {
  it("offers every open status, including awaiting review", () => {
    expect(statusChoicesFor(context())).toEqual([
      "NOT_STARTED",
      "IN_PROGRESS",
      "BLOCKED",
      "AWAITING_REVIEW",
    ]);
  });

  it("adds completed to the list only once the task is complete", () => {
    expect(statusChoicesFor(context({ status: "COMPLETED" }))).toContain("COMPLETED");
    expect(statusChoicesFor(context({ status: "IN_PROGRESS" }))).not.toContain("COMPLETED");
  });

  it("marks complete, and the completion gate decides whether the button may be pressed", () => {
    expect(completeButtonFor(context())).toEqual({ label: "Mark complete", disabled: false });
    expect(completeButtonFor(context({ canComplete: false }))).toEqual({
      label: "Mark complete",
      disabled: true,
    });
  });
});

describe("a contractor on a project that asks for a sign-off", () => {
  const contractor = (overrides: Partial<TaskActionContext> = {}) =>
    context({ isExternal: true, ...overrides });

  it("is not offered awaiting review as a status to set by hand", () => {
    expect(statusChoicesFor(contractor())).toEqual(["NOT_STARTED", "IN_PROGRESS", "BLOCKED"]);
  });

  it("still sees awaiting review while the work is sitting there, so the dropdown tells the truth", () => {
    expect(statusChoicesFor(contractor({ status: "AWAITING_REVIEW" }))).toEqual([
      "NOT_STARTED",
      "IN_PROGRESS",
      "BLOCKED",
      "AWAITING_REVIEW",
    ]);
  });

  it("submits for sign-off, and may always press it — the gate runs at the lead's confirmation", () => {
    expect(submitsForSignoff(contractor())).toBe(true);
    expect(completeButtonFor(contractor({ canComplete: false }))).toEqual({
      label: "Submit for sign-off",
      disabled: false,
    });
  });
});

describe("a contractor on a project with the sign-off switched off", () => {
  const contractor = (overrides: Partial<TaskActionContext> = {}) =>
    context({ isExternal: true, signoffRequired: false, ...overrides });

  it("completes exactly as a colleague does, gate included", () => {
    expect(submitsForSignoff(contractor())).toBe(false);
    expect(statusChoicesFor(contractor())).toContain("AWAITING_REVIEW");
    expect(completeButtonFor(contractor({ canComplete: false }))).toEqual({
      label: "Mark complete",
      disabled: true,
    });
  });
});
