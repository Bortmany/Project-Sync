// The signed-in person's own work on a timeline: their discipline tasks, grouped under the main
// tasks those belong to. Same shape as the project timeline.

import { failFrom, guardRead, ok } from "@/server/http";
import { ganttForMyTasks } from "@/server/services/my-tasks";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await guardRead("my-tasks-gantt");
  if (guard.response) return guard.response;

  try {
    return ok(await ganttForMyTasks(guard.actor));
  } catch (error) {
    return failFrom(error, { route: "GET /api/my-tasks/gantt" });
  }
}
