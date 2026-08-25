// Just the number on the bell. Its own tiny route so the topbar can poll it without pulling the
// whole list every minute.

import { failFrom, guardRead, ok } from "@/server/http";
import { unreadCount } from "@/server/services/notifications";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await guardRead("notifications-unread");
  if (guard.response) return guard.response;

  try {
    return ok({ unread: await unreadCount(guard.actor) });
  } catch (error) {
    return failFrom(error, { route: "GET /api/notifications/unread-count" });
  }
}
