// The notification seam. Every service calls this after its transaction has committed, so a problem
// saving notifications can never undo the change that caused them.

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { NotificationTypeName } from "@/lib/zod-schemas";
import { deliverToOrgWebhooks } from "@/server/services/webhooks";

export type NotifyPayload = {
  /** Short headline, e.g. "New task assigned to you". */
  title: string;
  /** One plain-English sentence. */
  body: string;
  /** Where the notification takes the person, e.g. "/discipline-tasks/abc123". */
  linkUrl: string;
};

/** Who is telling people. The actor is skipped as a recipient, and their company bounds the fan-out. */
export type NotifyActor = { userId: string; orgId: string };

/**
 * The one dial on a fan-out.
 *
 * `chatCopy: false` writes the in-app rows and posts nothing to Slack or Teams. It exists for the
 * one case where the SAME piece of news has to go out twice with two different links — an
 * announcement that includes contractors, whose colleagues are sent to the noticeboard and whose
 * contractors are sent to their own brief page, because /messages is a page they may not read. The
 * chat channel is the company's own and has already had the notice once; a second copy differing
 * only in its link would be noise, not news.
 */
export type NotifyOptions = { chatCopy?: boolean };

/**
 * Tells people something happened: one Notification row per recipient.
 *
 * The actor never hears about their own action, a person listed twice gets one row, and people who
 * have been deactivated get nothing. **A fan-out never leaves the actor's organisation**: the
 * recipient lookup is filtered by `actor.orgId`, so even a caller that handed in the wrong id
 * cannot post a notification into another company. Failures are logged and swallowed —
 * notifications are a side effect of a change that has already happened, never a reason to fail it.
 * Email delivery, if it is ever added, hangs off this same function.
 */
export async function notify(
  actor: NotifyActor,
  userIds: string[],
  type: NotificationTypeName,
  payload: NotifyPayload,
  options: NotifyOptions = {},
): Promise<void> {
  try {
    const wanted = [...new Set(userIds.filter((id) => Boolean(id) && id !== actor.userId))];
    if (wanted.length === 0) return;

    const recipients = await prisma.user.findMany({
      where: { id: { in: wanted }, orgId: actor.orgId, isActive: true },
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
        actorId: actor.userId,
      })),
    });

    // The chat copy, once per organisation rather than once per person, and only when the company
    // has switched that kind of event on. Deliberately NOT awaited: the in-app rows above are the
    // truth, and nobody waits on Slack to see their own change go through. It never throws.
    if (options.chatCopy === false) return;

    void deliverToOrgWebhooks(actor.orgId, {
      type,
      title: payload.title,
      body: payload.body,
      linkUrl: payload.linkUrl,
    });
  } catch (error) {
    logger.error("Could not save notifications", { type, linkUrl: payload.linkUrl, error });
  }
}
