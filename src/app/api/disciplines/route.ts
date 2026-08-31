// The discipline catalogue, for the pickers on the project and task forms. Any signed-in person may read it.

import { failFrom, guardRead, ok } from "@/server/http";
import { listDisciplines } from "@/server/services/directory";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await guardRead("disciplines");
  if (guard.response) return guard.response;

  try {
    return ok(await listDisciplines(guard.actor));
  } catch (error) {
    return failFrom(error, { route: "GET /api/disciplines" });
  }
}
