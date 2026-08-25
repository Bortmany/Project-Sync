// EmptyState — a calm, one-line message with a subtle sail motif behind it.

import type { ReactNode } from "react";
import { SailMotif } from "@/components/ui/sail-motif";

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
      <SailMotif className="pointer-events-none absolute inset-0 h-full w-full" opacity={0.5} />
      <div className="relative space-y-3">
        <p className="text-sm text-[var(--olng-text)]">{message}</p>
        {action}
      </div>
    </div>
  );
}
