// Reading and clearing a person's notifications, plus the deadline scan the hourly sweep runs.
// Every read and every write here is scoped to one person: nobody ever sees or clears someone
// else's notifications.

import type { Prisma } from "@/generated/prisma/client";
import { ACCESS_EXPIRY_GRACE_MS, ACCESS_EXPIRY_WARNING_MS } from "@/lib/access-expiry";
import { prisma } from "@/lib/db";
import type { NotificationDTO } from "@/lib/zod-schemas";
import { NotificationDTO as NotificationSchema } from "@/lib/zod-schemas";
import type { ActorContext } from "@/server/actor";
import { NotFoundError } from "@/server/errors";
import { checkDto, checkDtoList } from "@/server/serialize";
import type { WebhookEvent } from "@/server/services/webhooks";

/** The newest notifications a person can hold on screen. Older ones stay in the database. */
const LIST_LIMIT = 100;

/** How far ahead "a deadline is coming up" looks. */
export const APPROACHING_WINDOW_MS = 48 * 60 * 60 * 1000;

const DEADLINE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/**
 * The same "30 Sep 2026", read in UTC. A contractor's access end date is stored at UTC midnight and
 * the warning's own link names that UTC day, so the sentence has to say the same day the link does —
 * on a server west of Greenwich the ordinary reading would print the day before.
 */
const ACCESS_END_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

type NotificationRow = {
  id: string;
  type: NotificationDTO["type"];
  title: string;
  body: string;
  linkUrl: string;
  actorId: string | null;
  readAt: Date | null;
  createdAt: Date;
  actor: { name: string } | null;
};

function toNotificationDTO(row: NotificationRow): NotificationDTO {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    linkUrl: row.linkUrl,
    actorId: row.actorId,
    actorName: row.actor?.name ?? null,
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}

/** One person's notifications, newest first. Read and unread together — the UI groups them. */
export async function listNotifications(actor: ActorContext): Promise<NotificationDTO[]> {
  const rows = await prisma.notification.findMany({
    where: { userId: actor.userId },
    orderBy: { createdAt: "desc" },
    take: LIST_LIMIT,
    include: { actor: { select: { name: true } } },
  });

  return checkDtoList(NotificationSchema, rows.map(toNotificationDTO), "NotificationDTO");
}

/** How many of this person's notifications are still unread — what the bell shows. */
export async function unreadCount(actor: ActorContext): Promise<number> {
  return prisma.notification.count({ where: { userId: actor.userId, readAt: null } });
}

/**
 * Marks one notification read. Only ever your own: somebody else's is **not found**, the same
 * answer the tenant rule gives everywhere else, so guessing ids never reveals that one is real.
 */
export async function markNotificationRead(
  actor: ActorContext,
  input: { id: string },
): Promise<NotificationDTO> {
  // Ownership is part of the lookup, not a check after it: a row belonging to anybody else simply
  // does not come back.
  const existing = await prisma.notification.findFirst({
    where: { id: input.id, userId: actor.userId },
    select: { id: true, userId: true, readAt: true },
  });
  if (!existing) throw new NotFoundError("We could not find that notification.");

  if (!existing.readAt) {
    await prisma.notification.update({
      where: { id: existing.id },
      data: { readAt: new Date() },
    });
  }

  const row = await prisma.notification.findUniqueOrThrow({
    where: { id: existing.id },
    include: { actor: { select: { name: true } } },
  });

  return checkDto(NotificationSchema, toNotificationDTO(row), "NotificationDTO");
}

/** Clears the whole bell in one go. Returns how many were still unread. */
export async function markAllNotificationsRead(actor: ActorContext): Promise<{ count: number }> {
  const result = await prisma.notification.updateMany({
    where: { userId: actor.userId, readAt: null },
    data: { readAt: new Date() },
  });
  return { count: result.count };
}

/* ------------------------------------------------------------------ */
/* The deadline scan (run by src/server/sweep.ts)                      */
/* ------------------------------------------------------------------ */

/** What the deadline scan itself wrote. */
export type DeadlineCounts = { approaching: number; overdue: number };

/** Everything one sweep wrote: the deadline reminders, plus the contractor access warnings. */
export type SweepCounts = DeadlineCounts & { accessExpiring: number };

/**
 * What the sweep wrote, ready for the chat copy. The organisation comes from the person the
 * notification was written for — who is always a member of that task's project — so a reminder can
 * no more leave its company than any other fan-out can.
 */
export type SweepWebhookEvent = { orgId: string } & WebhookEvent;

/** The rows that were written, plus the chat events they should produce once the sweep commits. */
export type SweepOutcome = { counts: DeadlineCounts; events: SweepWebhookEvent[] };

type Candidate = {
  userId: string;
  linkUrl: string;
  title: string;
  deadline: Date;
};

/**
 * Writes the deadline notifications that are due, and nothing that has already been sent.
 *
 * How "exactly once" is kept, without a new column (the schema is frozen): a notification's
 * `linkUrl` identifies the task, so before writing we look for a row of the same type, for the same
 * person, with the same link.
 * - `OVERDUE` — one per person per task, ever. If a row exists, nothing is written again.
 * - `DEADLINE_APPROACHING` — one per person per task *per deadline*. A row only counts if it was
 *   created inside the current 48-hour window (deadline minus 48 hours), so moving a deadline out
 *   earns a fresh warning while a re-run inside the same window writes nothing.
 *
 * None of this is load-bearing: overdue is derived at read time everywhere in the app
 * (`isOverdue()` in src/lib/progress.ts). A missed sweep loses a nudge, never the truth.
 */
export async function sweepDeadlineNotifications(
  tx: Prisma.TransactionClient,
  now: Date = new Date(),
): Promise<SweepOutcome> {
  const soon = new Date(now.getTime() + APPROACHING_WINDOW_MS);
  // Deadlines mean "by the end of that day" (see isOverdue in src/lib/progress.ts), so a task is
  // only overdue once its deadline day has fully passed; until then it still counts as approaching.
  const overdueCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [approachingCandidates, overdueCandidates] = await Promise.all([
    candidates(tx, { gt: overdueCutoff, lte: soon }),
    candidates(tx, { lte: overdueCutoff }),
  ]);

  const approaching = await writeNew(tx, "DEADLINE_APPROACHING", approachingCandidates, now);
  const overdue = await writeNew(tx, "OVERDUE", overdueCandidates, now);

  return {
    counts: { approaching: approaching.count, overdue: overdue.count },
    events: [...approaching.events, ...overdue.events],
  };
}

/**
 * Warns a company's administrators that a contractor's access is about to end.
 *
 * Run by the same hourly sweep, inside the same advisory-locked transaction, and kept quiet by the
 * same trick the deadline reminders use — no new column, because the schema is frozen. The
 * notification's `linkUrl` carries the contractor AND the date their access ends
 * (`/admin/users?expiring=<userId>&on=<yyyy-mm-dd>`), so:
 *  - the same warning is never sent twice for the same date, and
 *  - extending the date changes the link, which earns one fresh warning about the new date.
 *
 * Recipients are the administrators of that contractor's OWN company and nobody else. Nothing in
 * the app depends on this having run: an expired contractor is refused at sign-in either way.
 */
export async function sweepAccessExpiryNotifications(
  tx: Prisma.TransactionClient,
  now: Date = new Date(),
): Promise<{ count: number }> {
  const until = new Date(now.getTime() + ACCESS_EXPIRY_WARNING_MS);
  // Anything later than this has not run out yet — the same one-day grace `isAccessExpired()` gives,
  // so somebody whose last day is today is still warned about, and somebody already locked out is
  // not warned about again.
  const stillValid = new Date(now.getTime() - ACCESS_EXPIRY_GRACE_MS);

  const ending = await tx.user.findMany({
    where: {
      role: "EXTERNAL",
      isActive: true,
      accessExpiresAt: { gt: stillValid, lte: until },
    },
    select: { id: true, name: true, orgId: true, accessExpiresAt: true },
  });
  if (ending.length === 0) return { count: 0 };

  const admins = await tx.user.findMany({
    where: {
      orgId: { in: [...new Set(ending.map((person) => person.orgId))] },
      role: "ADMIN",
      isActive: true,
    },
    select: { id: true, orgId: true },
  });
  if (admins.length === 0) return { count: 0 };

  const adminsOf = new Map<string, string[]>();
  for (const admin of admins) {
    adminsOf.set(admin.orgId, [...(adminsOf.get(admin.orgId) ?? []), admin.id]);
  }

  const wanted = ending.flatMap((person) => {
    const expiresAt = person.accessExpiresAt as Date;
    const linkUrl = `/admin/users?expiring=${person.id}&on=${expiresAt.toISOString().slice(0, 10)}`;
    return (adminsOf.get(person.orgId) ?? []).map((adminId) => ({
      userId: adminId,
      linkUrl,
      name: person.name,
      expiresAt,
    }));
  });
  if (wanted.length === 0) return { count: 0 };

  const sent = await tx.notification.findMany({
    where: {
      type: "DEADLINE_APPROACHING",
      linkUrl: { in: [...new Set(wanted.map((row) => row.linkUrl))] },
    },
    select: { userId: true, linkUrl: true },
  });

  const data = wanted
    .filter(
      (row) =>
        !sent.some((existing) => existing.userId === row.userId && existing.linkUrl === row.linkUrl),
    )
    .map((row) => ({
      userId: row.userId,
      type: "DEADLINE_APPROACHING" as const,
      title: "A contractor's access is ending",
      body: `${row.name}'s access ends on ${ACCESS_END_FORMAT.format(row.expiresAt)}. Extend it in Admin → Users if their work is not finished.`,
      linkUrl: row.linkUrl,
      actorId: null,
      createdAt: now,
    }));

  if (data.length === 0) return { count: 0 };

  const result = await tx.notification.createMany({ data });
  return { count: result.count };
}

/** Open tasks whose deadline falls in the given window, with the person who should hear about it. */
async function candidates(
  tx: Prisma.TransactionClient,
  deadline: Prisma.DateTimeFilter,
): Promise<Candidate[]> {
  const disciplineTasks = await tx.disciplineTask.findMany({
    where: {
      deletedAt: null,
      status: { not: "COMPLETED" },
      assigneeId: { not: null },
      deadline,
      mainTask: { deletedAt: null, project: { deletedAt: null } },
    },
    select: { id: true, title: true, deadline: true, assigneeId: true },
  });

  const mainTasks = await tx.mainTask.findMany({
    where: {
      deletedAt: null,
      status: { not: "COMPLETED" },
      ownerId: { not: null },
      deadline,
      project: { deletedAt: null },
    },
    select: { id: true, title: true, deadline: true, ownerId: true },
  });

  return [
    ...disciplineTasks.map((task) => ({
      userId: task.assigneeId as string,
      linkUrl: `/discipline-tasks/${task.id}`,
      title: task.title,
      deadline: task.deadline,
    })),
    ...mainTasks.map((task) => ({
      userId: task.ownerId as string,
      linkUrl: `/tasks/${task.id}`,
      title: task.title,
      deadline: task.deadline,
    })),
  ];
}

async function writeNew(
  tx: Prisma.TransactionClient,
  type: "DEADLINE_APPROACHING" | "OVERDUE",
  rows: Candidate[],
  now: Date,
): Promise<{ count: number; events: SweepWebhookEvent[] }> {
  if (rows.length === 0) return { count: 0, events: [] };

  const active = await tx.user.findMany({
    where: { id: { in: [...new Set(rows.map((row) => row.userId))] }, isActive: true },
    select: { id: true, orgId: true },
  });
  const activeIds = new Set(active.map((user) => user.id));
  const orgOf = new Map(active.map((user) => [user.id, user.orgId]));

  const sent = await tx.notification.findMany({
    where: { type, linkUrl: { in: [...new Set(rows.map((row) => row.linkUrl))] } },
    select: { userId: true, linkUrl: true, createdAt: true },
  });

  const alreadySent = (row: Candidate): boolean =>
    sent.some((existing) => {
      if (existing.userId !== row.userId || existing.linkUrl !== row.linkUrl) return false;
      if (type === "OVERDUE") return true;
      return existing.createdAt.getTime() >= row.deadline.getTime() - APPROACHING_WINDOW_MS;
    });

  const data = rows
    .filter((row) => activeIds.has(row.userId) && !alreadySent(row))
    .map((row) => ({
      userId: row.userId,
      type,
      title: type === "OVERDUE" ? "A task is overdue" : "A deadline is coming up",
      body:
        type === "OVERDUE"
          ? `"${row.title}" was due on ${DEADLINE_FORMAT.format(row.deadline)}.`
          : `"${row.title}" is due on ${DEADLINE_FORMAT.format(row.deadline)}.`,
      linkUrl: row.linkUrl,
      actorId: null,
      createdAt: now,
    }));

  if (data.length === 0) return { count: 0, events: [] };

  const result = await tx.notification.createMany({ data });

  // One chat event per company per task, even in the unlikely case two rows share a link. The
  // sweep's own caller posts these only after the transaction has committed.
  const seen = new Set<string>();
  const events: SweepWebhookEvent[] = [];
  for (const row of data) {
    const orgId = orgOf.get(row.userId);
    if (!orgId) continue;
    const key = `${orgId}:${row.linkUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push({ orgId, type, title: row.title, body: row.body, linkUrl: row.linkUrl });
  }

  return { count: result.count, events };
}
