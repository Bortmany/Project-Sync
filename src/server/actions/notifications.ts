"use server";

// Server actions for the bell: mark one read, or clear them all. Thin wrappers — the ownership
// check lives in the service.
//
// These deliberately write no ActivityLog row: read state is a personal preference, not a change to
// a project, and the audit trail records project work only.

import { z } from "zod";
import type { ActionResult, NotificationDTO } from "@/lib/zod-schemas";
import { toFieldErrors } from "@/lib/zod-schemas";
import { toFailure } from "@/server/errors";
import { beginMutation } from "@/server/actions/guard";
import * as notifications from "@/server/services/notifications";

const CHECK_FIELDS = "Please check the highlighted fields.";

const MarkReadInput = z.object({ id: z.string().min(1).max(40) });

export async function markNotificationRead(input: {
  id: string;
}): Promise<ActionResult<NotificationDTO>> {
  const parsed = MarkReadInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };
  }

  const guard = await beginMutation("mark-notification-read", 240);
  if (guard.failure) return guard.failure;

  try {
    return { ok: true, data: await notifications.markNotificationRead(guard.actor, parsed.data) };
  } catch (error) {
    return toFailure(error, { action: "markNotificationRead" });
  }
}

export async function markAllNotificationsRead(): Promise<ActionResult<{ count: number }>> {
  const guard = await beginMutation("mark-all-notifications-read");
  if (guard.failure) return guard.failure;

  try {
    return { ok: true, data: await notifications.markAllNotificationsRead(guard.actor) };
  } catch (error) {
    return toFailure(error, { action: "markAllNotificationsRead" });
  }
}
