"use server";

// Server actions for the noticeboard. Thin wrappers: parse, guard, service, refresh, result.
// The audience rules, the one-level reply rule and the tombstone all live in the service.

import { revalidatePath } from "next/cache";
import type {
  ActionResult,
  BroadcastSettingDTO,
  CreatePostInput,
  DismissAnnouncementInput,
  EditPostInput,
  PostDTO,
  ReplyToPostInput,
  SetBroadcastPolicyInput,
} from "@/lib/zod-schemas";
import {
  CreatePostInput as CreatePostSchema,
  DeletePostInput as DeletePostSchema,
  DismissAnnouncementInput as DismissAnnouncementSchema,
  EditPostInput as EditPostSchema,
  ReplyToPostInput as ReplyToPostSchema,
  SetBroadcastPolicyInput as SetBroadcastPolicySchema,
  toFieldErrors,
} from "@/lib/zod-schemas";
import { toFailure } from "@/server/errors";
import { beginMutation } from "@/server/actions/guard";
import * as posts from "@/server/services/posts";

const CHECK_FIELDS = "Please check the highlighted fields.";

/** Refreshes the two pages a noticeboard change is visible on. */
function revalidateBoards(): void {
  revalidatePath("/messages");
  revalidatePath("/dashboard");
}

export async function createPost(input: CreatePostInput): Promise<ActionResult<PostDTO>> {
  const parsed = CreatePostSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("create-post");
  if (guard.failure) return guard.failure;

  try {
    const post = await posts.createPost(guard.actor, parsed.data);
    revalidateBoards();
    return { ok: true, data: post };
  } catch (error) {
    return toFailure(error, { action: "createPost" });
  }
}

export async function replyToPost(input: ReplyToPostInput): Promise<ActionResult<PostDTO>> {
  const parsed = ReplyToPostSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("reply-to-post");
  if (guard.failure) return guard.failure;

  try {
    const reply = await posts.replyToPost(guard.actor, parsed.data);
    revalidateBoards();
    return { ok: true, data: reply };
  } catch (error) {
    return toFailure(error, { action: "replyToPost" });
  }
}

export async function editPost(input: EditPostInput): Promise<ActionResult<PostDTO>> {
  const parsed = EditPostSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("edit-post");
  if (guard.failure) return guard.failure;

  try {
    const post = await posts.editPost(guard.actor, parsed.data);
    revalidateBoards();
    return { ok: true, data: post };
  } catch (error) {
    return toFailure(error, { action: "editPost" });
  }
}

export async function deletePost(input: { id: string }): Promise<ActionResult<{ removed: true }>> {
  const parsed = DeletePostSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("delete-post");
  if (guard.failure) return guard.failure;

  try {
    const result = await posts.deletePost(guard.actor, parsed.data);
    revalidateBoards();
    return { ok: true, data: result };
  } catch (error) {
    return toFailure(error, { action: "deletePost" });
  }
}

/** Personal read state: no audit row, and only ever your own view of an announcement. */
export async function dismissAnnouncement(
  input: DismissAnnouncementInput,
): Promise<ActionResult<{ dismissed: true }>> {
  const parsed = DismissAnnouncementSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("dismiss-announcement");
  if (guard.failure) return guard.failure;

  try {
    const result = await posts.dismissAnnouncement(guard.actor, parsed.data);
    revalidatePath("/dashboard");
    return { ok: true, data: result };
  } catch (error) {
    return toFailure(error, { action: "dismissAnnouncement" });
  }
}

export async function setBroadcastPolicy(
  input: SetBroadcastPolicyInput,
): Promise<ActionResult<BroadcastSettingDTO>> {
  const parsed = SetBroadcastPolicySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: CHECK_FIELDS, fieldErrors: toFieldErrors(parsed.error) };

  const guard = await beginMutation("set-broadcast-policy");
  if (guard.failure) return guard.failure;

  try {
    const setting = await posts.setBroadcastPolicy(guard.actor, parsed.data);
    revalidatePath("/admin/integrations");
    revalidateBoards();
    return { ok: true, data: setting };
  } catch (error) {
    return toFailure(error, { action: "setBroadcastPolicy" });
  }
}
