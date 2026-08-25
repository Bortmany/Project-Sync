// While the discipline catalogue is being read on the server, show the shape of the table.

import { Skeleton, SkeletonRows } from "@/components/ui";

export default function AdminDisciplinesLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-7 w-48" />
      <SkeletonRows rows={8} height="h-11" />
    </div>
  );
}
