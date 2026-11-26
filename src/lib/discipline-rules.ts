// Who must carry a discipline on their account — one rule, read by Admin → Users and by the server.
//
// Leads and engineers always work inside one discipline. So does an external contractor: THE
// EXTERNAL RULE gives them only the discipline tasks assigned to them, and a project only lets them
// join in their own discipline (the Team tab and `upsertMember`), so a contractor with no discipline
// could never be added to any project. The account form therefore asks for it up front.
//
// Contractors created before this rule may have none. They keep working exactly as before: saving
// their account without choosing one is still accepted (so extending somebody's access date never
// turns into a new chore), and the Team tab points an administrator at the fix when it matters.
// What can no longer happen is a NEW gap — a new contractor without one, somebody becoming a
// contractor without one, or a contractor's discipline being cleared.

import type { RoleName } from "@/lib/zod-schemas";

/** The roles whose work always belongs to one discipline. */
export const DISCIPLINE_ROLES: RoleName[] = ["DISCIPLINE_LEAD", "ENGINEER", "EXTERNAL"];

export const DISCIPLINE_REQUIRED_MESSAGE = "Choose a discipline for a discipline lead or an engineer.";
export const CONTRACTOR_DISCIPLINE_MESSAGE =
  "Choose the contractor's discipline. They can only join a project in their own discipline.";

/** The account as it stands before an edit; absent when the account is being created. */
export type DisciplineBefore = { role: RoleName; disciplineId: string | null };

/**
 * True for a contractor saved before the rule who still has no discipline, and is not being given
 * one now. Their account may be saved as it is.
 */
export function isLegacyContractorWithoutDiscipline(
  role: RoleName,
  before: DisciplineBefore | undefined,
): boolean {
  return role === "EXTERNAL" && before?.role === "EXTERNAL" && before.disciplineId === null;
}

/**
 * The problem with this choice, in plain words, or null when it is fine. Shared by the form (to
 * disable the button and explain why) and the server (which refuses it whatever the form did).
 */
export function disciplineProblem(
  role: RoleName,
  disciplineId: string | null | undefined,
  before?: DisciplineBefore,
): string | null {
  if (disciplineId) return null;
  if (!DISCIPLINE_ROLES.includes(role)) return null;
  if (role !== "EXTERNAL") return DISCIPLINE_REQUIRED_MESSAGE;
  return isLegacyContractorWithoutDiscipline(role, before) ? null : CONTRACTOR_DISCIPLINE_MESSAGE;
}

/** The hint under the Discipline box, per role. */
export function disciplineHint(role: RoleName, before?: DisciplineBefore): string {
  if (role === "EXTERNAL") {
    return isLegacyContractorWithoutDiscipline(role, before)
      ? "Needed before they can join a project. Choose one now."
      : "Required for contractors — they join projects in their own discipline.";
  }
  return role === "DISCIPLINE_LEAD" || role === "ENGINEER"
    ? "Required for leads and engineers."
    : "Not needed for this role.";
}
