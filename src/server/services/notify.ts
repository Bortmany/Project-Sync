// The notification seam. Milestone 4 fills this in; until then every call is a deliberate no-op.

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
 * Tells people something happened.
 *
 * TODO (Milestone 4): write a Notification row per recipient (skipping the actor), respect any
 * per-person preferences, and hand off to email once that integration exists. Every caller in
 * src/server/services already passes the right recipients and payload, so Milestone 4 only edits
 * this file. Failures here must never fail the surrounding change — notifications are a side effect.
 */
export async function notify(
  userIds: string[],
  type: NotificationTypeName,
  payload: NotifyPayload,
): Promise<void> {
  void userIds;
  void type;
  void payload;
}
