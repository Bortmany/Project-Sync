"use server";

// Server actions for comments. Thin wrappers: parse, guard, service, refresh, result.
// The mention rules and the soft-delete tombstone live in the service, never here.

import { z } from "zod";
import type { ActionResult, CommentDTO } from "@/lib/zod-schemas";
import { CreateCommentInput, toFieldErrors } from "@/lib/zod-schemas";
import { toFailure } from "@/server/errors";
import { beginMutation, revalidateTask } from "@/server/actions/guard";
import * as comments from "@/server/services/comments";

const CHECK_FIELDS = "Please check the highlighted fields.";

const EditCommentInput = z.object({
  id: z.string().min(1).max(40),
  body: z.string().trim().min(1, "Write something first.").max(5000),
});

const DeleteCommentInput = z.object({ id: z.string().min(1).max(40) });

export async function createComment(input: CreateCommentInput): Promise<ActionResult<CommentDTO>> {
  const parsed = CreateCommentInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("create-comment");
  if (guard.failure) return guard.failure;

  try {
    const comment = await comments.createComment(guard.actor, parsed.data);
    const scope = await comments.commentScope(guard.actor, comment.id);
    revalidateTask(scope.projectId, scope.mainTaskId, scope.disciplineTaskId ?? undefined);
    return { ok: true, data: comment };
  } catch (error) {
    return toFailure(error, { action: "createComment" });
  }
}

export async function editComment(input: {
  id: string;
  body: string;
}): Promise<ActionResult<CommentDTO>> {
  const parsed = EditCommentInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("edit-comment");
  if (guard.failure) return guard.failure;

  try {
    const comment = await comments.editComment(guard.actor, parsed.data);
    const scope = await comments.commentScope(guard.actor, comment.id);
    revalidateTask(scope.projectId, scope.mainTaskId, scope.disciplineTaskId ?? undefined);
    return { ok: true, data: comment };
  } catch (error) {
    return toFailure(error, { action: "editComment" });
  }
}

export async function deleteComment(input: { id: string }): Promise<ActionResult<{ removed: true }>> {
  const parsed = DeleteCommentInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("delete-comment");
  if (guard.failure) return guard.failure;

  try {
    const scope = await comments.deleteComment(guard.actor, parsed.data);
    revalidateTask(scope.projectId, scope.mainTaskId, scope.disciplineTaskId ?? undefined);
    return { ok: true, data: { removed: true } };
  } catch (error) {
    return toFailure(error, { action: "deleteComment" });
  }
}
