// The notification seam. Every service calls this after its transaction has committed, so a problem
// saving notifications can never undo the change that caused them.

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { NotificationTypeName } from "@/lib/zod-schemas";
import { emailAvailable, sendAlertEmail, type BulkRecipient } from "@/server/services/email";
import { deliverToOrgWebhooks, toggleForType } from "@/server/services/webhooks";

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
 * `chatCopy: false` writes the in-app rows and sends NO copies at all — nothing to Slack or Teams
 * and no alert email. It exists for two callers. The contractors' half of an announcement that
 * included them is the same news with a different link (their colleagues are sent to the
 * noticeboard, contractors to their own brief page, because /messages is a page they may not read):
 * the chat channel has already had the notice once, and the contractor reads it on their brief. And
 * the two workspace-deletion messages to a company's administrators borrow `ANNOUNCEMENT` for their
 * shape but are not noticeboard news, so neither the announcements chat toggle nor an alert email
 * may carry them. The option keeps its name; it means "copies".
 */
export type NotifyOptions = { chatCopy?: boolean };

/** One recipient as the lookup reads them: enough to write the row and decide on an email. */
export type NotifyRecipient = {
  id: string;
  email: string;
  emailAlerts: boolean;
  emailVerifiedAt: Date | null;
};

/**
 * Tells people something happened: one Notification row per recipient.
 *
 * The actor never hears about their own action, a person listed twice gets one row, and people who
 * have been deactivated get nothing. **A fan-out never leaves the actor's organisation**: the
 * recipient lookup is filtered by `actor.orgId`, so even a caller that handed in the wrong id
 * cannot post a notification into another company. Failures are logged and swallowed —
 * notifications are a side effect of a change that has already happened, never a reason to fail it.
 *
 * Email delivery hangs off this same function, after the rows are committed: one alert email per
 * notification row, only to a recipient who switched alerts on and has a confirmed address, and
 * only for a type that has a chat toggle. The company's chat toggles themselves have no say in it.
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

    const recipients: NotifyRecipient[] = await prisma.user.findMany({
      where: { id: { in: wanted }, orgId: actor.orgId, isActive: true },
      select: { id: true, email: true, emailAlerts: true, emailVerifiedAt: true },
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

    // Both copies stop here when the caller asked for none (see NotifyOptions).
    if (options.chatCopy === false) return;

    // The chat copy, once per organisation rather than once per person, and only when the company
    // has switched that kind of event on. Deliberately NOT awaited: the in-app rows above are the
    // truth, and nobody waits on Slack to see their own change go through. It never throws.
    void deliverToOrgWebhooks(actor.orgId, {
      type,
      title: payload.title,
      body: payload.body,
      linkUrl: payload.linkUrl,
    });

    // The email copy, once per PERSON, and only for people who asked for it. Not awaited either,
    // for the same reason, and it never throws.
    void emailAlerts(alertRecipients(recipients, type), payload);
  } catch (error) {
    logger.error("Could not save notifications", { type, linkUrl: payload.linkUrl, error });
  }
}

/**
 * Which of these recipients gets an alert email for this type: nobody while email is not set up or
 * when the type has no chat toggle (`DOCUMENT_UPLOADED` and `COMMENT_ADDED` stay in the app),
 * otherwise exactly the people with alerts on AND a confirmed address. The company's chat toggles
 * are not consulted — an email is a personal choice (spec decision D6).
 */
export function alertRecipients(
  recipients: NotifyRecipient[],
  type: NotificationTypeName,
): BulkRecipient[] {
  if (toggleForType(type) === null) return [];
  if (!emailAvailable()) return [];
  return recipients
    .filter((recipient) => recipient.emailAlerts && recipient.emailVerifiedAt !== null)
    .map((recipient) => ({ id: recipient.id, email: recipient.email }));
}

/**
 * Sends one alert email per recipient, one after another, built from the row's own words and
 * nothing else. Never throws: every delivery failure is already logged inside `sendEmail`.
 */
export async function emailAlerts(recipients: BulkRecipient[], row: NotifyPayload): Promise<void> {
  for (const recipient of recipients) {
    try {
      await sendAlertEmail(recipient, row);
    } catch (error) {
      logger.error("Could not send an alert email", {
        userId: recipient.id,
        reason: error instanceof Error ? error.name : "unknown",
      });
    }
  }
}
