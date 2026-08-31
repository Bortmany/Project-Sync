// "Your day": what needs you today, worked out from work the app already records. No new data is
// collected for this page and nothing on it is stored.

import { Suspense } from "react";
import { BriefView } from "@/components/tasks/brief-view";
import { SkeletonRows } from "@/components/ui";

export const metadata = { title: "Your day — Tielora" };

export default function BriefPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--brand-primary)]">Your day</h1>
        <p className="mt-1 text-sm text-[var(--brand-text)]">
          Your own work, worked out from what the app already records. Each section says the period
          it covers.
        </p>
      </div>
      <Suspense fallback={<SkeletonRows rows={6} />}>
        <BriefView />
      </Suspense>
    </div>
  );
}
