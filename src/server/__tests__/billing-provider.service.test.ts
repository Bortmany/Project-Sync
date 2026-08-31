// The payment provider: the webhook's order of operations, and the two buttons.
//
// NOTHING HERE TOUCHES A REAL PAYMENT PROVIDER. There is no account, no key and no network: the
// four environment variables are set to test values for the tests that need them, `global.fetch` is
// replaced with a stub that answers what the provider's documentation says it answers, and every
// webhook body is crafted here and signed with the test secret.
//
// The four promises under test, in the order they matter:
//  1. **A body we did not sign changes nothing.** Missing, wrong, or stale — none of them leaves a
//     BillingEvent row, let alone moves a plan. That check happens before any database effect, and
//     the absence of the row is how the test proves it.
//  2. **The same event twice is one event.** The provider retries until it is acknowledged.
//  3. **A plan moves only when the provider says so**, and every move is audited with the old plan,
//     the new plan and the event's id — and nothing from the payload.
//  4. **Dormant means dormant.** With the variables unset the webhook answers "not set up" and both
//     buttons refuse in plain English.

import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/permissions";
import { ServiceError } from "@/server/errors";
import { ACTIVITY } from "@/server/services/activity";
import {
  billingHealth,
  billingStatus,
  openBillingPortal,
  processBillingWebhook,
  startUpgrade,
} from "@/server/services/billing";
import { BILLING_PROVIDER, checkWebhookSignature } from "@/server/services/paddle";
import {
  makeOrg,
  makeProjectFixture,
  resetDatabase,
  setPlan,
  type Fixture,
} from "@/server/__tests__/harness";

/* ------------------------------------------------------------------ */
/* Switching the provider on and off for one test                      */
/* ------------------------------------------------------------------ */

const SECRET = "pdl_ntfset_01_test_secret_value_only";
const API_KEY = "pdl_sdbx_apikey_for_tests_only";
const PRICE_ID = "pri_01test";

const KEYS = ["PADDLE_API_KEY", "PADDLE_WEBHOOK_SECRET", "PADDLE_PRICE_ID_PRO", "PADDLE_ENV"] as const;
const saved = new Map<string, string | undefined>();

function configureProvider(): void {
  for (const key of KEYS) saved.set(key, process.env[key]);
  saved.set("APP_BASE_URL", process.env.APP_BASE_URL);
  process.env.PADDLE_API_KEY = API_KEY;
  process.env.PADDLE_WEBHOOK_SECRET = SECRET;
  process.env.PADDLE_PRICE_ID_PRO = PRICE_ID;
  process.env.PADDLE_ENV = "sandbox";
  process.env.APP_BASE_URL = "https://tielora.example";
}

function restoreEnv(): void {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved.clear();
}

/* ------------------------------------------------------------------ */
/* Crafted, signed webhook bodies                                      */
/* ------------------------------------------------------------------ */

let eventCounter = 0;

type EventOptions = {
  eventId?: string;
  orgId?: string | null;
  customerId?: string;
  subscriptionId?: string;
  status?: string;
  /** When the PROVIDER says it happened. Left out, it is now — which is what a real one carries. */
  occurredAt?: Date;
};

/** A payload shaped the way the provider's documentation says one is shaped. */
function body(eventType: string, options: EventOptions = {}): string {
  eventCounter += 1;
  const data: Record<string, unknown> = {
    id: options.subscriptionId ?? "sub_01test",
    customer_id: options.customerId ?? "ctm_01test",
    ...(options.status ? { status: options.status } : {}),
    ...(options.orgId === null ? {} : { custom_data: { org_id: options.orgId } }),
  };
  return JSON.stringify({
    event_id: options.eventId ?? `evt_${eventCounter}`,
    event_type: eventType,
    occurred_at: (options.occurredAt ?? new Date()).toISOString(),
    data,
  });
}

/** The provider's own header: `ts=<unix seconds>;h1=<hex hmac of "ts:body">`. */
function sign(raw: string, atMs = Date.now(), secret = SECRET): string {
  const ts = String(Math.floor(atMs / 1000));
  const h1 = createHmac("sha256", secret).update(`${ts}:${raw}`).digest("hex");
  return `ts=${ts};h1=${h1}`;
}

const eventRows = () => prisma.billingEvent.count();
const planOfOrg = async (orgId: string) =>
  (await prisma.organization.findUnique({ where: { id: orgId }, select: { plan: true } }))?.plan;

/* ------------------------------------------------------------------ */

let fixture: Fixture;

beforeEach(async () => {
  await resetDatabase();
  fixture = await makeProjectFixture();
  await setPlan(fixture.orgId, "FREE");
});

afterEach(() => {
  restoreEnv();
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await prisma.$disconnect();
});

/* ------------------------------------------------------------------ */
/* 1. The signature is the whole door                                  */
/* ------------------------------------------------------------------ */

describe("only a body we really signed is ever acted on", () => {
  beforeEach(() => configureProvider());

  it("accepts a correctly signed, current webhook", async () => {
    const raw = body("subscription.activated", { orgId: fixture.orgId });
    const outcome = await processBillingWebhook(raw, sign(raw));

    expect(outcome.httpStatus).toBe(200);
    expect(await planOfOrg(fixture.orgId)).toBe("PRO");
  });

  it("refuses a missing signature, and writes nothing at all", async () => {
    const raw = body("subscription.activated", { orgId: fixture.orgId });

    const outcome = await processBillingWebhook(raw, null);

    expect(outcome.httpStatus).toBe(400);
    // The proof that verification happens BEFORE any database effect: no delivery was recorded.
    expect(await eventRows()).toBe(0);
    expect(await planOfOrg(fixture.orgId)).toBe("FREE");
  });

  it("refuses a signature that does not match the body, and writes nothing at all", async () => {
    const raw = body("subscription.activated", { orgId: fixture.orgId });
    const forged = sign(raw, Date.now(), "a-different-secret-entirely");

    const outcome = await processBillingWebhook(raw, forged);

    expect(outcome.httpStatus).toBe(400);
    expect(await eventRows()).toBe(0);
    expect(await planOfOrg(fixture.orgId)).toBe("FREE");
  });

  it("refuses a signature for a body that was edited on the way", async () => {
    const raw = body("subscription.activated", { orgId: fixture.orgId });
    const header = sign(raw);

    const tampered = raw.replace("subscription.activated", "subscription.canceled");
    const outcome = await processBillingWebhook(tampered, header);

    expect(outcome.httpStatus).toBe(400);
    expect(await eventRows()).toBe(0);
  });

  it("refuses a stale signature, however well signed it is", async () => {
    const raw = body("subscription.activated", { orgId: fixture.orgId });
    const old = sign(raw, Date.now() - 10 * 60_000);

    const outcome = await processBillingWebhook(raw, old);

    expect(outcome.httpStatus).toBe(400);
    expect(await eventRows()).toBe(0);
    expect(await planOfOrg(fixture.orgId)).toBe("FREE");
  });

  it("tells the four verdicts apart without ever leaking which part was wrong to the caller", () => {
    const raw = body("subscription.activated", { orgId: fixture.orgId });
    expect(checkWebhookSignature(raw, sign(raw), SECRET)).toBe("ok");
    expect(checkWebhookSignature(raw, null, SECRET)).toBe("missing");
    expect(checkWebhookSignature(raw, "nonsense", SECRET)).toBe("missing");
    expect(checkWebhookSignature(raw, sign(raw, Date.now(), "wrong"), SECRET)).toBe("invalid");
    expect(checkWebhookSignature(raw, sign(raw, Date.now() - 10 * 60_000), SECRET)).toBe("stale");
  });
});

/* ------------------------------------------------------------------ */
/* 2. The same event twice is one event                                */
/* ------------------------------------------------------------------ */

describe("a retried delivery is recognised and ignored", () => {
  beforeEach(() => configureProvider());

  it("processes the same event id once, however many times it arrives", async () => {
    const raw = body("subscription.activated", { orgId: fixture.orgId, eventId: "evt_same" });
    const header = sign(raw);

    expect((await processBillingWebhook(raw, header)).httpStatus).toBe(200);
    expect((await processBillingWebhook(raw, header)).httpStatus).toBe(200);
    expect((await processBillingWebhook(raw, sign(raw))).httpStatus).toBe(200);

    expect(await eventRows()).toBe(1);
    expect(await planOfOrg(fixture.orgId)).toBe("PRO");

    // And the company only moved once, so there is exactly one audit row about it.
    const audits = await prisma.activityLog.count({
      where: { action: ACTIVITY.BILLING_PLAN_CHANGED, entityId: fixture.orgId },
    });
    expect(audits).toBe(1);
  });

  it("does not re-upgrade a company that was downgraded after the first delivery", async () => {
    const raw = body("subscription.activated", { orgId: fixture.orgId, eventId: "evt_replay" });
    await processBillingWebhook(raw, sign(raw));
    await setPlan(fixture.orgId, "FREE");

    await processBillingWebhook(raw, sign(raw));

    expect(await planOfOrg(fixture.orgId)).toBe("FREE");
  });
});

/* ------------------------------------------------------------------ */
/* 3. Which events move a plan                                         */
/* ------------------------------------------------------------------ */

describe("the plan moves only when the provider says so", () => {
  beforeEach(() => configureProvider());

  it("puts a company on Pro on activation, and records who it is at the provider", async () => {
    const raw = body("subscription.activated", {
      orgId: fixture.orgId,
      customerId: "ctm_abc",
      subscriptionId: "sub_abc",
    });
    await processBillingWebhook(raw, sign(raw));

    const org = await prisma.organization.findUnique({
      where: { id: fixture.orgId },
      select: { plan: true, billingCustomerId: true, billingSubscriptionId: true },
    });
    expect(org?.plan).toBe("PRO");
    expect(org?.billingCustomerId).toBe("ctm_abc");
    expect(org?.billingSubscriptionId).toBe("sub_abc");
  });

  it("audits the move with the old plan, the new plan and the event id — and no payload", async () => {
    const raw = body("subscription.activated", { orgId: fixture.orgId, eventId: "evt_audit" });
    await processBillingWebhook(raw, sign(raw));

    const row = await prisma.activityLog.findFirst({
      where: { action: ACTIVITY.BILLING_PLAN_CHANGED, entityId: fixture.orgId },
    });
    expect(row?.summary).toBe("Plan changed from FREE to PRO");
    // Nobody in this app pressed anything, so the row has no actor.
    expect(row?.actorId).toBeNull();
    expect(row?.metadata).toMatchObject({
      provider: BILLING_PROVIDER,
      from: "FREE",
      to: "PRO",
      eventId: "evt_audit",
    });
  });

  it("drops a cancelled company back to Free and keeps the ids for history", async () => {
    const up = body("subscription.activated", {
      orgId: fixture.orgId,
      customerId: "ctm_keep",
      subscriptionId: "sub_keep",
    });
    await processBillingWebhook(up, sign(up));

    const down = body("subscription.canceled", {
      orgId: fixture.orgId,
      customerId: "ctm_keep",
      subscriptionId: "sub_keep",
    });
    const outcome = await processBillingWebhook(down, sign(down));

    expect(outcome.httpStatus).toBe(200);
    const org = await prisma.organization.findUnique({
      where: { id: fixture.orgId },
      select: { plan: true, billingCustomerId: true, billingSubscriptionId: true },
    });
    expect(org?.plan).toBe("FREE");
    expect(org?.billingCustomerId).toBe("ctm_keep");
    expect(org?.billingSubscriptionId).toBe("sub_keep");
  });

  it("drops a company back to Free when its subscription expires", async () => {
    await setPlan(fixture.orgId, "PRO");
    const raw = body("subscription.expired", { orgId: fixture.orgId });
    await processBillingWebhook(raw, sign(raw));

    expect(await planOfOrg(fixture.orgId)).toBe("FREE");
  });

  it("ignores a delivery that overtook a newer one — a late 'active' cannot un-cancel", async () => {
    const start = new Date("2026-08-31T10:00:00.000Z");
    const later = new Date("2026-08-31T10:05:00.000Z");
    // This one really happened between the two, and simply arrives last.
    const inBetween = new Date("2026-08-31T10:02:00.000Z");

    const up = body("subscription.activated", { orgId: fixture.orgId, occurredAt: start });
    await processBillingWebhook(up, sign(up));
    expect(await planOfOrg(fixture.orgId)).toBe("PRO");

    const down = body("subscription.canceled", { orgId: fixture.orgId, occurredAt: later });
    await processBillingWebhook(down, sign(down));
    expect(await planOfOrg(fixture.orgId)).toBe("FREE");

    const stale = body("subscription.updated", {
      orgId: fixture.orgId,
      status: "active",
      occurredAt: inBetween,
    });
    const outcome = await processBillingWebhook(stale, sign(stale));

    // Accepted and recorded — the delivery history is complete — but the plan does not move.
    expect(outcome.httpStatus).toBe(200);
    expect(await planOfOrg(fixture.orgId)).toBe("FREE");
    expect(await eventRows()).toBe(3);
    expect(
      await prisma.activityLog.count({ where: { action: ACTIVITY.BILLING_PLAN_CHANGED } }),
    ).toBe(2);
  });

  it("still acts on an event that arrives after another one and really is newer", async () => {
    const first = new Date("2026-08-31T10:00:00.000Z");
    const second = new Date("2026-08-31T10:00:00.400Z");

    const up = body("subscription.activated", { orgId: fixture.orgId, occurredAt: first });
    await processBillingWebhook(up, sign(up));

    // Four hundred milliseconds later at the provider — the two are told apart by the provider's
    // own clock, never by when they happened to reach us.
    const down = body("subscription.canceled", { orgId: fixture.orgId, occurredAt: second });
    await processBillingWebhook(down, sign(down));

    expect(await planOfOrg(fixture.orgId)).toBe("FREE");
  });

  it("never reorders one company's events by another company's", async () => {
    const other = await makeOrg("Neighbour Energy", "FREE");
    const late = new Date("2026-08-31T12:00:00.000Z");
    const early = new Date("2026-08-31T09:00:00.000Z");

    const theirs = body("subscription.activated", { orgId: other.id, occurredAt: late });
    await processBillingWebhook(theirs, sign(theirs));

    const mine = body("subscription.activated", { orgId: fixture.orgId, occurredAt: early });
    await processBillingWebhook(mine, sign(mine));

    expect(await planOfOrg(fixture.orgId)).toBe("PRO");
    expect(await planOfOrg(other.id)).toBe("PRO");
  });

  it("judges a payment problem by the provider's clock, so a late failure cannot raise a stale warning", async () => {
    const failedAt = new Date("2026-08-31T10:00:00.000Z");
    const paidAt = new Date("2026-08-31T10:30:00.000Z");

    // The subscription exists, which is what makes the question worth asking at all.
    const up = body("subscription.activated", {
      orgId: fixture.orgId,
      subscriptionId: "sub_signal",
      occurredAt: new Date("2026-08-31T09:00:00.000Z"),
    });
    await processBillingWebhook(up, sign(up));

    // The payment that went through happened LAST but reached us FIRST.
    const paid = body("transaction.completed", { orgId: fixture.orgId, occurredAt: paidAt });
    await processBillingWebhook(paid, sign(paid));

    const failed = body("transaction.payment_failed", { orgId: fixture.orgId, occurredAt: failedAt });
    await processBillingWebhook(failed, sign(failed));

    // Ordered by when they happened, the newest word is "paid" — so the card says nothing is wrong.
    expect((await billingStatus(fixture.adminActor)).provider.paymentIssue).toBe(false);
  });

  it("does raise the warning when the failure really is the newest word", async () => {
    const up = body("subscription.activated", {
      orgId: fixture.orgId,
      subscriptionId: "sub_signal",
      occurredAt: new Date("2026-08-31T09:00:00.000Z"),
    });
    await processBillingWebhook(up, sign(up));

    const paid = body("transaction.completed", {
      orgId: fixture.orgId,
      occurredAt: new Date("2026-08-31T10:00:00.000Z"),
    });
    await processBillingWebhook(paid, sign(paid));

    const failed = body("transaction.payment_failed", {
      orgId: fixture.orgId,
      occurredAt: new Date("2026-08-31T11:00:00.000Z"),
    });
    await processBillingWebhook(failed, sign(failed));

    expect((await billingStatus(fixture.adminActor)).provider.paymentIssue).toBe(true);
  });

  it("reconciles an update by the status it carries", async () => {
    const paused = body("subscription.updated", { orgId: fixture.orgId, status: "paused" });
    await setPlan(fixture.orgId, "PRO");
    await processBillingWebhook(paused, sign(paused));
    expect(await planOfOrg(fixture.orgId)).toBe("FREE");

    const active = body("subscription.updated", { orgId: fixture.orgId, status: "active" });
    await processBillingWebhook(active, sign(active));
    expect(await planOfOrg(fixture.orgId)).toBe("PRO");
  });

  it("keeps Pro while a payment is being retried — past due is not a downgrade", async () => {
    await setPlan(fixture.orgId, "PRO");

    const pastDue = body("subscription.updated", { orgId: fixture.orgId, status: "past_due" });
    await processBillingWebhook(pastDue, sign(pastDue));
    expect(await planOfOrg(fixture.orgId)).toBe("PRO");

    const failed = body("transaction.payment_failed", { orgId: fixture.orgId });
    await processBillingWebhook(failed, sign(failed));
    expect(await planOfOrg(fixture.orgId)).toBe("PRO");
  });

  it("records an event type it does not recognise and changes nothing", async () => {
    const raw = body("subscription.trialing_something_new", { orgId: fixture.orgId });
    const outcome = await processBillingWebhook(raw, sign(raw));

    expect(outcome.httpStatus).toBe(200);
    expect(await eventRows()).toBe(1);
    expect(await planOfOrg(fixture.orgId)).toBe("FREE");
    expect(
      await prisma.activityLog.count({ where: { action: ACTIVITY.BILLING_PLAN_CHANGED } }),
    ).toBe(0);
  });

  it("answers a company we do not have exactly as it answers one we do — never a 404", async () => {
    const raw = body("subscription.activated", { orgId: "clnotarealorgid00000000" });
    const outcome = await processBillingWebhook(raw, sign(raw));

    expect(outcome.httpStatus).toBe(200);
    // Recorded so the delivery history is complete, with no company attached to it.
    const row = await prisma.billingEvent.findFirst();
    expect(row?.orgId).toBeNull();
    expect(await planOfOrg(fixture.orgId)).toBe("FREE");
  });

  it("answers a webhook with no company named at all the same way", async () => {
    const raw = body("subscription.activated", { orgId: null });
    const outcome = await processBillingWebhook(raw, sign(raw));

    expect(outcome.httpStatus).toBe(200);
    expect(await planOfOrg(fixture.orgId)).toBe("FREE");
  });

  it("only ever moves the company the payload names, and never a neighbour", async () => {
    const other = await makeOrg("Another company entirely", "FREE");

    const raw = body("subscription.activated", { orgId: fixture.orgId });
    await processBillingWebhook(raw, sign(raw));

    expect(await planOfOrg(fixture.orgId)).toBe("PRO");
    expect(await planOfOrg(other.id)).toBe("FREE");
  });
});

/* ------------------------------------------------------------------ */
/* 4. The two buttons                                                  */
/* ------------------------------------------------------------------ */

/** Replaces the network with one answer, and remembers what was asked for. */
function stubFetch(answer: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const stub = vi.fn(async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(answer), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", stub);
  return calls;
}

describe("upgrading", () => {
  beforeEach(() => configureProvider());

  it("asks the provider for a checkout, names the company in it, and hands back the address", async () => {
    const calls = stubFetch({
      data: { id: "txn_01", checkout: { url: "https://sandbox-buy.paddle.com/checkout/abc" } },
    });

    const result = await startUpgrade(fixture.adminActor);

    expect(result.url).toContain("https://sandbox-buy.paddle.com/checkout/abc");
    expect(result.url).toContain("success_url=");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://sandbox-api.paddle.com/transactions");
    const sent = JSON.parse(String(calls[0].init.body)) as { custom_data: { org_id: string } };
    expect(sent.custom_data.org_id).toBe(fixture.orgId);
  });

  it("never writes the checkout address into the audit trail", async () => {
    stubFetch({ data: { checkout: { url: "https://sandbox-buy.paddle.com/checkout/secret-token" } } });

    await startUpgrade(fixture.adminActor);

    const rows = await prisma.activityLog.findMany({
      where: { action: ACTIVITY.BILLING_CHECKOUT_STARTED },
    });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).not.toContain("secret-token");
    expect(JSON.stringify(rows[0])).not.toContain("paddle.com");
    // Nor the API key, ever.
    expect(JSON.stringify(rows[0])).not.toContain(API_KEY);
  });

  it("refuses to send anybody to an address the provider does not host", async () => {
    stubFetch({ data: { checkout: { url: "https://tielora.example/checkout?_ptxn=txn_01" } } });

    await expect(startUpgrade(fixture.adminActor)).rejects.toBeInstanceOf(ServiceError);
  });

  it("refuses plainly when the provider answers with a shape we cannot read", async () => {
    stubFetch({ data: { id: "txn_01" } });

    await expect(startUpgrade(fixture.adminActor)).rejects.toThrow(/Checkout isn't ready/);
  });

  it("is refused to anybody who is not an administrator of that company", async () => {
    stubFetch({ data: { checkout: { url: "https://sandbox-buy.paddle.com/c/1" } } });

    await expect(startUpgrade(fixture.pmActor)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(startUpgrade(fixture.engineerActor)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("tells an administrator whose company is already on Pro, instead of charging them twice", async () => {
    await setPlan(fixture.orgId, "PRO");
    stubFetch({ data: { checkout: { url: "https://sandbox-buy.paddle.com/c/1" } } });

    await expect(startUpgrade(fixture.adminActor)).rejects.toThrow(/already on Pro/);
  });
});

describe("managing an existing subscription", () => {
  beforeEach(() => configureProvider());

  it("mints a fresh portal address per press and never stores it", async () => {
    const activation = body("subscription.activated", {
      orgId: fixture.orgId,
      customerId: "ctm_portal",
      subscriptionId: "sub_portal",
    });
    await processBillingWebhook(activation, sign(activation));

    const calls = stubFetch({
      data: { urls: { general: { overview: "https://sandbox-customer-portal.paddle.com/s/one" } } },
    });

    const result = await openBillingPortal(fixture.adminActor);

    expect(result.url).toBe("https://sandbox-customer-portal.paddle.com/s/one");
    expect(calls[0].url).toBe("https://sandbox-api.paddle.com/customers/ctm_portal/portal-sessions");

    // Nothing about the address is kept anywhere.
    const org = await prisma.organization.findUnique({ where: { id: fixture.orgId } });
    expect(JSON.stringify(org)).not.toContain("customer-portal");
    const rows = await prisma.activityLog.findMany({
      where: { action: ACTIVITY.BILLING_PORTAL_OPENED },
    });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).not.toContain("customer-portal");
  });

  it("says so plainly when there is no subscription on file yet", async () => {
    stubFetch({ data: {} });
    await expect(openBillingPortal(fixture.adminActor)).rejects.toThrow(/don't have a subscription/);
  });

  it("is refused to anybody who is not an administrator", async () => {
    await expect(openBillingPortal(fixture.pmActor)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

/* ------------------------------------------------------------------ */
/* 5. Dormant means dormant                                            */
/* ------------------------------------------------------------------ */

describe("with no provider keys set, nothing about billing exists", () => {
  beforeEach(() => {
    // Save the current values, then clear them: this block is the unset world.
    configureProvider();
    for (const key of KEYS) delete process.env[key];
  });

  it("answers the webhook 'not set up' and touches nothing", async () => {
    const raw = body("subscription.activated", { orgId: fixture.orgId });

    const outcome = await processBillingWebhook(raw, sign(raw));

    expect(outcome.httpStatus).toBe(503);
    expect(await eventRows()).toBe(0);
    expect(await planOfOrg(fixture.orgId)).toBe("FREE");
  });

  it("refuses both buttons in plain English, without calling anybody", async () => {
    const calls = stubFetch({});

    await expect(startUpgrade(fixture.adminActor)).rejects.toThrow(/isn't turned on/);
    await expect(openBillingPortal(fixture.adminActor)).rejects.toThrow(/isn't turned on/);
    expect(calls).toHaveLength(0);
  });

  it("reads as dormant on the health check", () => {
    expect(billingHealth()).toBe("dormant");
  });
});

describe("with the provider keys set", () => {
  beforeEach(() => configureProvider());

  it("reads as configured on the health check, and says nothing else", () => {
    expect(billingHealth()).toBe("configured");
  });
});
