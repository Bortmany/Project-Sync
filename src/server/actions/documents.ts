"use server";

// Server actions for documents. Uploading is a route (it carries bytes, not JSON), so the only action
// here is removing a document — which never removes a revision, only hides the document and reopens
// whatever checklist item it was standing in for.

import { z } from "zod";
import type { ActionResult } from "@/lib/zod-schemas";
import { toFieldErrors } from "@/lib/zod-schemas";
import { toFailure } from "@/server/errors";
import { beginMutation, revalidateProject, revalidateTask } from "@/server/actions/guard";
import * as documents from "@/server/services/documents";

const CHECK_FIELDS = "Please check the highlighted fields.";

const ByIdInput = z.object({ id: z.string().min(1).max(40) });

/** Administrators and project managers only. Refused while it props up a completed task. */
export async function softDeleteDocument(input: { id: string }): Promise<ActionResult<{ deleted: true }>> {
  const parsed = ByIdInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("delete-document");
  if (guard.failure) return guard.failure;

  try {
    const result = await documents.softDeleteDocument(guard.actor, parsed.data);

    if (result.mainTaskId) {
      revalidateTask(result.projectId, result.mainTaskId, result.disciplineTaskId ?? undefined);
    } else {
      revalidateProject(result.projectId);
    }

    return { ok: true, data: { deleted: true } };
  } catch (error) {
    return toFailure(error, { action: "softDeleteDocument" });
  }
}
