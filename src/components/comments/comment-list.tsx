// The comment thread: the composer, then every comment oldest first. People who were mentioned show
// in blue; comments their author removed stay in place as a muted "Comment removed" line so the
// conversation still makes sense.

"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { deleteComment, editComment } from "@/components/actions";
import { useAction } from "@/components/hooks/use-action";
import {
  useDisciplineTaskComments,
  useMainTaskComments,
  useMe,
  type CommentRowDTO,
  type MeDTO,
} from "@/components/hooks/use-api";
import { formatRelative } from "@/components/format";
import { CommentComposer, type Mentionable } from "@/components/comments/comment-composer";
import {
  Avatar,
  Button,
  EmptyState,
  ErrorBanner,
  Modal,
  Skeleton,
  Textarea,
} from "@/components/ui";

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Splits a comment into plain text and the "@Name" tokens that match someone on the project. */
function renderBody(body: string, names: string[]) {
  if (names.length === 0) return body;

  const alternatives = [...names]
    .sort((a, b) => b.length - a.length)
    .map(escapeForRegExp)
    .join("|");
  const parts = body.split(new RegExp(`@(${alternatives})`, "g"));

  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <span key={index} className="font-semibold text-[var(--brand-primary)]">
        @{part}
      </span>
    ) : (
      <span key={index}>{part}</span>
    ),
  );
}

function CommentRow({
  comment,
  me,
  memberNames,
  onChanged,
}: {
  comment: CommentRowDTO;
  me: MeDTO | undefined;
  memberNames: string[];
  onChanged: () => void;
}) {
  const { run, pending, error } = useAction();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const isMine = me?.id === comment.authorId;
  const canModerate = me?.role === "ADMIN" || me?.role === "PROJECT_MANAGER";
  const canEdit = !comment.isDeleted && (isMine || me?.role === "ADMIN");
  const canRemove = !comment.isDeleted && (isMine || canModerate);

  if (comment.isDeleted) {
    return (
      <li className="flex items-start gap-3 py-3">
        <Avatar name={comment.authorName} size={32} />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-[var(--brand-gray)]">
            <span className="font-semibold">{comment.authorName}</span> ·{" "}
            {formatRelative(comment.createdAt)}
          </p>
          <p className="mt-1 text-sm italic text-[var(--brand-gray)]">Comment removed</p>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-start gap-3 py-3">
      <Avatar name={comment.authorName} size={32} />

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 text-sm text-[var(--brand-gray)]">
            <span className="font-semibold text-[var(--brand-ink)]">{comment.authorName}</span> ·{" "}
            {formatRelative(comment.createdAt)}
            {comment.editedAt ? " · (edited)" : ""}
          </p>

          {canEdit || canRemove ? (
            <div className="relative">
              <button
                type="button"
                aria-label={`Options for ${comment.authorName}'s comment`}
                aria-expanded={menuOpen}
                className="rounded px-2 py-1 text-sm text-[var(--brand-gray)] hover:bg-[var(--page-bg)]"
                onClick={() => setMenuOpen((open) => !open)}
              >
                ⋯
              </button>
              {menuOpen ? (
                <div className="absolute right-0 z-20 mt-1 w-36 overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-white shadow-lg">
                  {canEdit ? (
                    <button
                      type="button"
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-[var(--page-bg)]"
                      onClick={() => {
                        setDraft(comment.body);
                        setEditing(true);
                        setMenuOpen(false);
                      }}
                    >
                      Edit
                    </button>
                  ) : null}
                  {canRemove ? (
                    <button
                      type="button"
                      className="block w-full px-3 py-2 text-left text-sm text-[var(--status-blocked)] hover:bg-[var(--page-bg)]"
                      onClick={() => {
                        setConfirmOpen(true);
                        setMenuOpen(false);
                      }}
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {error ? <ErrorBanner message={error} /> : null}

        {editing ? (
          <div className="space-y-2">
            <Textarea
              value={draft}
              aria-label="Edit your comment"
              onChange={(event) => setDraft(event.target.value)}
            />
            <div className="flex gap-2">
              <Button
                loading={pending}
                disabled={draft.trim().length === 0}
                onClick={() =>
                  run(() => editComment({ id: comment.id, body: draft.trim() }), {
                    success: "Comment updated.",
                    failure: "Couldn't save this comment. Try again.",
                    onSuccess: () => {
                      setEditing(false);
                      onChanged();
                    },
                  })
                }
              >
                Save
              </Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <p className="whitespace-pre-wrap text-sm text-[var(--brand-text)]">
            {renderBody(comment.body, memberNames)}
          </p>
        )}
      </div>

      <Modal
        open={confirmOpen}
        title="Delete this comment?"
        size="sm"
        onClose={() => setConfirmOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={pending}
              onClick={() =>
                run(() => deleteComment({ id: comment.id }), {
                  success: "Comment removed.",
                  failure: "Couldn't remove this comment. Try again.",
                  onSuccess: () => {
                    setConfirmOpen(false);
                    onChanged();
                  },
                })
              }
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm">
          The comment stays in the thread as &quot;Comment removed&quot; so the conversation still
          reads properly. This can&apos;t be undone.
        </p>
      </Modal>
    </li>
  );
}

function Thread({
  comments,
  isPending,
  isError,
  onRetry,
  members,
  mainTaskId,
  disciplineTaskId,
  onChanged,
}: {
  comments: CommentRowDTO[] | undefined;
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  members: Mentionable[];
  mainTaskId?: string;
  disciplineTaskId?: string;
  onChanged: () => void;
}) {
  const me = useMe();
  const memberNames = members.map((member) => member.userName);

  return (
    <div className="space-y-4">
      <CommentComposer
        mainTaskId={mainTaskId}
        disciplineTaskId={disciplineTaskId}
        mentionable={members}
        onPosted={onChanged}
      />

      {isError ? (
        <ErrorBanner message="Couldn't load comments. Try refreshing the page." onRetry={onRetry} />
      ) : isPending ? (
        <div className="space-y-3" role="status" aria-label="Loading comments">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex items-start gap-3">
              <Skeleton className="h-8 w-8 rounded-full" />
              <div className="flex-1 space-y-1">
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-3 w-3/4" />
              </div>
            </div>
          ))}
        </div>
      ) : (comments?.length ?? 0) === 0 ? (
        <EmptyState message="No comments yet. Start the discussion." />
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {(comments ?? []).map((comment) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              me={me.data}
              memberNames={memberNames}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** The thread on a main task. */
export function MainTaskComments({
  mainTaskId,
  projectId,
  members,
}: {
  mainTaskId: string;
  projectId: string;
  members: Mentionable[];
}) {
  const queryClient = useQueryClient();
  const comments = useMainTaskComments(mainTaskId);

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["task", mainTaskId] });
    void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
  }

  return (
    <Thread
      comments={comments.data}
      isPending={comments.isPending}
      isError={comments.isError}
      onRetry={() => void comments.refetch()}
      members={members}
      mainTaskId={mainTaskId}
      onChanged={refresh}
    />
  );
}

/** The thread on a discipline task. */
export function DisciplineTaskComments({
  disciplineTaskId,
  mainTaskId,
  projectId,
  members,
}: {
  disciplineTaskId: string;
  mainTaskId: string;
  projectId: string;
  members: Mentionable[];
}) {
  const queryClient = useQueryClient();
  const comments = useDisciplineTaskComments(disciplineTaskId);

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["discipline-task", disciplineTaskId] });
    void queryClient.invalidateQueries({ queryKey: ["task", mainTaskId] });
    void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
  }

  return (
    <Thread
      comments={comments.data}
      isPending={comments.isPending}
      isError={comments.isError}
      onRetry={() => void comments.refetch()}
      members={members}
      disciplineTaskId={disciplineTaskId}
      onChanged={refresh}
    />
  );
}
