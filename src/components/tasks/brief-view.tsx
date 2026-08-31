// "Your day": a dense, factual brief of one person's own work, computed on the server.
//
// Every section says its own window in plain English, every date goes through the app's Intl
// formatting, and an empty day is one line — not a parade of empty cards.

"use client";

import Link from "next/link";
import { isExternalUser, useMe, useMyBrief } from "@/components/hooks/use-api";
import { formatDate, formatDateTime, formatDateUtc, formatRelative } from "@/components/format";
import { ErrorBanner, SkeletonRows } from "@/components/ui";
import type { BriefItemDTO, BriefSectionDTO } from "@/lib/zod-schemas";

/** One row: what it is, where it is, and the one fact that put it in this section. */
function BriefRow({ item, showDeadline }: { item: BriefItemDTO; showDeadline: boolean }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-[var(--border)] py-1.5 last:border-b-0">
      {/*
        No link when there is nowhere to go. A contractor's notice is the whole thing — the
        noticeboard it came from is a page they may not open — so the title is plain text and the
        notice itself is printed underneath.
      */}
      {item.linkUrl ? (
        <Link
          href={item.linkUrl}
          className="font-semibold text-[var(--brand-primary)] hover:underline"
        >
          {item.title}
        </Link>
      ) : (
        <span className="font-semibold text-[var(--brand-ink)]">{item.title}</span>
      )}
      {item.projectCode ? (
        <span className="text-xs text-[var(--brand-gray)]">{item.projectCode}</span>
      ) : null}
      {item.disciplineCode ? (
        <span className="text-xs text-[var(--brand-gray)]">{item.disciplineCode}</span>
      ) : null}
      {showDeadline && item.deadline ? (
        <span
          className="text-xs"
          style={{
            color: item.daysOverdue ? "var(--status-blocked)" : "var(--brand-text)",
          }}
        >
          {formatDate(item.deadline)}
        </span>
      ) : null}
      {item.daysOverdue ? (
        <span className="text-xs font-semibold text-[var(--status-blocked)]">
          {item.daysOverdue === 1 ? "1 day over" : `${item.daysOverdue} days over`}
        </span>
      ) : null}
      {item.note ? <span className="text-xs text-[var(--brand-text)]">{item.note}</span> : null}
      {item.at ? (
        <span className="text-xs text-[var(--brand-gray)]">{formatRelative(item.at)}</span>
      ) : null}
      {item.body ? (
        <span className="w-full whitespace-pre-wrap text-sm text-[var(--brand-text)]">
          {item.body}
        </span>
      ) : null}
    </li>
  );
}

function Section({
  title,
  window: windowText,
  section,
  showDeadline = true,
}: {
  title: string;
  window: string;
  section: BriefSectionDTO;
  showDeadline?: boolean;
}) {
  if (section.total === 0) return null;

  const hidden = section.total - section.items.length;

  return (
    <section className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--brand-gray)]">
        {title} ({section.total})
      </h2>
      <p className="mb-1 text-xs text-[var(--brand-gray)]">{windowText}</p>
      <ul className="text-sm">
        {section.items.map((item) => (
          <BriefRow key={`${title}-${item.id}`} item={item} showDeadline={showDeadline} />
        ))}
      </ul>
      {hidden > 0 ? (
        <p className="mt-1 text-xs text-[var(--brand-gray)]">
          {hidden === 1 ? "1 more not shown." : `${hidden} more not shown.`}
        </p>
      ) : null}
    </section>
  );
}

export function BriefView() {
  const brief = useMyBrief();
  const me = useMe();
  const contractor = isExternalUser(me.data);

  if (brief.isError) {
    return (
      <ErrorBanner
        message="Couldn't put your brief together. Try refreshing the page."
        onRetry={() => void brief.refetch()}
      />
    );
  }

  if (brief.isPending || !brief.data) return <SkeletonRows rows={6} />;

  const data = brief.data;
  const total =
    data.dueToday.total +
    data.overdue.total +
    data.newlyUnblocked.total +
    data.mentions.total +
    data.awaitingReview.total +
    data.announcements.total +
    data.awaitingAcknowledgement.total;

  const since = `The 24 hours since ${formatDateTime(data.since)}`;

  if (total === 0) {
    return (
      <p className="text-sm text-[var(--brand-text)]">
        Nothing due today, nothing overdue, nothing newly unblocked, no mentions in the last 24
        hours, nothing waiting for your review and no announcements running.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <Section
        title="Due today"
        // Deadlines are set at UTC midnight, and the server picks today's window in UTC — so the day
        // is named in UTC too, rather than quietly shifting by one wherever the reader is sitting.
        window={`Deadline of ${formatDateUtc(data.generatedAt)} (UTC)`}
        section={data.dueToday}
      />
      <Section
        title="Overdue"
        window="Deadline already passed, still open"
        section={data.overdue}
      />
      <Section
        title="Newly unblocked"
        window={`${since} — the last thing they waited on closed, or their gate opened`}
        section={data.newlyUnblocked}
      />
      <Section
        title="Mentions"
        window={since}
        section={data.mentions}
        showDeadline={false}
      />
      <Section
        title="Awaiting your review"
        window="Main tasks you own whose work is finished"
        section={data.awaitingReview}
      />
      {/*
        A contractor's version of this section is a different thing wearing the same shape, so it
        says so: "Announcement" implies the reply / dismiss / acknowledge apparatus they never get,
        and "Notices" is the honest word for a read-only list somebody included them in.
      */}
      <Section
        title={contractor ? "Notices" : "Announcements"}
        window={
          contractor
            ? "Company and project announcements this account has been included in"
            : "Still running for you — the company, your projects, your department"
        }
        section={data.announcements}
      />
      {/*
        Last on purpose: "here is what is running" and then "here is what you still have to do about
        it". Hiding one of these from the dashboard does not take it off this list.
      */}
      <Section
        title="Waiting for your acknowledgement"
        window="Still open — acknowledge from the dashboard or Messages"
        section={data.awaitingAcknowledgement}
        showDeadline={false}
      />
    </div>
  );
}
