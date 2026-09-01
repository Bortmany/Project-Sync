// Is Microsoft 365 connected for my company? The one question the upload dialog asks before it
// offers the "Attach from OneDrive or SharePoint" tab.
//
// With the Azure app unregistered this answers 200 `{ configured: false }` and the tab never
// appears. Dormant is a normal answer, not a failure: this route is asked on every page that can
// upload a file, and a 404 there made every browser console log an error about an app behaving
// exactly as intended. Nothing a person sees changes — the tab is hidden either way.

import { MicrosoftStatusDTO } from "@/lib/zod-schemas";
import { checkDto } from "@/server/serialize";
import { failFrom, guardRead, ok } from "@/server/http";
import { microsoftAvailable, microsoftConnectionFor } from "@/server/services/microsoft";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!microsoftAvailable()) {
    return ok(checkDto(MicrosoftStatusDTO, { configured: false }, "MicrosoftStatusDTO"));
  }

  const guard = await guardRead("microsoft-status");
  if (guard.response) return guard.response;

  try {
    const connection = await microsoftConnectionFor(guard.actor);
    return ok(
      checkDto(MicrosoftStatusDTO, { ...connection, configured: true }, "MicrosoftStatusDTO"),
    );
  } catch (error) {
    return failFrom(error, { route: "GET /api/integrations/microsoft/status" });
  }
}
