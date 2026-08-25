// Comments and the activity feed.
//
// A comment always hangs off exactly one task (a main task or a discipline task), it is always
// written by someone who may comment on that project, and every mentioned person must already be an
// active member of that project. Comments are soft-deleted: the row stays for the audit trail and the
// listing shows it as a tombstone instead of dropping it. Every create, edit and delete appends
// exactly one activity row inside the same transaction as the change itself.

import { notDeleted, prisma } from "@/lib/db";
import { ForbiddenError, assertCan } from "@/lib/permissions";
import type { ActivityItemDTO, CommentDTO, CreateCommentInput } from "@/lib/zod-schemas";
import {
  ActivityItemDTO as ActivityItemSchema,
  CommentDTO as CommentSchema,
} from "@/lib/zod-schemas";
import type { ActorContext } from "@/server/actor";
import { NotFoundError, ServiceError } from "@/server/errors";
import { checkDto } from "@/server/serialize";
import { ACTIVITY, appendActivity, toActivityItemDTO } from "@/server/services/activity";
import { notify } from "@/server/services/notify";
import { assertCanViewProject } from "@/server/services/projects";

/** What a removed comment says in the thread. The original text is never shown again. */
const TOMBSTONE_BODY = "Comment removed";

/**
 * A comment as the thread shows it: the shared CommentDTO plus the one flag the UI needs to render a
 * removed comment as a muted tombstone. The extra field is additive — the row still satisfies
 * CommentDTO, which is checked on every serialize.
 */
export type CommentListItemDTO = CommentDTO & { isDeleted: boolean };

/** Where a comment lives: which task, which project, and what to call it in the audit trail. */
type CommentTarget = {
  projectId: string;
  mainTaskId: string | null;
  disciplineTaskId: string | null;
  /** The main task the comment ultimately sits under — used for links and notifications. */
  parentMainTaskId: string;
  title: string;
  entityType: "MainTask" | "DisciplineTask";
  entityId: string;
  linkUrl: string;
  /** The people who follow this task: its assignee and the main task's owner. */
  followerIds: string[];
};

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/** One task's thread, oldest first, tombstones included. */
export async function listComments(
  actor: ActorContext,
  target: { mainTaskId?: string | null; disciplineTaskId?: string | null },
): Promise<CommentListItemDTO[]> {
  const where = await resolveTarget(target.mainTaskId ?? null, target.disciplineTaskId ?? null);
  await assertCanViewProject(actor, where.projectId);

  // Deliberately not activeComments() from src/lib/db.ts: a removed comment still belongs in the
  // thread as a tombstone, so this listing needs the soft-deleted rows too.
  const rows = await prisma.comment.findMany({
    where: where.mainTaskId
      ? { mainTaskId: where.mainTaskId }
      : { disciplineTaskId: where.disciplineTaskId },
    orderBy: { createdAt: "asc" },
    include: { author: { select: { name: true } } },
  });

  return rows.map(toCommentListItem);
}

/**
 * The audit trail for one task or one project, newest first.
 * A main task's feed rolls up its discipline tasks' entries as well, so the parent page shows
 * everything that happened underneath it.
 */
export async function listActivity(
  actor: ActorContext,
  target: { mainTaskId?: string | null; disciplineTaskId?: string | null; projectId?: string | null },
  options: { limit?: number } = {},
): Promise<ActivityItemDTO[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);

  if (target.projectId) {
    await assertCanViewProject(actor, target.projectId);
    return readActivity({ projectId: target.projectId }, limit);
  }

  if (target.mainTaskId) {
    const mainTask = await prisma.mainTask.findFirst({
      where: { id: target.mainTaskId, ...notDeleted },
      select: { id: true, projectId: true },
    });
    if (!mainTask) throw new NotFoundError("We could not find that task.");
    await assertCanViewProject(actor, mainTask.projectId);

    // Deleted discipline tasks are included on purpose — their history is part of the main task's.
    const subtasks = await prisma.disciplineTask.findMany({
      where: { mainTaskId: mainTask.id },
      select: { id: true },
    });
    return readActivity({ entityId: { in: [mainTask.id, ...subtasks.map((task) => task.id)] } }, limit);
  }

  if (target.disciplineTaskId) {
    const task = await prisma.disciplineTask.findFirst({
      where: { id: target.disciplineTaskId, ...notDeleted },
      select: { id: true, mainTask: { select: { projectId: true } } },
    });
    if (!task) throw new NotFoundError("We could not find that task.");
    await assertCanViewProject(actor, task.mainTask.projectId);
    return readActivity({ entityId: task.id }, limit);
  }

  throw new ServiceError("Tell us which task or project you want the activity for.");
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

/** Posts a comment, records it in the audit trail and tells the people who should know. */
export async function createComment(
  actor: ActorContext,
  input: CreateCommentInput,
): Promise<CommentDTO> {
  const target = await resolveTarget(input.mainTaskId ?? null, input.disciplineTaskId ?? null);
  assertCan(actor, "COMMENT", { projectId: target.projectId });

  const body = input.body.trim();
  if (body.length === 0) throw new ServiceError("Write something first.");

  const mentions = [...new Set(input.mentions ?? [])];
  await assertMentionsAreMembers(target.projectId, mentions);

  const commentId = await prisma.$transaction(async (tx) => {
    const comment = await tx.comment.create({
      data: {
        body,
        authorId: actor.userId,
        mainTaskId: target.mainTaskId,
        disciplineTaskId: target.disciplineTaskId,
        mentions,
      },
    });

    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: target.projectId,
      entityType: target.entityType,
      entityId: target.entityId,
      action: ACTIVITY.COMMENT_ADDED,
      summary: `${actor.name} commented on "${target.title}"`,
      metadata: { commentId: comment.id, mentions: mentions.length },
    });

    return comment.id;
  });

  const mentioned = mentions.filter((userId) => userId !== actor.userId);
  if (mentioned.length > 0) {
    await notify(mentioned, "MENTIONED", {
      title: "You were mentioned in a comment",
      body: `${actor.name} mentioned you on "${target.title}".`,
      linkUrl: target.linkUrl,
      actorId: actor.userId,
    });
  }

  const followers = target.followerIds.filter(
    (userId) => userId !== actor.userId && !mentioned.includes(userId),
  );
  if (followers.length > 0) {
    await notify(followers, "COMMENT_ADDED", {
      title: "New comment on your task",
      body: `${actor.name} commented on "${target.title}".`,
      linkUrl: target.linkUrl,
      actorId: actor.userId,
    });
  }

  return buildCommentDTO(commentId);
}

/** Changes the text of your own comment. Administrators may also correct one. */
export async function editComment(
  actor: ActorContext,
  input: { id: string; body: string },
): Promise<CommentDTO> {
  const existing = await loadComment(input.id);
  const target = await resolveTarget(existing.mainTaskId, existing.disciplineTaskId);
  assertCan(actor, "COMMENT", { projectId: target.projectId });

  if (existing.deletedAt) throw new ServiceError("That comment was removed, so it cannot be edited.");
  if (existing.authorId !== actor.userId && actor.role !== "ADMIN") {
    throw new ForbiddenError("COMMENT", "You can only edit your own comments.");
  }

  const body = input.body.trim();
  if (body.length === 0) throw new ServiceError("Write something first.");
  if (body.length > 5000) throw new ServiceError("That comment is too long. Keep it under 5000 characters.");

  await prisma.$transaction(async (tx) => {
    await tx.comment.update({
      where: { id: existing.id },
      data: { body, editedAt: new Date() },
    });

    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: target.projectId,
      entityType: target.entityType,
      entityId: target.entityId,
      action: ACTIVITY.COMMENT_EDITED,
      summary: `${actor.name} edited a comment on "${target.title}"`,
      metadata: { commentId: existing.id },
    });
  });

  return buildCommentDTO(existing.id);
}

/** Removes a comment from view. The row stays, the thread shows a tombstone, the audit trail keeps both. */
export async function deleteComment(
  actor: ActorContext,
  input: { id: string },
): Promise<{ removed: true; projectId: string; mainTaskId: string; disciplineTaskId: string | null }> {
  const existing = await loadComment(input.id);
  const target = await resolveTarget(existing.mainTaskId, existing.disciplineTaskId);
  assertCan(actor, "COMMENT", { projectId: target.projectId });

  const scope = {
    removed: true as const,
    projectId: target.projectId,
    mainTaskId: target.parentMainTaskId,
    disciplineTaskId: target.disciplineTaskId,
  };

  if (existing.authorId !== actor.userId && !canModerate(actor, target.projectId)) {
    throw new ForbiddenError(
      "COMMENT",
      "You can only remove your own comments. A project manager can remove anyone's.",
    );
  }

  if (existing.deletedAt) return scope;

  await prisma.$transaction(async (tx) => {
    await tx.comment.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });

    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: target.projectId,
      entityType: target.entityType,
      entityId: target.entityId,
      action: ACTIVITY.COMMENT_DELETED,
      summary: `${actor.name} removed a comment on "${target.title}"`,
      metadata: { commentId: existing.id, authorId: existing.authorId },
    });
  });

  return scope;
}

/** Which project and task a comment belongs to — the actions use it to refresh the right pages. */
export async function commentScope(
  commentId: string,
): Promise<{ projectId: string; mainTaskId: string; disciplineTaskId: string | null }> {
  const comment = await loadComment(commentId);
  const target = await resolveTarget(comment.mainTaskId, comment.disciplineTaskId);
  return {
    projectId: target.projectId,
    mainTaskId: target.parentMainTaskId,
    disciplineTaskId: target.disciplineTaskId,
  };
}

/* ------------------------------------------------------------------ */
/* Loaders, serializers and small helpers                              */
/* ------------------------------------------------------------------ */

async function readActivity(
  where: { projectId?: string; entityId?: string | { in: string[] } },
  take: number,
): Promise<ActivityItemDTO[]> {
  const rows = await prisma.activityLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take,
    include: { actor: { select: { name: true } } },
  });

  const items = rows.map(toActivityItemDTO);
  for (const item of items) checkDto(ActivityItemSchema, item, "ActivityItemDTO");
  return items;
}

async function loadComment(id: string) {
  const comment = await prisma.comment.findUnique({ where: { id } });
  if (!comment) throw new NotFoundError("We could not find that comment.");
  return comment;
}

/** Works out the task a comment hangs off, refusing anything that names both or neither. */
async function resolveTarget(
  mainTaskId: string | null,
  disciplineTaskId: string | null,
): Promise<CommentTarget> {
  if (Boolean(mainTaskId) === Boolean(disciplineTaskId)) {
    throw new ServiceError("A comment belongs to either a main task or a discipline task, not both.");
  }

  if (mainTaskId) {
    const task = await prisma.mainTask.findFirst({
      where: { id: mainTaskId, ...notDeleted },
      select: { id: true, projectId: true, title: true, ownerId: true },
    });
    if (!task) throw new NotFoundError("We could not find that task.");

    return {
      projectId: task.projectId,
      mainTaskId: task.id,
      disciplineTaskId: null,
      parentMainTaskId: task.id,
      title: task.title,
      entityType: "MainTask",
      entityId: task.id,
      linkUrl: `/tasks/${task.id}`,
      followerIds: task.ownerId ? [task.ownerId] : [],
    };
  }

  const task = await prisma.disciplineTask.findFirst({
    where: { id: disciplineTaskId as string, ...notDeleted },
    select: {
      id: true,
      title: true,
      assigneeId: true,
      mainTask: { select: { id: true, projectId: true, ownerId: true } },
    },
  });
  if (!task) throw new NotFoundError("We could not find that task.");

  const followers = [task.assigneeId, task.mainTask.ownerId].filter(
    (userId): userId is string => Boolean(userId),
  );

  return {
    projectId: task.mainTask.projectId,
    mainTaskId: null,
    disciplineTaskId: task.id,
    parentMainTaskId: task.mainTask.id,
    title: task.title,
    entityType: "DisciplineTask",
    entityId: task.id,
    linkUrl: `/discipline-tasks/${task.id}`,
    followerIds: [...new Set(followers)],
  };
}

/** Nobody can be mentioned into a project they are not on — that would leak the task to them. */
async function assertMentionsAreMembers(projectId: string, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;

  const members = await prisma.projectMember.findMany({
    where: { projectId, userId: { in: userIds } },
    select: { userId: true, user: { select: { isActive: true } } },
  });
  const allowed = new Set(
    members.filter((member) => member.user.isActive).map((member) => member.userId),
  );
  const refused = userIds.filter((userId) => !allowed.has(userId));
  if (refused.length === 0) return;

  const people = await prisma.user.findMany({
    where: { id: { in: refused } },
    select: { name: true },
  });
  const names = people.map((person) => person.name).join(", ");

  throw new ServiceError(
    names
      ? `You can only mention people who are on this project. Remove ${names} from your comment, or ask a project manager to add them to the project first.`
      : "You can only mention people who are on this project.",
    { mentions: ["One of the people you mentioned is not on this project."] },
  );
}

/** Administrators and the project's managers may remove anyone's comment; everyone else, only their own. */
function canModerate(actor: ActorContext, projectId: string): boolean {
  if (actor.role === "ADMIN") return true;
  const membership = actor.memberships.find((entry) => entry.projectId === projectId);
  return membership?.projectRole === "PROJECT_MANAGER" || membership?.projectRole === "ADMIN";
}

type CommentRow = {
  id: string;
  body: string;
  authorId: string;
  mainTaskId: string | null;
  disciplineTaskId: string | null;
  mentions: string[];
  editedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  author: { name: string };
};

/** One comment. A removed comment keeps its place in the thread but loses its text. */
function toCommentDTO(row: CommentRow): CommentDTO {
  const isDeleted = row.deletedAt !== null;
  const dto: CommentDTO = {
    id: row.id,
    body: isDeleted ? TOMBSTONE_BODY : row.body,
    authorId: row.authorId,
    authorName: row.author.name,
    mainTaskId: row.mainTaskId,
    disciplineTaskId: row.disciplineTaskId,
    mentions: isDeleted ? [] : row.mentions,
    editedAt: isDeleted ? null : row.editedAt,
    createdAt: row.createdAt,
  };

  return checkDto(CommentSchema, dto, "CommentDTO");
}

/** One row of the thread: the comment plus the flag that tells the UI to draw a tombstone. */
function toCommentListItem(row: CommentRow): CommentListItemDTO {
  return { ...toCommentDTO(row), isDeleted: row.deletedAt !== null };
}

/** Builds the full comment DTO. Callers have already checked that the person may see it. */
async function buildCommentDTO(commentId: string): Promise<CommentDTO> {
  const row = await prisma.comment.findUnique({
    where: { id: commentId },
    include: { author: { select: { name: true } } },
  });
  if (!row) throw new NotFoundError("We could not find that comment.");

  return toCommentDTO(row);
}
