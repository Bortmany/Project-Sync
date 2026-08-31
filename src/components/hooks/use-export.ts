// The Data & privacy page's one read: where the workspace export has got to.
//
// The same polling shape the notification bell uses (src/components/hooks/use-notifications.ts) —
// a small route asked at an interval — with one difference: it only polls WHILE an export is being
// prepared. Once it is ready, or has failed, there is nothing left to wait for and the polling
// stops on its own.

"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { readRoute } from "@/components/hooks/use-api";
import { WorkspaceExportStatusDTO } from "@/lib/zod-schemas";

export const WORKSPACE_EXPORT_KEY = ["workspace-export"] as const;

/** How often the page asks whether the archive is finished. */
const POLL_MS = 5_000;

export function useWorkspaceExportStatus(
  initialData: WorkspaceExportStatusDTO,
): UseQueryResult<WorkspaceExportStatusDTO> {
  return useQuery({
    queryKey: WORKSPACE_EXPORT_KEY,
    queryFn: () => readRoute("/api/admin/export/status", WorkspaceExportStatusDTO),
    initialData,
    refetchInterval: (query) => (query.state.data?.state === "WORKING" ? POLL_MS : false),
    staleTime: 0,
  });
}
