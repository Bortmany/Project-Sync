// The private scratchpad: reminders a person jots for themselves. Nobody else ever reads this list.

import { Suspense } from "react";
import { PersonalListView } from "@/components/tasks/personal-list-view";
import { SkeletonRows } from "@/components/ui";

export const metadata = { title: "Personal list — Project Nexus" };

export default function PersonalListPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--olng-blue)]">Personal list</h1>
        <p className="mt-1 text-sm text-[var(--olng-text)]">
          A private scratchpad only you can see.
        </p>
      </div>
      <Suspense fallback={<SkeletonRows rows={5} />}>
        <PersonalListView />
      </Suspense>
    </div>
  );
}
