// The words and layout of the alert and brief emails. Pure: no database, no network, no env.
//
// Three rules govern this file:
//  1. **Text somebody typed never becomes a link.** Outlook and Gmail turn any bare web address in
//     a plain-text email into a live link, so a task titled "Sign in at https://evil.example" would
//     arrive from Tielora's trusted sender with a working link to somebody else's site. In the EMAIL
//     copy only — never in the stored notification row — every `http://`, `https://` or `www.` run
//     is replaced with "[link removed]". It is the email's version of `slackEscape`/`teamsEscape`.
//  2. **Plain text, one fixed skeleton.** No HTML, no template library: a header line, the body,
//     the "Open it in Tielora" link, then a `--` footer with the two ways out. Invitations, resets
//     and verification keep their own layout in `email.ts` and never carry the footer.
//  3. **Dates are "30 Sep 2026", in UTC**, through `Intl` — the same day the brief page names.

import type { BriefDTO, BriefItemDTO, BriefSectionDTO } from "@/lib/zod-schemas";

/* ------------------------------------------------------------------ */
/* The unsubscribe page and route — one set of words for both          */
/* ------------------------------------------------------------------ */

/** Unsubscribe requests per IP address per minute, on the route and on the page alike. */
export const UNSUBSCRIBE_LIMIT = 300;

/** The neutral sentence after the press — the same for every token, genuine or not. */
export const UNSUBSCRIBE_DONE_MESSAGE =
  "Done. If that link was still valid, those emails have stopped. You can review all your email settings in Your account.";

/** The calm 429 sentence. */
export const UNSUBSCRIBE_BUSY_MESSAGE =
  "Too many tries just now. Wait a minute and press the button again.";

/** What replaces a typed web address in an email. */
export const LINK_REMOVED = "[link removed]";

/** The same cap a chat card's body has. */
export const EMAIL_BODY_MAX_CHARS = 1_200;

/** A subject longer than this is cut; mail clients show far less anyway. */
export const EMAIL_SUBJECT_MAX_CHARS = 200;

/** The most lines one brief section shows before "and N more". The brief page's own cap. */
export const EMAIL_SECTION_LIMIT = 10;

/**
 * A web address run: the scheme or `www.`, then printable ASCII that is not a space, a quote or an
 * angle bracket. Stopping at the first non-ASCII character is what keeps right-to-left text around
 * a link intact — an Arabic word written straight after an address is never swallowed with it.
 */
const URL_RUN = /(?:https?:\/\/|www\.)[!#-&(-;=?-~]*/gi;

/** Punctuation that usually ends a sentence rather than an address, given back after the swap. */
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/;

/** Removes every typed web address from a piece of text. */
export function neutraliseLinks(text: string): string {
  return text.replace(URL_RUN, (run) => {
    const tail = run.match(TRAILING_PUNCTUATION)?.[0] ?? "";
    return `${LINK_REMOVED}${tail}`;
  });
}

/** C0 and C1 control characters — newlines, tabs, escapes and the like. */
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/g;

/** Control characters other than the newline, which a body may keep. */
const CONTROL_EXCEPT_NEWLINE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g;

function cap(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** A subject line: one line, no control characters, no live links, not absurdly long. */
export function emailSubject(text: string): string {
  const oneLine = neutraliseLinks(text).replace(CONTROL_CHARACTERS, " ").replace(/ {2,}/g, " ").trim();
  return cap(oneLine || "Tielora", EMAIL_SUBJECT_MAX_CHARS);
}

/** A body sentence: no live links, no control characters except newlines, capped like chat. */
export function emailBodyText(text: string, max = EMAIL_BODY_MAX_CHARS): string {
  return cap(neutraliseLinks(text).replace(CONTROL_EXCEPT_NEWLINE, " ").trim(), max);
}

/**
 * Read in parts rather than as one en-GB string: newer ICU data spells September "Sept" in en-GB,
 * and an email is kept to the house form "30 Sep 2026" whatever the server's ICU says.
 */
const DATE_PARTS = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** "30 Sep 2026", read in UTC — the clock deadlines are written on. */
export function emailDate(date: Date): string {
  const parts = DATE_PARTS.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("day")} ${part("month")} ${part("year")}`;
}

/* ------------------------------------------------------------------ */
/* The fixed skeleton                                                  */
/* ------------------------------------------------------------------ */

export type EmailFooterLinks = {
  /** The confirmation page, `<APP_BASE_URL>/unsubscribe?t=…`. */
  unsubscribePage: string;
  /** `<APP_BASE_URL>/account`. */
  account: string;
};

export type EmailLayoutInput = {
  /** The word after "Tielora — ": "Alert", "Your day" or "Your week". */
  kind: "Alert" | "Your day" | "Your week";
  /** Already neutralised. */
  body: string;
  /** "Open it in Tielora:" for an alert, "Open your day in Tielora:" for the daily brief. */
  openLabel: string;
  openLink: string;
  footer: EmailFooterLinks;
};

/**
 * The skeleton every alert and brief shares, so both ways out are always at the bottom:
 *
 *     Tielora — Alert
 *
 *     <body>
 *
 *     Open it in Tielora:
 *     <link>
 *
 *     --
 *     Stop emails like this one: <unsubscribe page>
 *     Change all your email settings: <account>
 *     Sent by Tielora because you asked for these emails.
 */
export function emailLayout(input: EmailLayoutInput): string {
  return [
    `Tielora — ${input.kind}`,
    "",
    input.body,
    "",
    input.openLabel,
    input.openLink,
    "",
    "--",
    `Stop emails like this one: ${input.footer.unsubscribePage}`,
    `Change all your email settings: ${input.footer.account}`,
    "Sent by Tielora because you asked for these emails.",
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* The daily brief                                                     */
/* ------------------------------------------------------------------ */

type SectionSpec = {
  key: keyof Pick<
    BriefDTO,
    | "dueToday"
    | "overdue"
    | "newlyUnblocked"
    | "mentions"
    | "awaitingReview"
    | "announcements"
    | "awaitingAcknowledgement"
  >;
  heading: string;
  showDeadline: boolean;
};

/** The page's own order and wording (`brief-view.tsx`), in capitals for plain text. */
const SECTIONS: SectionSpec[] = [
  { key: "dueToday", heading: "DUE TODAY", showDeadline: true },
  { key: "overdue", heading: "OVERDUE", showDeadline: true },
  { key: "newlyUnblocked", heading: "NEWLY UNBLOCKED", showDeadline: true },
  { key: "mentions", heading: "MENTIONS", showDeadline: false },
  { key: "awaitingReview", heading: "AWAITING YOUR REVIEW", showDeadline: true },
  { key: "announcements", heading: "ANNOUNCEMENTS", showDeadline: true },
  {
    key: "awaitingAcknowledgement",
    heading: "WAITING FOR YOUR ACKNOWLEDGEMENT",
    showDeadline: false,
  },
];

/** True when every section of the brief is empty — the day on which nothing is sent. */
export function briefIsEmpty(brief: BriefDTO): boolean {
  return SECTIONS.every((section) => brief[section.key].total === 0);
}

/** "- Task title (SUR-EXP) — 12 Sep 2026 — 5 days over — 60% complete" */
function briefLine(item: BriefItemDTO, showDeadline: boolean): string {
  const parts = [
    item.projectCode ? `${item.title} (${item.projectCode})` : item.title,
  ];
  if (showDeadline && item.deadline) parts.push(emailDate(new Date(item.deadline)));
  if (item.daysOverdue) {
    parts.push(item.daysOverdue === 1 ? "1 day over" : `${item.daysOverdue} days over`);
  }
  if (item.note) parts.push(item.note);
  return `- ${emailBodyText(parts.join(" — "), 300).replace(/\n/g, " ")}`;
}

function sectionBlock(spec: SectionSpec, section: BriefSectionDTO): string[] {
  const shown = section.items.slice(0, EMAIL_SECTION_LIMIT);
  const lines = [`${spec.heading} (${section.total})`, ...shown.map((item) => briefLine(item, spec.showDeadline))];
  const more = section.total - shown.length;
  if (more > 0) lines.push(`and ${more} more — open Tielora to see them`);
  return lines;
}

/** "Your day — 30 Sep 2026 (2 due today, 1 overdue)", with the empty counts left out. */
export function dailyBriefSubject(brief: BriefDTO, now: Date): string {
  const counts: string[] = [];
  if (brief.dueToday.total > 0) counts.push(`${brief.dueToday.total} due today`);
  if (brief.overdue.total > 0) counts.push(`${brief.overdue.total} overdue`);
  const suffix = counts.length > 0 ? ` (${counts.join(", ")})` : "";
  return emailSubject(`Your day — ${emailDate(now)}${suffix}`);
}

/** The body of the daily brief: one block per non-empty section, in the page's order. */
export function dailyBriefBody(brief: BriefDTO): string {
  const blocks = SECTIONS.filter((spec) => brief[spec.key].total > 0).map((spec) =>
    sectionBlock(spec, brief[spec.key]).join("\n"),
  );
  return blocks.join("\n\n");
}
