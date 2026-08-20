// The dashboard's data regions: six tiles, my tasks, discipline progress, upcoming deadlines,
// recent activity. One /api/dashboard read feeds them all; each region has its own states.

"use client";

import Link from "next/link";
import { ActivityFeed, ActivitySkeleton } from "@/components/activity/activity-item";
import { MyTaskGroups } from "@/components/tasks/my-task-rows";
import { useDashboard } from "@/components/hooks/use-api";
import { formatShortDate } from "@/components/format";
import {
  Card,
  DisciplineDot,
  ErrorBanner,
  ProgressBar,
  Skeleton,
  SkeletonRows,
  StatTile,
  StatusBadge,
} from "@/components/ui";

const TILES = [
  { label: "Total", key: "total", href: "/my-tasks" },
  { label: "In progress", key: "inProgress", href: "/my-tasks?status=IN_PROGRESS" },
  { label: "Completed", key: "completed", href: "/my-tasks?status=COMPLETED" },
  { label: "Blocked", key: "blocked", href: "/my-tasks?status=BLOCKED" },
  { label: "Overdue", key: "overdue", href: "/my-tasks?due=overdue" },
  { label: "Due soon", key: "dueSoon", href: "/my-tasks?due=week" },
] as const;

export function DashboardView() {
  const dashboard = useDashboard();
  const data = dashboard.data;
  const loading = dashboard.isPending;
  const failed = dashboard.isError;
  const retry = () => void dashboard.refetch();

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {TILES.map((tile) =>
          loading || !data ? (
            <Skeleton key={tile.key} className="h-20 w-full" />
          ) : (
            <Link key={tile.key} href={tile.href} className="rounded-[var(--radius)]">
              <StatTile
                label={tile.label}
                value={data.counts[tile.key]}
                alert={tile.key === "overdue" && data.counts.overdue > 0}
              />
            </Link>
          ),
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title="My tasks"
          action={
            <Link href="/my-tasks" className="text-sm font-semibold text-[var(--olng-blue)]">
              View all →
            </Link>
          }
        >
          {failed ? (
            <ErrorBanner message="Couldn't load your tasks. Try refreshing the page." onRetry={retry} />
          ) : loading || !data ? (
            <div className="space-y-2">
              <Skeleton className="h-3 w-24" />
              <SkeletonRows rows={4} />
            </div>
          ) : data.myTasks.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--olng-text)]">
              No tasks assigned to you yet. Once you&apos;re added to a discipline task, it&apos;ll
              show up here.
            </p>
          ) : (
            <MyTaskGroups tasks={data.myTasks.slice(0, 8)} />
          )}
        </Card>

        <Card title="Discipline progress">
          {failed ? (
            <ErrorBanner
              message="Couldn't load discipline progress. Try refreshing the page."
              onRetry={retry}
            />
          ) : loading || !data ? (
            <SkeletonRows rows={4} height="h-6" />
          ) : data.disciplineProgress.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--olng-text)]">
              No discipline tasks yet. Progress will appear here once tasks are created.
            </p>
          ) : (
            <ul className="space-y-3">
              {data.disciplineProgress.map((row) => (
                <li key={row.disciplineId}>
                  <Link
                    href={`/my-tasks?discipline=${encodeURIComponent(row.code)}`}
                    className="flex min-h-9 items-center gap-3 rounded-[var(--radius)] px-1 hover:bg-[var(--page-bg)]"
                  >
                    <DisciplineDot colorHex={row.colorHex} code={row.code} />
                    <span className="w-32 shrink-0 truncate text-sm text-[var(--olng-navy)]">
                      {row.name}
                    </span>
                    <span className="flex-1">
                      <ProgressBar pct={row.pct} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title="Upcoming deadlines"
          action={
            <Link href="/my-tasks" className="text-sm font-semibold text-[var(--olng-blue)]">
              View all →
            </Link>
          }
        >
          {failed ? (
            <ErrorBanner
              message="Couldn't load upcoming deadlines. Try refreshing the page."
              onRetry={retry}
            />
          ) : loading || !data ? (
            <SkeletonRows rows={3} />
          ) : data.upcomingDeadlines.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--olng-text)]">
              Nothing due soon. You&apos;re all caught up.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {data.upcomingDeadlines.slice(0, 5).map((item) => (
                <li key={`${item.kind}-${item.id}`}>
                  <Link
                    href={
                      item.kind === "MAIN" ? `/tasks/${item.id}` : `/discipline-tasks/${item.id}`
                    }
                    className="flex min-h-11 items-center gap-3 px-1 py-2 hover:bg-[var(--page-bg)]"
                  >
                    <span
                      className="w-16 shrink-0 text-sm font-semibold"
                      style={{
                        color: item.isOverdue ? "var(--status-blocked)" : "var(--olng-navy)",
                      }}
                    >
                      {formatShortDate(item.deadline)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-[var(--olng-text)]">
                      {item.title}
                    </span>
                    <span className="rounded-full bg-[var(--page-bg)] px-2 py-0.5 text-xs text-[var(--olng-text)]">
                      {item.projectCode}
                    </span>
                    <StatusBadge status={item.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Recent activity">
          {failed ? (
            <ErrorBanner
              message="Couldn't load recent activity. Try refreshing the page."
              onRetry={retry}
            />
          ) : loading || !data ? (
            <ActivitySkeleton />
          ) : data.recentActivity.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--olng-text)]">
              No activity yet. Things will start showing up here as work gets underway.
            </p>
          ) : (
            <ActivityFeed items={data.recentActivity.slice(0, 8)} />
          )}
        </Card>
      </div>
    </div>
  );
}
