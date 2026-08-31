// Where the company's export has got to. Small on purpose: the Data & privacy page polls it while
// an export is being prepared, exactly as the topbar bell polls its unread count.

import { ok, failFrom, guardRead } from "@/server/http";
import { workspaceExportStatus } from "@/server/services/workspace-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await guardRead("admin-export-status");
  if (guard.response) return guard.response;

  try {
    return ok(await workspaceExportStatus(guard.actor));
  } catch (error) {
    return failFrom(error, { route: "GET /api/admin/export/status" });
  }
}
