// Is Microsoft 365 connected for my company? The one question the upload dialog asks before it
// offers the "Attach from OneDrive or SharePoint" tab.
//
// With the Azure app unregistered this answers a plain "not set up" and the tab never appears.

import { MICROSOFT_NOT_CONFIGURED } from "@/lib/ms-graph";
import { fail, failFrom, guardRead, ok } from "@/server/http";
import { microsoftAvailable, microsoftConnectionFor } from "@/server/services/microsoft";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!microsoftAvailable()) return fail(MICROSOFT_NOT_CONFIGURED, 404);

  const guard = await guardRead("microsoft-status");
  if (guard.response) return guard.response;

  try {
    return ok(await microsoftConnectionFor(guard.actor));
  } catch (error) {
    return failFrom(error, { route: "GET /api/integrations/microsoft/status" });
  }
}
