"use server";

// Server action for Admin → Data & privacy: asking for a full copy of the company's data.
// Thin wrapper, as every action is: guard, service, refresh, result. The service does the
// authorisation, the once-a-day rule and the audit row.

import type { ActionResult, WorkspaceExportStatusDTO } from "@/lib/zod-schemas";
import { toFailure } from "@/server/errors";
import { beginMutation, revalidateAdmin } from "@/server/actions/guard";
import * as exports from "@/server/services/workspace-export";

/**
 * Starts the workspace export.
 *
 * Limited hard — five presses a minute per person — because each one can start a job that reads
 * every row and every file the company has. The real ceiling is the once-per-company-per-day rule
 * inside the service: a rate limit counts per process, and this promise has to hold across
 * restarts and however many administrators the company has.
 */
export async function startWorkspaceExport(): Promise<ActionResult<WorkspaceExportStatusDTO>> {
  const guard = await beginMutation("start-workspace-export", 5);
  if (guard.failure) return guard.failure;

  try {
    const status = await exports.startWorkspaceExport(guard.actor);
    revalidateAdmin();
    return { ok: true, data: status };
  } catch (error) {
    return toFailure(error, { action: "startWorkspaceExport" });
  }
}
