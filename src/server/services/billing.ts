// Plans and limits — the enforcement half.
//
// THE CHOKE POINTS ARE THE POINT. A limit is checked in exactly three places, each of them the one
// service function that can add to the thing being limited: createProject, createUser (both the
// password and the invite path) and uploadDocumentVersion (which every upload walks through,
// browser and Microsoft 365 alike). Nothing else in the app has to remember plans exist.
//
// READS ARE NEVER BLOCKED. A company that is already over a limit — an existing project, an
// existing person, existing files — carries on exactly as before: everything opens, everything
// works, and the only thing refused is adding MORE. That is grandfathering, and it is what makes a
// future downgrade safe.
//
// A limit refusal writes no ActivityLog row. It is an ordinary validation failure, like a duplicate
// project code or a missing password, and those have never been audited — the audit trail records
// work that HAPPENED, and nothing happened here.
//
// THE SECOND HALF OF THIS FILE IS TAKING THE MONEY, and it is dormant until four environment
// variables are set (house rule 11). Every provider-specific fact — the host, the event names, the
// payload fields, the signature scheme — lives in src/server/services/paddle.ts and nowhere else;
// this file only ever hears "there is a provider", "here are two addresses" and "this webhook means
// activate, deactivate or nothing".

import type { Prisma } from "@/generated/prisma/client";
import { ACCESS_EXPIRY_GRACE_MS } from "@/lib/access-expiry";
import { notDeleted, prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { assertCan } from "@/lib/permissions";
import { limitRefusal, limitsFor, planOf, type LimitKind } from "@/lib/plan-limits";
import type {
  BillingProviderDTO,
  BillingRedirectDTO,
  BillingStatusDTO,
  PlanLimitsDTO,
  PlanName,
  PlanUsageDTO,
} from "@/lib/zod-schemas";
import {
  BillingRedirectDTO as BillingRedirectSchema,
  BillingStatusDTO as BillingStatusSchema,
} from "@/lib/zod-schemas";
import type { ActorContext } from "@/server/actor";
import { NotFoundError, ServiceError } from "@/server/errors";
import { checkDto } from "@/server/serialize";
import { ACTIVITY, appendActivity } from "@/server/services/activity";
import {
  BILLING_NOT_CONFIGURED,
  BILLING_PROVIDER,
  PAYMENT_FAILED_EVENT,
  PAYMENT_SIGNAL_EVENTS,
  billingConfigured,
  checkWebhookSignature,
  createCheckoutUrl,
  createPortalUrl,
  paddleConfig,
  planIntentFor,
  readWebhookEvent,
  type PaddleConfig,
} from "@/server/services/paddle";

/* ------------------------------------------------------------------ */
/* Reading where a company stands                                      */
/* ------------------------------------------------------------------ */

/** The company's plan, read from its own row and never from anything the browser sent. */
export async function planForOrg(orgId: string): Promise<PlanName> {
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { plan: true } });
  if (!org) throw new NotFoundError("We could not find that workspace.");
  return planOf(org);
}

/** Live projects. A soft-deleted project frees its place, the same way it disappears from listings. */
export async function countProjects(orgId: string): Promise<number> {
  return prisma.project.count({ where: { orgId, ...notDeleted } });
}

/**
 * People who can still sign in — and the count means exactly that, in both directions.
 *
 * A DEACTIVATED ACCOUNT DOES NOT COUNT, deliberately: an administrator who has deactivated somebody
 * has given the seat back, and charging a company for accounts nobody can use would make
 * deactivation pointless. The account, its work and its audit trail all stay exactly where they are
 * — this is a count, not a deletion.
 *
 * **AND NEITHER DOES A CONTRACTOR WHOSE ACCESS HAS RUN OUT.** `getSessionUser()` and the sign-in
 * route turn them away exactly as they turn away a deactivated account, so counting them would
 * charge a company for a seat nobody can use. The rule is the one in `isAccessExpired()` and this
 * is the same rule written as a query: not a contractor, or no end date, or an end date still
 * inside its one-day grace. It is spelled out as an OR rather than a NOT because a NULL end date
 * under a negated comparison would quietly drop everybody who has none.
 */
export async function countUsers(orgId: string, now: Date = new Date()): Promise<number> {
  const graceCutoff = new Date(now.getTime() - ACCESS_EXPIRY_GRACE_MS);
  return prisma.user.count({
    where: {
      orgId,
      isActive: true,
      OR: [
        { role: { not: "EXTERNAL" } },
        { accessExpiresAt: null },
        { accessExpiresAt: { gt: graceCutoff } },
      ],
    },
  });
}

/**
 * Every stored byte this company is responsible for.
 *
 * ALL revisions are counted, including the revisions of soft-deleted documents: the files are still
 * on our disk (nothing in this app ever deletes a revision or its bytes), so counting only the live
 * ones would let a company remove a document, upload it again and use the same disk twice over.
 * Deleting the whole workspace is the one thing that frees the space, and that removes the rows too.
 *
 * This is ONE aggregate query per upload, and that cost is accepted rather than cached: a stored
 * total would be a number that can drift from the truth, uploads are already rate limited to 30 a
 * minute per person, and the alternative — a usage column — is exactly the kind of duplicated
 * derived state this app keeps refusing to add.
 */
export async function storedBytes(orgId: string): Promise<number> {
  const total = await prisma.documentVersion.aggregate({
    _sum: { sizeBytes: true },
    where: { document: { project: { orgId } } },
  });
  return total._sum.sizeBytes ?? 0;
}

/**
 * What we can honestly say about the payment provider for one company.
 *
 * NOTHING NEW IS STORED to produce any of it: `configured` is four environment variables,
 * `hasSubscription` is the id column the webhook already writes, and `paymentIssue` is derived from
 * the BillingEvent rows we were already keeping for replay protection — the same discipline OVERDUE
 * and a locked phase follow.
 */
async function providerStatusFor(
  orgId: string,
  subscriptionId: string | null,
): Promise<BillingProviderDTO> {
  const configured = billingConfigured();
  const hasSubscription = Boolean(subscriptionId);
  if (!configured || !hasSubscription) {
    return { configured, hasSubscription, paymentIssue: false };
  }

  // The newest thing the provider told us about payment going through, whatever it was. A failure
  // that has since been followed by a completed payment is not a problem any more.
  //
  // "Newest" is the PROVIDER'S clock, not ours — the same rule the webhook uses to spot a delivery
  // that overtook another. Ordering by `processedAt` would let a delayed failure that happened
  // BEFORE a successful payment arrive afterwards and show the administrator a payment warning that
  // was already out of date. Undatable rows are never reordered: they sort last and are only ever
  // consulted when nothing dated exists, so a company whose events all predate `occurredAt` behaves
  // exactly as it did before.
  const newest = await prisma.billingEvent.findFirst({
    where: { orgId, provider: BILLING_PROVIDER, eventType: { in: PAYMENT_SIGNAL_EVENTS } },
    orderBy: [{ occurredAt: { sort: "desc", nulls: "last" } }, { processedAt: "desc" }],
    select: { eventType: true },
  });

  return { configured, hasSubscription, paymentIssue: newest?.eventType === PAYMENT_FAILED_EVENT };
}

/** Everything the Billing page shows: the plan, what is being used, and what the plan allows. */
export async function billingStatus(actor: ActorContext): Promise<BillingStatusDTO> {
  assertCan(actor, "MANAGE_BILLING");

  const org = await prisma.organization.findUnique({
    where: { id: actor.orgId },
    select: { plan: true, billingSubscriptionId: true },
  });
  if (!org) throw new NotFoundError("We could not find that workspace.");
  const plan = planOf(org);

  const [projects, users, documentBytes, provider] = await Promise.all([
    countProjects(actor.orgId),
    countUsers(actor.orgId),
    storedBytes(actor.orgId),
    providerStatusFor(actor.orgId, org.billingSubscriptionId),
  ]);

  const usage: PlanUsageDTO = { projects, users, documentBytes };
  const limits: PlanLimitsDTO = limitsFor(plan);

  return checkDto(BillingStatusSchema, { plan, usage, limits, provider }, "BillingStatusDTO");
}

/** What /api/health reports. A word about configuration, and nothing about anybody's money. */
export function billingHealth(): "dormant" | "configured" {
  return billingConfigured() ? "configured" : "dormant";
}

/* ------------------------------------------------------------------ */
/* The three choke points                                              */
/* ------------------------------------------------------------------ */

/**
 * The shared shape of all three: read the plan, count what is there, and refuse only when adding
 * this one more thing would go past the ceiling. Already over the ceiling is refused too — that is
 * the same rule, not a different one — but nothing already there is ever touched.
 */
async function assertRoom(
  actor: ActorContext,
  kind: LimitKind,
  used: number,
  adding: number,
): Promise<void> {
  const plan = await planForOrg(actor.orgId);
  const limit = limitsFor(plan)[kind];
  if (limit === null) return;
  if (used + adding <= limit) return;
  throw new ServiceError(limitRefusal(kind, plan, actor.role));
}

/**
 * Before a project is created. The cheap version: it answers an obvious refusal instantly, without
 * opening a transaction — but it is a read followed by a write, so two people pressing "Create
 * project" in the same second could both pass it. The transaction-safe version below is what
 * actually holds the line, and `createProject` calls both, exactly as `deleteMyAccount` keeps its
 * cheap pre-transaction count alongside its locked one.
 */
export async function assertProjectRoom(actor: ActorContext): Promise<void> {
  await assertRoom(actor, "projects", await countProjects(actor.orgId), 1);
}

/**
 * The same question asked BEHIND A LOCK on the company's own row, inside the transaction that
 * creates the project.
 *
 * Counting outside the transaction is a check-then-act race: two requests both count one project,
 * both decide there is room for one more, and a one-project company ends up with two. Locking the
 * `Organization` row first makes the second request wait, count again and be refused — the same
 * `SELECT … FOR UPDATE` the sole-administrator rule uses, for the same reason, and
 * transaction-scoped so it is always released.
 *
 * Projects get this treatment because their ceiling is the smallest (one, on a free plan), so an
 * overshoot is the one a person would actually see. See "Plans and limits" in docs/CONVENTIONS.md
 * for why people and storage are left as read-then-write.
 */
export async function assertProjectRoomInTransaction(
  tx: Prisma.TransactionClient,
  actor: ActorContext,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${actor.orgId} FOR UPDATE`;

  const org = await tx.organization.findUnique({
    where: { id: actor.orgId },
    select: { plan: true },
  });
  const plan = planOf(org);
  const limit = limitsFor(plan).projects;
  if (limit === null) return;

  const used = await tx.project.count({ where: { orgId: actor.orgId, ...notDeleted } });
  if (used + 1 <= limit) return;
  throw new ServiceError(limitRefusal("projects", plan, actor.role));
}

/** Before an account is created — the password path and the invite path both come through here. */
export async function assertUserRoom(actor: ActorContext): Promise<void> {
  await assertRoom(actor, "users", await countUsers(actor.orgId), 1);
}

/** Before a revision's bytes are recorded. Every upload path in the app passes this way. */
export async function assertStorageRoom(actor: ActorContext, incomingBytes: number): Promise<void> {
  await assertRoom(actor, "documentBytes", await storedBytes(actor.orgId), incomingBytes);
}

/* ------------------------------------------------------------------ */
/* Paying: the two buttons                                             */
/* ------------------------------------------------------------------ */
//
// Everything provider-specific below is borrowed from src/server/services/paddle.ts and nothing
// else: this file knows there is "a provider", that it can mint two addresses, and that its
// webhooks mean ACTIVATE, DEACTIVATE or NONE. It does not know a single Paddle field name.

/** The provider's settings, or a plain refusal. Both buttons and the webhook start here. */
function requireProvider(): PaddleConfig {
  const config = paddleConfig();
  if (!config) throw new ServiceError(BILLING_NOT_CONFIGURED);
  return config;
}

/** Where somebody comes back to after paying. The page reads `billing=success` and waits honestly. */
function successUrl(config: PaddleConfig): string {
  return `${config.appBaseUrl}/admin/billing?billing=success`;
}

/**
 * "Upgrade to Pro": mints a checkout and hands back the address to send this administrator to.
 *
 * The audit row is written only once the provider has actually given us a checkout, and it records
 * that an upgrade was started and nothing else — NOT the address, which is a one-press credential
 * of sorts and is never stored, never logged and never put in an ActivityLog row.
 */
export async function startUpgrade(actor: ActorContext): Promise<BillingRedirectDTO> {
  assertCan(actor, "MANAGE_BILLING");
  const config = requireProvider();

  const plan = await planForOrg(actor.orgId);
  if (plan === "PRO") {
    throw new ServiceError("Your company is already on Pro. Use Manage billing to change anything.");
  }

  const url = await createCheckoutUrl(config, { orgId: actor.orgId, successUrl: successUrl(config) });

  await prisma.$transaction(async (tx) => {
    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: null,
      entityType: "Organization",
      entityId: actor.orgId,
      action: ACTIVITY.BILLING_CHECKOUT_STARTED,
      summary: `${actor.name} started an upgrade to Pro`,
      metadata: { provider: BILLING_PROVIDER, plan: "PRO", environment: config.environment },
    });
  });

  return checkDto(BillingRedirectSchema, { url }, "BillingRedirectDTO");
}

/**
 * "Manage billing": mints a FRESH portal address every press. These links are single-use and
 * short-lived at the provider, so caching one would hand somebody a dead link — and storing one
 * would be storing a credential this app has no business keeping.
 */
export async function openBillingPortal(actor: ActorContext): Promise<BillingRedirectDTO> {
  assertCan(actor, "MANAGE_BILLING");
  const config = requireProvider();

  const org = await prisma.organization.findUnique({
    where: { id: actor.orgId },
    select: { billingCustomerId: true, billingSubscriptionId: true },
  });
  if (!org?.billingCustomerId) {
    throw new ServiceError(
      "We don't have a subscription on file for your company yet. If you have just paid, give it a minute and refresh this page.",
    );
  }

  const url = await createPortalUrl(config, org.billingCustomerId, org.billingSubscriptionId);

  await prisma.$transaction(async (tx) => {
    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: null,
      entityType: "Organization",
      entityId: actor.orgId,
      action: ACTIVITY.BILLING_PORTAL_OPENED,
      summary: `${actor.name} opened the billing page at our payment provider`,
      metadata: { provider: BILLING_PROVIDER, environment: config.environment },
    });
  });

  return checkDto(BillingRedirectSchema, { url }, "BillingRedirectDTO");
}

/* ------------------------------------------------------------------ */
/* The webhook                                                         */
/* ------------------------------------------------------------------ */

/** What the route should answer. Nothing here is ever shown to a person. */
export type WebhookOutcome = { httpStatus: number; message: string };

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * THE ORDER OF OPERATIONS HERE IS THE SECURITY. It never changes:
 *
 *  1. **Configured?** With no secret there is nothing to verify against, so the request is refused
 *     as "not set up" before anything else happens.
 *  2. **Signature, over the RAW body, before anything is parsed and before any database read.**
 *     A request that fails this leaves no trace in any table — not a BillingEvent row, not a plan
 *     change, nothing. It is the only thing standing between a stranger and a free Pro plan.
 *  3. **Idempotency.** The event's own id is inserted into BillingEvent inside the same transaction
 *     as the plan change. The `@@unique([provider, eventId])` constraint IS the replay rule:
 *     a provider retries until it is acknowledged, and the second delivery loses the race, rolls
 *     back and is answered 200.
 *  4. **The company** comes from the payload's custom data, and one we do not recognise is recorded
 *     and answered 200 — never a 404, which would turn this endpoint into a way of asking whether
 *     a company id is real.
 *  5. **The plan moves**, and an audit row is written in the same transaction.
 *
 * Anything unexpected throws, which the route turns into a 500 so the provider retries it later.
 */
export async function processBillingWebhook(
  rawBody: string,
  signatureHeader: string | null,
): Promise<WebhookOutcome> {
  const config = paddleConfig();
  if (!config) {
    // Dormant. The provider will retry and eventually mark the delivery failed, which is correct:
    // nothing is set up here, and pretending to have accepted the event would be worse.
    return { httpStatus: 503, message: BILLING_NOT_CONFIGURED };
  }

  const verdict = checkWebhookSignature(rawBody, signatureHeader, config.webhookSecret);
  if (verdict !== "ok") {
    // The verdict word only. Never the body, never the header, never the secret.
    logger.warn("A billing webhook was refused", { reason: verdict });
    return { httpStatus: 400, message: "That request could not be verified." };
  }

  const event = readWebhookEvent(rawBody);
  if (!event) {
    // Signed by us, so retrying will not make it readable. Accept it and move on.
    logger.warn("A billing webhook was verified but could not be read");
    return { httpStatus: 200, message: "Ignored." };
  }

  const org = event.orgId
    ? await prisma.organization.findUnique({
        where: { id: event.orgId },
        select: { id: true, plan: true, billingCustomerId: true, billingSubscriptionId: true },
      })
    : null;

  try {
    return await prisma.$transaction(async (tx) => {
      // The claim. A duplicate delivery fails here and the whole transaction unwinds.
      const claimed = await tx.billingEvent.create({
        data: {
          provider: BILLING_PROVIDER,
          eventId: event.eventId,
          eventType: event.eventType,
          orgId: org?.id ?? null,
          occurredAt: event.occurredAt,
        },
        select: { id: true },
      });

      if (!org) {
        // Recorded so the delivery history is complete, and answered exactly as a known company is
        // answered, so nobody can tell the difference from outside.
        logger.warn("A billing webhook named a company we do not have", {
          eventType: event.eventType,
        });
        return { httpStatus: 200, message: "Recorded." };
      }

      // DELIVERIES CAN ARRIVE OUT OF ORDER, and one that overtook a newer one must not undo it: a
      // delayed "updated: active" landing after a cancellation would put a cancelled company back
      // on Pro and keep it there. So an event the provider stamped EARLIER than something this
      // company has already been told about changes nothing — it is still recorded, because the
      // delivery history is the record that it arrived.
      //
      // The comparison is provider clock against provider clock, and it has to be: `processedAt` is
      // OUR clock, and a company that cancels seconds after upgrading would have the second event's
      // `occurred_at` sitting before the first event's arrival time — which would throw away a
      // perfectly good event. Two events we cannot date (no `occurred_at` either side) are never
      // reordered; they behave exactly as they did before this rule existed.
      const newest = event.occurredAt
        ? await tx.billingEvent.findFirst({
            where: {
              provider: BILLING_PROVIDER,
              orgId: org.id,
              occurredAt: { not: null },
              id: { not: claimed.id },
            },
            orderBy: { occurredAt: "desc" },
            select: { occurredAt: true },
          })
        : null;

      if (event.occurredAt && newest?.occurredAt && event.occurredAt < newest.occurredAt) {
        // The event id and the two moments only — nothing from the payload.
        logger.warn("A billing webhook arrived out of order and was recorded without acting on it", {
          eventType: event.eventType,
        });
        return { httpStatus: 200, message: "Recorded." };
      }

      const intent = planIntentFor(event);
      const from = planOf(org);
      const to: PlanName | null =
        intent === "ACTIVATE" ? "PRO" : intent === "DEACTIVATE" ? "FREE" : null;

      // The provider's ids are kept whatever happens, cancellation included: they are how "Manage
      // billing" still works afterwards, and how a resubscription is recognised as the same
      // customer. They are identifiers at the provider — never a key, a token or anything about a
      // card, none of which is stored anywhere in this app.
      const ids = {
        ...(event.customerId ? { billingCustomerId: event.customerId } : {}),
        ...(event.subscriptionId ? { billingSubscriptionId: event.subscriptionId } : {}),
      };
      const planMoved = to !== null && to !== from;

      if (planMoved || Object.keys(ids).length > 0) {
        await tx.organization.update({
          where: { id: org.id },
          data: { ...(planMoved ? { plan: to } : {}), ...ids },
        });
      }

      // The BillingEvent row is the record that a delivery ARRIVED; this row is the record that the
      // company MOVED. A webhook that changes nothing writes only the first, exactly as a limit
      // refusal writes no audit row at all.
      if (planMoved) {
        await appendActivity(tx, {
          actorId: null,
          projectId: null,
          entityType: "Organization",
          entityId: org.id,
          action: ACTIVITY.BILLING_PLAN_CHANGED,
          summary: `Plan changed from ${from} to ${to}`,
          // The event's own id and type, and nothing from the payload itself.
          metadata: {
            provider: BILLING_PROVIDER,
            from,
            to,
            eventId: event.eventId,
            eventType: event.eventType,
          },
        });
      }

      return { httpStatus: 200, message: "Recorded." };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Already handled, so this is a retry of something we finished. Acknowledge it and stop.
      return { httpStatus: 200, message: "Already handled." };
    }
    throw error;
  }
}
