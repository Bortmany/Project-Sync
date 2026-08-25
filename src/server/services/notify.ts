// The notification seam. Every service calls this after its transaction has committed, so a problem
// saving notifications can never undo the change that caused them.

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { NotificationTypeName } from "@/lib/zod-schemas";

export type NotifyPayload = {
  /** Short headline, e.g. "New task assigned to you". */
  title: string;
  /** One plain-English sentence. */
  body: string;
  /** Where the notification takes the person, e.g. "/discipline-tasks/abc123". */
  linkUrl: string;
  /** Who caused it, so nobody is notified about their own action. */
  actorId?: string;
};

/**
 * Tells people something happened: one Notification row per recipient.
 *
 * The actor never hears about their own action, a person listed twice gets one row, and people who
 * have been deactivated get nothing. Failures are logged and swallowed — notifications are a side
 * effect of a change that has already happened, never a reason to fail it. Email delivery, if it is
 * ever added, hangs off this same function.
 */
export async function notify(
  userIds: string[],
  type: NotificationTypeName,
  payload: NotifyPayload,
): Promise<void> {
  try {
    const wanted = [...new Set(userIds.filter((id) => Boolean(id) && id !== payload.actorId))];
    if (wanted.length === 0) return;

    const recipients = await prisma.user.findMany({
      where: { id: { in: wanted }, isActive: true },
      select: { id: true },
    });
    if (recipients.length === 0) return;

    await prisma.notification.createMany({
      data: recipients.map((recipient) => ({
        userId: recipient.id,
        type,
        title: payload.title,
        body: payload.body,
        linkUrl: payload.linkUrl,
        actorId: payload.actorId ?? null,
      })),
    });
  } catch (error) {
    logger.error("Could not save notifications", { type, linkUrl: payload.linkUrl, error });
  }
}
