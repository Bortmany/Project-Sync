// Signing in to the Tielora tab inside Microsoft Teams — the same identity rule as "Sign in with
// Microsoft" (docs/CONVENTIONS.md, "Sign in with Microsoft"), for a second way of arriving.
//
// TWO WAYS IN, ONE RULE:
//  - **Single sign-on** (`signInWithTeamsToken`): Teams hands the tab a short-lived Microsoft-signed
//    token. It is validated completely (`validateTeamsToken`, audience-aware, src/lib/ms-id-token.ts)
//    BEFORE any Tielora row is read. Identity is `tid` + `oid` ONLY — the token has no reliable
//    verified email, so the tab never matches on email. A person whose `oid` is not pinned yet goes
//    through the popup, which is the ordinary Microsoft sign-in (where the verified-email first-link
//    rule lives) started "from Teams".
//  - **The popup hand-off** (`signInWithHandoff`): the popup's callback minted a single-use,
//    two-minute `TEAMS_HANDOFF` code (no session). Exchanging it is one conditional update.
//
// THE RULES THAT DO NOT MOVE:
//  - The company is the ONE organisation whose `entraTenantId` equals the token's `tid`; the person
//    must belong to it — checked, not assumed. A token from another tenant, or a tenant no company
//    owns, is refused with the same answer as everything else.
//  - **A miss never says why.** Every refusal is `{ kind: "refused" }`; the route answers one
//    sentence. The log line carries a category and, when known, the user id — never the email, the
//    oid, the tid, a token or a code.
//  - **Two-factor is never skipped.** Two-factor on means a five-minute ticket and nothing else: no
//    session, no cookie, no LOGIN row.
//  - No session without its LOGIN row: the session, `lastLoginAt` and the row are one transaction.
//    The row says `via: "teams-sso"` or `"teams-popup"`. The route sets the tab's own cookie
//    (`tielora_teams`) after the commit.

import { mintSession } from "@/lib/auth";
import { isAccessExpired } from "@/lib/access-expiry";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { validateTeamsToken } from "@/lib/ms-id-token";
import { teamsAppConfig, type TeamsVia } from "@/lib/teams-app";
import {
  EMAIL_TOKEN_TTL_MS,
  consumeEmailToken,
  issueEmailToken,
} from "@/server/services/email-tokens";
import { SIGNIN_USER_SELECT, signingKeys } from "@/server/services/microsoft-signin";
import { readableTotpSecret } from "@/server/services/two-factor";

export type TabSignInOutcome =
  | {
      kind: "signed-in";
      userId: string;
      /** The raw token for the tab's cookie — set by the route only after this commits. */
      sessionToken: string;
      sessionExpiresAt: Date;
    }
  | { kind: "two-factor"; userId: string; pendingToken: string; expiresAt: Date }
  | {
      kind: "refused";
      reason: string;
      userId?: string;
      /**
       * True when the refusal says someone is guessing or forging (a bad hand-off code, a token that
       * fails its checks). False for ordinary "not linked yet" / "company not switched on" misses,
       * which must never count toward the per-address lockout. Internal: the browser never sees it.
       */
      countsAsFailure: boolean;
    };

type Meta = { ip?: string; userAgent?: string | null };

function refused(reason: string, userId?: string, countsAsFailure = false): TabSignInOutcome {
  logger.warn("Teams sign-in refused", { reason, userId });
  return { kind: "refused", reason, userId, countsAsFailure };
}

type Person = NonNullable<Awaited<ReturnType<typeof loadPerson>>>;

function loadPerson(userId: string) {
  return prisma.user.findUnique({ where: { id: userId }, select: SIGNIN_USER_SELECT });
}

/**
 * The end of both ways in: deactivation and a contractor's end date refuse here exactly as at the
 * password; two-factor is asked if it is on; otherwise one transaction writes the session and LOGIN.
 */
async function finish(person: Person, via: TeamsVia, meta: Meta): Promise<TabSignInOutcome> {
  if (!person.isActive) return refused("inactive", person.id);
  if (isAccessExpired(person)) return refused("access-expired", person.id);

  // A secret that can no longer be read (a rotated SESSION_SECRET) has just been switched off and
  // recorded, and the sign-in carries on — exactly as after a password.
  const needsSecondFactor = person.totpEnabledAt ? (await readableTotpSecret(person)) !== null : false;

  if (needsSecondFactor) {
    const issued = await issueEmailToken(
      person.id,
      "TWOFA_PENDING_MICROSOFT",
      EMAIL_TOKEN_TTL_MS.TWOFA_PENDING_MICROSOFT,
    );
    logger.info("Teams sign-in is waiting for a second factor", { userId: person.id });
    return {
      kind: "two-factor",
      userId: person.id,
      pendingToken: issued.rawToken,
      expiresAt: issued.expiresAt,
    };
  }

  const minted = mintSession();
  await prisma.$transaction(async (tx) => {
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
    // The same row the password route writes, saying which door — Microsoft, by way of Teams.
    await tx.activityLog.create({
      data: {
        actorId: person.id,
        entityType: "User",
        entityId: person.id,
        action: "LOGIN",
        summary: `${person.name} signed in (via Teams)`,
        metadata: { reportedIp: meta.ip ?? null, twoFactor: false, method: "microsoft", via },
      },
    });
  });

  logger.info("Sign-in succeeded", { userId: person.id, method: "microsoft", via });
  return {
    kind: "signed-in",
    userId: person.id,
    sessionToken: minted.rawToken,
    sessionExpiresAt: minted.expiresAt,
  };
}

/** Single sign-on: Teams' token in, a session (or a two-factor ticket, or a refusal) out. */
export async function signInWithTeamsToken(token: string, meta: Meta): Promise<TabSignInOutcome> {
  try {
    const config = teamsAppConfig();
    if (!config) return refused("not-set-up");

    const checked = await validateTeamsToken(token, { audience: config.audience }, signingKeys.keyFor);
    if (!checked.ok) return refused(`token-${checked.reason}`, undefined, true);
    const { tid, oid } = checked.identity;

    // The company is the one that owns this tenant, and nothing else.
    const org = await prisma.organization.findUnique({
      where: { entraTenantId: tid },
      select: { id: true },
    });
    if (!org) return refused("tenant-not-switched-on");

    // Identity is tid + oid. No email fallback, ever: an unpinned person goes through the popup.
    const person = await prisma.user.findUnique({
      where: { microsoftTenantId_microsoftOid: { microsoftTenantId: tid, microsoftOid: oid } },
      select: SIGNIN_USER_SELECT,
    });
    if (!person) return refused("not-linked");
    if (person.orgId !== org.id) return refused("linked-in-another-company", person.id);

    return await finish(person, "teams-sso", meta);
  } catch (error) {
    // Never the error itself — a message about a lookup can carry the value it looked up.
    return refused(`unexpected-${error instanceof Error ? error.name : "unknown"}`);
  }
}

/** The popup's one-time code in, a session (or a two-factor ticket, or a refusal) out. */
export async function signInWithHandoff(code: string, meta: Meta): Promise<TabSignInOutcome> {
  const outcome = await exchangeHandoff(code, meta);
  // Every refusal on this path counts: the code is the proof, and it is not for guessing at.
  return outcome.kind === "refused" ? { ...outcome, countsAsFailure: true } : outcome;
}

async function exchangeHandoff(code: string, meta: Meta): Promise<TabSignInOutcome> {
  try {
    if (!teamsAppConfig()) return refused("not-set-up");

    // Single use, and the WRITE is the proof: one conditional update on (hash + purpose + unused +
    // unexpired). A second exchange of the same code matches nothing.
    const holder = await consumeEmailToken(code, "TEAMS_HANDOFF");
    if (!holder) return refused("code-not-valid");

    const person = await loadPerson(holder.id);
    if (!person) return refused("no-person");

    // The company must STILL own the tenant this person is linked under (a switch-off since the
    // popup closed clears both, and the link is gone with it).
    if (!person.microsoftTenantId || !person.microsoftOid) return refused("not-linked", person.id);
    const org = await prisma.organization.findUnique({
      where: { entraTenantId: person.microsoftTenantId },
      select: { id: true },
    });
    if (!org || org.id !== person.orgId) return refused("tenant-not-switched-on", person.id);

    return await finish(person, "teams-popup", meta);
  } catch (error) {
    return refused(`unexpected-${error instanceof Error ? error.name : "unknown"}`);
  }
}
