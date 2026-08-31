// Messages: the company noticeboard. One tab per audience this person belongs to — Everyone, each
// of their projects, each of their departments — with the announcements running there at the top
// and the board's conversations underneath.
//
// The tab strip IS the audience picker. If a composer appears under a tab, that audience is one
// this person may post to; if it does not, it is not. Nothing is ever offered greyed out, which is
// both the design standard's rule and the simplest thing to get right: the server decides
// (`canPost` on each audience) and the screen only draws what it is told.

"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  createPost,
  deletePost,
  editPost,
  replyToPost,
} from "@/components/actions";
import { useAction } from "@/components/hooks/use-action";
import {
  isManager,
  useAnnouncements,
  useBoard,
  useMe,
  usePostAudiences,
} from "@/components/hooks/use-api";
import { formatRelative } from "@/components/format";
import { FileTypeIcon } from "@/components/documents/file-icon";
import { AnnouncementCard } from "@/components/posts/announcement-card";
import {
  DocumentPicker,
  type PickedDocument,
} from "@/components/posts/document-picker";
import {
  Avatar,
  Button,
  Card,
  CompanyBadge,
  DateInput,
  EmptyState,
  ErrorBanner,
  Field,
  Input,
  Modal,
  Skeleton,
  SkeletonRows,
  Tabs,
  Textarea,
  type TabItem,
} from "@/components/ui";
import type { BoardPostDTO, PostAudienceDTO, PostDTO } from "@/lib/zod-schemas";

/* ------------------------------------------------------------------ */
/* The composer                                                        */
/* ------------------------------------------------------------------ */

function Composer({
  audience,
  onPosted,
}: {
  audience: PostAudienceDTO;
  onPosted: () => void;
}) {
  const me = useMe();
  const { run, pending, error } = useAction();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [isAnnouncement, setIsAnnouncement] = useState(false);
  const [requiresAck, setRequiresAck] = useState(false);
  const [includeExternals, setIncludeExternals] = useState(false);
  const [until, setUntil] = useState("");
  const [attachment, setAttachment] = useState<PickedDocument | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Asking a whole audience to confirm they have read something is an administrator's or a project
  // manager's call. A department lead the company's broadcast setting lets announce simply never
  // sees this choice — never greyed out, which is this screen's standing rule. The server refuses
  // it either way.
  const mayRequireAck = isManager(me.data);

  // Contractors work on projects and for the company, never inside one of its departments — so the
  // choice to include them only exists on those two audiences. Same rule on the server.
  const mayIncludeExternals = audience.kind !== "DISCIPLINE";

  // One document, on a project board, on the post that starts a conversation. Announcements are
  // told rather than browsed, and a reply never carries one.
  const mayAttach = !isAnnouncement && audience.kind === "PROJECT" && audience.projectId !== null;

  function post() {
    run(
      () =>
        createPost({
          kind: isAnnouncement ? "ANNOUNCEMENT" : "BOARD",
          projectId: audience.projectId,
          disciplineId: audience.disciplineId,
          title: title.trim() || null,
          body: body.trim(),
          expiresAt: isAnnouncement && until ? new Date(`${until}T23:59:59`) : null,
          requiresAck: isAnnouncement && mayRequireAck && requiresAck,
          includeExternals: isAnnouncement && mayIncludeExternals && includeExternals,
          documentId: mayAttach ? (attachment?.id ?? null) : null,
        }),
      {
        success: isAnnouncement ? "Announcement posted." : "Posted.",
        failure: "Couldn't post that. Try again.",
        onSuccess: () => {
          setTitle("");
          setBody("");
          setUntil("");
          setIsAnnouncement(false);
          setRequiresAck(false);
          setIncludeExternals(false);
          setAttachment(null);
          onPosted();
        },
      },
    );
  }

  return (
    <Card>
      <div className="space-y-3">
        {error ? <ErrorBanner message={error} /> : null}

        <Input
          value={title}
          aria-label="Title (optional)"
          placeholder="Title (optional)"
          maxLength={200}
          onChange={(event) => setTitle(event.target.value)}
        />

        <Textarea
          value={body}
          aria-label={`Write to ${audience.label}`}
          placeholder="Share an update, ask a question…"
          maxLength={5000}
          onChange={(event) => setBody(event.target.value)}
        />

        {/*
          Pointing at a document that already exists, instead of describing it. Nothing is uploaded
          and nothing is copied — and a reader who may not see the document simply sees no link.
        */}
        {mayAttach ? (
          attachment ? (
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-3 py-1 text-[var(--brand-ink)]">
                <FileTypeIcon filename={attachment.title} />
                <span className="font-medium">
                  {attachment.title}
                  {attachment.revision === null ? "" : ` · Rev ${attachment.revision}`}
                </span>
              </span>
              <button
                type="button"
                aria-label={`Remove ${attachment.title}`}
                className="text-sm text-[var(--brand-gray)] hover:text-[var(--brand-ink)]"
                onClick={() => setAttachment(null)}
              >
                ✕
              </button>
            </p>
          ) : (
            <button
              type="button"
              className="font-semibold text-[var(--brand-primary)] hover:underline"
              onClick={() => setPickerOpen(true)}
            >
              Attach a document
            </button>
          )
        ) : null}

        {mayAttach && audience.projectId ? (
          <DocumentPicker
            open={pickerOpen}
            projectId={audience.projectId}
            onClose={() => setPickerOpen(false)}
            onAttach={setAttachment}
          />
        ) : null}

        {/*
          An announcement is the same post with a louder delivery: everybody in the audience is
          notified, and it shows on their dashboard until they dismiss it or it expires. The choice
          only appears to people who may make it — the server refuses it either way.
        */}
        <label className="flex items-start gap-2 text-sm text-[var(--brand-text)]">
          <input
            type="checkbox"
            className="mt-1"
            checked={isAnnouncement}
            onChange={(event) => setIsAnnouncement(event.target.checked)}
          />
          <span>
            <span className="font-medium text-[var(--brand-ink)]">Post as an announcement</span>
            <span className="block text-xs text-[var(--brand-gray)]">
              Everyone in {audience.label} is notified, and it sits on their dashboard until they
              dismiss it.
            </span>
          </span>
        </label>

        {isAnnouncement && mayRequireAck ? (
          <label className="flex items-start gap-2 text-sm text-[var(--brand-text)]">
            <input
              type="checkbox"
              className="mt-1"
              checked={requiresAck}
              onChange={(event) => setRequiresAck(event.target.checked)}
            />
            <span>
              <span className="font-medium text-[var(--brand-ink)]">Require acknowledgement</span>
              <span className="block text-xs text-[var(--brand-gray)]">
                Everyone in {audience.label} gets an Acknowledge button and stays counted until they
                use it. You&apos;ll see who still hasn&apos;t.
              </span>
            </span>
          </label>
        ) : null}

        {/*
          Contractors have no noticeboard at all, so this is the one door onto it — and it is opened
          one announcement at a time, deliberately. Off by default, and what they get is the notice
          itself on their own daily brief: no reply, no dismissal, no Acknowledge button.
        */}
        {isAnnouncement && mayIncludeExternals ? (
          <label className="flex items-start gap-2 text-sm text-[var(--brand-text)]">
            <input
              type="checkbox"
              className="mt-1"
              checked={includeExternals}
              onChange={(event) => setIncludeExternals(event.target.checked)}
            />
            <span>
              <span className="font-medium text-[var(--brand-ink)]">
                Include external contractors
              </span>
              <span className="block text-xs text-[var(--brand-gray)]">
                {audience.kind === "PROJECT"
                  ? `Off by default. Turn this on and any contractor working on ${audience.label} also sees this notice — title, body, who posted it, and when. They can't reply, dismiss it, or see who else has read it.`
                  : "Off by default. Turn this on and every contractor working on any of this company's projects also sees this notice — title, body, who posted it, and when. They can't reply, dismiss it, or see who else has read it."}
              </span>
            </span>
          </label>
        ) : null}

        {isAnnouncement ? (
          <Field
            label="Show until (optional)"
            hint="Leave it empty and the announcement stays until somebody removes it."
          >
            <DateInput
              value={until}
              aria-label="Show until"
              onChange={(event) => setUntil(event.target.value)}
            />
          </Field>
        ) : null}

        <div className="flex justify-end">
          <Button
            loading={pending}
            disabled={body.trim().length === 0}
            onClick={post}
            className="w-full sm:w-auto"
          >
            Post
          </Button>
        </div>
      </div>
    </Card>
  );
}

function ReplyComposer({ parentId, onPosted }: { parentId: string; onPosted: () => void }) {
  const { run, pending, error } = useAction();
  const [body, setBody] = useState("");

  return (
    <div className="space-y-2">
      {error ? <ErrorBanner message={error} /> : null}
      <Textarea
        value={body}
        aria-label="Write a reply"
        placeholder="Write a reply…"
        maxLength={5000}
        onChange={(event) => setBody(event.target.value)}
      />
      <div className="flex justify-end">
        <Button
          loading={pending}
          disabled={body.trim().length === 0}
          onClick={() =>
            run(() => replyToPost({ parentId, body: body.trim() }), {
              success: "Reply posted.",
              failure: "Couldn't post that reply. Try again.",
              onSuccess: () => {
                setBody("");
                onPosted();
              },
            })
          }
          className="w-full sm:w-auto"
        >
          Reply
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* One post and its replies                                            */
/* ------------------------------------------------------------------ */

function PostMenu({ post, onChanged }: { post: PostDTO; onChanged: () => void }) {
  const { run, pending, error } = useAction();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [title, setTitle] = useState(post.title ?? "");
  const [body, setBody] = useState(post.body);

  if (!post.canEdit && !post.canDelete) return null;

  return (
    <>
      <div className="relative">
        <button
          type="button"
          aria-label={`Options for ${post.authorName}'s post`}
          aria-expanded={menuOpen}
          className="rounded px-2 py-1 text-sm text-[var(--brand-gray)] hover:bg-[var(--page-bg)]"
          onClick={() => setMenuOpen((open) => !open)}
        >
          ⋯
        </button>
        {menuOpen ? (
          <div className="absolute right-0 z-20 mt-1 w-36 overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-white shadow-lg">
            {post.canEdit ? (
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-[var(--page-bg)]"
                onClick={() => {
                  setTitle(post.title ?? "");
                  setBody(post.body);
                  setEditing(true);
                  setMenuOpen(false);
                }}
              >
                Edit
              </button>
            ) : null}
            {post.canDelete ? (
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

      <Modal
        open={editing}
        title="Edit your post"
        size="sm"
        onClose={() => setEditing(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              loading={pending}
              disabled={body.trim().length === 0}
              onClick={() =>
                run(
                  () =>
                    editPost({
                      id: post.id,
                      title: post.parentId ? null : title.trim() || null,
                      body: body.trim(),
                    }),
                  {
                    success: "Post updated.",
                    failure: "Couldn't save that. Try again.",
                    onSuccess: () => {
                      setEditing(false);
                      onChanged();
                    },
                  },
                )
              }
            >
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {error ? <ErrorBanner message={error} /> : null}
          {post.parentId ? null : (
            <Input
              value={title}
              aria-label="Title (optional)"
              placeholder="Title (optional)"
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
            />
          )}
          <Textarea
            value={body}
            aria-label="Edit your post"
            maxLength={5000}
            onChange={(event) => setBody(event.target.value)}
          />
        </div>
      </Modal>

      <Modal
        open={confirmOpen}
        title="Delete this post?"
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
                run(() => deletePost({ id: post.id }), {
                  success: "Post removed.",
                  failure: "Couldn't remove that post. Try again.",
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
          The post stays in the feed as &quot;Post removed&quot; so the replies under it still make
          sense. This can&apos;t be undone.
        </p>
      </Modal>
    </>
  );
}

function PostHeader({ post, onChanged }: { post: PostDTO; onChanged: () => void }) {
  return (
    <div className="flex items-start gap-2">
      <p className="min-w-0 flex-1 text-sm text-[var(--brand-gray)]">
        <span className="font-semibold text-[var(--brand-ink)]">{post.authorName}</span>{" "}
        <CompanyBadge companyName={post.authorCompanyName} /> · posted{" "}
        {formatRelative(post.createdAt)}
        {post.editedAt ? " · (edited)" : ""}
      </p>
      {post.isDeleted ? null : <PostMenu post={post} onChanged={onChanged} />}
    </div>
  );
}

function ReplyRow({ reply, onChanged }: { reply: PostDTO; onChanged: () => void }) {
  return (
    <li className="flex items-start gap-2 pl-4 sm:pl-8">
      <Avatar name={reply.authorName} size={24} />
      <div className="min-w-0 flex-1 space-y-1">
        <PostHeader post={reply} onChanged={onChanged} />
        <p
          className={`whitespace-pre-wrap text-sm ${
            reply.isDeleted
              ? "italic text-[var(--brand-gray)]"
              : "text-[var(--brand-text)]"
          }`}
        >
          {reply.body}
        </p>
      </div>
    </li>
  );
}

function BoardPost({ post, onChanged }: { post: BoardPostDTO; onChanged: () => void }) {
  const [replying, setReplying] = useState(false);

  return (
    <Card>
      <div className="flex items-start gap-3">
        <Avatar name={post.authorName} size={32} />
        <div className="min-w-0 flex-1 space-y-1">
          <PostHeader post={post} onChanged={onChanged} />
          {post.title ? (
            <h3 className="text-sm font-semibold text-[var(--brand-ink)]">{post.title}</h3>
          ) : null}
          <p
            className={`whitespace-pre-wrap text-sm ${
              post.isDeleted ? "italic text-[var(--brand-gray)]" : "text-[var(--brand-text)]"
            }`}
          >
            {post.body}
          </p>

          {/*
            The document this conversation points at. The server decides, per reader, whether there
            is one to show at all — a document somebody may not see arrives as null and nothing is
            drawn here: no placeholder, no greyed chip, no title.
          */}
          {post.attachment ? (
            <p>
              <Link
                href={post.attachment.linkUrl}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-3 py-1 text-sm font-semibold text-[var(--brand-primary)] hover:underline"
              >
                <FileTypeIcon filename={post.attachment.title} />
                {post.attachment.title} · Rev {post.attachment.revision}
              </Link>
            </p>
          ) : null}
        </div>
      </div>

      {post.replies.length > 0 ? (
        <ul className="mt-3 space-y-3 border-t border-[var(--border)] pt-3">
          {post.replies.map((reply) => (
            <ReplyRow key={reply.id} reply={reply} onChanged={onChanged} />
          ))}
        </ul>
      ) : null}

      {post.isDeleted ? null : (
        <div className="mt-3 pl-4 sm:pl-8">
          {replying ? (
            <ReplyComposer
              parentId={post.id}
              onPosted={() => {
                setReplying(false);
                onChanged();
              }}
            />
          ) : (
            <Button variant="ghost" onClick={() => setReplying(true)}>
              Reply
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* One tab                                                             */
/* ------------------------------------------------------------------ */

/** Warm where somebody can act, plain where they cannot — never an invitation you can't accept. */
function emptyBoardMessage(audience: PostAudienceDTO): string {
  if (!audience.canPost) return "Nothing posted here yet.";
  if (audience.kind === "EVERYONE") {
    return "Nothing posted here yet. Be the first to say something to the whole company.";
  }
  if (audience.kind === "PROJECT") {
    return `No posts on ${audience.label} yet. Questions, updates, heads-up — this is the place.`;
  }
  return `Quiet in ${audience.label} so far. Kick things off.`;
}

function AudiencePanel({ audience }: { audience: PostAudienceDTO }) {
  const queryClient = useQueryClient();
  const board = useBoard(audience.key);
  const announcements = useAnnouncements();

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["board", audience.key] });
    void queryClient.invalidateQueries({ queryKey: ["announcements"] });
  }

  const running = (announcements.data ?? []).filter(
    (post) => post.audience.key === audience.key,
  );

  return (
    <div className="space-y-6">
      {/* Announcements for this audience. Absent, not empty-stated, when there are none. */}
      {announcements.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : running.length > 0 ? (
        <div className="space-y-3">
          {running.map((post) => (
            // No dismiss here on purpose: dismissing hides a notice from the DASHBOARD strip. The
            // noticeboard is where you come to look, so it keeps showing what is running.
            <AnnouncementCard key={post.id} post={post} />
          ))}
        </div>
      ) : null}

      {audience.canPost ? <Composer audience={audience} onPosted={refresh} /> : null}

      {board.isError ? (
        <ErrorBanner
          message="Couldn't load this board. Try refreshing the page."
          onRetry={() => void board.refetch()}
        />
      ) : board.isPending ? (
        <SkeletonRows rows={3} height="h-24" />
      ) : board.data.length === 0 ? (
        <EmptyState message={emptyBoardMessage(audience)} />
      ) : (
        <div className="space-y-4">
          {board.data.map((post) => (
            <BoardPost key={post.id} post={post} onChanged={refresh} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The page                                                            */
/* ------------------------------------------------------------------ */

export function MessagesView() {
  const me = useMe();
  const audiences = usePostAudiences();
  const router = useRouter();
  const search = useSearchParams();

  const wanted = search.get("tab") ?? "everyone";

  if (audiences.isError) {
    return (
      <ErrorBanner
        message="Couldn't load your boards. Try refreshing the page."
        onRetry={() => void audiences.refetch()}
      />
    );
  }

  if (audiences.isPending || me.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <SkeletonRows rows={3} height="h-24" />
      </div>
    );
  }

  const items: TabItem[] = audiences.data.map((audience) => ({
    id: audience.key,
    label: audience.label,
    content: <AudiencePanel audience={audience} />,
  }));

  const initialId = audiences.data.some((audience) => audience.key === wanted)
    ? wanted
    : "everyone";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-[var(--brand-ink)]">Messages</h1>
        <p className="text-sm text-[var(--brand-text)]">
          Announcements and the boards for the company, your projects and your department.
        </p>
      </div>

      <Tabs
        items={items}
        initialId={initialId}
        onChange={(id) => {
          // Keeping the tab in the address bar is what lets an announcement notification land on
          // the right one — and what lets somebody share a board with a colleague.
          router.replace(`/messages?tab=${encodeURIComponent(id)}`, { scroll: false });
        }}
      />
    </div>
  );
}
