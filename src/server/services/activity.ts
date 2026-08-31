// The audit trail. Rows are only ever inserted — nothing here updates or deletes one (the golden rule).

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { ActivityItemDTO } from "@/lib/zod-schemas";
import { ActivityItemDTO as ActivityItemSchema } from "@/lib/zod-schemas";
import { checkDtoList } from "@/server/serialize";

/** The vocabulary of audit actions. Keep new entries short, upper case and past tense. */
export const ACTIVITY = {
  ORG_CREATED: "ORG_CREATED",
  PROJECT_CREATED: "PROJECT_CREATED",
  PROJECT_UPDATED: "PROJECT_UPDATED",
  MEMBER_ADDED: "MEMBER_ADDED",
  MEMBER_UPDATED: "MEMBER_UPDATED",
  MEMBER_REMOVED: "MEMBER_REMOVED",
  DISCIPLINE_ENABLED: "DISCIPLINE_ENABLED",
  DISCIPLINE_LEAD_CHANGED: "DISCIPLINE_LEAD_CHANGED",
  DISCIPLINE_REMOVED: "DISCIPLINE_REMOVED",
  MAIN_TASK_CREATED: "MAIN_TASK_CREATED",
  MAIN_TASK_UPDATED: "MAIN_TASK_UPDATED",
  MAIN_TASK_PHASE_CHANGED: "MAIN_TASK_PHASE_CHANGED",
  PHASE_CREATED: "PHASE_CREATED",
  PHASE_RENAMED: "PHASE_RENAMED",
  PHASES_REORDERED: "PHASES_REORDERED",
  PHASE_DELETED: "PHASE_DELETED",
  /** The recorded, authorised way past a stage gate — the phase-level twin of OVERRIDE_APPLIED. */
  PHASE_OVERRIDE_APPLIED: "PHASE_OVERRIDE_APPLIED",
  OVERRIDE_APPLIED: "OVERRIDE_APPLIED",
  OVERRIDE_CLEARED: "OVERRIDE_CLEARED",
  TASK_CREATED: "TASK_CREATED",
  TASK_UPDATED: "TASK_UPDATED",
  ASSIGNED: "ASSIGNED",
  STATUS_CHANGED: "STATUS_CHANGED",
  COMPLETED: "COMPLETED",
  REOPENED: "REOPENED",
  /** A contractor handed work in for an internal sign-off — a request, never a completion. */
  SUBMITTED_FOR_REVIEW: "SUBMITTED_FOR_REVIEW",
  /** The reviewer sent it back, with what needs changing. A confirmation is a plain COMPLETED row. */
  REVIEW_REJECTED: "REVIEW_REJECTED",
  DEPENDENCY_ADDED: "DEPENDENCY_ADDED",
  DEPENDENCY_REMOVED: "DEPENDENCY_REMOVED",
  DATES_UPDATED: "DATES_UPDATED",
  COMMENT_ADDED: "COMMENT_ADDED",
  COMMENT_EDITED: "COMMENT_EDITED",
  COMMENT_DELETED: "COMMENT_DELETED",
  DOCUMENT_UPLOADED: "DOCUMENT_UPLOADED",
  DOCUMENT_DELETED: "DOCUMENT_DELETED",
  USER_CREATED: "USER_CREATED",
  USER_UPDATED: "USER_UPDATED",
  USER_DEACTIVATED: "USER_DEACTIVATED",
  USER_REACTIVATED: "USER_REACTIVATED",
  DISCIPLINE_CREATED: "DISCIPLINE_CREATED",
  DISCIPLINE_UPDATED: "DISCIPLINE_UPDATED",
  // Chat integrations. None of these rows ever carries the webhook address — kind and switches only.
  INTEGRATION_CONNECTED: "INTEGRATION_CONNECTED",
  INTEGRATION_UPDATED: "INTEGRATION_UPDATED",
  INTEGRATION_ENABLED: "INTEGRATION_ENABLED",
  INTEGRATION_DISABLED: "INTEGRATION_DISABLED",
  INTEGRATION_EVENTS_CHANGED: "INTEGRATION_EVENTS_CHANGED",
  INTEGRATION_TEST_SENT: "INTEGRATION_TEST_SENT",
  INTEGRATION_REMOVED: "INTEGRATION_REMOVED",
  // Microsoft 365 files. These rows carry the tenant id and who connected — never a token.
  MICROSOFT_CONNECTED: "MICROSOFT_CONNECTED",
  MICROSOFT_DISCONNECTED: "MICROSOFT_DISCONNECTED",
  // The noticeboard. A dismissal is deliberately absent: hiding a notice from your own dashboard is
  // personal read state, not company work, so it writes no row here.
  ANNOUNCEMENT_POSTED: "ANNOUNCEMENT_POSTED",
  /**
   * Somebody confirmed they had read an announcement that asked them to. This one IS recorded, and
   * that is the whole difference from a dismissal beside it: hiding a notice is your own business,
   * confirming you read it is an attestation the person who posted it relies on.
   */
  POST_ACKNOWLEDGED: "POST_ACKNOWLEDGED",
  POST_CREATED: "POST_CREATED",
  POST_REPLIED: "POST_REPLIED",
  POST_EDITED: "POST_EDITED",
  POST_DELETED: "POST_DELETED",
  BROADCAST_POLICY_CHANGED: "BROADCAST_POLICY_CHANGED",
  // Transactional email. The row records that the app MEANT to send one — it carries the kind and
  // the recipient's user id, and never the token, the link or the address.
  EMAIL_SENT: "EMAIL_SENT",
  // What somebody did with an emailed link. None of these rows ever carries the token, the link or
  // the password that was chosen — only that the account moved, and when.
  /** A forgotten password was set again from a reset link, and every session was dropped. */
  PASSWORD_RESET: "PASSWORD_RESET",
  /** An invited colleague chose their first password and became a real account. */
  INVITE_ACCEPTED: "INVITE_ACCEPTED",
  /** Somebody proved an address is theirs. A nudge finished, never a permission granted. */
  EMAIL_VERIFIED: "EMAIL_VERIFIED",
} as const;

export type ActivityAction = (typeof ACTIVITY)[keyof typeof ACTIVITY];

export type AppendActivityInput = {
  actorId: string;
  projectId: string | null;
  entityType:
    // The organisation itself — the very first audit row a company ever has, written at signup.
    | "Organization"
    | "Project"
    | "ProjectMember"
    | "ProjectDiscipline"
    | "ProjectPhase"
    | "MainTask"
    | "DisciplineTask"
    | "Document"
    // A noticeboard post carries its project when it has one, and nothing when it is aimed at the
    // whole company or one department.
    | "Post"
    // Admin-section rows carry no project — they are about the organisation, not one project.
    | "User"
    | "Discipline"
    | "OrgIntegration"
    | "MicrosoftConnection"
    // An email the app sent to one person. `entityId` is that person's user id, so the row sits in
    // their history — the address itself is never copied here.
    | "Email";
  entityId: string;
  action: ActivityAction;
  /** Plain English, e.g. "Ahmed al-Balushi marked Electrical review complete". */
  summary: string;
  metadata?: Record<string, unknown>;
};

/**
 * Appends one audit row. Always called with the transaction client of the change it records,
 * so a change and its audit row either both happen or neither does.
 */
export async function appendActivity(
  tx: Prisma.TransactionClient,
  input: AppendActivityInput,
): Promise<void> {
  await tx.activityLog.create({
    data: {
      actorId: input.actorId,
      projectId: input.projectId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      summary: input.summary,
      metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

type ActivityRow = {
  id: string;
  actorId: string | null;
  projectId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  summary: string;
  createdAt: Date;
  actor: { name: string } | null;
};

export function toActivityItemDTO(row: ActivityRow): ActivityItemDTO {
  return {
    id: row.id,
    actorId: row.actorId,
    actorName: row.actor?.name ?? null,
    projectId: row.projectId,
    entityType: row.entityType,
    entityId: row.entityId,
    action: row.action,
    summary: row.summary,
    createdAt: row.createdAt,
  };
}

/** The newest audit rows for a set of projects — used by the dashboard. */
export async function recentActivityForProjects(
  projectIds: string[],
  take = 15,
): Promise<ActivityItemDTO[]> {
  if (projectIds.length === 0) return [];

  const rows = await prisma.activityLog.findMany({
    where: { projectId: { in: projectIds } },
    orderBy: { createdAt: "desc" },
    take,
    include: { actor: { select: { name: true } } },
  });

  return checkDtoList(ActivityItemSchema, rows.map(toActivityItemDTO), "ActivityItemDTO");
}
