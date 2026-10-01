// Sign in with Microsoft — an extra door into Tielora, never a replacement for the password.
//
// THE TENANT RULE IS THE WHOLE POINT OF THIS FILE. A Microsoft login is the first way into the app
// that starts from an OUTSIDE party's claim about which company somebody belongs to, so the order
// below is law (spec 1.C, steps 1–7):
//  1. The attempt cookie (sealed state + nonce + PKCE verifier, ten minutes) must match what came
//     back. Missing, expired, tampered or mismatching → refuse.
//  2. The ID token is validated completely (src/lib/ms-id-token.ts) before ANY Tielora data is read.
//  3. Identity is `tid` + `oid`. The email is never enough on its own.
//  4. The company is the ONE organisation whose `entraTenantId` equals the token's `tid`. None →
//     refuse. Every person lookup after this is scoped to that company and checked against it.
//  5. Already linked: the person whose (`microsoftTenantId`, `microsoftOid`) is (`tid`, `oid`), in
//     that company. The email is not consulted again.
//  6. First time: only with an `email` claim AND `xms_edov === true`; the lower-cased address is
//     looked up in THAT company only; active, not an expired contractor, not linked yet. The link is
//     one conditional write (`microsoftOid IS NULL`), so two simultaneous first sign-ins have one
//     winner. An account already linked to a different `oid` is refused.
//  7. One transaction: the session, `lastLoginAt`, the LOGIN row (`method: "microsoft"`) and, on a
//     first link, a MICROSOFT_IDENTITY_LINKED row with NO identifier in it. The route sets the
//     cookie after the commit.
//
// FOUR MORE RULES:
//  - **A miss never says why.** Every refusal is the same redirect to `/login?microsoft=failed` and
//    the login page shows SIGN_IN_REFUSED_MESSAGE — the password route's own sentence. The log line
//    carries a category and the user id when known — never the email, the oid, the tid or a token.
//  - **Two-factor is never skipped.** Somebody with Tielora two-factor on gets a five-minute
//    `TWOFA_PENDING_MICROSOFT` ticket and nothing else: no session, cookie, LOGIN row or lastLoginAt.
//  - **A failed Microsoft sign-in never touches `login-account:<email>`** — it has no password to
//    guess and must not let anybody lock the real owner out of the password form.
//  - **Nothing about a Microsoft token is stored.** The code is exchanged, the ID token is read,
//    and only the two identifiers survive.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mintSession } from "@/lib/auth";
import { isAccessExpired } from "@/lib/access-expiry";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  SIGNIN_CALLBACK_PATH,
  appBaseUrl,
  domainOf,
  microsoftConfig,
  signInAuthorizeUrl,
  type MicrosoftConfig,
} from "@/lib/ms-graph";
import { JwksCache, validateIdToken, type MicrosoftIdentity } from "@/lib/ms-id-token";
import { assertCan } from "@/lib/permissions";
import { open, seal } from "@/lib/secret-box";
import type { MicrosoftSignInStatusDTO, RoleName } from "@/lib/zod-schemas";
import { MicrosoftSignInStatusDTO as StatusSchema } from "@/lib/zod-schemas";
import type { ActorContext } from "@/server/actor";
import { ServiceError } from "@/server/errors";
import { checkDto } from "@/server/serialize";
import { ACTIVITY, appendActivity } from "@/server/services/activity";
import { EMAIL_TOKEN_TTL_MS, issueEmailToken } from "@/server/services/email-tokens";
import { exchangeSignInCode, fetchSigningKeys } from "@/server/services/graph";
import { readableTotpSecret, TWO_FACTOR_USER_SELECT } from "@/server/services/two-factor";

/* ------------------------------------------------------------------ */
/* Dormancy                                                            */
/* ------------------------------------------------------------------ */

/**
 * Whether this deployment has the Azure app registered at all (`MS_GRAPH_CLIENT_ID` and
 * `MS_GRAPH_CLIENT_SECRET` both set). False means the login page is byte-for-byte what it always
 * was and both routes answer "not set up". The login page reads this to decide whether the button
 * exists.
 */
export function microsoftSignInAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return microsoftConfig(env) !== null;
}

/** The registered sign-in callback address, or null while APP_BASE_URL is not set. */
export function signInRedirectUri(env: NodeJS.ProcessEnv = process.env): string | null {
  const base = appBaseUrl(env);
  return base ? `${base}${SIGNIN_CALLBACK_PATH}` : null;
}

/** How many companies have Microsoft sign-in switched on. A number for /api/health and nothing else. */
export async function microsoftSignInOrgCount(): Promise<number> {
  try {
    return await prisma.organization.count({ where: { entraTenantId: { not: null } } });
  } catch {
    return 0;
  }
}

/* ------------------------------------------------------------------ */
/* The attempt cookie                                                  */
/* ------------------------------------------------------------------ */

/** Holds one sign-in attempt between leaving for Microsoft and coming back. httpOnly, sealed. */
export const ATTEMPT_COOKIE = "tielora_ms_attempt";
/** The cookie is only ever sent to the Microsoft sign-in routes, never to the rest of the app. */
export const ATTEMPT_COOKIE_PATH = "/api/auth/microsoft";
/** Ten minutes to finish at Microsoft; after that the attempt is refused. */
export const ATTEMPT_MAX_AGE_SEC = 600;

const ATTEMPT_PURPOSE = "microsoft.signin-attempt";

export type SignInAttempt = {
  /** "signin" from the login page; "enable" from an administrator's Switch on. */
  purpose: "signin" | "enable";
  /** Sent to Microsoft as `state` and compared on the way back. */
  state: string;
  /** Sent as `nonce`; the ID token must carry it back. */
  nonce: string;
  /** The PKCE verifier. Only its S256 hash ever leaves the server. */
  verifier: string;
  /** When the attempt began, in milliseconds. */
  ts: number;
  /** Enable only: the administrator who pressed Switch on, and their company. */
  userId?: string;
  orgId?: string;
  /**
   * "teams" when the attempt was started from the Teams tab's sign-in window. A fixed flag that
   * only changes the ENDING (a one-time hand-off code instead of a session); it cannot loosen a check.
   */
  via?: "teams";
};

function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

function challengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * The attempt, sealed with AES-256-GCM under a key derived from SESSION_SECRET for its own purpose —
 * so it is both unreadable and tamper-proof, and the PKCE verifier never sits in the browser in the
 * clear.
 */
export function sealAttempt(attempt: SignInAttempt): string {
  return seal(ATTEMPT_PURPOSE, JSON.stringify(attempt));
}

/** The attempt when it opens, is well formed and is under ten minutes old; otherwise null. */
export function openAttempt(value: string | undefined, now = Date.now()): SignInAttempt | null {
  if (!value || value.length > 4_096) return null;
  let parsed: Partial<SignInAttempt>;
  try {
    parsed = JSON.parse(open(ATTEMPT_PURPOSE, value)) as Partial<SignInAttempt>;
  } catch {
    return null;
  }
  if (
    (parsed.purpose !== "signin" && parsed.purpose !== "enable") ||
    typeof parsed.state !== "string" ||
    typeof parsed.nonce !== "string" ||
    typeof parsed.verifier !== "string" ||
    typeof parsed.ts !== "number"
  ) {
    return null;
  }
  if (now - parsed.ts > ATTEMPT_MAX_AGE_SEC * 1000 || parsed.ts - now > 60_000) return null;
  if (parsed.purpose === "enable" && (typeof parsed.userId !== "string" || typeof parsed.orgId !== "string")) {
    return null;
  }
  return {
    purpose: parsed.purpose,
    state: parsed.state,
    nonce: parsed.nonce,
    verifier: parsed.verifier,
    ts: parsed.ts,
    userId: parsed.userId,
    orgId: parsed.orgId,
    // Only the one known value survives; anything else in a (sealed) cookie is ignored.
    via: parsed.via === "teams" && parsed.purpose === "signin" ? "teams" : undefined,
  };
}

function sameString(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export type StartedAttempt = {
  /** Where to send the browser. */
  authorizeUrl: string;
  /** The sealed attempt, for the httpOnly cookie. */
  cookieValue: string;
};

function requireSignInConfig(): { config: MicrosoftConfig; redirectUri: string } {
  const config = microsoftConfig();
  const redirectUri = signInRedirectUri();
  if (!config || !redirectUri) throw new ServiceError("Sign in with Microsoft is not set up.");
  return { config, redirectUri };
}

function begin(
  purpose: SignInAttempt["purpose"],
  who?: { userId: string; orgId: string },
  via?: "teams",
): StartedAttempt {
  const { config, redirectUri } = requireSignInConfig();
  const attempt: SignInAttempt = {
    purpose,
    state: randomToken(24),
    nonce: randomToken(24),
    verifier: randomToken(48),
    ts: Date.now(),
    ...(who ?? {}),
    ...(via ? { via } : {}),
  };
  return {
    authorizeUrl: signInAuthorizeUrl(config, redirectUri, {
      state: attempt.state,
      nonce: attempt.nonce,
      codeChallenge: challengeFor(attempt.verifier),
    }),
    cookieValue: sealAttempt(attempt),
  };
}

/** The login page's "Sign in with Microsoft": anonymous, bound only to this browser's cookie. */
export function startMicrosoftSignIn(options: { via?: "teams" } = {}): StartedAttempt {
  return begin("signin", undefined, options.via);
}

/**
 * An administrator's "Switch on". Bound to them and their company: the callback refuses a session
 * that is not this same administrator of this same company.
 */
export function startMicrosoftSignInEnable(actor: ActorContext): StartedAttempt {
  assertCan(actor, "MANAGE_INTEGRATIONS");
  return begin("enable", { userId: actor.userId, orgId: actor.orgId });
}

/* ------------------------------------------------------------------ */
/* The ID token                                                        */
/* ------------------------------------------------------------------ */

/** Microsoft's signing keys, cached in this process. Test seam: `signingKeys.clear()`. */
export const signingKeys = new JwksCache(fetchSigningKeys);

type CallbackInput = { code: string | null; state: string | null; error: string | null };

type IdentityResult =
  | { ok: true; identity: MicrosoftIdentity }
  | { ok: false; reason: string; cancelled?: boolean };

/** Step 1 and 2: the attempt matches, Microsoft did not say no, the code becomes a valid ID token. */
async function identityFrom(attempt: SignInAttempt, input: CallbackInput): Promise<IdentityResult> {
  if (!input.state || !sameString(input.state, attempt.state)) {
    return { ok: false, reason: "state-mismatch" };
  }
  // Microsoft says no by sending an error instead of a code — usually somebody pressed Cancel.
  if (input.error) return { ok: false, reason: "cancelled", cancelled: true };
  if (!input.code || input.code.length > 4_096) return { ok: false, reason: "no-code" };

  const { config, redirectUri } = requireSignInConfig();
  let idToken: string;
  try {
    idToken = await exchangeSignInCode(config, redirectUri, input.code, attempt.verifier);
  } catch {
    return { ok: false, reason: "microsoft-error" };
  }

  const checked = await validateIdToken(
    idToken,
    { clientId: config.clientId, nonce: attempt.nonce },
    signingKeys.keyFor,
  );
  if (!checked.ok) return { ok: false, reason: `token-${checked.reason}` };
  return { ok: true, identity: checked.identity };
}

/* ------------------------------------------------------------------ */
/* Signing in                                                          */
/* ------------------------------------------------------------------ */

export type SignInOutcome =
  | {
      kind: "signed-in";
      userId: string;
      role: RoleName;
      /** The raw session token for the cookie — set by the route only after this commits. */
      sessionToken: string;
      sessionExpiresAt: Date;
    }
  | { kind: "two-factor"; userId: string; pendingToken: string }
  /**
   * Started from Teams: no session and no two-factor ticket here. The identity rule passed (and a
   * first link was written); the code is single-use, two minutes, and exchanged at
   * `/api/teams/session`, where two-factor is asked if it is on.
   */
  | { kind: "teams-handoff"; userId: string; handoffCode: string }
  | { kind: "refused"; reason: string; userId?: string };

/** Thrown inside the transaction to roll a lost race back. */
class LinkLost extends Error {}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

/** What a sign-in needs to know about a person; the Teams tab's sign-in reuses it. */
export const SIGNIN_USER_SELECT = {
  ...TWO_FACTOR_USER_SELECT,
  email: true,
  role: true,
  isActive: true,
  accessExpiresAt: true,
  microsoftOid: true,
  microsoftTenantId: true,
} as const;

function refused(reason: string, userId?: string): SignInOutcome {
  // A category and, when known, whose account — never the email, the oid, the tid or any token.
  logger.warn("Microsoft sign-in refused", { reason, userId });
  return { kind: "refused", reason, userId };
}

/**
 * The whole of a sign-in callback, from the attempt cookie to a session (or a two-factor ticket, or
 * a refusal). Pure of cookies: the route reads and deletes the attempt cookie and sets the session
 * cookie after this has committed.
 */
export async function completeMicrosoftSignIn(
  attempt: SignInAttempt,
  input: CallbackInput,
  meta: { ip?: string; userAgent?: string | null },
): Promise<SignInOutcome> {
  if (attempt.purpose !== "signin") return refused("wrong-attempt");

  const result = await identityFrom(attempt, input);
  if (!result.ok) return refused(result.reason);
  const { tid, oid, email, emailDomainVerified } = result.identity;

  // Step 4: the company is the one that owns this tenant, and nothing else.
  const org = await prisma.organization.findUnique({
    where: { entraTenantId: tid },
    select: { id: true },
  });
  if (!org) return refused("tenant-not-switched-on");

  // Step 5: already linked — by tid + oid, and it must be inside that same company.
  let user = await prisma.user.findUnique({
    where: { microsoftTenantId_microsoftOid: { microsoftTenantId: tid, microsoftOid: oid } },
    select: SIGNIN_USER_SELECT,
  });
  if (user && user.orgId !== org.id) return refused("linked-in-another-company", user.id);

  let firstLink = false;
  if (!user) {
    // Step 6: first time — a verified email, looked up in THIS company only.
    if (!email || !emailDomainVerified) return refused("email-not-verified-by-microsoft");
    user = await prisma.user.findFirst({
      where: { email, orgId: org.id },
      select: SIGNIN_USER_SELECT,
    });
    if (!user || user.orgId !== org.id) return refused("no-matching-account");
    if (user.microsoftOid !== null || user.microsoftTenantId !== null) {
      return refused("linked-to-a-different-microsoft-account", user.id);
    }
    firstLink = true;
  }

  // Deactivation and a contractor's end date refuse here exactly as they do at the password.
  if (!user.isActive) return refused("inactive", user.id);
  if (isAccessExpired(user)) return refused("access-expired", user.id);

  // Two-factor is never skipped. A secret that can no longer be read (a rotated SESSION_SECRET) has
  // just been switched off and recorded, and the sign-in carries on — exactly as after a password.
  // (Started from Teams: the exchange at /api/teams/session asks for it instead.)
  const teamsMode = attempt.via === "teams";
  const needsSecondFactor =
    !teamsMode && user.totpEnabledAt ? (await readableTotpSecret(user)) !== null : false;

  const person = user;
  const minted = needsSecondFactor || teamsMode ? null : mintSession();

  try {
    const pendingToken = await prisma.$transaction(async (tx) => {
      if (firstLink) {
        // THE LINK IS THIS WRITE. `microsoftOid: null` in the WHERE clause means a second first
        // sign-in racing this one matches nothing; the company must still own this tenant, so a
        // switch-off that committed a moment ago cannot be undone by a link landing after it.
        const linked = await tx.user.updateMany({
          where: {
            id: person.id,
            orgId: org.id,
            isActive: true,
            microsoftOid: null,
            microsoftTenantId: null,
            organization: { entraTenantId: tid },
          },
          data: { microsoftOid: oid, microsoftTenantId: tid },
        });
        if (linked.count !== 1) throw new LinkLost();

        await appendActivity(tx, {
          actorId: person.id,
          projectId: null,
          entityType: "User",
          entityId: person.id,
          action: ACTIVITY.MICROSOFT_IDENTITY_LINKED,
          summary: `${person.name} linked their Microsoft account`,
          // Deliberately EMPTY of identifiers: the audit trail can never be edited, so it must not
          // hold an oid, a tid or an address that deleting the account is meant to clear.
          metadata: {},
        });
      }

      if (teamsMode) {
        const issued = await issueEmailToken(
          person.id,
          "TEAMS_HANDOFF",
          EMAIL_TOKEN_TTL_MS.TEAMS_HANDOFF,
          tx,
        );
        return issued.rawToken;
      }

      if (needsSecondFactor) {
        const issued = await issueEmailToken(
          person.id,
          "TWOFA_PENDING_MICROSOFT",
          EMAIL_TOKEN_TTL_MS.TWOFA_PENDING_MICROSOFT,
          tx,
        );
        return issued.rawToken;
      }

      if (!minted) throw new Error("unreachable");
      await tx.session.create({
        data: {
          tokenHash: minted.tokenHash,
          userId: person.id,
          expiresAt: minted.expiresAt,
          ip: meta.ip ?? undefined,
          userAgent: meta.userAgent?.slice(0, 300),
        },
      });
      await tx.user.update({ where: { id: person.id }, data: { lastLoginAt: new Date() } });
      // The same row, written the same way, that the password route writes — saying which door.
      await tx.activityLog.create({
        data: {
          actorId: person.id,
          entityType: "User",
          entityId: person.id,
          action: "LOGIN",
          summary: `${person.name} signed in`,
          metadata: { reportedIp: meta.ip ?? null, twoFactor: false, method: "microsoft" },
        },
      });
      return null;
    });

    if (pendingToken && teamsMode) {
      logger.info("Microsoft sign-in from Teams is waiting to be exchanged", { userId: person.id });
      return { kind: "teams-handoff", userId: person.id, handoffCode: pendingToken };
    }

    if (pendingToken) {
      logger.info("Microsoft sign-in is waiting for a second factor", { userId: person.id });
      return { kind: "two-factor", userId: person.id, pendingToken };
    }
  } catch (error) {
    if (error instanceof LinkLost || isUniqueViolation(error)) {
      return refused("link-lost-race", person.id);
    }
    throw error;
  }

  if (!minted) throw new Error("unreachable");
  logger.info("Sign-in succeeded", { userId: person.id, method: "microsoft" });
  return {
    kind: "signed-in",
    userId: person.id,
    role: person.role,
    sessionToken: minted.rawToken,
    sessionExpiresAt: minted.expiresAt,
  };
}

/* ------------------------------------------------------------------ */
/* Switching it on                                                     */
/* ------------------------------------------------------------------ */

/** What the Microsoft 365 card is told, as `/admin/integrations?microsoftSignIn=<outcome>`. */
export type EnableOutcome = "enabled" | "denied" | "mismatch" | "taken" | "switchOffFirst" | "failed";

/**
 * An administrator came back from signing in to Microsoft AS THEMSELVES. The company's tenant is
 * captured from that token — never typed — and only when Microsoft vouches (`xms_edov`) for an
 * email that is exactly the administrator's own Tielora address. `actor` is whoever the CURRENT
 * session belongs to; it must be the administrator who started, of the company they started in.
 */
export async function completeMicrosoftSignInEnable(
  actor: ActorContext | null,
  attempt: SignInAttempt,
  input: CallbackInput,
): Promise<EnableOutcome> {
  const fail = (outcome: EnableOutcome, reason: string): EnableOutcome => {
    logger.warn("Microsoft sign-in was not switched on", { reason, userId: actor?.userId });
    return outcome;
  };

  if (attempt.purpose !== "enable") return fail("failed", "wrong-attempt");
  if (!actor || actor.userId !== attempt.userId || actor.orgId !== attempt.orgId) {
    return fail("failed", "session-changed");
  }
  try {
    assertCan(actor, "MANAGE_INTEGRATIONS");
  } catch {
    return fail("failed", "not-allowed");
  }

  const result = await identityFrom(attempt, input);
  if (!result.ok) return fail(result.cancelled ? "denied" : "failed", result.reason);
  const { tid, oid, email, emailDomainVerified } = result.identity;

  // The Microsoft account must be the administrator's own: same address, vouched for by Microsoft.
  if (!email || !emailDomainVerified || email !== actor.email.toLowerCase()) {
    return fail("mismatch", "email-mismatch");
  }

  const org = await prisma.organization.findUnique({
    where: { id: actor.orgId },
    select: { id: true, entraTenantId: true },
  });
  if (!org) return fail("failed", "no-company");
  if (org.entraTenantId && org.entraTenantId !== tid) return fail("switchOffFirst", "other-tenant-held");

  const holder = await prisma.organization.findUnique({
    where: { entraTenantId: tid },
    select: { id: true },
  });
  if (holder && holder.id !== actor.orgId) return fail("taken", "tenant-taken");

  const me = await prisma.user.findUnique({
    where: { id: actor.userId },
    select: { orgId: true, microsoftOid: true, microsoftTenantId: true },
  });
  if (!me || me.orgId !== actor.orgId) return fail("failed", "no-account");
  const alreadyMine = me.microsoftOid === oid && me.microsoftTenantId === tid;
  if (!alreadyMine && (me.microsoftOid !== null || me.microsoftTenantId !== null)) {
    return fail("failed", "admin-linked-elsewhere");
  }

  const domain = domainOf(email);

  try {
    await prisma.$transaction(async (tx) => {
      // Conditional on the company holding no tenant or this one, so two administrators pressing
      // Switch on with two different tenants at once cannot both win.
      const claimed = await tx.organization.updateMany({
        where: { id: actor.orgId, OR: [{ entraTenantId: null }, { entraTenantId: tid }] },
        data: { entraTenantId: tid },
      });
      if (claimed.count !== 1) throw new LinkLost("switchOffFirst");

      if (!alreadyMine) {
        const linked = await tx.user.updateMany({
          where: { id: actor.userId, orgId: actor.orgId, microsoftOid: null, microsoftTenantId: null },
          data: { microsoftOid: oid, microsoftTenantId: tid },
        });
        if (linked.count !== 1) throw new LinkLost("failed");
        await appendActivity(tx, {
          actorId: actor.userId,
          projectId: null,
          entityType: "User",
          entityId: actor.userId,
          action: ACTIVITY.MICROSOFT_IDENTITY_LINKED,
          summary: `${actor.name} linked their Microsoft account`,
          metadata: {},
        });
      }

      await appendActivity(tx, {
        actorId: actor.userId,
        projectId: null,
        entityType: "Organization",
        entityId: actor.orgId,
        action: ACTIVITY.MICROSOFT_SIGNIN_ENABLED,
        summary: `${actor.name} switched on Sign in with Microsoft${domain ? ` (${domain})` : ""}`,
        // Company facts only — the tenant and its domain. Never the administrator's oid or address.
        metadata: { tenantId: tid, domain },
      });
    });
  } catch (error) {
    // The unique index on entraTenantId is the last word when another company claimed the same
    // tenant in the same instant.
    if (isUniqueViolation(error)) return fail("taken", "tenant-taken-race");
    if (error instanceof LinkLost) {
      return fail(error.message === "switchOffFirst" ? "switchOffFirst" : "failed", "lost-race");
    }
    throw error;
  }

  logger.info("Microsoft sign-in switched on", { orgId: actor.orgId, userId: actor.userId });
  return "enabled";
}

/* ------------------------------------------------------------------ */
/* Switching it off                                                    */
/* ------------------------------------------------------------------ */

/**
 * Forgets the company's tenant and removes EVERY Microsoft link in this company — the actor's own
 * company, and nothing else. Sessions are untouched: nothing about who anybody is has changed.
 * Any Microsoft sign-in ticket still waiting for a code is retired, because the door it came
 * through has just been closed.
 */
export async function disableMicrosoftSignIn(actor: ActorContext): Promise<{ removed: true }> {
  assertCan(actor, "MANAGE_INTEGRATIONS");

  const org = await prisma.organization.findUnique({
    where: { id: actor.orgId },
    select: { entraTenantId: true },
  });
  if (!org?.entraTenantId) {
    throw new ServiceError("Sign in with Microsoft is already switched off.");
  }

  await prisma.$transaction(async (tx) => {
    const unlinked = await tx.user.updateMany({
      where: {
        orgId: actor.orgId,
        OR: [{ microsoftOid: { not: null } }, { microsoftTenantId: { not: null } }],
      },
      data: { microsoftOid: null, microsoftTenantId: null },
    });
    await tx.organization.update({ where: { id: actor.orgId }, data: { entraTenantId: null } });
    await tx.emailToken.updateMany({
      where: { purpose: "TWOFA_PENDING_MICROSOFT", usedAt: null, user: { orgId: actor.orgId } },
      data: { usedAt: new Date() },
    });
    await appendActivity(tx, {
      actorId: actor.userId,
      projectId: null,
      entityType: "Organization",
      entityId: actor.orgId,
      action: ACTIVITY.MICROSOFT_SIGNIN_DISABLED,
      summary: `${actor.name} switched off Sign in with Microsoft`,
      metadata: { peopleUnlinked: unlinked.count },
    });
  });

  return { removed: true };
}

/* ------------------------------------------------------------------ */
/* What the admin card reads                                           */
/* ------------------------------------------------------------------ */

/**
 * The "Sign in with Microsoft" half of the Microsoft 365 card, for the actor's OWN company only.
 * The domain, who and when come from the latest MICROSOFT_SIGNIN_ENABLED row — nothing else is
 * stored for it. A name is null when that account has since left.
 */
export async function microsoftSignInStatus(actor: ActorContext): Promise<MicrosoftSignInStatusDTO> {
  assertCan(actor, "MANAGE_INTEGRATIONS");

  const org = await prisma.organization.findUnique({
    where: { id: actor.orgId },
    select: { entraTenantId: true },
  });
  const enabled = Boolean(org?.entraTenantId);

  const [latest, linkedPeople] = await Promise.all([
    enabled
      ? prisma.activityLog.findFirst({
          where: {
            action: ACTIVITY.MICROSOFT_SIGNIN_ENABLED,
            entityType: "Organization",
            entityId: actor.orgId,
          },
          orderBy: { createdAt: "desc" },
          select: {
            createdAt: true,
            metadata: true,
            actor: { select: { name: true, isActive: true, orgId: true } },
          },
        })
      : Promise.resolve(null),
    prisma.user.count({ where: { orgId: actor.orgId, microsoftOid: { not: null } } }),
  ]);

  const metadata = (latest?.metadata ?? {}) as { domain?: unknown };
  const who = latest?.actor;

  return checkDto(
    StatusSchema,
    {
      enabled,
      domain: typeof metadata.domain === "string" ? metadata.domain : null,
      enabledByName: who && who.isActive && who.orgId === actor.orgId ? who.name : null,
      enabledAt: latest ? latest.createdAt.toISOString() : null,
      linkedPeople,
      callbackReady: signInRedirectUri() !== null,
    },
    "MicrosoftSignInStatusDTO",
  );
}
