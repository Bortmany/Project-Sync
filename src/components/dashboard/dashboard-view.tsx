// The dashboard's data regions: six tiles, my tasks, discipline progress, upcoming deadlines,
// recent activity. One /api/dashboard read feeds them all; each region has its own states.

"use client";

import Link from "next/link";
import { ActivityFeed, ActivitySkeleton } from "@/components/activity/activity-item";
import { MyTaskGroups } from "@/components/tasks/my-task-rows";
import { isManager, useDashboard, useMe } from "@/components/hooks/use-api";
import { formatShortDate } from "@/components/format";
import {
  Card,
  DisciplineDot,
  EmptyState,
  ErrorBanner,
  ProgressBar,
  Skeleton,
  SkeletonRows,
  StatTile,
  StatusBadge,
} from "@/components/ui";
import type { MeDTO } from "@/components/hooks/use-api";
import type { DashboardDTO } from "@/lib/zod-schemas";

const TILES = [
  { label: "Total", key: "total", href: "/my-tasks" },
  { label: "In progress", key: "inProgress", href: "/my-tasks?status=IN_PROGRESS" },
  { label: "Completed", key: "completed", href: "/my-tasks?status=COMPLETED" },
  { label: "Blocked", key: "blocked", href: "/my-tasks?status=BLOCKED" },
  { label: "Overdue", key: "overdue", href: "/my-tasks?due=overdue" },
  { label: "Due soon", key: "dueSoon", href: "/my-tasks?due=week" },
] as const;

/**
 * A workspace with nothing in it yet. The dashboard read returns empty everywhere when the person
 * can see no project at all (`emptyDashboard()` in src/server/services/dashboard.ts), which is what
 * a company sees on the day it signs up — and what someone sees before they are added to a project.
 */
function nothingToShow(data: DashboardDTO): boolean {
  return (
    data.counts.total === 0 &&
    data.myTasks.length === 0 &&
    data.disciplineProgress.length === 0 &&
    data.upcomingDeadlines.length === 0 &&
    data.recentActivity.length === 0
  );
}

/**
 * The first thing a brand-new workspace sees: what to do next, in order.
 *
 * The same screen answers two situations, because the dashboard read cannot tell them apart: a
 * company with no projects at all, and someone who has not been added to one yet. What each person
 * can actually do decides the wording — an administrator or project manager is told to create the
 * first project, everybody else is told who will add them.
 */
function FirstRun({ me }: { me: MeDTO | undefined }) {
  const canCreate = isManager(me);
  const isAdmin = me?.role === "ADMIN";

  return (
    <EmptyState
      message={canCreate ? "This workspace has no projects yet." : "You're not on any projects yet."}
      action={
        <div className="space-y-3">
          {canCreate ? (
            <>
              <ol className="mx-auto max-w-sm space-y-1 text-left text-sm text-[var(--brand-text)]">
                <li>1. Create your first project.</li>
                {isAdmin ? <li>2. Add your team from the Users page in the sidebar.</li> : null}
              </ol>
              <Link
                href="/projects?new=1"
                className="inline-flex items-center justify-center rounded-[var(--radius)] bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--brand-mid)]"
              >
                Create your first project
              </Link>
            </>
          ) : (
            <p className="text-sm text-[var(--brand-text)]">
              Your project manager creates projects and adds you to them.
            </p>
          )}
        </div>
      }
    />
  );
}

export function DashboardView() {
  const dashboard = useDashboard();
  const me = useMe();
  const data = dashboard.data;
  const loading = dashboard.isPending;
  const failed = dashboard.isError;
  const retry = () => void dashboard.refetch();

  // Who is signed in decides what the first-run panel says, so nothing is shown until that read
  // lands — otherwise an administrator sees the "your project manager will add you" wording flash.
  if (!loading && !failed && data && nothingToShow(data)) {
    return me.isPending ? null : <FirstRun me={me.data} />;
  }

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
            <Link href="/my-tasks" className="text-sm font-semibold text-[var(--brand-primary)]">
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
            <EmptyState
              compact
              message="No tasks assigned to you yet. Once you're added to a discipline task, it'll show up here."
              action={
                <Link
                  href="/projects"
                  className="inline-flex items-center justify-center rounded-[var(--radius)] border border-[var(--brand-primary)] bg-white px-4 py-2 text-sm font-semibold text-[var(--brand-primary)] transition-colors hover:bg-[var(--page-bg)]"
                >
                  View projects
                </Link>
              }
            />
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
            <p className="py-6 text-center text-sm text-[var(--brand-text)]">
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
                    <span className="w-24 shrink-0 truncate text-sm text-[var(--brand-ink)] sm:w-32">
                      {row.name}
                    </span>
                    <span className="min-w-0 flex-1">
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
            <Link href="/my-tasks" className="text-sm font-semibold text-[var(--brand-primary)]">
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
            <p className="py-6 text-center text-sm text-[var(--brand-text)]">
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
                    className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-1 py-2 hover:bg-[var(--page-bg)]"
                  >
                    <span
                      className="w-16 shrink-0 text-sm font-semibold"
                      style={{
                        color: item.isOverdue ? "var(--status-blocked)" : "var(--brand-ink)",
                      }}
                    >
                      {formatShortDate(item.deadline)}
                    </span>
                    <span className="min-w-0 flex-1 basis-40 truncate text-sm text-[var(--brand-text)]">
                      {item.title}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="rounded-full bg-[var(--page-bg)] px-2 py-0.5 text-xs text-[var(--brand-text)]">
                        {item.projectCode}
                      </span>
                      <StatusBadge status={item.status} />
                    </span>
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
            <p className="py-6 text-center text-sm text-[var(--brand-text)]">
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
