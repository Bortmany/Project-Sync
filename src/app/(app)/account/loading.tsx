// While the account cards (two-factor, email choices, deletion) are read on the server.

import { Skeleton, SkeletonRows } from "@/components/ui";

export default function AccountLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <Skeleton className="h-7 w-48" />
      <SkeletonRows rows={3} height="h-40" />
    </div>
  );
}
