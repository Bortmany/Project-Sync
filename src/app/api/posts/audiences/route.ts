// The noticeboard tabs this person may read, each saying whether they may post or moderate there.

import { failFrom, guardRead, ok } from "@/server/http";
import { listAudiences } from "@/server/services/posts";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await guardRead("posts-audiences");
  if (guard.response) return guard.response;

  try {
    return ok(await listAudiences(guard.actor));
  } catch (error) {
    return failFrom(error, { route: "GET /api/posts/audiences" });
  }
}
