// While the integration cards (Microsoft, Teams app, AI, chat) are read on the server, show their shape.

import { Skeleton, SkeletonRows } from "@/components/ui";

export default function AdminIntegrationsLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-7 w-48" />
      <SkeletonRows rows={4} height="h-48" />
    </div>
  );
}
