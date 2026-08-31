// Admin → Data & privacy → Delete this workspace, and the sweep that finally carries it out.
//
// The shape of the promise:
//
//  - **Asking is reversible for seven days.** `Organization.deleteRequestedAt` and
//    `deleteRequestedById` are the whole record; the deadline itself is never stored, it is that
//    moment plus the grace period worked out at read time, exactly as OVERDUE and a locked phase
//    are. Any administrator of the company can call it off, from the danger card or from the banner
//    that follows them around every page while it is pending.
//  - **Nothing is locked during the grace period.** The workspace goes on working exactly as it
//    did: people finish their tasks, upload their documents and write their comments. That is
//    deliberate. Every administrator was notified the moment it was asked for and any of them can
//    cancel with one press, so a lockout would only punish the people who had no say in it — and a
//    week of half-usable software is a worse answer than a week of honest warning.
//  - **Then it is gone for good.** The hourly sweep deletes every row of that company and every
//    file it ever uploaded. There is no undo, no archive and no soft delete: the seven days ARE the
//    undo, which is what the screens, the privacy page and GO-LIVE all say.
//
// Two things about the hard delete are worth reading before changing it:
//
//  1. **The order is not decoration.** Deleting the `Organization` row alone does NOT work.
//     Organization cascades to User, Discipline, Project, OrgIntegration, MicrosoftConnection and
//     Post — but those cascades then run straight into foreign keys that RESTRICT: `Project`,
//     `MainTask`, `Document`, `DocumentVersion`, `Comment`, `Notification`, `ProjectMember` and
//     `Post` all point at a `User` that may not be deleted while they exist (Prisma's default for a
//     required relation), `MainTask.phaseId` restricts a phase, and `Post.documentId` restricts a
//     document. So every dependent table is emptied by hand, in reverse-dependency order, inside
//     ONE transaction — either the whole company goes or none of it does.
//  2. **The audit trail goes with it.** GO-LIVE promises an append-only trail *within a living
//     workspace*; it was never a promise to keep one company's history after that company has asked
//     for all of it to be deleted. Deleting the workspace deletes its activity log with everything
//     else, and both the danger card and the privacy page say so in plain words.
//
// Files are dealt with outside the transaction: the names are collected before it, and the bytes
// are removed after it commits. A file that will not delete is logged and left — an orphan on disk
// costs disk space, never correctness, and no database row points at it any more.

import { rm } from "node:fs/promises";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { assertCan } from "@/lib/permissions";
import { storedFilePath } from "@/lib/upload";
import type { RequestWorkspaceDeletionInput, WorkspaceDeletionDTO } from "@/lib/zod-schemas";
import { WorkspaceDeletionDTO as WorkspaceDeletionSchema } from "@/lib/zod-schemas";
import type { ActorContext } from "@/server/actor";
import { NotFoundError, ServiceError } from "@/server/errors";
import { checkDto } from "@/server/serialize";
import { ACTIVITY, appendActivity } from "@/server/services/activity";
import { notify } from "@/server/services/notify";
import { exportFilePath } from "@/server/services/workspace-export";

/** How long an administrator has to change their mind. The one number the whole feature turns on. */
export const WORKSPACE_DELETION_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** How many rows are named in one delete statement's worth of file names. */
const FILE_BATCH = 500;

const NAME_MISMATCH =
  "That doesn't match your workspace's name. Type it exactly as it is shown, then try again.";

const ALREADY_PENDING =
  "This workspace is already scheduled for deletion. Cancel that first if you want to start again.";

const NOT_PENDING = "This workspace isn't scheduled for deletion.";

/* ------------------------------------------------------------------ */
/* Reading the state                                                   */
/* ------------------------------------------------------------------ */

type OrgRow = {
  id: string;
  name: string;
  deleteRequestedAt: Date | null;
  deleteRequestedBy: { name: string } | null;
};

const ORG_SELECT = {
  id: true,
  name: true,
  deleteRequestedAt: true,
  deleteRequestedBy: { select: { name: true } },
} as const;

/** The moment a request becomes permanent. Derived, never stored. */
export function deletionDeadline(requestedAt: Date): Date {
  return new Date(requestedAt.getTime() + WORKSPACE_DELETION_GRACE_MS);
}

function toDTO(org: OrgRow, now: Date): WorkspaceDeletionDTO {
  if (!org.deleteRequestedAt) {
    return {
      workspaceName: org.name,
      pending: false,
      requestedAt: null,
      requestedByName: null,
      deletesOn: null,
      daysLeft: null,
    };
  }

  const deletesOn = deletionDeadline(org.deleteRequestedAt);
  return {
    workspaceName: org.name,
    pending: true,
    requestedAt: org.deleteRequestedAt,
    // Almost always a real name. Somebody who has deleted their own account since asking reads as
    // "Former member" here, exactly as they do everywhere else — deleting an account anonymises it
    // rather than removing the row. Null is only the SetNull belt-and-braces case, and the card
    // falls back to "an administrator" rather than inventing a name.
    requestedByName: org.deleteRequestedBy?.name ?? null,
    deletesOn,
    daysLeft: Math.max(0, Math.ceil((deletesOn.getTime() - now.getTime()) / DAY_MS)),
  };
}

async function loadOrg(orgId: string): Promise<OrgRow> {
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: ORG_SELECT });
  if (!org) throw new NotFoundError("We could not find that workspace.");
  return org;
}

/** The danger card's state. ADMIN of their OWN company, like everything else on this screen. */
export async function workspaceDeletionStatus(
  actor: ActorContext,
  now: Date = new Date(),
): Promise<WorkspaceDeletionDTO> {
  assertCan(actor, "DELETE_ORG");
  return checkDto(WorkspaceDeletionSchema, toDTO(await loadOrg(actor.orgId), now), "WorkspaceDeletionDTO");
}

/**
 * What the app-wide banner reads, once per page load.
 *
 * Administrators only — deliberately. Everybody in the company is affected, but only an
 * administrator has a button to press here, and a countdown to permanent data loss that the reader
 * can do nothing about is anxiety rather than information. Null means "draw no banner", which is
 * also the answer for everybody who is not an administrator.
 */
export async function pendingWorkspaceDeletion(
  user: { orgId: string; role: string },
  now: Date = new Date(),
): Promise<WorkspaceDeletionDTO | null> {
  if (user.role !== "ADMIN") return null;

  const org = await prisma.organization.findUnique({
    where: { id: user.orgId },
    select: ORG_SELECT,
  });
  if (!org?.deleteRequestedAt) return null;
  return toDTO(org, now);
}

/* ------------------------------------------------------------------ */
/* Asking, and calling it off                                          */
/* ------------------------------------------------------------------ */

/** Every administrator of a company who can still sign in — the audience for both messages. */
async function adminIdsOf(orgId: string): Promise<string[]> {
  const admins = await prisma.user.findMany({
    where: { orgId, role: "ADMIN", isActive: true },
    select: { id: true },
  });
  return admins.map((admin) => admin.id);
}

/**
 * Tells the company's other administrators. In-app only, on purpose.
 *
 * `ANNOUNCEMENT` is the closest type in shape — company-wide news, not one person's task — but the
 * chat copy is switched off with `{ chatCopy: false }`: the `announcements` toggle means "somebody
 * posted on the noticeboard", and a countdown to the company's data being deleted is not that. The
 * banner every administrator now sees on every page is the loud half of this; the notification is
 * the one that survives being missed. Never awaited by the caller's transaction — it runs after the
 * commit, exactly as every other fan-out in this app does.
 */
async function tellTheAdmins(
  actor: ActorContext,
  title: string,
  body: string,
): Promise<void> {
  const recipients = await adminIdsOf(actor.orgId);
  await notify(
    actor,
    recipients,
    "ANNOUNCEMENT",
    { title, body, linkUrl: "/admin/data-privacy" },
    { chatCopy: false },
  );
}

/**
 * Schedules the whole workspace for deletion, seven days from now.
 *
 * The typed confirmation is checked here rather than only in the browser: the name has to be typed
 * exactly, trimmed of surrounding spaces and nothing else. It is compared against the company's own
 * name, read from the row, so there is nothing a request body could substitute.
 */
export async function requestWorkspaceDeletion(
  actor: ActorContext,
  input: RequestWorkspaceDeletionInput,
  now: Date = new Date(),
): Promise<WorkspaceDeletionDTO> {
  assertCan(actor, "DELETE_ORG");

  const org = await loadOrg(actor.orgId);
  if (org.deleteRequestedAt) throw new ServiceError(ALREADY_PENDING);
  if (input.confirmName.trim() !== org.name.trim()) {
    throw new ServiceError(NAME_MISMATCH, { confirmName: [NAME_MISMATCH] });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.organization.update({
      where: { id: org.id },
      data: { deleteRequestedAt: now, deleteRequestedById: actor.userId },
      select: ORG_SELECT,
    });

    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: null,
      entityType: "Organization",
      entityId: org.id,
      action: ACTIVITY.WORKSPACE_DELETION_REQUESTED,
      summary: `${actor.name} asked for this workspace to be deleted`,
      metadata: { deletesOn: deletionDeadline(now).toISOString() },
    });

    return row;
  });

  const dto = toDTO(updated, now);
  await tellTheAdmins(
    actor,
    "This workspace is scheduled for deletion",
    `${actor.name} asked for ${org.name} to be deleted. Everything goes for good in ${dto.daysLeft} days unless an administrator cancels it.`,
  );

  return checkDto(WorkspaceDeletionSchema, dto, "WorkspaceDeletionDTO");
}

/**
 * Calls it off. Any administrator of the company, not only the one who asked, and no typed
 * confirmation at all: undoing a dangerous thing should be the easiest press on the screen.
 */
export async function cancelWorkspaceDeletion(
  actor: ActorContext,
  now: Date = new Date(),
): Promise<WorkspaceDeletionDTO> {
  assertCan(actor, "DELETE_ORG");

  const org = await loadOrg(actor.orgId);
  if (!org.deleteRequestedAt) throw new ServiceError(NOT_PENDING);

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.organization.update({
      where: { id: org.id },
      data: { deleteRequestedAt: null, deleteRequestedById: null },
      select: ORG_SELECT,
    });

    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: null,
      entityType: "Organization",
      entityId: org.id,
      action: ACTIVITY.WORKSPACE_DELETION_CANCELLED,
      summary: `${actor.name} cancelled the deletion of this workspace`,
      metadata: {},
    });

    return row;
  });

  await tellTheAdmins(
    actor,
    "The workspace deletion was cancelled",
    `${actor.name} cancelled the request to delete ${org.name}. Nothing has been removed.`,
  );

  return checkDto(WorkspaceDeletionSchema, toDTO(updated, now), "WorkspaceDeletionDTO");
}

/* ------------------------------------------------------------------ */
/* The hard delete                                                     */
/* ------------------------------------------------------------------ */

/** What one deleted workspace left behind on disk, plus the counts for the log line. */
export type DeletedWorkspace = {
  orgId: string;
  rows: number;
  users: number;
  projects: number;
  /** Absolute paths, collected before the transaction and removed after it commits. */
  files: string[];
};

/** Every uploaded file belonging to one company's document revisions, by absolute path. */
async function uploadedFilesOf(tx: Prisma.TransactionClient, orgId: string): Promise<string[]> {
  const paths: string[] = [];
  let cursor: string | null = null;

  for (;;) {
    const rows: { id: string; storedFilename: string }[] = await tx.documentVersion.findMany({
      where: { document: { project: { orgId } } },
      select: { id: true, storedFilename: true },
      orderBy: { id: "asc" },
      take: FILE_BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) break;
    for (const row of rows) paths.push(storedFilePath(row.storedFilename));
    if (rows.length < FILE_BATCH) break;
    cursor = rows[rows.length - 1]!.id;
  }

  return paths;
}

/** Every export archive this company has ever had built, by absolute path. */
async function exportArchivesOf(tx: Prisma.TransactionClient, orgId: string): Promise<string[]> {
  // The archive is named after the id of its own EXPORT_STARTED row — which is exactly why those
  // rows have to be read BEFORE the activity log is emptied.
  const rows = await tx.activityLog.findMany({
    where: { entityType: "Organization", entityId: orgId, action: ACTIVITY.EXPORT_STARTED },
    select: { id: true },
  });
  return rows.map((row) => exportFilePath(row.id));
}

/**
 * Empties one company, table by table, in reverse-dependency order. Runs inside the caller's
 * transaction: every table here or none of them.
 *
 * Read the file header before reordering anything — the order is what keeps the RESTRICT foreign
 * keys satisfied, and getting it wrong fails loudly rather than quietly, which is the one mercy.
 */
async function deleteEveryRow(
  tx: Prisma.TransactionClient,
  orgId: string,
): Promise<{ rows: number; users: number; projects: number }> {
  const ofOrg = { project: { orgId } };
  let rows: number = 0;
  const count = (result: { count: number }): number => {
    rows += result.count;
    return result.count;
  };

  // The noticeboard first: a post RESTRICTS the document it points at and the person who wrote it.
  count(await tx.postAck.deleteMany({ where: { post: { orgId } } }));
  count(await tx.postDismissal.deleteMany({ where: { post: { orgId } } }));
  count(await tx.post.deleteMany({ where: { orgId } }));

  // Notifications restrict their recipient; the activity log does not, but it goes with the company
  // it belongs to all the same (see the file header).
  count(await tx.notification.deleteMany({ where: { user: { orgId } } }));
  count(
    await tx.activityLog.deleteMany({
      where: { OR: [{ project: { orgId } }, { actor: { orgId } }] },
    }),
  );

  // Comments restrict their author; required documents restrict their discipline task.
  count(
    await tx.comment.deleteMany({
      where: { OR: [{ mainTask: ofOrg }, { disciplineTask: { mainTask: ofOrg } }] },
    }),
  );
  count(await tx.requiredDocument.deleteMany({ where: { disciplineTask: { mainTask: ofOrg } } }));

  // Documents and their revisions, before the tasks and the people they both restrict.
  count(await tx.documentVersion.deleteMany({ where: { document: ofOrg } }));
  count(await tx.document.deleteMany({ where: ofOrg }));

  // The work itself, from the leaves up: dependencies, discipline tasks, main tasks, phases.
  count(
    await tx.taskDependency.deleteMany({
      where: {
        OR: [{ predecessor: { mainTask: ofOrg } }, { successor: { mainTask: ofOrg } }],
      },
    }),
  );
  count(await tx.disciplineTask.deleteMany({ where: { mainTask: ofOrg } }));
  // MainTask.phaseId is Restrict, so the tasks go before the phases they sit behind.
  count(await tx.mainTask.deleteMany({ where: ofOrg }));
  count(await tx.projectPhase.deleteMany({ where: ofOrg }));

  // The project's people and departments.
  count(await tx.projectMember.deleteMany({ where: ofOrg }));
  count(await tx.projectDiscipline.deleteMany({ where: ofOrg }));

  // Personal rows, and every key into an account.
  count(await tx.favorite.deleteMany({ where: { user: { orgId } } }));
  count(await tx.personalTask.deleteMany({ where: { user: { orgId } } }));
  count(await tx.emailToken.deleteMany({ where: { user: { orgId } } }));
  count(await tx.session.deleteMany({ where: { user: { orgId } } }));

  // Project.createdById restricts a User, so projects go before people.
  const projects = count(await tx.project.deleteMany({ where: { orgId } }));
  count(await tx.discipline.deleteMany({ where: { orgId } }));
  count(await tx.orgIntegration.deleteMany({ where: { orgId } }));
  count(await tx.microsoftConnection.deleteMany({ where: { orgId } }));
  const users = count(await tx.user.deleteMany({ where: { orgId } }));

  await tx.organization.delete({ where: { id: orgId } });
  rows += 1;

  return { rows, users, projects };
}

/**
 * Deletes every workspace whose seven days have run out.
 *
 * Called from `runSweepOnce()` **inside its advisory-locked transaction**, so however many copies
 * of the app are running, exactly one of them can be deleting a company at any moment. The file
 * paths it returns are removed by the caller once that transaction has committed — never before,
 * because a transaction that rolls back must not have taken anybody's documents with it.
 */
export async function sweepWorkspaceDeletions(
  tx: Prisma.TransactionClient,
  now: Date = new Date(),
): Promise<DeletedWorkspace[]> {
  const due = await tx.organization.findMany({
    where: { deleteRequestedAt: { lte: new Date(now.getTime() - WORKSPACE_DELETION_GRACE_MS) } },
    select: { id: true },
  });
  if (due.length === 0) return [];

  const deleted: DeletedWorkspace[] = [];

  for (const org of due) {
    // Both lists are read BEFORE anything is deleted: the uploads are named on rows that are about
    // to go, and an archive is named after an audit row that is about to go with them.
    const files = [...(await uploadedFilesOf(tx, org.id)), ...(await exportArchivesOf(tx, org.id))];
    const counts = await deleteEveryRow(tx, org.id);
    deleted.push({ orgId: org.id, files, ...counts });
  }

  return deleted;
}

/**
 * Removes the files of the workspaces the sweep just deleted. Call it AFTER the transaction has
 * committed. Never throws: a file that will not delete is logged and left behind, because no row
 * points at it any more and an orphan costs disk space rather than correctness.
 */
export async function removeDeletedWorkspaceFiles(deleted: DeletedWorkspace[]): Promise<void> {
  for (const workspace of deleted) {
    let removed = 0;
    let failed = 0;

    for (const file of workspace.files) {
      try {
        await rm(file, { force: true });
        removed += 1;
      } catch {
        failed += 1;
      }
    }

    // Counts and the company id, never a name, an address or a file name — the same discretion
    // every other line about an export or an upload keeps.
    logger.info("A workspace was deleted", {
      orgId: workspace.orgId,
      rows: workspace.rows,
      users: workspace.users,
      projects: workspace.projects,
      filesRemoved: removed,
      filesLeftBehind: failed,
    });
  }
}
