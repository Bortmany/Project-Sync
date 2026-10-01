// While "Your day" is worked out on the server inside the Teams tab, show the shape of it.

import { Skeleton, SkeletonRows } from "@/components/ui";

export default function TeamsLoading() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-6 w-40" />
      <SkeletonRows rows={5} height="h-14" />
    </div>
  );
}
