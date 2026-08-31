// What the discipline-task screen offers on a piece of work: which statuses its dropdown lists, and
// what its one dominant button says and whether it may be pressed.
//
// Pure and shared so the two halves of the action bar can never disagree with each other. It is a
// courtesy, never the check itself — the server judges every transition again (updateDisciplineTaskStatus
// and completeDisciplineTask in src/server/services/tasks.ts), and the real completion gate runs when
// somebody inside the company confirms a contractor's sign-off.

import type { TaskStatusName } from "@/lib/zod-schemas";

/** Everything the two decisions below need to know about the person and the task. */
export type TaskActionContext = {
  /** The signed-in person is an external contractor. */
  isExternal: boolean;
  /** This project asks for a sign-off on contractor work (Project.externalSignoffRequired). */
  signoffRequired: boolean;
  status: TaskStatusName;
  /** The completion gate's answer: mandatory documents in, dependencies closed. */
  canComplete: boolean;
};

const OPEN_STATUSES: TaskStatusName[] = ["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "AWAITING_REVIEW"];

/** True when this person hands work in for a sign-off rather than completing it themselves. */
export function submitsForSignoff(context: TaskActionContext): boolean {
  return context.isExternal && context.signoffRequired;
}

/**
 * The statuses the "Change status" dropdown lists.
 *
 * A contractor on a sign-off project does not get "Awaiting review" as a status to pick: handing
 * work in is the Submit button, which records the submission and tells the lead. The status stays
 * in the list when the task is already sitting there, so the dropdown always shows where the work is.
 */
export function statusChoicesFor(context: TaskActionContext): TaskStatusName[] {
  const choices = OPEN_STATUSES.filter(
    (status) =>
      status !== "AWAITING_REVIEW" || !submitsForSignoff(context) || context.status === status,
  );
  return context.status === "COMPLETED" ? [...choices, "COMPLETED"] : choices;
}

/**
 * The dominant button on the action bar.
 *
 * For a colleague this is "Mark complete", and the completion gate decides whether it may be
 * pressed. For a contractor on a sign-off project it is "Submit for sign-off", and it is always
 * pressable: submitting is a request, and the gate is judged at the lead's confirmation, where the
 * person who can actually do something about a missing document sees it.
 */
export function completeButtonFor(context: TaskActionContext): {
  label: string;
  disabled: boolean;
} {
  if (submitsForSignoff(context)) return { label: "Submit for sign-off", disabled: false };
  return { label: "Mark complete", disabled: !context.canComplete };
}
