// Small display helpers. Dates read as "30 Sep 2026"; feeds use relative time. No date library in this app.

const DAY_MS = 24 * 60 * 60 * 1000;

const FULL_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const SHORT_DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

const CLOCK_TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

/** "30 Sep 2026" */
export function formatDate(value: Date | null | undefined): string {
  if (!value) return "—";
  return FULL_DATE.format(value);
}

/** "22 Aug" — used where the year is obvious from context. */
export function formatShortDate(value: Date): string {
  return SHORT_DATE.format(value);
}

/** "30 Sep 2026, 07:15" — used where a brief has to state exactly where its window starts. */
export function formatDateTime(value: Date): string {
  return `${FULL_DATE.format(value)}, ${CLOCK_TIME.format(value)}`;
}

const FULL_DATE_UTC = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * "30 Sep 2026" read in UTC. Deadlines are stored at UTC midnight and the briefs work their day
 * windows out in UTC, so anywhere a brief NAMES that window it says the same day the server used —
 * west of Greenwich, the ordinary local formatting would print the day before.
 */
export function formatDateUtc(value: Date): string {
  return FULL_DATE_UTC.format(value);
}

/** "2 h ago" / "3 d ago" — only inside activity and notification feeds. */
export function formatRelative(value: Date, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.round((now.getTime() - value.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return formatDate(value);
}

/** The "YYYY-MM-DD" a date input expects, read as the LOCAL calendar day. */
export function toDateInputValue(value: Date | null | undefined): string {
  if (!value) return "";
  const offset = value.getTimezoneOffset() * 60 * 1000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 10);
}

/**
 * The "YYYY-MM-DD" a date input expects, read as the UTC day — the same hazard `formatDateUtc`
 * exists for, one step earlier.
 *
 * Use this wherever a stored UTC-midnight day is put BACK into a date field. A form field reads
 * "2026-09-30" and sends `new Date("2026-09-30")`, which is UTC midnight; pre-filling that same
 * value with the local reading west of Greenwich would show 29 Sep, and saving the form again
 * would store 29 Sep — the day walking backwards on every save.
 */
export function toUtcDateInputValue(value: Date | null | undefined): string {
  if (!value) return "";
  return value.toISOString().slice(0, 10);
}

/** The day key used for day dividers in feeds. */
export function dayKey(value: Date): string {
  return toDateInputValue(value);
}

export type DueBucket = "overdue" | "today" | "week" | "later";

export const DUE_BUCKET_LABEL: Record<DueBucket, string> = {
  overdue: "Overdue",
  today: "Today",
  week: "This week",
  later: "Later",
};

export const DUE_BUCKET_ORDER: DueBucket[] = ["overdue", "today", "week", "later"];

/** Which group a deadline belongs to on the dashboard and My tasks. */
export function dueBucket(deadline: Date, isOverdue: boolean, now: Date = new Date()): DueBucket {
  if (isOverdue) return "overdue";
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const due = new Date(
    deadline.getFullYear(),
    deadline.getMonth(),
    deadline.getDate(),
  ).getTime();
  if (due <= startOfToday) return "today";
  if (due <= startOfToday + 7 * DAY_MS) return "week";
  return "later";
}

/** True when a deadline is within the next seven days (amber treatment in tables). */
export function isDueSoon(deadline: Date, now: Date = new Date()): boolean {
  const diff = deadline.getTime() - now.getTime();
  return diff >= 0 && diff <= 7 * DAY_MS;
}
