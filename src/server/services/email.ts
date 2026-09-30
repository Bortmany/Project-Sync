// Email: the invitation, password-reset and verification messages Tielora sends, and — only for
// people who asked for them — alert emails (a copy of one in-app notification) and the daily brief.
// Only those last two carry the one-click unsubscribe headers and footer.
//
// SERVER ONLY. Nothing here is ever imported by a client component — it reads the API key.
//
// Four rules govern this file:
//  1. **Dormant unless keyed.** With `RESEND_API_KEY` or `EMAIL_FROM` unset, every send below is a
//     silent no-op that answers `{ status: "dormant" }`. Nothing else in the app behaves any
//     differently, nothing is queued for later, and no screen ever says which variable is missing —
//     exactly the shape Slack, Teams and Microsoft 365 already follow.
//  2. **In-app is the truth; an email is a copy.** Delivery is best-effort and per-process, the same
//     accepted limitation chat delivery carries: one attempt, one retry when Resend answers 429,
//     then the message is dropped with a logged line. There is no queue table. The `ActivityLog` row
//     the calling service wrote inside its own transaction is the record that the app meant to send.
//  3. **Nothing secret is ever logged.** Not the API key, not the from address, not the recipient's
//     address, not the link and never the token inside it. A failure line carries the purpose, the
//     recipient's user id and what went wrong — the same discretion a webhook failure line uses.
//  4. **Never fatal.** Nothing here throws. It is called after the caller's transaction has
//     committed and deliberately not awaited, so a slow or broken mail provider can never delay,
//     undo or fail the change that caused the email.

import type { Prisma } from "@/generated/prisma/client";
import {
  dailyBriefBody,
  dailyBriefSubject,
  emailBodyText,
  emailLayout,
  emailSubject,
  type EmailFooterLinks,
} from "@/lib/email-text";
import { logger } from "@/lib/logger";
import { limit } from "@/lib/rate-limit";
import { unsubscribeToken } from "@/lib/unsubscribe-token";
import type { BriefDTO, EmailedPurposeName, UnsubscribeKindName } from "@/lib/zod-schemas";
import { ACTIVITY, appendActivity } from "@/server/services/activity";
import { EMAIL_TOKEN_TTL_WORDS } from "@/server/services/email-tokens";
// The one place in the app that reads and validates APP_BASE_URL. Reused rather than repeated, so
// a link in an email and a link in a Slack card can never disagree about where this app lives.
import { appBaseUrl } from "@/server/services/webhooks";

/** Resend's send endpoint. The only address this file ever calls. */
const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** How long a single send may take before it is abandoned. */
const REQUEST_TIMEOUT_MS = 10_000;

/** The longest we will ever wait when Resend says "too many requests". */
const MAX_RETRY_WAIT_MS = 10_000;

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

type EmailConfig = { apiKey: string; from: string };

function emailConfig(env: NodeJS.ProcessEnv = process.env): EmailConfig | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.EMAIL_FROM?.trim();
  if (!apiKey || !from) return null;
  return { apiKey, from };
}

/**
 * Are the two mail variables set? This is the narrow question: keys only.
 *
 * `emailAvailable()` below is the one screens and `/api/health` should ask, because a link with
 * nowhere to point is no use to anybody.
 */
export function emailConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return emailConfig(env) !== null;
}

/** Said once per process, never again — a missing address is a deployment mistake, not a flood. */
let warnedAboutBaseUrl = false;

/**
 * Everything a real send needs: both mail variables AND `APP_BASE_URL`.
 *
 * Every one of these emails exists to carry a link, and a link is built from `APP_BASE_URL`. Keys
 * set with no base address is therefore treated as **dormant**, not as "send a broken email": the
 * app logs one line naming the missing piece and goes on behaving exactly as it does with no mail
 * provider at all. This is the one place email is stricter than chat, where an unset base address
 * merely means the card names the page instead of linking to it.
 */
export function emailAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!emailConfigured(env)) return false;
  if (appBaseUrl() !== null) return true;

  if (!warnedAboutBaseUrl) {
    warnedAboutBaseUrl = true;
    logger.warn("Email is keyed but APP_BASE_URL is not set, so no email will be sent", {
      hint: "Set APP_BASE_URL to this deployment's address, with no trailing slash.",
    });
  }
  return false;
}

/** What `/api/health` reports: a word, and nothing that names anybody. */
export function emailStatus(env: NodeJS.ProcessEnv = process.env): "dormant" | "configured" {
  return emailAvailable(env) ? "configured" : "dormant";
}

/* ------------------------------------------------------------------ */
/* Links                                                               */
/* ------------------------------------------------------------------ */

/**
 * Where each kind of emailed link lands. One place, so an email and a page cannot drift apart.
 *
 * Keyed by `EmailedPurposeName`, not by every purpose: an EXPORT token is a download bearer handed
 * to an administrator on screen, never a link in a message, and the compiler is what says so.
 */
export const EMAIL_LINK_PATH: Record<EmailedPurposeName, string> = {
  INVITE: "/set-password",
  RESET: "/reset-password",
  VERIFY: "/verify-email",
};

/**
 * The full link that goes in the email, or `null` when there is no base address to build it from
 * (which is also when this whole feature reads as dormant, so a caller that checks
 * `emailAvailable()` first never sees the null).
 */
export function emailLink(purpose: EmailedPurposeName, rawToken: string): string | null {
  const base = appBaseUrl();
  if (!base) return null;
  return `${base}${EMAIL_LINK_PATH[purpose]}?token=${encodeURIComponent(rawToken)}`;
}

/* ------------------------------------------------------------------ */
/* The send itself                                                     */
/* ------------------------------------------------------------------ */

export type EmailOutcome =
  | { status: "dormant" }
  | { status: "sent" }
  | { status: "failed"; reason: string };

export type EmailMessage = {
  to: string;
  subject: string;
  /** Plain text only. These emails carry one link and no markup; there is no template library. */
  text: string;
  /**
   * Extra mail headers. Only the alert and brief emails pass any — the two one-click unsubscribe
   * headers (RFC 8058). Invitations, resets and verification never carry them.
   */
  headers?: Record<string, string>;
};

/** The two kinds of email a person chooses, as they appear in a log line. */
export type BulkEmailPurpose = "ALERT" | "DAILY_BRIEF";

/** Only ever used to make a log line useful. Never the address, never the link. */
type SendContext = { purpose?: EmailedPurposeName | BulkEmailPurpose; userId?: string };

/** Seconds from a Retry-After header, clamped to something we are willing to wait. */
export function emailRetryAfterMs(header: string | null): number {
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds <= 0) return 1_000;
  return Math.min(seconds * 1_000, MAX_RETRY_WAIT_MS);
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function postOnce(config: EmailConfig, message: EmailMessage): Promise<Response> {
  return fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      // Only present when asked for, so the three account emails go out exactly as they always have.
      ...(message.headers ? { headers: message.headers } : {}),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    redirect: "error",
  });
}

/**
 * Sends one plain-text email, best-effort.
 *
 * One attempt, plus a single retry when Resend answers 429 — waiting exactly as long as its
 * `Retry-After` header asks, up to ten seconds. Never throws, and never awaited by a user-facing
 * flow: call it as `void sendEmail(...)` once the transaction behind it has committed.
 */
export async function sendEmail(
  message: EmailMessage,
  context: SendContext = {},
): Promise<EmailOutcome> {
  const config = emailConfig();
  if (!config || appBaseUrl() === null) return { status: "dormant" };

  const fail = (reason: string, status: number | null): EmailOutcome => {
    // Purpose, recipient id and what went wrong. No address, no subject line about a real person,
    // no body, and never the link or the token inside it.
    logger.warn("Could not send an email", {
      purpose: context.purpose ?? null,
      userId: context.userId ?? null,
      status,
      reason,
    });
    return { status: "failed", reason };
  };

  try {
    let response = await postOnce(config, message);

    if (response.status === 429) {
      await wait(emailRetryAfterMs(response.headers.get("retry-after")));
      response = await postOnce(config, message);
    }

    if (response.ok) return { status: "sent" };

    return fail(
      response.status === 401 || response.status === 403
        ? "the mail provider refused our key"
        : response.status === 422
          ? "the mail provider refused the message"
          : response.status === 429
            ? "the mail provider is rate limiting us"
            : "the mail provider refused the message",
      response.status,
    );
  } catch {
    // Timeouts, DNS failures, refused connections — all the same to us, and none of them worth
    // repeating to anybody.
    return fail("we could not reach the mail provider", null);
  }
}

/* ------------------------------------------------------------------ */
/* The three messages                                                  */
/* ------------------------------------------------------------------ */

/** Who an email is going to. Never carries a password hash or anything else about the account. */
export type EmailRecipient = { id: string; name: string; email: string };

/** An invitation additionally names who sent it and which company it is for. */
export type InviteRecipient = EmailRecipient & {
  inviterName: string;
  organizationName: string;
};

/** "Tielora" sits at the top of every message, in plain text — no logo, no template library. */
const WORDMARK = "Tielora";

function body(lines: string[]): string {
  return [WORDMARK, "", ...lines].join("\n");
}

/**
 * "Set your password to get started" — the first thing a new colleague ever hears from Tielora.
 * Sent after the account has been created and committed, never before.
 */
export function sendInviteEmail(user: InviteRecipient, link: string): Promise<EmailOutcome> {
  return sendEmail(
    {
      to: user.email,
      subject: "You're invited to Tielora",
      text: body([
        `Hi ${user.name},`,
        "",
        `${user.inviterName} has invited you to join ${user.organizationName} on Tielora.`,
        "",
        "Set your password to get started:",
        link,
        "",
        `This link expires in ${EMAIL_TOKEN_TTL_WORDS.INVITE}.`,
        "",
        "Didn't expect this? You can ignore this email — nothing will happen until the link above is used.",
      ]),
    },
    { purpose: "INVITE", userId: user.id },
  );
}

/**
 * Only ever sent to an address that really has an account. The `/forgot-password` page hides that
 * fact from the browser; inside the inbox there is nothing left to hide.
 */
export function sendPasswordResetEmail(user: EmailRecipient, link: string): Promise<EmailOutcome> {
  return sendEmail(
    {
      to: user.email,
      subject: "Reset your Tielora password",
      text: body([
        `Hi ${user.name},`,
        "",
        "We received a request to reset the password for your Tielora account.",
        "",
        "Choose a new password:",
        link,
        "",
        `This link expires in ${EMAIL_TOKEN_TTL_WORDS.RESET}.`,
        "",
        "Didn't ask for this? You can safely ignore this email — your password won't change unless you use the link above.",
      ]),
    },
    { purpose: "RESET", userId: user.id },
  );
}

/** A nudge, never a lock: nothing in the app is withheld from somebody who has not verified. */
export function sendVerificationEmail(user: EmailRecipient, link: string): Promise<EmailOutcome> {
  return sendEmail(
    {
      to: user.email,
      subject: "Verify your Tielora email",
      text: body([
        `Hi ${user.name},`,
        "",
        "Please confirm this is your email address.",
        "",
        "Verify your email:",
        link,
        "",
        `This link expires in ${EMAIL_TOKEN_TTL_WORDS.VERIFY}.`,
        "",
        "Didn't sign up for Tielora? You can ignore this email.",
      ]),
    },
    { purpose: "VERIFY", userId: user.id },
  );
}

/* ------------------------------------------------------------------ */
/* The audit row                                                       */
/* ------------------------------------------------------------------ */

export type EmailAuditInput = {
  /** Who caused it. For a reset or a verification the person asks for their own, so it is them. */
  actorId: string;
  /** Only used for an invitation's plain-English summary; the other two are self-service. */
  actorName?: string | null;
  recipientId: string;
  recipientName: string;
  purpose: EmailedPurposeName;
};

function summaryFor(input: EmailAuditInput): string {
  switch (input.purpose) {
    case "INVITE":
      return input.actorName
        ? `${input.actorName} sent ${input.recipientName} an invitation email`
        : `An invitation email was sent to ${input.recipientName}`;
    case "RESET":
      return `A password reset link was sent to ${input.recipientName}`;
    case "VERIFY":
      return `A verification email was sent to ${input.recipientName}`;
  }
}

/**
 * Records that the app decided to send an email — written by the calling service INSIDE its own
 * transaction, before anything is put on the wire.
 *
 * The ordering is deliberate and documented in docs/CONVENTIONS.md: the audit row is the record of
 * intent, and the email is the copy. Writing it first means a mail provider that is down, slow or
 * rate limiting can never leave a reset with no trace of having been asked for, and it keeps house
 * rule 1 intact — every mutation appends its audit row inside the same transaction.
 *
 * What it never carries: the token, the link, or the email address. The recipient's user id is
 * enough to find the address on the account itself, which is where it already lives.
 */
export async function appendEmailActivity(
  tx: Prisma.TransactionClient,
  input: EmailAuditInput,
): Promise<void> {
  await appendActivity(tx, {
    actorId: input.actorId,
    projectId: null,
    entityType: "Email",
    entityId: input.recipientId,
    action: ACTIVITY.EMAIL_SENT,
    summary: summaryFor(input),
    metadata: { kind: input.purpose, userId: input.recipientId },
  });
}

/* ------------------------------------------------------------------ */
/* Alert and brief emails — only for people who asked for them         */
/* ------------------------------------------------------------------ */

/**
 * The flood guard: at most this many alert emails per person per hour, counted in this process
 * exactly as rate limiting is. A person mass-assigned fifty tasks gets twenty emails, not fifty;
 * every in-app notification is still written, and those are the truth.
 */
export const ALERT_EMAILS_PER_HOUR = 20;
const ALERT_WINDOW_MS = 60 * 60 * 1000;

/** Where the daily brief's "Open your day in Tielora" link goes. */
const BRIEF_PAGE_PATH = "/my-tasks/brief";

/** Who an alert or brief is going to: the id for the token and the log line, the address to send. */
export type BulkRecipient = { id: string; email: string };

/** Everything an alert email is built from: the notification row, and nothing wider. */
export type AlertEmailRow = { title: string; body: string; linkUrl: string };

export type BulkEmailOutcome = EmailOutcome | { status: "held back" };

type BulkLinks = { headers: Record<string, string>; footer: EmailFooterLinks };

/**
 * The two unsubscribe headers and the two footer links for one person and one kind, or null when
 * there is no base address or no secret to sign the token with. No alert or brief ever goes out
 * without its way out.
 */
function bulkLinks(personId: string, kind: UnsubscribeKindName): BulkLinks | null {
  const base = appBaseUrl();
  if (!base) return null;
  const token = unsubscribeToken(personId, kind);
  if (!token) return null;
  const t = encodeURIComponent(token);
  return {
    headers: {
      "List-Unsubscribe": `<${base}/api/email/unsubscribe?t=${t}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    footer: { unsubscribePage: `${base}/unsubscribe?t=${t}`, account: `${base}/account` },
  };
}

function appLink(path: string): string {
  const base = appBaseUrl() ?? "";
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}

/** Said once per process: a keyed mail provider with no SESSION_SECRET cannot sign the way out. */
let warnedAboutSigning = false;

function noWayOut(purpose: BulkEmailPurpose): BulkEmailOutcome {
  if (!warnedAboutSigning) {
    warnedAboutSigning = true;
    logger.warn("Alert and brief emails need SESSION_SECRET for their unsubscribe link", {
      purpose,
    });
  }
  return { status: "failed", reason: "there is no unsubscribe link to put in it" };
}

/**
 * One alert email: the copy of ONE notification row, for the person that row belongs to.
 *
 * Subject = the row's title; body = the row's sentence and a link back to the row's page. Nothing
 * is fetched to enrich it, so whatever walls `notify()` already keeps — the company, the contractor
 * — are the walls of the email too. Typed web addresses become "[link removed]" here, in the copy,
 * never in the stored row. The caller decides WHETHER a person is emailed (their `emailAlerts`, a
 * confirmed address, a type with a chat toggle); this only builds, guards and sends.
 *
 * Never throws, never awaited by anything a person is waiting on.
 */
export async function sendAlertEmail(
  recipient: BulkRecipient,
  row: AlertEmailRow,
): Promise<BulkEmailOutcome> {
  if (!emailAvailable()) return { status: "dormant" };
  const links = bulkLinks(recipient.id, "ALERTS");
  if (!links) return noWayOut("ALERT");

  const flood = limit(`email-alerts:${recipient.id}`, ALERT_EMAILS_PER_HOUR, ALERT_WINDOW_MS);
  if (!flood.ok) {
    // The person's id and nothing else — never an address, never what the alert said.
    logger.info("Alert email held back", {
      userId: recipient.id,
      reason: "the hourly limit for this person was reached",
    });
    return { status: "held back" };
  }

  return sendEmail(
    {
      to: recipient.email,
      subject: emailSubject(row.title),
      text: emailLayout({
        kind: "Alert",
        body: emailBodyText(row.body),
        openLabel: "Open it in Tielora:",
        openLink: appLink(row.linkUrl),
        footer: links.footer,
      }),
      headers: links.headers,
    },
    { purpose: "ALERT", userId: recipient.id },
  );
}

/**
 * One person's daily brief: their own "Your day", exactly as their brief page shows it to them.
 * The caller has already decided the day is not empty — nothing is sent on an empty day.
 */
export async function sendDailyBriefEmail(
  recipient: BulkRecipient,
  brief: BriefDTO,
  now: Date,
): Promise<BulkEmailOutcome> {
  if (!emailAvailable()) return { status: "dormant" };
  const links = bulkLinks(recipient.id, "DAILY");
  if (!links) return noWayOut("DAILY_BRIEF");

  return sendEmail(
    {
      to: recipient.email,
      subject: dailyBriefSubject(brief, now),
      text: emailLayout({
        kind: "Your day",
        body: dailyBriefBody(brief),
        openLabel: "Open your day in Tielora:",
        openLink: appLink(BRIEF_PAGE_PATH),
        footer: links.footer,
      }),
      headers: links.headers,
    },
    { purpose: "DAILY_BRIEF", userId: recipient.id },
  );
}
