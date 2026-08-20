// My tasks — everything assigned to the signed-in person, grouped by when it's due.

import { Suspense } from "react";
import { MyTasksView } from "@/components/tasks/my-tasks-view";
import { SkeletonRows } from "@/components/ui";

export const metadata = { title: "My tasks — Project Nexus" };

export default function MyTasksPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-[var(--olng-blue)]">My tasks</h1>
      <Suspense fallback={<SkeletonRows rows={8} />}>
        <MyTasksView />
      </Suspense>
    </div>
  );
}
