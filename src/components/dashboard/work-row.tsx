// One row of the dashboard's Late and Upcoming cards and of the list a tile opens. The same row
// everywhere, so what a tile counts looks the same as what its list shows.

import Link from "next/link";
import { formatDate } from "@/components/format";
import { StatusBadge } from "@/components/ui";
import type { DashboardWorkItem } from "@/lib/zod-schemas";

/** "5 days late" / "1 day late". */
export function lateText(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"} late`;
}

/** "today" / "tomorrow" / "in 3 days". */
export function untilText(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

export function WorkRow({ item }: { item: DashboardWorkItem }) {
  const late = item.isOverdue;
  const figure = late ? lateText(item.daysLate ?? 1) : untilText(item.daysUntil ?? 0);
  const color = late ? "var(--status-blocked)" : "var(--brand-ink)";
  return (
    <li>
      <Link
        href={item.kind === "MAIN" ? `/tasks/${item.id}` : `/discipline-tasks/${item.id}`}
        className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-1 py-2 hover:bg-[var(--page-bg)] lg:flex-nowrap"
      >
        <span className="order-1 min-w-0 basis-full truncate text-sm text-[var(--brand-text)] lg:order-2 lg:flex-1 lg:basis-auto">
          {item.title}
        </span>
        <span
          className="order-2 w-28 shrink-0 text-sm font-semibold lg:order-1"
          style={{ color }}
        >
          {formatDate(item.deadline)}
        </span>
        <span className="order-3 flex shrink-0 items-center gap-2">
          <span className="rounded-full bg-[var(--page-bg)] px-2 py-0.5 text-xs text-[var(--brand-text)]">
            {item.projectCode}
          </span>
          <StatusBadge status={item.status} />
        </span>
        <span className="order-4 ml-auto shrink-0 text-sm font-bold" style={{ color }}>
          {figure}
        </span>
      </Link>
    </li>
  );
}
