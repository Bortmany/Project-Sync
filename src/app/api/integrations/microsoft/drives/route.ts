// Where this company's files live, as the connected account sees them.
//
// The upload target travels with the request on purpose: the service checks the SAME permission an
// upload to that task needs before it returns a single name, so browsing can never reach further
// than uploading already does.

import { MICROSOFT_NOT_CONFIGURED } from "@/lib/ms-graph";
import { MicrosoftTargetInput, toFieldErrors } from "@/lib/zod-schemas";
import { fail, failFrom, failWithFields, guardRead, ok, queryRecord, tighterLimit } from "@/server/http";
import { listMicrosoftDrives, microsoftAvailable } from "@/server/services/microsoft";

export const dynamic = "force-dynamic";

/** Every one of these costs a call to Microsoft, so it is held well below the ordinary read limit. */
const BROWSE_LIMIT = 60;

const TARGET_KEYS = [
  "projectId",
  "mainTaskId",
  "disciplineTaskId",
  "documentId",
  "requiredDocumentId",
];

export async function GET(request: Request) {
  if (!microsoftAvailable()) return fail(MICROSOFT_NOT_CONFIGURED, 404);

  const guard = await guardRead("microsoft-drives");
  if (guard.response) return guard.response;

  const throttled = tighterLimit(guard.actor, "microsoft-browse", BROWSE_LIMIT);
  if (throttled) return throttled;

  const parsed = MicrosoftTargetInput.safeParse(queryRecord(request, TARGET_KEYS));
  if (!parsed.success) {
    return failWithFields("Say where the file would go first.", toFieldErrors(parsed.error));
  }

  try {
    return ok(await listMicrosoftDrives(guard.actor, parsed.data));
  } catch (error) {
    return failFrom(error, { route: "GET /api/integrations/microsoft/drives" });
  }
}
