// One folder's contents in OneDrive or SharePoint — the drive's top level when no folder is named.
// Same permission as an upload to the named task, checked in the service before anything is read.

import { MICROSOFT_NOT_CONFIGURED } from "@/lib/ms-graph";
import { MicrosoftBrowseInput, toFieldErrors } from "@/lib/zod-schemas";
import { fail, failFrom, failWithFields, guardRead, ok, queryRecord, tighterLimit } from "@/server/http";
import { listMicrosoftFolder, microsoftAvailable } from "@/server/services/microsoft";

export const dynamic = "force-dynamic";

const BROWSE_LIMIT = 60;

const KEYS = [
  "projectId",
  "mainTaskId",
  "disciplineTaskId",
  "documentId",
  "requiredDocumentId",
  "driveId",
  "itemId",
];

export async function GET(request: Request) {
  if (!microsoftAvailable()) return fail(MICROSOFT_NOT_CONFIGURED, 404);

  const guard = await guardRead("microsoft-items");
  if (guard.response) return guard.response;

  const throttled = tighterLimit(guard.actor, "microsoft-browse", BROWSE_LIMIT);
  if (throttled) return throttled;

  const parsed = MicrosoftBrowseInput.safeParse(queryRecord(request, KEYS));
  if (!parsed.success) {
    return failWithFields("Please check the highlighted fields.", toFieldErrors(parsed.error));
  }

  try {
    return ok(await listMicrosoftFolder(guard.actor, parsed.data));
  } catch (error) {
    return failFrom(error, { route: "GET /api/integrations/microsoft/items" });
  }
}
