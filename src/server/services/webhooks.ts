// Chat delivery: posting a copy of a notification into an organisation's Slack or Teams channel.
//
// Three rules govern this file:
//  1. **In-app notifications are the truth.** Everything here happens AFTER the notification rows
//     are committed, and nothing here can undo or delay them. A failed post costs a chat message,
//     never a notification and never the change that caused it.
//  2. **The webhook address is a bearer secret.** It is read from the database, used, and thrown
//     away. It is never logged, never returned to a browser and never written to an audit row — a
//     failure line carries the kind and the organisation id, nothing else.
//  3. **Only two hosts are ever called.** The address is re-checked against the per-kind allowlist
//     here, at delivery time, not only when it was saved (`webhookUrlProblem` — the SSRF guard).
//
// Accepted limitation, the same one rate limiting carries: delivery is per-process and in-memory.
// There is no queue table and no cross-instance retry — one attempt, one retry on 429, then the
// message is dropped with a logged line. Documented in docs/CONVENTIONS.md.

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import type {
  IntegrationEventName,
  IntegrationEventToggles,
  IntegrationKindName,
  NotificationTypeName,
} from "@/lib/zod-schemas";
import { IntegrationEventToggles as TogglesSchema, webhookUrlProblem } from "@/lib/zod-schemas";

/** Everything a chat card is built from. The digest is this and nothing else. */
export type ChatMessage = {
  title: string;
  body: string;
  /** The in-app path, e.g. "/discipline-tasks/abc123". Turned into a full link when APP_BASE_URL is set. */
  linkUrl: string;
};

/** One thing that happened, in the same words the in-app notification uses. */
export type WebhookEvent = ChatMessage & { type: NotificationTypeName };

/** How long a single POST may take before it is abandoned. */
const REQUEST_TIMEOUT_MS = 5_000;

/** The longest we will ever wait when a chat tool says "too many requests". */
const MAX_RETRY_WAIT_MS = 10_000;

/** Teams refuses anything larger; Slack is far more generous, so one cap covers both. */
const MAX_PAYLOAD_BYTES = 28 * 1024;

/** Keeps a card body short enough that the whole envelope comfortably fits the cap. */
const MAX_BODY_CHARS = 1_200;

/**
 * The toggles that stand for a notification being copied to chat. `dailyBrief` is deliberately NOT
 * one of them: the digest is a summary of data the app already holds, not a fan-out of any
 * notification type, so the compiler refuses to let anything below map to it.
 */
type FanOutToggle = Exclude<IntegrationEventName, "dailyBrief">;

/**
 * Which toggle decides each kind of notification. Anything mapped to null is never delivered to
 * chat in this round — document uploads and ordinary comments stay in the app, where they belong.
 */
const TOGGLE_FOR_TYPE: Record<NotificationTypeName, FanOutToggle | null> = {
  ASSIGNED: "taskAssigned",
  MENTIONED: "mention",
  STATUS_CHANGED: "statusChange",
  DEADLINE_APPROACHING: "overdueReminder",
  OVERDUE: "overdueReminder",
  OVERRIDE_APPLIED: "gateOverride",
  DOCUMENT_UPLOADED: null,
  COMMENT_ADDED: null,
};

export function toggleForType(type: NotificationTypeName): IntegrationEventName | null {
  return TOGGLE_FOR_TYPE[type];
}

/**
 * Where this copy of the app lives, for the "Open in Tielora" link. Unset is a supported state:
 * the message then names the page instead of linking to it, and everything else works the same.
 */
export function appBaseUrl(): string | null {
  const raw = process.env.APP_BASE_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return raw.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** The full link to a page, or null when APP_BASE_URL is not set. */
function fullLink(linkUrl: string): string | null {
  const base = appBaseUrl();
  if (!base) return null;
  return `${base}${linkUrl.startsWith("/") ? "" : "/"}${linkUrl}`;
}

function shorten(text: string, max = MAX_BODY_CHARS): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

/**
 * Slack shows `<url|text>` as a link and swallows these three characters otherwise, so a task title
 * somebody typed can never become a link pointing wherever they liked.
 */
function slackEscape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * A Teams Adaptive Card TextBlock renders a subset of markdown, which means a task title reading
 * `[Reset your Tielora password](https://evil.example)` would arrive in the company's channel as a
 * real, clickable link to somebody else's website. Backslash-escaping the four characters that make
 * a link or a code span takes that away; brackets and backticks then show as themselves.
 *
 * Deliberately narrow: `(`, `)`, `-` and `.` are left alone because they cannot make a link on
 * their own and they appear in ordinary titles ("Rev (B) — 12.4") all day long. `*` and `_` are
 * left alone too: the worst they can do is make a word bold.
 */
function teamsEscape(text: string): string {
  return text.replace(/([\\[\]`])/g, "\\$1");
}

/* ------------------------------------------------------------------ */
/* The two payload shapes                                              */
/* ------------------------------------------------------------------ */

/**
 * Slack Block Kit: a header, a section with the sentence, and a context line saying where it came
 * from. A top-level `text` is always included as the fallback Slack shows in its notifications.
 */
export function slackPayload(event: ChatMessage, link: string | null, source: string): unknown {
  const body = shorten(event.body);
  const linkLine = link
    ? `<${link}|Open in Tielora>`
    : `Open ${slackEscape(event.linkUrl)} in Tielora`;

  return {
    // The fallback Slack shows in its own notification list is mrkdwn too, so it is escaped exactly
    // like the section blocks are.
    text: slackEscape(shorten(`${event.title} — ${body}`, 300)),
    blocks: [
      { type: "header", text: { type: "plain_text", text: shorten(event.title, 150) } },
      { type: "section", text: { type: "mrkdwn", text: slackEscape(body) } },
      { type: "section", text: { type: "mrkdwn", text: linkLine } },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: `Tielora · ${slackEscape(shorten(source, 80))}` }],
      },
    ],
  };
}

/**
 * The Teams Workflows envelope: an Adaptive Card inside a `message` attachment. Version 1.4 is
 * pinned deliberately — it is the widely supported one. The "Open in Tielora" button only appears
 * when there is a real link to open; a card action with no address is rejected.
 */
export function teamsPayload(event: ChatMessage, link: string | null, source: string): unknown {
  const body = shorten(event.body);
  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body: [
            {
              type: "TextBlock",
              text: teamsEscape(shorten(event.title, 150)),
              weight: "Bolder",
              size: "Medium",
              wrap: true,
            },
            { type: "TextBlock", text: teamsEscape(body), wrap: true },
            {
              type: "TextBlock",
              text: teamsEscape(
                link ? `Tielora · ${source}` : `Tielora · ${source} · ${event.linkUrl}`,
              ),
              wrap: true,
              isSubtle: true,
              spacing: "Small",
            },
          ],
          ...(link
            ? { actions: [{ type: "Action.OpenUrl", title: "Open in Tielora", url: link }] }
            : {}),
        },
      },
    ],
  };
}

export function buildPayload(
  kind: IntegrationKindName,
  event: ChatMessage,
  source: string,
): unknown {
  const link = fullLink(event.linkUrl);
  return kind === "SLACK" ? slackPayload(event, link, source) : teamsPayload(event, link, source);
}

/**
 * Serialises a payload and refuses anything over the 28 KB cap rather than sending a request that
 * is certain to be rejected. Bodies are already shortened, so this is a last line of defence.
 */
function serialise(payload: unknown): string | null {
  const text = JSON.stringify(payload);
  return Buffer.byteLength(text, "utf8") > MAX_PAYLOAD_BYTES ? null : text;
}

/* ------------------------------------------------------------------ */
/* The POST itself                                                     */
/* ------------------------------------------------------------------ */

export type DeliveryOutcome = { ok: boolean; status: number | null; reason: string };

/** Seconds from a Retry-After header, clamped to something we are willing to wait. */
export function retryAfterMs(header: string | null): number {
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds <= 0) return 1_000;
  return Math.min(seconds * 1_000, MAX_RETRY_WAIT_MS);
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function postOnce(url: string, payload: string): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    redirect: "error",
  });
}

/**
 * One delivery attempt, plus a single retry when the chat tool answers 429 — waiting exactly as
 * long as its `Retry-After` header asks, up to ten seconds. Never throws: the caller is a
 * side effect of something that has already happened.
 */
export async function postToWebhook(
  kind: IntegrationKindName,
  url: string,
  payload: unknown,
): Promise<DeliveryOutcome> {
  // The SSRF guard, re-run against the stored value at the moment of use.
  const problem = webhookUrlProblem(kind, url);
  if (problem) return { ok: false, status: null, reason: "the saved address is not usable" };

  const body = serialise(payload);
  if (!body) return { ok: false, status: null, reason: "the message was too large to send" };

  try {
    let response = await postOnce(url, body);

    if (response.status === 429) {
      await wait(retryAfterMs(response.headers.get("retry-after")));
      response = await postOnce(url, body);
    }

    if (response.ok) return { ok: true, status: response.status, reason: "delivered" };

    return {
      ok: false,
      status: response.status,
      reason:
        response.status === 404 || response.status === 410
          ? "the channel or webhook no longer exists"
          : response.status === 429
            ? "the chat tool is rate limiting us"
            : "the chat tool refused the message",
    };
  } catch {
    // Timeouts, DNS failures, refused connections — all the same to us, and none of them say why
    // in a way worth showing anyone.
    return { ok: false, status: null, reason: "we could not reach the chat tool" };
  }
}

/* ------------------------------------------------------------------ */
/* The fan-out                                                         */
/* ------------------------------------------------------------------ */

function togglesFrom(value: unknown): IntegrationEventToggles | null {
  const parsed = TogglesSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Posts one event to every chat channel this organisation has switched on for it.
 *
 * Called after the notification transaction has committed, and called without being awaited by
 * `notify()` — the person who caused the change never waits for Slack. Never throws.
 */
export async function deliverToOrgWebhooks(orgId: string, event: WebhookEvent): Promise<void> {
  const toggle = toggleForType(event.type);
  if (!toggle) return;

  try {
    const integrations = await prisma.orgIntegration.findMany({
      where: { orgId, enabled: true },
      select: { kind: true, webhookUrl: true, eventToggles: true },
    });
    if (integrations.length === 0) return;

    for (const integration of integrations) {
      const kind = integration.kind as IntegrationKindName;
      const toggles = togglesFrom(integration.eventToggles);
      if (!toggles || !toggles[toggle]) continue;

      const outcome = await postToWebhook(
        kind,
        integration.webhookUrl,
        buildPayload(kind, event, sourceLabel(event.type)),
      );
      if (!outcome.ok) {
        // Kind and organisation only. The address is a secret and never appears in a log line.
        logger.warn("Could not deliver a chat notification", {
          kind,
          orgId,
          event: event.type,
          status: outcome.status,
          reason: outcome.reason,
        });
      }
    }
  } catch (error) {
    logger.error("Chat delivery failed", { orgId, event: event.type, error });
  }
}

/**
 * Posts one daily digest to EXACTLY the channels it was handed — never "every enabled channel".
 *
 * That distinction is the whole point of the argument. The sweep chooses which channels are due
 * (`dailyBriefSentAt` behind today's line) and stamps those same rows afterwards. If this function
 * looked the channels up for itself, a Teams channel enabled at nine in the morning would make the
 * ten o'clock sweep post to Slack a second time — Slack was not due, but it was enabled, and only
 * the rows that were due would have been stamped.
 *
 * The digest is NOT a notification fan-out: no notification row exists behind it, and none is
 * written (documented in docs/CONVENTIONS.md as a deviation, exactly like marking a notification
 * read writing no audit row). It is a chat-only summary of data the app already holds, sent once a
 * day, and it is off unless an administrator asked for it.
 *
 * Returns how many channels it reached, so the sweep can log the run. Never throws.
 */
export async function deliverDailyBrief(
  orgId: string,
  integrationIds: string[],
  message: ChatMessage,
): Promise<number> {
  if (integrationIds.length === 0) return 0;

  let sent = 0;
  try {
    // The `orgId` is part of the lookup even though the ids came from the caller: a fan-out cannot
    // leave its company, and an id is never trusted on its own. `enabled` is re-checked here for
    // the same reason the webhook address is re-checked at delivery time — the state that matters
    // is the state at the moment of sending.
    const integrations = await prisma.orgIntegration.findMany({
      where: { id: { in: integrationIds }, orgId, enabled: true },
      select: { kind: true, webhookUrl: true, eventToggles: true },
    });

    for (const integration of integrations) {
      const kind = integration.kind as IntegrationKindName;
      const toggles = togglesFrom(integration.eventToggles);
      if (!toggles || !toggles.dailyBrief) continue;

      const outcome = await postToWebhook(
        kind,
        integration.webhookUrl,
        buildPayload(kind, message, "Daily brief"),
      );
      if (outcome.ok) {
        sent += 1;
      } else {
        // Kind and organisation only. The address is a secret and never appears in a log line.
        logger.warn("Could not deliver a daily brief", {
          kind,
          orgId,
          status: outcome.status,
          reason: outcome.reason,
        });
      }
    }
  } catch (error) {
    logger.error("Daily brief delivery failed", { orgId, error });
  }
  return sent;
}

/** The small grey line at the bottom of a card — what kind of event this was, in plain English. */
function sourceLabel(type: NotificationTypeName): string {
  switch (type) {
    case "ASSIGNED":
      return "Task assigned";
    case "MENTIONED":
      return "You were mentioned";
    case "STATUS_CHANGED":
      return "Status changed";
    case "DEADLINE_APPROACHING":
      return "Deadline reminder";
    case "OVERDUE":
      return "Overdue reminder";
    case "OVERRIDE_APPLIED":
      return "Override applied";
    default:
      return "Update";
  }
}

/**
 * The "Send test message" button. Uses exactly the same payload builder and the same guard as a
 * real notification, so a successful test proves the real thing will work too.
 */
export async function sendTestMessage(
  kind: IntegrationKindName,
  url: string,
  companyName: string,
): Promise<DeliveryOutcome> {
  const event: WebhookEvent = {
    type: "STATUS_CHANGED",
    title: "Tielora test message",
    body: `This channel is connected to ${companyName} in Tielora. Notifications you have switched on will arrive here.`,
    linkUrl: "/dashboard",
  };
  return postToWebhook(kind, url, buildPayload(kind, event, "Test message"));
}
