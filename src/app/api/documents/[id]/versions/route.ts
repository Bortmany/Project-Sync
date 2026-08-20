// The full revision history of one document, newest first. Nothing is ever missing from this list.

import { failFrom, guardRead, ok } from "@/server/http";
import { listVersions } from "@/server/services/documents";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardRead("document-versions");
  if (guard.response) return guard.response;

  const { id } = await context.params;

  try {
    return ok(await listVersions(guard.actor, id));
  } catch (error) {
    return failFrom(error, { route: "GET /api/documents/[id]/versions", documentId: id });
  }
}
