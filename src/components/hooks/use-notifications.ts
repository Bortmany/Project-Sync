// The notification hooks: the list, the unread count the bell polls, and the two ways to clear them.
//
// The fetch/unwrap helper and the DTO shapes are the shared ones — readRoute from use-api.ts and the
// schemas from src/lib/zod-schemas.ts. Nothing is redefined here.

"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { z } from "zod";
import { markAllNotificationsRead, markNotificationRead } from "@/components/actions";
import { readRoute } from "@/components/hooks/use-api";
import { NotificationDTO, UnreadCountDTO } from "@/lib/zod-schemas";

/** Every notification query hangs off this key, so one invalidate refreshes the list and the bell. */
export const NOTIFICATIONS_KEY = ["notifications"] as const;
export const UNREAD_KEY = ["notifications", "unread"] as const;

/** How often the bell asks the server whether anything new arrived. */
const POLL_MS = 60_000;

/**
 * This person's notifications, newest first (up to 100). Deliberately not polled: the tiny
 * unread-count route is what runs every minute, and marking anything read invalidates this key,
 * so the list is fetched when it is opened and after a change — never a hundred rows a minute.
 */
export function useNotifications(): UseQueryResult<NotificationDTO[]> {
  return useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: () => readRoute("/api/notifications", z.array(NotificationDTO)),
  });
}

/** The number on the bell. Polled every minute. */
export function useUnreadCount(): UseQueryResult<number> {
  return useQuery({
    queryKey: UNREAD_KEY,
    queryFn: async () => (await readRoute("/api/notifications/unread-count", UnreadCountDTO)).unread,
    refetchInterval: POLL_MS,
    staleTime: 0,
  });
}

/** Marks one notification read. Used when a row is clicked. */
export function useMarkRead(): UseMutationResult<NotificationDTO, Error, string> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const result = await markNotificationRead({ id });
      if (!result.ok) throw new Error(result.error);
      return result.data;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
    },
  });
}

/** Clears everything unread in one go. */
export function useMarkAllRead(): UseMutationResult<{ count: number }, Error, void> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const result = await markAllNotificationsRead();
      if (!result.ok) throw new Error(result.error);
      return result.data;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
    },
  });
}

/** Unread first, then the rest — the "New" / "Earlier" grouping both screens use. */
export function groupNotifications(items: NotificationDTO[]): {
  unread: NotificationDTO[];
  read: NotificationDTO[];
} {
  return {
    unread: items.filter((item) => item.readAt === null),
    read: items.filter((item) => item.readAt !== null),
  };
}
