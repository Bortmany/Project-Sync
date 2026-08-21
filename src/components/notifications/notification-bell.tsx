// The topbar bell: how many notifications are waiting, and the eight newest behind a click.

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BellIcon } from "@/components/shell/icons";
import { NotificationRow } from "@/components/notifications/notification-row";
import { Badge } from "@/components/ui";
import {
  groupNotifications,
  useMarkAllRead,
  useMarkRead,
  useNotifications,
  useUnreadCount,
} from "@/components/hooks/use-notifications";
import type { NotificationDTO } from "@/lib/zod-schemas";

const DROPDOWN_LIMIT = 8;

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const unread = useUnreadCount();
  const list = useNotifications();
  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();

  const count = unread.data ?? 0;
  const items = (list.data ?? []).slice(0, DROPDOWN_LIMIT);
  const groups = groupNotifications(items);

  function openItem(item: NotificationDTO) {
    if (item.readAt === null) markRead.mutate(item.id);
    setOpen(false);
    router.push(item.linkUrl);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={count > 0 ? `Notifications, ${count} unread` : "Notifications"}
        className="relative rounded-[var(--radius)] p-2 text-[var(--olng-text)] hover:bg-[var(--page-bg)]"
      >
        <BellIcon />
        {count > 0 ? (
          <span className="absolute -right-1 -top-1">
            <Badge color="var(--status-blocked)">{count > 99 ? "99+" : count}</Badge>
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-2 w-[360px] max-w-[calc(100vw-1rem)] rounded-[var(--radius)] border border-[var(--border)] bg-white shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
            <span className="text-sm font-semibold text-[var(--olng-blue)]">Notifications</span>
            {count > 0 ? (
              <button
                type="button"
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
                className="text-xs font-semibold text-[var(--olng-blue)] hover:underline disabled:text-[var(--olng-gray)]"
              >
                Mark all read
              </button>
            ) : null}
          </div>

          <div className="max-h-96 overflow-y-auto py-1">
            {list.isPending ? (
              <p className="px-3 py-6 text-center text-sm text-[var(--olng-gray)]">Loading…</p>
            ) : list.isError ? (
              <p className="px-3 py-6 text-center text-sm text-[var(--status-blocked)]">
                Couldn&apos;t load notifications. Try refreshing the page.
              </p>
            ) : items.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-[var(--olng-text)]">
                You&apos;re all caught up. Nothing to see here.
              </p>
            ) : (
              <>
                {groups.unread.length > 0 ? (
                  <p className="px-3 pb-1 pt-2 text-[11px] uppercase tracking-wide text-[var(--olng-gray)]">
                    New
                  </p>
                ) : null}
                {groups.unread.map((item) => (
                  <NotificationRow key={item.id} item={item} onOpen={openItem} compact />
                ))}

                {groups.read.length > 0 ? (
                  <p className="px-3 pb-1 pt-2 text-[11px] uppercase tracking-wide text-[var(--olng-gray)]">
                    Earlier
                  </p>
                ) : null}
                {groups.read.map((item) => (
                  <NotificationRow key={item.id} item={item} onOpen={openItem} compact />
                ))}
              </>
            )}
          </div>

          <div className="border-t border-[var(--border)] px-3 py-2 text-right">
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="text-xs font-semibold text-[var(--olng-blue)] hover:underline"
            >
              View all notifications →
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
