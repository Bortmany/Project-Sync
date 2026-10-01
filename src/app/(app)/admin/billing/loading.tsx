// While the plan, usage and AI meter are read on the server, show the shape of the page.

import { Skeleton, SkeletonRows } from "@/components/ui";

export default function AdminBillingLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <Skeleton className="h-7 w-40" />
      <SkeletonRows rows={3} height="h-32" />
    </div>
  );
}
