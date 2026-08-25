// The signed-in person's own sidebar shortcuts, newest first. Never anyone else's.

import { failFrom, guardRead, ok } from "@/server/http";
import { listFavorites } from "@/server/services/favorites";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await guardRead("favorites");
  if (guard.response) return guard.response;

  try {
    return ok(await listFavorites(guard.actor));
  } catch (error) {
    return failFrom(error, { route: "GET /api/favorites" });
  }
}
