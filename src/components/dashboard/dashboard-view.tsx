// The dashboard's data regions: six tiles, my tasks, discipline progress, upcoming deadlines,
// recent activity. One /api/dashboard read feeds them all; each region has its own states.

"use client";

import Link from "next/link";
import { ActivityFeed, ActivitySkeleton } from "@/components/activity/activity-item";
import { AskTieloraDashboardCard } from "@/components/ai/ask-tielora-entry";
import { AnnouncementStrip } from "@/components/posts/announcement-strip";
import { MyTaskGroups } from "@/components/tasks/my-task-rows";
import { isManager, useDashboard, useMe } from "@/components/hooks/use-api";
import { formatDate } from "@/components/format";
import { WorkRow } from "@/components/dashboard/work-row";
import {
  Card,
  CompanyBadge,
  DisciplineDot,
  EmptyState,
  ErrorBanner,
  ProgressBar,
  Skeleton,
  SkeletonRows,
  StatTile,
} from "@/components/ui";
import type { MeDTO } from "@/components/hooks/use-api";
import type { DashboardDTO } from "@/lib/zod-schemas";
import type { AskProject } from "@/server/services/ai-panel";

const TILES = [
  { label: "All tasks", key: "total", href: "/dashboard/list?tile=all", hint: "Every main task and discipline task in the projects you can see." },
  { label: "In progress", key: "inProgress", href: "/dashboard/list?tile=in-progress", hint: "Tasks someone is working on now." },
  { label: "Completed", key: "completed", href: "/dashboard/list?tile=completed", hint: "Tasks that are finished." },
  { label: "Blocked", key: "blocked", href: "/dashboard/list?tile=blocked", hint: "Tasks that cannot move until something else is done." },
  { label: "Late", key: "overdue", href: "/dashboard/list?tile=late", hint: "Main tasks and discipline tasks past their deadline and not finished." },
  { label: "Due in 14 days", key: "dueSoon", href: "/dashboard/list?tile=upcoming", hint: "Unfinished tasks with a deadline in the next 14 days. The same list as Upcoming below." },
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
    data.lateTasks.length === 0 &&
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

export function DashboardView({ askProjects = null }: { askProjects?: AskProject[] | null }) {
  const dashboard = useDashboard();
  const me = useMe();
  const data = dashboard.data;
  const loading = dashboard.isPending;
  const failed = dashboard.isError;
  const retry = () => void dashboard.refetch();

  // Who is signed in decides what the first-run panel says, so nothing is shown until that read
  // lands — otherwise an administrator sees the "your project manager will add you" wording flash.
  if (!loading && !failed && data && nothingToShow(data)) {
    // Even a workspace with no work in it yet can have company news waiting on it, so the strip
    // stays above the first-run panel rather than disappearing with the rest of the page.
    return me.isPending ? null : (
      <div className="space-y-6">
        <AnnouncementStrip />
        <FirstRun me={me.data} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/*
        Company news sits above somebody's own numbers: it is usually time-sensitive and somebody
        else decided it mattered. It renders nothing at all when there is none, and fails silently.
      */}
      <AnnouncementStrip />

      {/* Ask Tielora: the server only hands over a list when the key is set, the company has it
          switched on, the person is internal and on at least one project. Null draws nothing. It
          arrives with the tiles (never a skeleton of its own) and not at all if the page failed. */}
      {askProjects && !loading && !failed && data ? <AskTieloraDashboardCard projects={askProjects} /> : null}

      <p className="-mb-3 text-xs text-[var(--brand-text)]">
        {data?.scope === "OWN" ? "Your work" : "Across the whole company"}
      </p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {TILES.map((tile) =>
          loading || !data ? (
            <Skeleton key={tile.key} className="h-20 w-full" />
          ) : (
            <Link
              key={tile.key}
              href={tile.href}
              title={tile.hint}
              className="rounded-[var(--radius)]"
            >
              <StatTile
                label={tile.label}
                value={data.counts[tile.key]}
                alert={tile.key === "overdue" && data.counts.overdue > 0}
              />
            </Link>
          ),
        )}
      </div>

      {/*
        "Needs your sign-off" only appears when there is something in it, so a company that uses no
        contractors never sees an empty card. A contractor never sees it at all — the queue comes
        back empty for them by rule, not by chance.
      */}
      {!loading && data && data.awaitingMySignoff.length > 0 ? (
        <Card title={`Needs your sign-off (${data.awaitingMySignoff.length})`}>
          <ul className="divide-y divide-[var(--border)]">
            {data.awaitingMySignoff.slice(0, 5).map((item) => (
              <li key={item.id}>
                <Link
                  href={`/discipline-tasks/${item.id}`}
                  className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-1 py-2 hover:bg-[var(--page-bg)]"
                >
                  <DisciplineDot colorHex={item.disciplineColorHex} code={item.disciplineCode} />
                  <span className="min-w-0 flex-1 basis-40 truncate text-sm font-semibold text-[var(--brand-ink)]">
                    {item.title}
                  </span>
                  {item.assigneeName ? (
                    <span className="flex shrink-0 flex-wrap items-center gap-2 text-sm text-[var(--brand-text)]">
                      {item.assigneeName}
                      <CompanyBadge companyName={item.assigneeCompanyName} />
                    </span>
                  ) : null}
                  <span
                    className="shrink-0 text-sm"
                    style={{ color: item.isOverdue ? "var(--status-blocked)" : "var(--brand-text)" }}
                  >
                    {formatDate(item.deadline)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title="My tasks"
          action={
            <Link
              href="/my-tasks"
              className="relative text-sm font-semibold text-[var(--brand-primary)] after:absolute after:-inset-x-1 after:-inset-y-3.5 after:content-['']"
            >
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
                    className="flex min-h-11 items-center gap-3 rounded-[var(--radius)] px-1 hover:bg-[var(--page-bg)]"
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
          title={`Late${data ? ` (${data.counts.overdue})` : ""}`}
          action={
            <Link
              href="/dashboard/list?tile=late"
              className="relative text-sm font-semibold text-[var(--brand-primary)] after:absolute after:-inset-x-1 after:-inset-y-3.5 after:content-['']"
            >
              View all →
            </Link>
          }
        >
          {failed ? (
            <ErrorBanner message="Couldn't load late tasks. Try refreshing the page." onRetry={retry} />
          ) : loading || !data ? (
            <SkeletonRows rows={3} />
          ) : data.lateTasks.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--brand-text)]">
              Nothing is late. Nice work, team.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {data.lateTasks.slice(0, 5).map((item) => (
                <WorkRow key={`${item.kind}-${item.id}`} item={item} />
              ))}
            </ul>
          )}
        </Card>

        <Card
          title={`Upcoming${data ? ` (${data.counts.dueSoon})` : ""}`}
          action={
            <Link
              href="/dashboard/list?tile=upcoming"
              className="relative text-sm font-semibold text-[var(--brand-primary)] after:absolute after:-inset-x-1 after:-inset-y-3.5 after:content-['']"
            >
              View all →
            </Link>
          }
        >
          <p className="-mt-1 mb-2 text-xs text-[var(--brand-text)]">Due in the next 14 days</p>
          {failed ? (
            <ErrorBanner
              message="Couldn't load upcoming tasks. Try refreshing the page."
              onRetry={retry}
            />
          ) : loading || !data ? (
            <SkeletonRows rows={3} />
          ) : data.upcomingDeadlines.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--brand-text)]">
              Nothing due in the next 14 days. Enjoy the quiet.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {data.upcomingDeadlines.slice(0, 5).map((item) => (
                <WorkRow key={`${item.kind}-${item.id}`} item={item} />
              ))}
            </ul>
          )}
        </Card>
      </div>

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
  );
}
