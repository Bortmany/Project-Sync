// The home screen figures, all scoped to the projects the signed-in person belongs to.

import { failFrom, guardRead, ok } from "@/server/http";
import { getDashboardForActor } from "@/server/services/dashboard";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await guardRead("dashboard");
  if (guard.response) return guard.response;

  try {
    return ok(await getDashboardForActor(guard.actor));
  } catch (error) {
    return failFrom(error, { route: "GET /api/dashboard" });
  }
}
