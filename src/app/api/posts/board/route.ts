// One board's conversations. The audience comes from the query as a single key — "everyone",
// "project:<id>" or "discipline:<id>" — and an audience this person does not belong to is a miss,
// answered "not found" by the service rather than "forbidden".

import { failFrom, guardRead, ok, queryRecord } from "@/server/http";
import { listBoard, parseAudienceKey } from "@/server/services/posts";
import { NotFoundError } from "@/server/errors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await guardRead("posts-board");
  if (guard.response) return guard.response;

  try {
    const { tab } = queryRecord(request, ["tab"]);
    const audience = parseAudienceKey(tab ?? "everyone");
    if (!audience) throw new NotFoundError("We could not find that board.");
    return ok(await listBoard(guard.actor, audience));
  } catch (error) {
    return failFrom(error, { route: "GET /api/posts/board" });
  }
}
