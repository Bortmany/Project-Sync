// One announcement, as both the dashboard strip and the Messages page draw it.
//
// The audience chip is the only colour on the card: the whole company in the brand blue, one
// project in stone, one department in that department's own dot colour — so a card reads as
// "who this is for" before it reads as anything else.

"use client";

import { Badge, CompanyBadge } from "@/components/ui";
import { formatRelative, formatShortDate } from "@/components/format";
import type { PostDTO } from "@/lib/zod-schemas";

export function AudienceChip({ audience }: { audience: PostDTO["audience"] }) {
  if (audience.kind === "EVERYONE") {
    return <Badge color="var(--brand-primary)">Everyone</Badge>;
  }
  if (audience.kind === "PROJECT") {
    return <Badge color="var(--brand-stone)">{audience.label}</Badge>;
  }
  return <Badge color={audience.colorHex ?? "var(--brand-gray)"}>{audience.label}</Badge>;
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
  return (
    <article className="min-w-0 rounded-[var(--radius)] border border-[var(--border)] bg-white p-4">
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1">
          <AudienceChip audience={post.audience} />
        </span>
        {onDismiss ? (
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
    </article>
  );
}
