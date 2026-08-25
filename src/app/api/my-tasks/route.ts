// Everything assigned to the signed-in person, across the projects they may see — completed
// work included, with true per-status counts even when the list is cut short.

import { failFrom, guardRead, ok } from "@/server/http";
import { listMyTasks } from "@/server/services/my-tasks";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await guardRead("my-tasks");
  if (guard.response) return guard.response;

  try {
    return ok(await listMyTasks(guard.actor));
  } catch (error) {
    return failFrom(error, { route: "GET /api/my-tasks" });
  }
}
