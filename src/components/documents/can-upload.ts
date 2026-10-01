// Who sees "New revision" on a document row. This mirrors assertCanUploadTo() on the server (a
// manager; a discipline lead on the project; the assignee of the document's own discipline task;
// for a shared main-task document, anyone assigned to one of that main task's discipline tasks —
// but never a contractor). It is a courtesy so nobody is offered a button the server would refuse;
// the server still checks every upload.

import {
  isExternalUser,
  isLeadOrAboveOn,
  isManagerOn,
  type MeDTO,
} from "@/components/hooks/use-api";
import type { DocumentDTO, ProjectDTO } from "@/lib/zod-schemas";

/** Just what the check needs from a main task's discipline summary. */
export type AssignedWork = { disciplineTaskId: string; assigneeId?: string | null };

export function canUploadRevisionTo(
  me: MeDTO | undefined,
  project: ProjectDTO | undefined,
  document: Pick<DocumentDTO, "disciplineTaskId">,
  /** The discipline tasks of the main task the document belongs to. */
  siblings: AssignedWork[],
): boolean {
  if (!me) return false;
  if (isManagerOn(me, project)) return true;

  if (document.disciplineTaskId) {
    if (!isExternalUser(me) && isLeadOrAboveOn(me, project)) return true;
    return siblings.some(
      (item) => item.disciplineTaskId === document.disciplineTaskId && item.assigneeId === me.id,
    );
  }

  // A shared main-task document: the company's register, closed to contractors.
  if (isExternalUser(me)) return false;
  if (isLeadOrAboveOn(me, project)) return true;
  return siblings.some((item) => item.assigneeId === me.id);
}
