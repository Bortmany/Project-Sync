// ActivityItem — one line of the audit trail: who did what, when. Reused by the dashboard feed,
// the project Activity tab and the task Activity tabs.

import Link from "next/link";
import type { ReactNode } from "react";
import type { ActivityItemDTO } from "@/lib/zod-schemas";
import { Skeleton } from "@/components/ui";
import { dayKey, formatDate, formatRelative } from "@/components/format";

function toneFor(action: string): string {
  const value = action.toUpperCase();
  if (value.includes("COMPLETE")) return "var(--status-completed)";
  if (value.includes("BLOCK") || value.includes("OVERRIDE") || value.includes("DELETE")) {
    return "var(--status-blocked)";
  }
  if (value.includes("DOCUMENT") || value.includes("UPLOAD")) return "var(--olng-sand)";
  if (value.includes("COMMENT")) return "var(--olng-gray)";
  return "var(--olng-blue)";
}

/** Where an activity row points, or null when the entity has no screen of its own yet. */
export function activityHref(item: ActivityItemDTO): string | null {
  const type = item.entityType.toUpperCase();
  if (type.includes("DISCIPLINE_TASK")) return `/discipline-tasks/${item.entityId}`;
  if (type.includes("MAIN_TASK")) return `/tasks/${item.entityId}`;
  if (type.includes("PROJECT")) return `/projects/${item.entityId}`;
  return null;
}

export function ActivityItem({ item }: { item: ActivityItemDTO }) {
  const href = activityHref(item);

  // Audit summaries are written as full sentences ("Layla al-Riyami created…"), so the name is only
  // added in front when the summary does not already start with it.
  const repeatsName = Boolean(item.actorName) && item.summary.startsWith(item.actorName as string);

  const body: ReactNode = (
    <span className="text-sm text-[var(--olng-text)]">
      {item.actorName && !repeatsName ? (
        <span className="font-semibold text-[var(--olng-navy)]">{item.actorName} </span>
      ) : null}
      {item.summary}
    </span>
  );

  return (
    <div className="flex items-start gap-3 py-2">
      <span
        className="mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: toneFor(item.action), opacity: 0.9 }}
        aria-hidden="true"
      >
        <span className="h-2 w-2 rounded-full bg-white" />
      </span>
      <span className="min-w-0 flex-1">
        {href ? (
          <Link href={href} className="hover:underline">
            {body}
          </Link>
        ) : (
          body
        )}
        <span className="mt-0.5 block text-xs text-[var(--olng-gray)]">
          {formatRelative(item.createdAt)}
        </span>
      </span>
    </div>
  );
}

/** The feed itself: activity rows newest first, with a thin divider between days. */
export function ActivityFeed({ items }: { items: ActivityItemDTO[] }) {
  let lastDay = "";
  return (
    <div className="divide-y divide-[var(--border)]">
      {items.map((item) => {
        const key = dayKey(item.createdAt);
        const showDivider = key !== lastDay;
        lastDay = key;
        return (
          <div key={item.id}>
            {showDivider ? <DayDivider date={item.createdAt} /> : null}
            <ActivityItem item={item} />
          </div>
        );
      })}
    </div>
  );
}

/** Loading placeholder shaped like activity rows. */
export function ActivitySkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading activity">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-start gap-3">
          <Skeleton className="h-6 w-6 rounded-full" />
          <div className="flex-1 space-y-1">
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-2 w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Kept out of ActivityItem on purpose — the parent feed decides where days break. */
export function DayDivider({ date }: { date: Date }) {
  return (
    <div className="flex items-center gap-2 py-2">
      <span className="h-px flex-1 bg-[var(--border)]" />
      <span className="text-[11px] uppercase tracking-wide text-[var(--olng-gray)]">
        {formatDate(date)}
      </span>
      <span className="h-px flex-1 bg-[var(--border)]" />
    </div>
  );
}
