// While the boards are being read, show the shape of the tab strip and the feed under it.

import { Skeleton, SkeletonRows } from "@/components/ui";

export default function MessagesLoading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-64" />
      <SkeletonRows rows={3} height="h-24" />
    </div>
  );
}
