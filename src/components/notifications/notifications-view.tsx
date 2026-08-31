// The full notifications page: everything waiting for you, newest first, in two groups.

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { NotificationRow } from "@/components/notifications/notification-row";
import {
  groupNotifications,
  useMarkAllRead,
  useMarkRead,
  useNotifications,
} from "@/components/hooks/use-notifications";
import { Button, EmptyState, ErrorBanner, SkeletonRows } from "@/components/ui";
import type { NotificationDTO } from "@/lib/zod-schemas";

/** How many rows show before "Load more". */
const PAGE_SIZE = 20;

export function NotificationsView() {
  const router = useRouter();
  const list = useNotifications();
  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();
  const [shown, setShown] = useState(PAGE_SIZE);

  const items = list.data ?? [];
  const visible = items.slice(0, shown);
  const groups = groupNotifications(visible);
  const unreadTotal = items.filter((item) => item.readAt === null).length;

  function openItem(item: NotificationDTO) {
    if (item.readAt === null) markRead.mutate(item.id);
    router.push(item.linkUrl);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-[var(--brand-primary)]">Notifications</h1>
        <Button
          variant="secondary"
          onClick={() => markAllRead.mutate()}
          disabled={unreadTotal === 0 || markAllRead.isPending}
        >
          Mark all read
        </Button>
      </div>

      {list.isError ? (
        <ErrorBanner
          message="Couldn't load notifications. Try refreshing the page."
          onRetry={() => void list.refetch()}
        />
      ) : null}

      {list.isPending ? <SkeletonRows rows={6} height="h-12" /> : null}

      {!list.isPending && !list.isError && items.length === 0 ? (
        <EmptyState
          message="You're all caught up. We'll let you know when something needs your attention."
          action={
            <Link
              href="/dashboard"
              className="inline-flex items-center justify-center rounded-[var(--radius)] border border-[var(--brand-primary)] bg-white px-4 py-2 text-sm font-semibold text-[var(--brand-primary)] transition-colors hover:bg-[var(--page-bg)]"
            >
              Go to dashboard
            </Link>
          }
        />
      ) : null}

      {visible.length > 0 ? (
        <div className="space-y-6">
          {groups.unread.length > 0 ? (
            <section className="space-y-1">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--brand-gray)]">
                New
              </h2>
              <div className="divide-y divide-[var(--border)] rounded-[var(--radius)] border border-[var(--border)] bg-white">
                {groups.unread.map((item) => (
                  <NotificationRow key={item.id} item={item} onOpen={openItem} />
                ))}
              </div>
            </section>
          ) : null}

          {groups.read.length > 0 ? (
            <section className="space-y-1">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--brand-gray)]">
                Earlier
              </h2>
              <div className="divide-y divide-[var(--border)] rounded-[var(--radius)] border border-[var(--border)] bg-white">
                {groups.read.map((item) => (
                  <NotificationRow key={item.id} item={item} onOpen={openItem} />
                ))}
              </div>
            </section>
          ) : null}

          {items.length > shown ? (
            <div className="text-center">
              <Button variant="ghost" onClick={() => setShown((value) => value + PAGE_SIZE)}>
                Load more
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
