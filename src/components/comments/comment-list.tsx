// The comment thread: the composer, then every comment oldest first. People and departments that
// were mentioned show in blue, a department with the four-dot glyph beside it; comments their author
// removed stay in place as a muted "Comment removed" line so the conversation still makes sense.

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
import {
  CommentComposer,
  type Mentionable,
  type MentionableDepartment,
} from "@/components/comments/comment-composer";
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

function CommentRow({
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
            <span className="font-semibold text-[var(--brand-ink)]">{comment.authorName}</span>{" "}
            <CompanyBadge companyName={comment.authorCompanyName} /> ·{" "}
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
            {renderBody(comment.body, memberNames, departmentNames)}
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
    <div className="space-y-4">
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
