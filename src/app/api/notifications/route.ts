// The signed-in person's own notifications, newest first. Never anyone else's.

import { failFrom, guardRead, ok } from "@/server/http";
import { listNotifications } from "@/server/services/notifications";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await guardRead("notifications");
  if (guard.response) return guard.response;

  try {
    return ok(await listNotifications(guard.actor));
  } catch (error) {
    return failFrom(error, { route: "GET /api/notifications" });
  }
}
