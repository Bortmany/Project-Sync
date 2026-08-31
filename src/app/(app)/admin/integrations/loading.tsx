// While the chat connections are being read on the server, show the shape of the two cards.

import { Skeleton, SkeletonRows } from "@/components/ui";

export default function AdminIntegrationsLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-7 w-48" />
      <SkeletonRows rows={2} height="h-48" />
    </div>
  );
}
