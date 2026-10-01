// Phone cards. On a phone a wide table becomes a stack of these: the title on top (it wraps, never
// clipped), then labelled lines, then full-width action buttons. Presentation only — no data is
// fetched here. Cards show below 640px (`sm:hidden`); the table beside them shows from 640px, so
// the desktop is exactly what it always was.

import Link from "next/link";
import type { ReactNode } from "react";

/** One labelled line on a card. */
export type PhoneCardField = {
  label: string;
  value: ReactNode;
  /** A line that has nothing to say is left out rather than shown as a dash. */
  hidden?: boolean;
};

/** The stack of cards. Hidden from 640px, where the table takes over. */
export function PhoneCardList({ children, label }: { children: ReactNode; label: string }) {
  return (
    <ul aria-label={label} className="space-y-3 sm:hidden">
      {children}
    </ul>
  );
}

/** The table wrapper for the same data: hidden on a phone, scrolls sideways only as a last resort. */
export function DesktopTable({ children }: { children: ReactNode }) {
  return (
    <div className="hidden overflow-x-auto rounded-[var(--radius)] border border-[var(--border)] bg-white sm:block">
      {children}
    </div>
  );
}

/** Text a person typed, inside a table cell: wraps instead of widening the table. */
export function CellText({ children }: { children: ReactNode }) {
  return <div className="min-w-0 max-w-md break-words">{children}</div>;
}

export function PhoneCard({
  title,
  href,
  meta,
  fields,
  actions,
  dimmed = false,
  leading,
}: {
  /** The headline. Whatever a person typed here wraps, so a pasted path cannot widen the card. */
  title: ReactNode;
  /** When set, the whole card is one tap target that opens this page. */
  href?: string;
  /** Small things under the title: badges, a code. */
  meta?: ReactNode;
  fields: PhoneCardField[];
  /** Buttons, drawn full width at the bottom. Leave out when `href` is set. */
  actions?: ReactNode;
  dimmed?: boolean;
  leading?: ReactNode;
}) {
  const body = (
    <>
      <div className="flex min-w-0 items-start gap-2">
        {leading}
        <div className="min-w-0 flex-1">
          <p className="min-w-0 break-words text-sm font-semibold text-[var(--brand-ink)]">{title}</p>
          {meta ? <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">{meta}</div> : null}
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 text-sm">
        {fields
          .filter((field) => !field.hidden)
          .map((field) => (
            <div key={field.label} className="contents">
              <dt className="text-xs text-[var(--brand-gray)]">{field.label}</dt>
              <dd className="min-w-0 break-words text-[var(--brand-text)]">{field.value}</dd>
            </div>
          ))}
      </dl>
    </>
  );

  return (
    <li
      className={`min-w-0 rounded-[var(--radius)] border border-[var(--border)] bg-white ${dimmed ? "opacity-60" : ""}`}
    >
      {href ? (
        <Link href={href} className="block min-h-11 p-4 active:bg-[var(--page-bg)]">
          {body}
        </Link>
      ) : (
        <div className="p-4">{body}</div>
      )}
      {actions ? (
        <div className="flex flex-col gap-2 border-t border-[var(--border)] p-3">{actions}</div>
      ) : null}
    </li>
  );
}
