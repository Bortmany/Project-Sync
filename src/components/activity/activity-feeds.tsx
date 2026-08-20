// The three audit-trail feeds: one main task (with its discipline tasks rolled up), one discipline
// task, and a whole project. Each one is the same feed with its own fetch and its own empty line.

"use client";

import {
  useDisciplineTaskActivity,
  useMainTaskActivity,
  useProjectActivity,
} from "@/components/hooks/use-api";
import { ActivityFeed, ActivitySkeleton } from "@/components/activity/activity-item";
import { EmptyState, ErrorBanner } from "@/components/ui";
import type { ActivityItemDTO } from "@/lib/zod-schemas";

function Feed({
  items,
  isPending,
  isError,
  onRetry,
  emptyMessage,
}: {
  items: ActivityItemDTO[] | undefined;
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  emptyMessage: string;
}) {
  if (isError) {
    return (
      <ErrorBanner message="Couldn't load activity. Try refreshing the page." onRetry={onRetry} />
    );
  }
  if (isPending) return <ActivitySkeleton rows={6} />;
  if ((items?.length ?? 0) === 0) return <EmptyState message={emptyMessage} />;
  return <ActivityFeed items={items ?? []} />;
}

export function MainTaskActivity({ mainTaskId }: { mainTaskId: string }) {
  const activity = useMainTaskActivity(mainTaskId);
  return (
    <Feed
      items={activity.data}
      isPending={activity.isPending}
      isError={activity.isError}
      onRetry={() => void activity.refetch()}
      emptyMessage="No activity yet."
    />
  );
}

export function DisciplineTaskActivity({ disciplineTaskId }: { disciplineTaskId: string }) {
  const activity = useDisciplineTaskActivity(disciplineTaskId);
  return (
    <Feed
      items={activity.data}
      isPending={activity.isPending}
      isError={activity.isError}
      onRetry={() => void activity.refetch()}
      emptyMessage="No activity yet."
    />
  );
}

export function ProjectActivity({ projectId }: { projectId: string }) {
  const activity = useProjectActivity(projectId);
  return (
    <Feed
      items={activity.data}
      isPending={activity.isPending}
      isError={activity.isError}
      onRetry={() => void activity.refetch()}
      emptyMessage="No activity on this project yet."
    />
  );
}
