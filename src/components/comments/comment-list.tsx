// The comment thread: the composer, then every comment oldest first. People and departments that
// were mentioned show in blue, a department with the four-dot glyph beside it; comments their author
// removed stay in place as a muted "Comment removed" line so the conversation still makes sense.

"use client";

import { useEffect, useRef, useState } from "react";
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
import {
  CommentComposer,
  type Mentionable,
  type MentionableDepartment,
} from "@/components/comments/comment-composer";
import { CounterLine } from "@/components/comments/comment-composer";
import { COMMENT_MAX_LENGTH } from "@/components/comments/comment-limit";
import { DisciplinesIcon } from "@/components/shell/icons";
import {
  Avatar,
  Button,
  CompanyBadge,
  EmptyState,
  ErrorBanner,
  Modal,
  Skeleton,
  Textarea,
  neighbourOf,
  type FocusAfterClose,
} from "@/components/ui";

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Splits a comment into plain text and the "@Name" tokens that match someone — or some department —
 * on the project. A department gets the same blue as a person plus the four-dot glyph, so a reader
 * can tell a whole team was called at a glance. A name held by both wins as a person.
 */
function renderBody(body: string, names: string[], departmentNames: string[]) {
  const all = [...new Set([...names, ...departmentNames])];
  if (all.length === 0) return body;

  const people = new Set(names);
  const alternatives = all
    .sort((a, b) => b.length - a.length)
    .map(escapeForRegExp)
    .join("|");
  const parts = body.split(new RegExp(`@(${alternatives})`, "g"));

  return parts.map((part, index) => {
    if (index % 2 === 0) return <span key={index}>{part}</span>;

    return people.has(part) ? (
      <span key={index} className="font-semibold text-[var(--brand-primary)]">
        @{part}
      </span>
    ) : (
      <span
        key={index}
        className="inline-flex items-center gap-1 font-semibold text-[var(--brand-primary)]"
      >
        <DisciplinesIcon size={13} />@{part}
      </span>
    );
  });
}

const OPTIONS_BUTTON = 'button[aria-label^="Options for"]';

/**
 * After a comment is deleted: the next comment that still has a "⋯" button, else the nearest one
 * above it, else the "Add a comment" box at the top of the thread. Worked out once the "Delete this
 * comment?" check has closed (see `focusAfterCloseRef` on Modal) — the thread is inert until then.
 */
function neighbourOfComment(row: Element | null | undefined): HTMLElement | null {
  const thread = row?.closest("[data-comment-thread]");
  if (!row || !thread) return null;
  return (
    neighbourOf(row, OPTIONS_BUTTON, thread) ??
    thread.querySelector<HTMLElement>('textarea[aria-label="Add a comment"]')
  );
}

export function CommentRow({
  comment,
  me,
  memberNames,
  departmentNames,
  onChanged,
}: {
  comment: CommentRowDTO;
  me: MeDTO | undefined;
  memberNames: string[];
  departmentNames: string[];
  onChanged: () => void;
}) {
  const { run, pending, error } = useAction();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // The "⋯" button: where focus goes back to once a dialog or edit opened from its menu is closed.
  const menuButton = useRef<HTMLButtonElement>(null);
  // The "Delete this comment?" check opens on its safe button, Cancel.
  const cancelDelete = useRef<HTMLButtonElement>(null);
  // Set when the comment is deleted: this row's "⋯" goes, so focus moves to a neighbour instead.
  const afterDelete = useRef<FocusAfterClose | null>(null);
  // The edit box, focused once when editing starts (cursor at the end, ready to carry on typing).
  const editBox = useRef<HTMLTextAreaElement>(null);

  // Keyed on `editing` only, so it runs once per edit and never while someone types.
  useEffect(() => {
    if (!editing) return;
    const box = editBox.current;
    if (!box) return;
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  }, [editing]);

  /** Leaves the edit without saving, and puts focus back on this row's "⋯" button. */
  function cancelEdit() {
    setEditing(false);
    setDraft(comment.body);
    menuButton.current?.focus();
  }

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
            <span className="break-words font-semibold text-[var(--brand-ink)]">{comment.authorName}</span>{" "}
            <CompanyBadge companyName={comment.authorCompanyName} /> ·{" "}
            {formatRelative(comment.createdAt)}
            {comment.editedAt ? " · (edited)" : ""}
          </p>

          {canEdit || canRemove ? (
            <div className="relative">
              <button
                ref={menuButton}
                type="button"
                aria-label={`Options for ${comment.authorName}'s comment`}
                aria-expanded={menuOpen}
                className="h-11 w-11 rounded text-sm text-[var(--brand-gray)] hover:bg-[var(--page-bg)]"
                onClick={() => setMenuOpen((open) => !open)}
              >
                ⋯
              </button>
              {menuOpen ? (
                <div className="absolute right-0 z-20 mt-1 w-36 overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-white shadow-lg">
                  {canEdit ? (
                    <button
                      type="button"
                      className="block min-h-11 w-full px-3 py-2 text-left text-sm hover:bg-[var(--page-bg)]"
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
                      className="block min-h-11 w-full px-3 py-2 text-left text-sm text-[var(--status-blocked)] hover:bg-[var(--page-bg)]"
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
              ref={editBox}
              value={draft}
              aria-label="Edit your comment"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                // Handled here: a dialog this thread sits in must not close on the same key.
                event.preventDefault();
                cancelEdit();
              }}
            />
            <CounterLine length={draft.length} />
            <div className="flex gap-2">
              <Button
                loading={pending}
                disabled={draft.trim().length === 0 || draft.length > COMMENT_MAX_LENGTH}
                onClick={() =>
                  run(() => editComment({ id: comment.id, body: draft.trim() }), {
                    success: "Comment updated.",
                    failure: "Couldn't save this comment. Try again.",
                    onSuccess: () => {
                      setEditing(false);
                      menuButton.current?.focus();
                      onChanged();
                    },
                  })
                }
              >
                Save
              </Button>
              <Button
                variant="ghost"
                onClick={cancelEdit}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <p className="min-w-0 whitespace-pre-wrap break-words text-sm text-[var(--brand-text)]">
            {renderBody(comment.body, memberNames, departmentNames)}
          </p>
        )}
      </div>

      <Modal
        open={confirmOpen}
        title="Delete this comment?"
        size="sm"
        returnFocusRef={menuButton}
        initialFocusRef={cancelDelete}
        focusAfterCloseRef={afterDelete}
        onClose={() => setConfirmOpen(false)}
        footer={
          <>
            <Button ref={cancelDelete} variant="ghost" onClick={() => setConfirmOpen(false)}>
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
                    // This row's "⋯" button goes once the comment shows as removed, so once the
                    // dialog has closed focus moves to a neighbour rather than back to it.
                    const row = menuButton.current?.closest("li");
                    afterDelete.current = () => neighbourOfComment(row);
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
  departments,
  mainTaskId,
  disciplineTaskId,
  onChanged,
}: {
  comments: CommentRowDTO[] | undefined;
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  members: Mentionable[];
  departments: MentionableDepartment[];
  mainTaskId?: string;
  disciplineTaskId?: string;
  onChanged: () => void;
}) {
  const me = useMe();
  const memberNames = members.map((member) => member.userName);
  const departmentNames = departments.map((department) => department.name);

  return (
    <div className="space-y-4" data-comment-thread>
      <CommentComposer
        mainTaskId={mainTaskId}
        disciplineTaskId={disciplineTaskId}
        mentionable={members}
        departments={departments}
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
              departmentNames={departmentNames}
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
  departments = [],
}: {
  mainTaskId: string;
  projectId: string;
  members: Mentionable[];
  departments?: MentionableDepartment[];
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
      departments={departments}
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
  departments = [],
}: {
  disciplineTaskId: string;
  mainTaskId: string;
  projectId: string;
  members: Mentionable[];
  departments?: MentionableDepartment[];
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
      departments={departments}
      disciplineTaskId={disciplineTaskId}
      onChanged={refresh}
    />
  );
}
