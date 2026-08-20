// EmptyState — a calm, one-line message with a subtle sail motif behind it.

import type { ReactNode } from "react";
import { SailMotif } from "@/components/ui/sail-motif";

export function EmptyState({
  message,
  action,
}: {
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-[var(--radius)] border border-dashed border-[var(--border)] bg-white px-6 py-12 text-center">
      <SailMotif className="pointer-events-none absolute inset-0 h-full w-full" opacity={0.5} />
      <div className="relative space-y-3">
        <p className="text-sm text-[var(--olng-text)]">{message}</p>
        {action}
      </div>
    </div>
  );
}
