// One notification line, shared by the bell dropdown and the full page: a colored dot for the kind
// of thing that happened, the sentence, and how long ago it was.

"use client";

import type { NotificationDTO } from "@/lib/zod-schemas";
import { formatRelative } from "@/components/format";

/** The same colour language as the activity feed: red for trouble, sand for paperwork, blue for work. */
function toneFor(type: NotificationDTO["type"]): string {
  switch (type) {
    case "OVERDUE":
    case "OVERRIDE_APPLIED":
      return "var(--status-blocked)";
    case "DEADLINE_APPROACHING":
    case "DOCUMENT_UPLOADED":
      return "var(--brand-stone)";
    case "COMMENT_ADDED":
    case "MENTIONED":
      return "var(--brand-gray)";
    default:
      return "var(--brand-primary)";
  }
}

export function NotificationRow({
  item,
  onOpen,
  compact = false,
}: {
  item: NotificationDTO;
  onOpen: (item: NotificationDTO) => void;
  compact?: boolean;
}) {
  const unread = item.readAt === null;

  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className={`flex w-full items-start gap-3 border-l-[3px] px-3 text-left hover:bg-[var(--page-bg)] ${
        compact ? "py-2" : "min-h-12 py-3"
      } ${unread ? "border-[var(--brand-accent)] bg-[var(--brand-accent)]/10" : "border-transparent"}`}
    >
      <span
        className="mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: toneFor(item.type), opacity: 0.9 }}
        aria-hidden="true"
      >
        <span className="h-2 w-2 rounded-full bg-white" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-sm text-[var(--brand-text)]">
          {item.actorName ? (
            <span className="font-semibold text-[var(--brand-ink)]">{item.actorName} </span>
          ) : null}
          {item.body}
        </span>
        <span className="relative mt-0.5 block text-xs text-[var(--brand-gray)]">
          {item.title} · {formatRelative(item.createdAt)}
          {unread ? <span className="sr-only"> — unread</span> : null}
        </span>
      </span>
    </button>
  );
}
