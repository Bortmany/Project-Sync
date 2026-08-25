// The signed-in person's private to-do list: open items first, then the ones already ticked off.

import { failFrom, guardRead, ok } from "@/server/http";
import { listPersonalTasks } from "@/server/services/personal-tasks";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await guardRead("personal-tasks");
  if (guard.response) return guard.response;

  try {
    return ok(await listPersonalTasks(guard.actor));
  } catch (error) {
    return failFrom(error, { route: "GET /api/personal-tasks" });
  }
}
