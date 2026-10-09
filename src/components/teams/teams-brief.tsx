// The signed-in tab: "Your day" for this person, read-only. The brief is worked out on the server by
// the very same `personBrief(actor)` the browser page uses and handed in as props — the tab's own
// cookie is never sent to an API route, so this component fetches nothing.
//
// Every row is one wide, plain button that opens its Tielora page in the person's browser (Teams'
// "open link"). There is no form, no button that changes anything and no sign-out.

"use client";

import type { MouseEvent } from "react";
import { formatDate, formatDateTime, formatDateUtc, formatRelative } from "@/components/format";
import { openInBrowser } from "@/components/teams/teams-host";
import type { BriefItemDTO, BriefSectionDTO, BriefDTO } from "@/lib/zod-schemas";

function open(event: MouseEvent<HTMLAnchorElement>, href: string) {
  event.preventDefault();
  void openInBrowser(href);
}

function RowBody({ item, showDeadline }: { item: BriefItemDTO; showDeadline: boolean }) {
  return (
    <>
      <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className={`font-semibold ${item.linkUrl ? "text-[var(--brand-primary)]" : "text-[var(--brand-ink)]"}`}>
          {item.title}
        </span>
        {item.projectCode ? <span className="text-xs text-[var(--brand-gray)]">{item.projectCode}</span> : null}
        {item.disciplineCode ? (
          <span className="text-xs text-[var(--brand-gray)]">{item.disciplineCode}</span>
        ) : null}
        {showDeadline && item.deadline ? (
          <span
            className="text-xs"
            style={{ color: item.daysOverdue ? "var(--status-blocked)" : "var(--brand-text)" }}
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
        {item.at ? <span className="text-xs text-[var(--brand-gray)]">{formatRelative(item.at)}</span> : null}
      </span>
      {item.body ? (
        <span className="mt-1 block whitespace-pre-wrap break-words text-sm text-[var(--brand-text)]">
          {item.body}
        </span>
      ) : null}
    </>
  );
}

function Row({ item, showDeadline }: { item: BriefItemDTO; showDeadline: boolean }) {
  return (
    <li className="border-b border-[var(--border)] last:border-b-0">
      {/* No link where there is nowhere to go — a contractor's notice is the whole thing. */}
      {item.linkUrl ? (
        <a
          href={item.linkUrl}
          onClick={(event) => open(event, item.linkUrl)}
          title="Opens in Tielora in your browser"
          className="block min-h-11 break-words py-2.5 hover:bg-[var(--page-bg)] focus-visible:bg-[var(--page-bg)] active:bg-[var(--border)]"
        >
          <RowBody item={item} showDeadline={showDeadline} />
          <span className="sr-only"> (opens in your browser)</span>
        </a>
      ) : (
        <div className="min-h-11 break-words py-2.5">
          <RowBody item={item} showDeadline={showDeadline} />
        </div>
      )}
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
          <Row key={`${title}-${item.id}`} item={item} showDeadline={showDeadline} />
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

export function TeamsBrief({ brief, contractor }: { brief: BriefDTO; contractor: boolean }) {
  const total =
    brief.dueToday.total +
    brief.overdue.total +
    brief.newlyUnblocked.total +
    brief.mentions.total +
    brief.awaitingReview.total +
    brief.announcements.total +
    brief.awaitingAcknowledgement.total;

  const since = `The 24 hours since ${formatDateTime(brief.since)}`;

  return (
    <div className="mx-auto w-full max-w-5xl">
      <h1 className="text-xl font-semibold text-[var(--brand-primary)]">Your day</h1>

      <div className="mt-4">
        {total === 0 ? (
          <p className="text-sm text-[var(--brand-text)]">
            Nothing due today, nothing overdue, nothing newly unblocked, no mentions in the last 24
            hours, nothing waiting for your review and no announcements running.
          </p>
        ) : (
          <div className="grid items-start gap-3 lg:grid-cols-2">
            <Section
              title="Due today"
              window={`Deadline of ${formatDateUtc(brief.generatedAt)} (UTC)`}
              section={brief.dueToday}
            />
            <Section title="Overdue" window="Deadline already passed, still open" section={brief.overdue} />
            <Section
              title="Newly unblocked"
              window={`${since} — the last thing they waited on closed, or their gate opened`}
              section={brief.newlyUnblocked}
            />
            <Section title="Mentions" window={since} section={brief.mentions} showDeadline={false} />
            <Section
              title="Awaiting your review"
              window="Main tasks you own whose work is finished"
              section={brief.awaitingReview}
            />
            <Section
              title={contractor ? "Notices" : "Announcements"}
              window={
                contractor
                  ? "Company and project announcements this account has been included in"
                  : "Still running for you — the company, your projects, your department"
              }
              section={brief.announcements}
            />
            <Section
              title="Waiting for your acknowledgement"
              window="Still open — acknowledge in Tielora, in your browser"
              section={brief.awaitingAcknowledgement}
              showDeadline={false}
            />
          </div>
        )}
      </div>

      <p className="mt-6">
        <a
          href="/my-tasks/brief"
          onClick={(event) => open(event, "/my-tasks/brief")}
          title="Opens in Tielora in your browser"
          className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--brand-primary)] hover:underline"
        >
          Open Tielora in your browser
          <span className="sr-only"> (opens in your browser)</span>
        </a>
      </p>
    </div>
  );
}
