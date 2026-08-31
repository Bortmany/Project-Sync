// Transactional email: the invitation, password-reset and verification messages Tielora sends.
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
import { logger } from "@/lib/logger";
import type { EmailPurposeName } from "@/lib/zod-schemas";
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

/** Where each kind of emailed link lands. One place, so an email and a page cannot drift apart. */
export const EMAIL_LINK_PATH: Record<EmailPurposeName, string> = {
  INVITE: "/set-password",
  RESET: "/reset-password",
  VERIFY: "/verify-email",
};

/**
 * The full link that goes in the email, or `null` when there is no base address to build it from
 * (which is also when this whole feature reads as dormant, so a caller that checks
 * `emailAvailable()` first never sees the null).
 */
export function emailLink(purpose: EmailPurposeName, rawToken: string): string | null {
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
};

/** Only ever used to make a log line useful. Never the address, never the link. */
type SendContext = { purpose?: EmailPurposeName; userId?: string };

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
  purpose: EmailPurposeName;
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
