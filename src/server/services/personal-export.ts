// "Your account" → Download your data: one person's own copy of their own data.
//
// Everything here is answered from the signed-in person's own rows, and nothing in it reaches
// further than they can reach in the app itself:
//  - THE TENANT RULE: every query is anchored to their organisation through `Project.orgId` or
//    their own `userId`, so this can never pick up another company's row even if an id collided.
//  - THE EXTERNAL RULE: a contractor's copy is narrowed by `externalTaskScope(actor)` exactly as
//    every other read of theirs is — the projects they hold live work on, the comments they wrote
//    on tasks assigned to them, and nothing else. A project they were left a member of after their
//    work moved is not in their copy, because it is not in their app either.
//
// It is deliberately immediate rather than a background job: this is one person's rows, it is JSON
// rather than files, and it is capped, so it is a read that answers in a moment. The company-wide
// export next door is the one that needs a job.
//
// No password, no hash and no token is ever in it — nothing here selects a column that holds one.

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { byUser, limit, type RateLimitResult } from "@/lib/rate-limit";
import type { PersonalExportDTO } from "@/lib/zod-schemas";
import { PersonalExportDTO as PersonalExportSchema } from "@/lib/zod-schemas";
import { externalTaskScope, isExternal, type ActorContext } from "@/server/actor";
import { NotFoundError } from "@/server/errors";
import { checkDto } from "@/server/serialize";
import { ACTIVITY, appendActivity } from "@/server/services/activity";

/**
 * The most rows any one section carries. A copy of somebody's data should be readable, and the
 * sections that hit this are named in `truncated` so nobody believes they have the lot. Newest
 * first, because a truncated copy that loses this year's work would be the wrong half.
 */
export const PERSONAL_EXPORT_SECTION_LIMIT = 5_000;

/** How many copies of your own data you may take in a day. */
export const PERSONAL_EXPORT_PER_DAY = 3;
export const PERSONAL_EXPORT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * The day's ceiling, on top of the ordinary read limit every route carries: each of these reads a
 * person's whole history, and nobody needs their own data three times before lunch.
 *
 * It lives here rather than inline in the route so it can be proved in the service tests, and the
 * route turns a refusal into the house's 429 with a `Retry-After` header.
 */
export function personalExportThrottle(userId: string): RateLimitResult {
  return limit(byUser(userId, "personal-export-day"), PERSONAL_EXPORT_PER_DAY, PERSONAL_EXPORT_WINDOW_MS);
}

const newestFirst = { createdAt: "desc" } as const;

/**
 * Builds one person's copy and records that they took it.
 *
 * The audit row is written in its own transaction after the read, and it names the person and
 * nothing else — never what was in the file.
 */
export async function downloadMyData(actor: ActorContext): Promise<PersonalExportDTO> {
  const me = await prisma.user.findFirst({
    where: { id: actor.userId, orgId: actor.orgId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      jobTitle: true,
      companyName: true,
      accessExpiresAt: true,
      emailVerifiedAt: true,
      lastLoginAt: true,
      createdAt: true,
      discipline: { select: { name: true } },
      organization: { select: { name: true } },
    },
  });
  if (!me) throw new NotFoundError("We could not find your account.");

  const external = isExternal(actor);
  const truncated: string[] = [];
  const capped = <T>(rows: T[], section: string): T[] => {
    if (rows.length >= PERSONAL_EXPORT_SECTION_LIMIT) truncated.push(section);
    return rows;
  };

  // A contractor's projects are the ones they hold live work on — membership alone is not enough,
  // exactly as `assertCanViewProject()` demands before it shows them a project at all.
  const memberships = await prisma.projectMember.findMany({
    where: {
      userId: actor.userId,
      project: {
        orgId: actor.orgId,
        deletedAt: null,
        ...(external
          ? { mainTasks: { some: { deletedAt: null, disciplineTasks: { some: { assigneeId: actor.userId, deletedAt: null } } } } }
          : {}),
      },
    },
    orderBy: { createdAt: "asc" },
    take: PERSONAL_EXPORT_SECTION_LIMIT,
    select: {
      projectRole: true,
      createdAt: true,
      project: { select: { name: true, code: true } },
      discipline: { select: { name: true } },
    },
  });

  const assigned = await prisma.disciplineTask.findMany({
    where: {
      assigneeId: actor.userId,
      mainTask: { project: { orgId: actor.orgId } },
    },
    orderBy: { deadline: "desc" },
    take: PERSONAL_EXPORT_SECTION_LIMIT,
    select: {
      title: true,
      status: true,
      priority: true,
      deadline: true,
      completedAt: true,
      discipline: { select: { name: true } },
      mainTask: { select: { title: true, project: { select: { name: true } } } },
    },
  });

  // A contractor may only ever comment on a discipline task assigned to them, so their copy holds
  // exactly those — never a main-task thread, which is a door they have never had.
  const commentScopes: Prisma.CommentWhereInput[] = external
    ? [
        {
          disciplineTask: {
            mainTask: { project: { orgId: actor.orgId } },
            ...externalTaskScope(actor),
          },
        },
      ]
    : [
        { mainTask: { project: { orgId: actor.orgId } } },
        { disciplineTask: { mainTask: { project: { orgId: actor.orgId } } } },
      ];

  const comments = await prisma.comment.findMany({
    where: { authorId: actor.userId, OR: commentScopes },
    orderBy: newestFirst,
    take: PERSONAL_EXPORT_SECTION_LIMIT,
    select: {
      body: true,
      createdAt: true,
      editedAt: true,
      deletedAt: true,
      mainTask: { select: { title: true, project: { select: { name: true } } } },
      disciplineTask: {
        select: { title: true, mainTask: { select: { project: { select: { name: true } } } } },
      },
    },
  });

  const notifications = await prisma.notification.findMany({
    where: { userId: actor.userId, user: { orgId: actor.orgId } },
    orderBy: newestFirst,
    take: PERSONAL_EXPORT_SECTION_LIMIT,
    select: { type: true, title: true, body: true, createdAt: true, readAt: true },
  });

  const favorites = await prisma.favorite.findMany({
    where: { userId: actor.userId },
    orderBy: newestFirst,
    take: PERSONAL_EXPORT_SECTION_LIMIT,
    select: {
      createdAt: true,
      project: { select: { name: true } },
      mainTask: { select: { title: true } },
      disciplineTask: { select: { title: true } },
    },
  });

  const personalTasks = await prisma.personalTask.findMany({
    where: { userId: actor.userId },
    orderBy: newestFirst,
    take: PERSONAL_EXPORT_SECTION_LIMIT,
    select: { title: true, done: true, createdAt: true, completedAt: true },
  });

  const acks = await prisma.postAck.findMany({
    where: { userId: actor.userId, post: { orgId: actor.orgId } },
    orderBy: newestFirst,
    take: PERSONAL_EXPORT_SECTION_LIMIT,
    select: { createdAt: true, post: { select: { title: true } } },
  });

  const dismissals = await prisma.postDismissal.findMany({
    where: { userId: actor.userId, post: { orgId: actor.orgId } },
    orderBy: newestFirst,
    take: PERSONAL_EXPORT_SECTION_LIMIT,
    select: { createdAt: true, post: { select: { title: true } } },
  });

  await prisma.$transaction(async (tx) => {
    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: null,
      entityType: "User",
      entityId: actor.userId,
      action: ACTIVITY.PERSONAL_EXPORT,
      summary: `${actor.name} downloaded a copy of their own data`,
      metadata: {},
    });
  });

  return checkDto(
    PersonalExportSchema,
    {
      exportedAt: new Date(),
      workspaceName: me.organization.name,
      profile: {
        name: me.name,
        email: me.email,
        role: me.role,
        jobTitle: me.jobTitle,
        companyName: me.companyName,
        disciplineName: me.discipline?.name ?? null,
        accessEndsOn: me.accessExpiresAt,
        emailConfirmedAt: me.emailVerifiedAt,
        lastSignedInAt: me.lastLoginAt,
        accountCreatedAt: me.createdAt,
      },
      projects: capped(memberships, "projects").map((row) => ({
        projectName: row.project.name,
        projectCode: row.project.code,
        yourRole: row.projectRole,
        yourDiscipline: row.discipline?.name ?? null,
        joinedAt: row.createdAt,
      })),
      assignedTasks: capped(assigned, "assignedTasks").map((row) => ({
        title: row.title,
        status: row.status,
        priority: row.priority,
        deadline: row.deadline,
        completedAt: row.completedAt,
        mainTaskTitle: row.mainTask.title,
        projectName: row.mainTask.project.name,
        disciplineName: row.discipline.name,
      })),
      comments: capped(comments, "comments").map((row) => ({
        body: row.body,
        onTask: row.mainTask?.title ?? row.disciplineTask?.title ?? "",
        projectName:
          row.mainTask?.project.name ?? row.disciplineTask?.mainTask.project.name ?? "",
        createdAt: row.createdAt,
        editedAt: row.editedAt,
        deletedAt: row.deletedAt,
      })),
      notifications: capped(notifications, "notifications").map((row) => ({
        type: row.type,
        title: row.title,
        body: row.body,
        createdAt: row.createdAt,
        readAt: row.readAt,
      })),
      favorites: capped(favorites, "favorites").map((row) => ({
        what: row.project ? "Project" : row.mainTask ? "Main task" : "Discipline task",
        title: row.project?.name ?? row.mainTask?.title ?? row.disciplineTask?.title ?? "",
        createdAt: row.createdAt,
      })),
      personalList: capped(personalTasks, "personalList").map((row) => ({
        title: row.title,
        done: row.done,
        createdAt: row.createdAt,
        completedAt: row.completedAt,
      })),
      acknowledgedAnnouncements: capped(acks, "acknowledgedAnnouncements").map((row) => ({
        title: row.post.title ?? "",
        createdAt: row.createdAt,
      })),
      dismissedAnnouncements: capped(dismissals, "dismissedAnnouncements").map((row) => ({
        title: row.post.title ?? "",
        createdAt: row.createdAt,
      })),
      truncated,
    },
    "PersonalExportDTO",
  );
}

/** The name the file lands under in somebody's downloads folder. */
export function personalExportFilename(when: Date = new Date()): string {
  return `tielora-my-data-${when.toISOString().slice(0, 10)}.json`;
}
