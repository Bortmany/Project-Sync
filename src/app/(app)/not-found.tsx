// Page-not-found inside the signed-in area — keeps the shell and offers one way back.

import Link from "next/link";
import { EmptyState } from "@/components/ui";

export const metadata = { title: "Page not found — Tielora" };

export default function AppNotFound() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-[var(--brand-primary)]">Page not found</h1>
      <EmptyState
        message="We couldn't find that page. It may have been removed, or the link may be out of date."
        action={
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center rounded-[var(--radius)] bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--brand-mid)]"
          >
            Back to the dashboard
          </Link>
        }
      />
    </div>
  );
}
