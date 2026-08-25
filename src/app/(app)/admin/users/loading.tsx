// While the people directory is being read on the server, show the shape of the table.

import { Skeleton, SkeletonRows } from "@/components/ui";

export default function AdminUsersLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-9 w-full max-w-sm" />
      <SkeletonRows rows={8} height="h-11" />
    </div>
  );
}
