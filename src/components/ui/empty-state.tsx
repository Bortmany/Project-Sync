// EmptyState — a calm, one-line message, optionally with the next action underneath it.

import type { ReactNode } from "react";

export function EmptyState({
  message,
  action,
  compact = false,
}: {
  message: string;
  action?: ReactNode;
  /** Less breathing room, for an empty state sitting inside a card rather than filling a page. */
  compact?: boolean;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-[var(--radius)] border border-dashed border-[var(--border)] bg-white text-center ${
        compact ? "px-4 py-6" : "px-6 py-12"
      }`}
    >
      <div className="relative space-y-3">
        <p className="text-sm text-[var(--brand-text)]">{message}</p>
        {action}
      </div>
    </div>
  );
}
