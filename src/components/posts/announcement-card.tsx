// One announcement, as both the dashboard strip and the Messages page draw it.
//
// The audience chip is the only colour on the card: the whole company in the brand blue, one
// project in stone, one department in that department's own dot colour — so a card reads as
// "who this is for" before it reads as anything else.
//
// Two controls can sit on one card and they must never be mistaken for each other:
//  - **Dismiss (✕)** is small, quiet and top-right. It hides the card from YOUR dashboard and says
//    nothing to anybody.
//  - **Acknowledge** is a full labelled button at the bottom, under a divider. It tells the person
//    who posted the notice that you have read it.
//
// The rule that keeps them apart is the simplest honest one, and the server enforces it: an
// announcement that asks to be acknowledged **cannot be dismissed until it has been**. So the ✕ is
// not drawn at all on such a card until the Acknowledge button has been used — nothing is ever
// offered here that would be refused, which is this section's standing rule.

"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { acknowledgePost } from "@/components/actions";
import { useAction } from "@/components/hooks/use-action";
import { Badge, Button, CompanyBadge, ErrorBanner } from "@/components/ui";
import { formatRelative, formatShortDate } from "@/components/format";
import type { PostAckProgressDTO, PostDTO } from "@/lib/zod-schemas";

export function AudienceChip({ audience }: { audience: PostDTO["audience"] }) {
  if (audience.kind === "EVERYONE") {
    return <Badge color="var(--brand-primary)">Everyone</Badge>;
  }
  if (audience.kind === "PROJECT") {
    return <Badge color="var(--brand-stone)">{audience.label}</Badge>;
  }
  return <Badge color={audience.colorHex ?? "var(--brand-gray)"}>{audience.label}</Badge>;
}

/**
 * How the acknowledgements are going — **only ever drawn for the author and an administrator**,
 * because the server only ever sends `ackProgress` to them. The audience never sees anybody's
 * status, their own included.
 *
 * The names open inline rather than in a floating panel: this card also lives full width on a
 * phone, where a popover has nowhere safe to sit.
 */
function AckProgress({ progress }: { progress: PostAckProgressDTO }) {
  const [open, setOpen] = useState(false);
  const everyone = progress.outstandingTotal === 0 && progress.audienceCount > 0;
  const hidden = progress.outstandingTotal - progress.outstandingNames.length;

  if (everyone) {
    return (
      <p className="mt-2 text-xs font-semibold text-[var(--brand-ink)]">
        ✓ Everyone has acknowledged this.
      </p>
    );
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        className="text-xs font-semibold text-[var(--brand-primary)] hover:underline"
      >
        {progress.ackCount} of {progress.audienceCount} acknowledged{" "}
        {open ? "▴ Hide the list" : "▾ See who hasn't"}
      </button>

      {open ? (
        <div className="mt-1 text-xs text-[var(--brand-text)]">
          <p className="text-[var(--brand-gray)]">Still waiting on:</p>
          <ul>
            {progress.outstandingNames.map((name) => (
              <li key={name}>· {name}</li>
            ))}
            {hidden > 0 ? <li className="text-[var(--brand-gray)]">· +{hidden} more</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** The reader's half: the button, or the quiet line that replaces it once it has been used. */
function AcknowledgeBlock({ post }: { post: PostDTO }) {
  const queryClient = useQueryClient();
  const { run, pending, error } = useAction();

  if (post.acked) {
    return (
      <p className="mt-3 border-t border-[var(--border)] pt-3 text-xs text-[var(--brand-gray)]">
        ✓ <span className="font-semibold text-[var(--brand-ink)]">You acknowledged this</span>
        {post.ackedAt ? ` · ${formatRelative(post.ackedAt)}` : ""}
      </p>
    );
  }

  return (
    <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
      {error ? <ErrorBanner message={error} /> : null}
      <Button
        loading={pending}
        className="w-full sm:w-auto"
        onClick={() =>
          run(() => acknowledgePost({ id: post.id }), {
            // No toast: the button turning into "You acknowledged this" IS the feedback, the same
            // way a dismissed card simply vanishing is.
            failure: "Couldn't record that. Try again.",
            onSuccess: () => {
              void queryClient.invalidateQueries({ queryKey: ["announcements"] });
              void queryClient.invalidateQueries({ queryKey: ["my-tasks", "brief"] });
            },
          })
        }
      >
        Acknowledge
      </Button>
      <p className="text-xs text-[var(--brand-gray)]">
        Acknowledging confirms you have read this. Until you do, it stays on your dashboard — you
        can hide it once you have acknowledged it.
      </p>
    </div>
  );
}

export function AnnouncementCard({
  post,
  onDismiss,
  dismissing = false,
}: {
  post: PostDTO;
  /** Only the dashboard strip passes this — dismissing is about that strip, nowhere else. */
  onDismiss?: (post: PostDTO) => void;
  dismissing?: boolean;
}) {
  // Waiting for this person's acknowledgement: the server would refuse a dismissal, so the control
  // is not offered. It comes back the moment they acknowledge.
  const waitingOnMe = post.requiresAck && !post.acked;
  const dismissable = onDismiss && !waitingOnMe;

  return (
    <article className="min-w-0 rounded-[var(--radius)] border border-[var(--border)] bg-white p-4">
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1">
          <AudienceChip audience={post.audience} />
        </span>
        {dismissable ? (
          <button
            type="button"
            aria-label={`Dismiss the announcement ${post.title ?? "from " + post.authorName}`}
            disabled={dismissing}
            onClick={() => onDismiss(post)}
            className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--brand-gray)] transition-colors hover:bg-[var(--page-bg)] hover:text-[var(--brand-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            ✕
          </button>
        ) : null}
      </div>

      {post.title ? (
        <h3 className="mt-2 text-base font-semibold text-[var(--brand-ink)]">{post.title}</h3>
      ) : null}

      <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--brand-text)]">{post.body}</p>

      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--brand-gray)]">
        <span className="flex items-center gap-2">
          {post.authorName}
          <CompanyBadge companyName={post.authorCompanyName} />
        </span>
        <span>posted {formatRelative(post.createdAt)}</span>
        {post.expiresAt ? <span>until {formatShortDate(post.expiresAt)}</span> : null}
      </p>

      {/* Author and administrator only — the server decides by sending the block or not. */}
      {post.ackProgress ? <AckProgress progress={post.ackProgress} /> : null}

      {post.requiresAck ? <AcknowledgeBlock post={post} /> : null}
    </article>
  );
}
