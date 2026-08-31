// THE ONE PADDLE MODULE. Everything this app knows about the payment provider is in this file:
// which environment variables switch it on, which host may be called, how a checkout link and a
// customer-portal link are minted, how a webhook's signature is checked, and how its payload is
// read. Nothing else in the app names Paddle, an event type or a payload field — swapping provider
// (the Lemon Squeezy fallback in docs/GO-LIVE.md, section 8) is a rewrite of this file and nothing
// else.
//
// THREE RULES, the same three the Microsoft integration follows:
//  1. **Dormant until configured** (house rule 11). With any of PADDLE_API_KEY,
//     PADDLE_WEBHOOK_SECRET, PADDLE_PRICE_ID_PRO or APP_BASE_URL unset there is no button on the
//     Billing page, the webhook answers "not set up", and /api/health says "billing": "dormant".
//     Setting them is the whole activation — no migration, no code change.
//  2. **One host, ever.** api.paddle.com, or sandbox-api.paddle.com when PADDLE_ENV is not live.
//     Checked at the moment of use, never only when a URL is built.
//  3. **The API key never leaves the server.** It is read here, sent in one Authorization header,
//     and never returned by a read, written to an audit row, put in an error message or logged. A
//     checkout or portal address is treated the same way: it is handed to the one administrator who
//     pressed the button and is never stored or logged.
//
// SERVER ONLY. This module reads process.env secrets, so it must never be imported by a component
// that carries "use client" — the Billing screen is given plain booleans by its server page.
//
// WHERE THE RESEARCH WAS UNCERTAIN (docs/GO-LIVE.md, section 8, lists these for activation day):
// the exact response shape of the create-transaction and portal-session calls could not be read
// first-hand. Every field is therefore read defensively, several plausible names are tried, and a
// shape we cannot read ends in a plain-English refusal rather than a guess or a crash.

import { createHmac, timingSafeEqual } from "node:crypto";
import { logger } from "@/lib/logger";
import { ServiceError } from "@/server/errors";

/** How this provider names itself in a BillingEvent row. */
export const BILLING_PROVIDER = "PADDLE";

/** What every action and the webhook say while the owner has not set the four variables. */
export const BILLING_NOT_CONFIGURED =
  "Upgrading isn't turned on for this Tielora yet. Ask whoever runs it to set up payments.";

/** Said when Paddle is reachable but did not answer with something we can use. */
const PADDLE_UNAVAILABLE = "We couldn't reach the payment page. Try again in a moment.";

/** How long any one call to Paddle may take before it is abandoned. One attempt, no retry storm. */
const REQUEST_TIMEOUT_MS = 10_000;

export const LIVE_HOST = "api.paddle.com";
export const SANDBOX_HOST = "sandbox-api.paddle.com";

/**
 * How far out of step a webhook's own timestamp may be before it is refused as a replay.
 *
 * Paddle's SDK helpers default to five seconds. Five MINUTES is used here deliberately: this app
 * runs on a platform whose clock we do not control, and a webhook refused for clock skew is
 * retried for three days and then marked failed — a far worse failure than a five-minute replay
 * window, which the BillingEvent unique key makes harmless anyway.
 */
export const SIGNATURE_MAX_AGE_MS = 5 * 60_000;

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

export type PaddleConfig = {
  apiKey: string;
  webhookSecret: string;
  /** The subscription price a company is checked out against. */
  priceId: string;
  /** "sandbox" until PADDLE_ENV says otherwise — the safe direction. */
  environment: "sandbox" | "live";
  /** https://api.paddle.com or https://sandbox-api.paddle.com. */
  baseUrl: string;
  /** This site's own address, needed for the return address after paying. */
  appBaseUrl: string;
};

/** Normalises APP_BASE_URL exactly as the Microsoft integration does — no trailing slash. */
function baseUrl(env: NodeJS.ProcessEnv): string | null {
  const raw = env.APP_BASE_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return raw.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/**
 * Which Paddle environment this deployment talks to. Anything that is not plainly live — unset, a
 * typo, a value from a newer build — reads as SANDBOX, which is the safe direction: a sandbox key
 * cannot charge anybody, and a live key pointed at the sandbox host simply fails loudly.
 *
 * "production" is accepted beside "live" because Paddle's own documentation uses both words.
 */
export function paddleEnvironment(env: NodeJS.ProcessEnv = process.env): "sandbox" | "live" {
  const value = env.PADDLE_ENV?.trim().toLowerCase() ?? "";
  return value === "live" || value === "production" ? "live" : "sandbox";
}

/**
 * The provider's settings, or null when the owner has not switched payments on. ALL FOUR are
 * needed: a key with no price to sell, or a price with nowhere to send anybody back to, is not
 * half-configured — it is dormant, which is a state that behaves rather than a state that breaks.
 */
export function paddleConfig(env: NodeJS.ProcessEnv = process.env): PaddleConfig | null {
  const apiKey = env.PADDLE_API_KEY?.trim() ?? "";
  const webhookSecret = env.PADDLE_WEBHOOK_SECRET?.trim() ?? "";
  const priceId = env.PADDLE_PRICE_ID_PRO?.trim() ?? "";
  const appBaseUrl = baseUrl(env);
  if (!apiKey || !webhookSecret || !priceId || !appBaseUrl) return null;

  const environment = paddleEnvironment(env);
  return {
    apiKey,
    webhookSecret,
    priceId,
    environment,
    baseUrl: `https://${environment === "live" ? LIVE_HOST : SANDBOX_HOST}`,
    appBaseUrl,
  };
}

/** True when all four variables are set. The only thing /api/health is ever told about billing. */
export function billingConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return paddleConfig(env) !== null;
}

/* ------------------------------------------------------------------ */
/* The one door out                                                    */
/* ------------------------------------------------------------------ */

/** The only two addresses this app ever calls about money. Checked on every request. */
function paddleUrlProblem(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "That address is not usable.";
  }
  if (url.protocol !== "https:") return "That address is not usable.";
  if (url.username || url.password) return "That address is not usable.";
  if (url.port) return "That address is not usable.";
  const host = url.hostname.toLowerCase();
  if (host !== LIVE_HOST && host !== SANDBOX_HOST) return "That address is not usable.";
  return null;
}

/**
 * Where an administrator may be redirected to. Paddle owns these; anything else means the checkout
 * we asked for is NOT hosted by Paddle (see the hosted-checkout caveat in docs/GO-LIVE.md), and
 * sending somebody there would land them on a page needing Paddle's own JavaScript, which this app
 * deliberately never loads. So it is refused in plain English instead.
 */
export function isPaddleHostedUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  if (url.port) return false;
  const host = url.hostname.toLowerCase();
  return host === "paddle.com" || host.endsWith(".paddle.com");
}

/** An id from Paddle that we are about to put into a URL path. Never trusted by shape alone. */
export function isSafePaddleId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,80}$/.test(value);
}

/**
 * One call to Paddle. One attempt, a hard timeout, redirects never followed, and nothing about the
 * key or the answer's body in any log line — only the status and the path that was asked for.
 */
async function paddleFetch(
  config: PaddleConfig,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<Record<string, unknown>> {
  const url = `${config.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  if (paddleUrlProblem(url)) throw new ServiceError(PADDLE_UNAVAILABLE);

  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: "manual",
    });
  } catch {
    throw new ServiceError(PADDLE_UNAVAILABLE);
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    // The status and the path are safe to record; the body is Paddle's and may echo back what we
    // sent, so it is never logged and never shown to anybody.
    logger.warn("Paddle refused a request", { status: response.status, path });
    throw new ServiceError(PADDLE_UNAVAILABLE);
  }

  return payload !== null && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
}

/* ------------------------------------------------------------------ */
/* Reading an answer we could not read first-hand                      */
/* ------------------------------------------------------------------ */

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Follows a dotted path through nested objects and returns the string at the end, or null. */
function stringAt(root: unknown, path: string): string | null {
  let current: unknown = root;
  for (const key of path.split(".")) {
    const record = asRecord(current);
    if (!record) return null;
    current = record[key];
  }
  return typeof current === "string" && current.length > 0 ? current : null;
}

/**
 * The first https:// string anywhere in a small answer, as a last resort when none of the named
 * paths matched. Bounded in depth so an unexpected answer can never cost a stack.
 */
function firstHttpsString(value: unknown, depth = 0): string | null {
  if (depth > 5) return null;
  if (typeof value === "string") return value.startsWith("https://") ? value : null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstHttpsString(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const record = asRecord(value);
  if (!record) return null;
  for (const item of Object.values(record)) {
    const found = firstHttpsString(item, depth + 1);
    if (found) return found;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Checkout                                                            */
/* ------------------------------------------------------------------ */

/**
 * Mints a checkout an administrator is REDIRECTED to.
 *
 * The redirect is the whole point: no Paddle JavaScript is loaded on any page of this app, so the
 * Content-Security-Policy in next.config.ts needs nothing added for it — a plain top-level
 * navigation to another site is not governed by any CSP directive (script-src, frame-src and
 * connect-src all stay exactly as they are). The overlay alternative, and the CSP entries it would
 * cost, is written up in docs/GO-LIVE.md, section 8, for activation day.
 *
 * The company's own id travels in `custom_data`, which Paddle copies onto the transaction and then
 * onto the subscription, so every later webhook says which company it is about.
 *
 * `checkout.url: null` is Paddle's documented way of saying "use this account's default payment
 * link", and the answer carries the address to send the buyer to. That address is CHECKED to be a
 * Paddle-hosted one before anybody is sent there.
 */
export async function createCheckoutUrl(
  config: PaddleConfig,
  input: { orgId: string; successUrl: string },
): Promise<string> {
  const answer = await paddleFetch(config, "/transactions", {
    method: "POST",
    body: {
      items: [{ price_id: config.priceId, quantity: 1 }],
      custom_data: { org_id: input.orgId },
      checkout: { url: null },
    },
  });

  const found =
    stringAt(answer, "data.checkout.url") ??
    stringAt(answer, "data.checkout_url") ??
    stringAt(answer, "data.url") ??
    firstHttpsString(answer.data);

  if (!found || !isPaddleHostedUrl(found)) {
    // Either the answer was shaped differently from the documentation, or this Paddle account has
    // no Paddle-hosted checkout (which live accounts need approval for — see docs/GO-LIVE.md).
    // Either way, nobody is redirected anywhere on a guess.
    logger.warn("Paddle did not return a usable hosted checkout address", {
      environment: config.environment,
      hostedAddress: Boolean(found),
    });
    throw new ServiceError(
      "Checkout isn't ready on this Tielora yet. Ask whoever runs it to finish setting up payments.",
    );
  }

  // Where the buyer comes back to. An extra query parameter is a safe thing to be wrong about: if
  // Paddle ignores it, they simply stay on Paddle's own confirmation page and the plan still
  // changes when the webhook lands.
  const url = new URL(found);
  url.searchParams.set("success_url", input.successUrl);
  return url.toString();
}

/* ------------------------------------------------------------------ */
/* The customer portal                                                 */
/* ------------------------------------------------------------------ */

/**
 * A fresh "manage billing" address for one company, minted at the moment the button is pressed.
 *
 * Portal links are single-use and short-lived, so this is never cached, never stored and never
 * logged — it is handed straight to the administrator who pressed the button.
 */
export async function createPortalUrl(
  config: PaddleConfig,
  customerId: string,
  subscriptionId: string | null,
): Promise<string> {
  if (!isSafePaddleId(customerId)) throw new ServiceError(PADDLE_UNAVAILABLE);

  const body =
    subscriptionId && isSafePaddleId(subscriptionId)
      ? { subscription_ids: [subscriptionId] }
      : {};

  const answer = await paddleFetch(config, `/customers/${customerId}/portal-sessions`, {
    method: "POST",
    body,
  });

  const found =
    stringAt(answer, "data.urls.general.overview") ??
    stringAt(answer, "data.urls.general") ??
    stringAt(answer, "data.url") ??
    firstHttpsString(answer.data);

  if (!found || !isPaddleHostedUrl(found)) {
    logger.warn("Paddle did not return a usable portal address", { environment: config.environment });
    throw new ServiceError("We couldn't open your billing page. Try again in a moment.");
  }
  return found;
}

/* ------------------------------------------------------------------ */
/* Webhook signatures                                                  */
/* ------------------------------------------------------------------ */

export type SignatureVerdict = "ok" | "missing" | "invalid" | "stale";

/** Reads `ts=1724…;h1=abcd…` without caring about order or unknown parts. */
function readSignatureHeader(header: string): { ts: string | null; h1: string | null } {
  let ts: string | null = null;
  let h1: string | null = null;
  for (const part of header.split(";")) {
    const at = part.indexOf("=");
    if (at < 0) continue;
    const key = part.slice(0, at).trim().toLowerCase();
    const value = part.slice(at + 1).trim();
    if (key === "ts") ts = value;
    if (key === "h1") h1 = value;
  }
  return { ts, h1 };
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Is this webhook really from Paddle, and is it recent?
 *
 * HMAC-SHA256 over the literal string `{ts}:{raw body}`, keyed with the notification destination's
 * own secret, compared in constant time against `h1`. THE BODY MUST BE THE RAW BYTES AS THEY
 * ARRIVED — re-serialising the JSON changes the signature, which is why the route reads
 * `request.text()` and nothing parses anything until this has passed.
 */
export function checkWebhookSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  now: number = Date.now(),
): SignatureVerdict {
  if (!header) return "missing";

  const { ts, h1 } = readSignatureHeader(header);
  if (!ts || !h1) return "missing";

  const seconds = Number(ts);
  if (!Number.isFinite(seconds)) return "invalid";

  const expected = createHmac("sha256", secret).update(`${ts}:${rawBody}`).digest("hex");
  if (!safeEqual(h1.toLowerCase(), expected)) return "invalid";

  // Only once the signature holds is the age worth judging: a stale verdict on an unsigned request
  // would tell an attacker their timestamp was the only thing wrong.
  if (Math.abs(now - seconds * 1_000) > SIGNATURE_MAX_AGE_MS) return "stale";

  return "ok";
}

/* ------------------------------------------------------------------ */
/* Reading a webhook                                                   */
/* ------------------------------------------------------------------ */

export type BillingWebhookEvent = {
  /** Identical on every retry of the same event — this is the replay key. */
  eventId: string;
  eventType: string;
  /** The company it is about, from `custom_data`, or null when it does not say. */
  orgId: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  /** The subscription's own status when the payload carries one ("active", "past_due", …). */
  status: string | null;
  /**
   * WHEN THE PROVIDER SAYS IT HAPPENED (`occurred_at`), not when it reached us. It is the only
   * clock the two sides share, and it is what lets a delivery that overtook another one be put
   * back in order. Null when the payload does not carry one, which reads as "we cannot tell".
   */
  occurredAt: Date | null;
};

/** A real moment, or null. A payload we cannot read a date from must never become 1970. */
function dateAt(root: unknown, path: string): Date | null {
  const raw = stringAt(root, path);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** A company id we are willing to look up. Every id in this app is a cuid: letters and digits. */
function plausibleOrgId(value: string | null): string | null {
  if (!value) return null;
  return /^[A-Za-z0-9]{1,64}$/.test(value) ? value : null;
}

/**
 * Turns a verified payload into the few facts this app acts on. Every field is read defensively —
 * both the documented snake_case name and the camelCase one — because the payload shape could not
 * be confirmed first-hand, and a missing field must read as "we do not know" rather than throw.
 */
export function readWebhookEvent(rawBody: string): BillingWebhookEvent | null {
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return null;
  }

  const root = asRecord(payload);
  if (!root) return null;

  const eventId = stringAt(root, "event_id") ?? stringAt(root, "eventId");
  const eventType = stringAt(root, "event_type") ?? stringAt(root, "eventType");
  if (!eventId || !eventType) return null;

  const orgId = plausibleOrgId(
    stringAt(root, "data.custom_data.org_id") ??
      stringAt(root, "data.custom_data.orgId") ??
      stringAt(root, "data.customData.org_id") ??
      stringAt(root, "data.customData.orgId"),
  );

  const customerId = stringAt(root, "data.customer_id") ?? stringAt(root, "data.customerId");

  // A subscription event is about itself; a transaction event names the subscription it belongs to.
  const subscriptionId =
    stringAt(root, "data.subscription_id") ??
    stringAt(root, "data.subscriptionId") ??
    (eventType.startsWith("subscription.") ? stringAt(root, "data.id") : null);

  return {
    eventId: eventId.slice(0, 200),
    eventType: eventType.slice(0, 100),
    orgId,
    customerId: customerId && isSafePaddleId(customerId) ? customerId : null,
    subscriptionId: subscriptionId && isSafePaddleId(subscriptionId) ? subscriptionId : null,
    status: stringAt(root, "data.status"),
    occurredAt: dateAt(root, "occurred_at") ?? dateAt(root, "occurredAt"),
  };
}

/* ------------------------------------------------------------------ */
/* Which events move a company's plan                                  */
/* ------------------------------------------------------------------ */

/** What a webhook means for the company's plan. The only provider vocabulary billing.ts sees. */
export type PlanIntent = "ACTIVATE" | "DEACTIVATE" | "NONE";

/**
 * The subscription is live and paid for.
 *
 * `subscription.created` is here beside `subscription.activated` on the roadmap's instruction. It
 * is the ONE line on this list to re-check on activation day (docs/GO-LIVE.md, section 8): the
 * research notes that for some flows `created` can arrive before the first payment, and if the
 * sandbox walkthrough shows that happening, deleting this one string is the whole fix.
 */
const ACTIVATING_EVENTS = new Set(["subscription.activated", "subscription.created"]);

/** The subscription has stopped. The company drops to FREE and keeps everything it already has. */
const DEACTIVATING_EVENTS = new Set([
  "subscription.canceled",
  "subscription.cancelled",
  "subscription.expired",
  "subscription.paused",
]);

/** Statuses `subscription.updated` can carry, and what each means for the plan. */
const ACTIVE_STATUSES = new Set(["active", "trialing"]);
const ENDED_STATUSES = new Set(["canceled", "cancelled", "expired", "paused"]);

/** A payment failed. The plan does NOT move — Paddle retries it, and the page says so honestly. */
export const PAYMENT_FAILED_EVENT = "transaction.payment_failed";

/** The events that say something about whether payment is going through, newest one wins. */
export const PAYMENT_SIGNAL_EVENTS = [
  PAYMENT_FAILED_EVENT,
  "transaction.completed",
  "subscription.activated",
];

export function planIntentFor(event: BillingWebhookEvent): PlanIntent {
  if (ACTIVATING_EVENTS.has(event.eventType)) return "ACTIVATE";
  if (DEACTIVATING_EVENTS.has(event.eventType)) return "DEACTIVATE";

  // "You don't need to listen for separate events for renewals, upgrades or downgrades —
  // subscription.updated covers them all", so its own status is what decides. `past_due` is
  // deliberately neither: Paddle is still trying, so the company keeps Pro through the dunning.
  if (event.eventType === "subscription.updated") {
    const status = event.status?.toLowerCase() ?? "";
    if (ACTIVE_STATUSES.has(status)) return "ACTIVATE";
    if (ENDED_STATUSES.has(status)) return "DEACTIVATE";
  }

  return "NONE";
}
