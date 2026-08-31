// The dashboard's announcement strip: what somebody else decided you should know, above your own
// numbers, because news is usually more time-sensitive than a count.
//
// Three deliberate behaviours, all different from the cards below it on that page:
//  - **It fails silently.** A secondary read should never plant a red banner above somebody's work,
//    so a failed load simply renders nothing (the hook does not retry either).
//  - **Nothing to show renders nothing at all** — no empty card, exactly as "Discipline progress"
//    quietly disappears when there is nothing in it.
//  - **Dismissing shows no toast.** The card vanishing IS the feedback, the same way marking a
//    notification read says nothing.

"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { dismissAnnouncement } from "@/components/actions";
import { useAction } from "@/components/hooks/use-action";
import { useAnnouncements, useMe, isExternalUser } from "@/components/hooks/use-api";
import { AnnouncementCard } from "@/components/posts/announcement-card";
import { Skeleton } from "@/components/ui";
import type { PostDTO } from "@/lib/zod-schemas";

/** How many fit above the tiles before the strip starts crowding the page it sits on. */
const MAX_CARDS = 3;

export function AnnouncementStrip() {
  const me = useMe();
  // A contractor has no noticeboard, so the read is never even made for them.
  const external = isExternalUser(me.data);
  const announcements = useAnnouncements(!me.isPending && !external);
  const queryClient = useQueryClient();
  const { run, pending } = useAction();
  const [dismissingId, setDismissingId] = useState<string | null>(null);

  if (external) return null;

  if (announcements.isPending && !announcements.isError) {
    // One block, not three: nobody knows yet how many there are, and pretending is worse than waiting.
    return <Skeleton className="h-24 w-full" />;
  }

  if (announcements.isError || !announcements.data) return null;

  const live = announcements.data.filter((post) => !post.dismissed);
  if (live.length === 0) return null;

  function dismiss(post: PostDTO) {
    setDismissingId(post.id);
    run(() => dismissAnnouncement({ id: post.id }), {
      failure: "Couldn't hide that announcement. Try again.",
      onSuccess: () => {
        setDismissingId(null);
        void queryClient.invalidateQueries({ queryKey: ["announcements"] });
      },
    });
  }

  return (
    <section className="space-y-3" aria-label="Announcements">
      {live.slice(0, MAX_CARDS).map((post) => (
        <AnnouncementCard
          key={post.id}
          post={post}
          onDismiss={dismiss}
          dismissing={pending && dismissingId === post.id}
        />
      ))}
      <p className="text-right">
        <Link
          href={`/messages?tab=${live[0]?.audience.key ?? "everyone"}`}
          className="text-sm font-semibold text-[var(--brand-primary)] hover:underline"
        >
          View all →
        </Link>
      </p>
    </section>
  );
}
