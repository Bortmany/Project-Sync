// Two-factor sign-in, from the inside: enrolling, confirming, the recovery codes, turning it off,
// an administrator's reset, and what happens when the sealed secret can no longer be read.
//
// Nothing here mocks the clock. Codes are asked for by STEP OFFSET from now — the step after this
// one is inside the ±1 window and is always higher than the step just spent — which is both what a
// real phone hands somebody thirty seconds later and immune to the test crossing a step boundary
// while it runs.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { base32Decode, stepAt, totpCode } from "@/lib/totp";
import { actorForUser, type ActorContext } from "@/server/actor";
import { createHash } from "node:crypto";
import {
  RECOVERY_CODE_COUNT,
  TOTP_SECRET_PURPOSE,
  TWO_FACTOR_ACCOUNT_TRIES,
  beginTwoFactorEnrollment,
  confirmTwoFactorEnrollment,
  disableTwoFactor,
  hashRecoveryCode,
  readableTotpSecret,
  regenerateRecoveryCodes,
  twoFactorAccountKey,
  twoFactorStatus,
} from "@/server/services/two-factor";
import { clearFailures } from "@/lib/rate-limit";
import { issueEmailToken } from "@/server/services/email-tokens";
import { resetPassword } from "@/server/services/account";
import { adminResetTwoFactor } from "@/server/services/admin";
import { NotFoundError, ServiceError } from "@/server/errors";
import { makeOrg, makeUser, resetDatabase } from "@/server/__tests__/harness";

/** The six digits an app would show `offset` steps from now. */
function codeFor(manualKey: string, offset = 0): string {
  const secret = base32Decode(manualKey);
  return totpCode(secret, stepAt(Date.now()) + offset);
}

/** Somebody with two-factor switched on, plus the key their app holds. */
async function enrolled(actor: ActorContext): Promise<{ manualKey: string; codes: string[] }> {
  const enrolment = await beginTwoFactorEnrollment(actor);
  const { codes } = await confirmTwoFactorEnrollment(actor, {
    code: codeFor(enrolment.manualKey),
  });
  return { manualKey: enrolment.manualKey, codes };
}

async function auditActions(userId: string): Promise<string[]> {
  const rows = await prisma.activityLog.findMany({
    where: { entityId: userId, entityType: "User" },
    orderBy: { createdAt: "asc" },
    select: { action: true },
  });
  return rows.map((row) => row.action);
}

let actor: ActorContext;

beforeEach(async () => {
  await resetDatabase();
  const person = await makeUser({ name: "Aisha al-Kindi", role: "ENGINEER" });
  actor = await actorForUser(person.id);
});

afterAll(async () => {
  await prisma.$disconnect();
});

/* ------------------------------------------------------------------ */
/* Enrolling                                                           */
/* ------------------------------------------------------------------ */

describe("starting enrolment", () => {
  it("hands back a QR code, a manual key and an otpauth address", async () => {
    const enrolment = await beginTwoFactorEnrollment(actor);

    expect(enrolment.qrDataUri.startsWith("data:image/png;base64,")).toBe(true);
    expect(enrolment.manualKey).toMatch(/^[A-Z2-7]{32}$/);
    expect(enrolment.otpauthUrl).toContain(enrolment.manualKey);
  });

  it("stores the secret sealed, never in plain text, and switches nothing on", async () => {
    const enrolment = await beginTwoFactorEnrollment(actor);

    const row = await prisma.user.findUniqueOrThrow({
      where: { id: actor.userId },
      select: { totpSecretEnc: true, totpEnabledAt: true, totpLastUsedStep: true },
    });

    expect(row.totpSecretEnc).not.toBeNull();
    expect(row.totpSecretEnc).not.toContain(enrolment.manualKey);
    expect(row.totpSecretEnc?.startsWith("v1.")).toBe(true);
    // A half-finished enrolment gates nothing: no date, no step, no codes.
    expect(row.totpEnabledAt).toBeNull();
    expect(row.totpLastUsedStep).toBeNull();
    expect(await prisma.twoFactorRecoveryCode.count({ where: { userId: actor.userId } })).toBe(0);
  });

  it("writes no audit row — nobody has attested to anything yet", async () => {
    await beginTwoFactorEnrollment(actor);
    expect(await auditActions(actor.userId)).toEqual([]);
  });

  it("starting again overwrites the half-finished secret", async () => {
    const first = await beginTwoFactorEnrollment(actor);
    const second = await beginTwoFactorEnrollment(actor);

    expect(second.manualKey).not.toBe(first.manualKey);
    // The old app's code is dead; the new one's works.
    await expect(
      confirmTwoFactorEnrollment(actor, { code: codeFor(first.manualKey) }),
    ).rejects.toBeInstanceOf(ServiceError);
    await confirmTwoFactorEnrollment(actor, { code: codeFor(second.manualKey) });
    expect((await twoFactorStatus(actor)).enabled).toBe(true);
  });

  it("refuses to start again once it is already on", async () => {
    await enrolled(actor);
    await expect(beginTwoFactorEnrollment(actor)).rejects.toThrow(/already on/);
  });
});

describe("confirming enrolment", () => {
  it("a wrong code leaves it switched off, with no codes and no audit row", async () => {
    await beginTwoFactorEnrollment(actor);

    await expect(confirmTwoFactorEnrollment(actor, { code: "000000" })).rejects.toBeInstanceOf(
      ServiceError,
    );

    const status = await twoFactorStatus(actor);
    expect(status.enabled).toBe(false);
    expect(await prisma.twoFactorRecoveryCode.count({ where: { userId: actor.userId } })).toBe(0);
    expect(await auditActions(actor.userId)).toEqual([]);
  });

  it("a working code switches it on, issues eight codes and records it", async () => {
    const { codes } = await enrolled(actor);

    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    for (const code of codes) expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{2}$/);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);

    const status = await twoFactorStatus(actor);
    expect(status.enabled).toBe(true);
    expect(status.enabledAt).not.toBeNull();
    expect(status.recoveryCodesLeft).toBe(RECOVERY_CODE_COUNT);
    expect(await auditActions(actor.userId)).toEqual(["TWO_FACTOR_ENABLED"]);
  });

  it("keeps only the hashes of the codes, never the codes", async () => {
    const { codes } = await enrolled(actor);

    const rows = await prisma.twoFactorRecoveryCode.findMany({
      where: { userId: actor.userId },
      select: { codeHash: true, usedAt: true },
    });

    expect(rows).toHaveLength(RECOVERY_CODE_COUNT);
    for (const row of rows) {
      expect(row.usedAt).toBeNull();
      expect(codes.some((code) => row.codeHash.includes(code.replace(/-/g, "")))).toBe(false);
    }
    // The hash of a code that was handed out really is one of the stored rows...
    const stored = rows.map((row) => row.codeHash);
    expect(stored).toContain(hashRecoveryCode(codes[0].replace(/-/g, "")));

    // ...and it is a KEYED hash, so a stolen database on its own cannot be ground through offline:
    // a plain SHA-256 of the same code matches nothing here.
    const plain = createHash("sha256").update(codes[0].replace(/-/g, "")).digest("hex");
    expect(stored).not.toContain(plain);
  });

  it("records the step the confirming code used, so it can never be used again", async () => {
    const enrolment = await beginTwoFactorEnrollment(actor);
    const code = codeFor(enrolment.manualKey);
    await confirmTwoFactorEnrollment(actor, { code });

    const row = await prisma.user.findUniqueOrThrow({
      where: { id: actor.userId },
      select: { totpLastUsedStep: true },
    });
    expect(row.totpLastUsedStep).not.toBeNull();

    // The same digits offered again for turning it off are refused.
    await expect(disableTwoFactor(actor, { code })).rejects.toBeInstanceOf(ServiceError);
    expect((await twoFactorStatus(actor)).enabled).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Turning it off                                                      */
/* ------------------------------------------------------------------ */

describe("turning it off", () => {
  it("takes a live code from the app", async () => {
    const { manualKey } = await enrolled(actor);

    const status = await disableTwoFactor(actor, { code: codeFor(manualKey, 1) });

    expect(status.enabled).toBe(false);
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: actor.userId },
      select: { totpSecretEnc: true, totpEnabledAt: true, totpLastUsedStep: true },
    });
    expect(row.totpSecretEnc).toBeNull();
    expect(row.totpEnabledAt).toBeNull();
    expect(row.totpLastUsedStep).toBeNull();
    expect(await prisma.twoFactorRecoveryCode.count({ where: { userId: actor.userId } })).toBe(0);
    expect(await auditActions(actor.userId)).toEqual(["TWO_FACTOR_ENABLED", "TWO_FACTOR_DISABLED"]);
  });

  it("takes an unused recovery code", async () => {
    const { codes } = await enrolled(actor);

    const status = await disableTwoFactor(actor, { recoveryCode: codes[3] });

    expect(status.enabled).toBe(false);
    expect(await auditActions(actor.userId)).toEqual(["TWO_FACTOR_ENABLED", "TWO_FACTOR_DISABLED"]);
  });

  it("refuses a wrong code, an already-used recovery code and a made-up one", async () => {
    const { manualKey, codes } = await enrolled(actor);

    await expect(disableTwoFactor(actor, { code: "000000" })).rejects.toBeInstanceOf(ServiceError);
    await expect(
      disableTwoFactor(actor, { recoveryCode: "AAAABBBBCC" }),
    ).rejects.toBeInstanceOf(ServiceError);

    // Spend one on replacing the codes, then try to use it again.
    await regenerateRecoveryCodes(actor, { recoveryCode: codes[0] });
    await expect(disableTwoFactor(actor, { recoveryCode: codes[0] })).rejects.toBeInstanceOf(
      ServiceError,
    );

    expect((await twoFactorStatus(actor)).enabled).toBe(true);
    // And it still comes off with the real thing.
    await disableTwoFactor(actor, { code: codeFor(manualKey, 1) });
    expect((await twoFactorStatus(actor)).enabled).toBe(false);
  });

  it("refuses somebody who never switched it on", async () => {
    await expect(disableTwoFactor(actor, { code: "123456" })).rejects.toThrow(/not on/);
  });
});

/* ------------------------------------------------------------------ */
/* Recovery codes                                                      */
/* ------------------------------------------------------------------ */

describe("replacing the recovery codes", () => {
  it("hands back eight fresh ones and kills every old one", async () => {
    const { manualKey, codes } = await enrolled(actor);

    const replaced = await regenerateRecoveryCodes(actor, { code: codeFor(manualKey, 1) });

    expect(replaced.codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(replaced.codes.some((code) => codes.includes(code))).toBe(false);
    expect((await twoFactorStatus(actor)).recoveryCodesLeft).toBe(RECOVERY_CODE_COUNT);

    // An old code is worth nothing now.
    await expect(disableTwoFactor(actor, { recoveryCode: codes[1] })).rejects.toBeInstanceOf(
      ServiceError,
    );
    // A new one works.
    await disableTwoFactor(actor, { recoveryCode: replaced.codes[1] });
    expect((await twoFactorStatus(actor)).enabled).toBe(false);
  });

  it("counts down as codes are spent, and records the replacement", async () => {
    const { codes } = await enrolled(actor);

    await regenerateRecoveryCodes(actor, { recoveryCode: codes[0] });
    expect(await auditActions(actor.userId)).toEqual([
      "TWO_FACTOR_ENABLED",
      "TWO_FACTOR_CODES_REPLACED",
    ]);
    expect((await twoFactorStatus(actor)).recoveryCodesLeft).toBe(RECOVERY_CODE_COUNT);
  });

  it("refuses without proof of the second factor", async () => {
    await enrolled(actor);
    await expect(
      regenerateRecoveryCodes(actor, { recoveryCode: "ZZZZZZZZZZ" }),
    ).rejects.toBeInstanceOf(ServiceError);
    expect((await twoFactorStatus(actor)).recoveryCodesLeft).toBe(RECOVERY_CODE_COUNT);
  });
});

/* ------------------------------------------------------------------ */
/* The failure budget                                                  */
/* ------------------------------------------------------------------ */

describe("guessing at the second factor from inside the app", () => {
  it("stops after the account's budget of wrong tries, and says to wait", async () => {
    await enrolled(actor);

    for (let attempt = 0; attempt < TWO_FACTOR_ACCOUNT_TRIES; attempt += 1) {
      await expect(disableTwoFactor(actor, { code: "000000" })).rejects.toThrow(
        "That code was not right. Try again.",
      );
    }

    await expect(disableTwoFactor(actor, { code: "000000" })).rejects.toThrow(/Too many attempts/);
    // The same ceiling covers replacing the codes — one budget per account, not one per button.
    await expect(regenerateRecoveryCodes(actor, { code: "000000" })).rejects.toThrow(
      /Too many attempts/,
    );
    expect((await twoFactorStatus(actor)).enabled).toBe(true);
  });

  it("forgives the count as soon as something works", async () => {
    const { manualKey, codes } = await enrolled(actor);

    await expect(disableTwoFactor(actor, { code: "000000" })).rejects.toThrow();
    await expect(disableTwoFactor(actor, { recoveryCode: "ZZZZZZZZZZ" })).rejects.toThrow();

    await regenerateRecoveryCodes(actor, { recoveryCode: codes[0] });

    // Back to a full budget: seven more misses in a row are still not enough to close the door.
    for (let attempt = 0; attempt < TWO_FACTOR_ACCOUNT_TRIES - 1; attempt += 1) {
      await expect(disableTwoFactor(actor, { code: "000000" })).rejects.toThrow(
        "That code was not right. Try again.",
      );
    }

    clearFailures(twoFactorAccountKey(actor.userId));
    await disableTwoFactor(actor, { code: codeFor(manualKey, 1) });
    expect((await twoFactorStatus(actor)).enabled).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Sign-in tickets                                                     */
/* ------------------------------------------------------------------ */

describe("a change to a credential or the second factor retires sign-in tickets", () => {
  const liveTickets = () =>
    prisma.emailToken.count({
      where: { userId: actor.userId, purpose: "TWOFA_PENDING", usedAt: null },
    });

  it("dies when two-factor itself is switched off", async () => {
    const { manualKey } = await enrolled(actor);
    await issueEmailToken(actor.userId, "TWOFA_PENDING");
    expect(await liveTickets()).toBe(1);

    await disableTwoFactor(actor, { code: codeFor(manualKey, 1) });

    expect(await liveTickets()).toBe(0);
  });

  it("dies when the password is reset from a link", async () => {
    await enrolled(actor);
    await issueEmailToken(actor.userId, "TWOFA_PENDING");
    const reset = await issueEmailToken(actor.userId, "RESET");

    await resetPassword({ token: reset.rawToken, password: "a-brand-new-password-2026" });

    expect(await liveTickets()).toBe(0);
  });

  it("dies when an administrator resets the second factor", async () => {
    await enrolled(actor);
    await issueEmailToken(actor.userId, "TWOFA_PENDING");
    const adminUser = await makeUser({ name: "Our Admin", role: "ADMIN", orgId: actor.orgId });

    await adminResetTwoFactor(await actorForUser(adminUser.id), { id: actor.userId });

    expect(await liveTickets()).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* A rotated SESSION_SECRET                                            */
/* ------------------------------------------------------------------ */

describe("when the saved secret can no longer be read", () => {
  it("switches two-factor off, records why, and tells the person", async () => {
    await enrolled(actor);

    const before = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "a-completely-different-secret-of-the-right-length";

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: actor.userId },
      select: {
        id: true,
        orgId: true,
        name: true,
        totpSecretEnc: true,
        totpEnabledAt: true,
        totpLastUsedStep: true,
      },
    });

    try {
      expect(await readableTotpSecret(user)).toBeNull();
    } finally {
      process.env.SESSION_SECRET = before;
    }

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: actor.userId },
      select: { totpSecretEnc: true, totpEnabledAt: true, totpLastUsedStep: true },
    });
    expect(after.totpSecretEnc).toBeNull();
    expect(after.totpEnabledAt).toBeNull();
    expect(after.totpLastUsedStep).toBeNull();
    expect(await prisma.twoFactorRecoveryCode.count({ where: { userId: actor.userId } })).toBe(0);

    const audit = await prisma.activityLog.findFirstOrThrow({
      where: { entityId: actor.userId, action: "TWO_FACTOR_RESET_SYSTEM" },
      select: { metadata: true, summary: true },
    });
    expect(audit.metadata).toEqual({ reason: "secret-unreadable-after-rotation" });

    const notice = await prisma.notification.findFirstOrThrow({
      where: { userId: actor.userId },
      select: { title: true, body: true, linkUrl: true },
    });
    expect(notice.title).toBe("Two-factor sign-in was switched off");
    expect(notice.linkUrl).toBe("/account");
  });

  it("never writes the secret into the audit row or the notice", async () => {
    const { manualKey } = await enrolled(actor);

    const before = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "another-completely-different-secret-value-here";
    try {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: actor.userId },
        select: {
          id: true,
          orgId: true,
          name: true,
          totpSecretEnc: true,
          totpEnabledAt: true,
          totpLastUsedStep: true,
        },
      });
      await readableTotpSecret(user);
    } finally {
      process.env.SESSION_SECRET = before;
    }

    const rows = await prisma.activityLog.findMany({ where: { entityId: actor.userId } });
    const notices = await prisma.notification.findMany({ where: { userId: actor.userId } });
    const everything = JSON.stringify([rows, notices]);
    expect(everything).not.toContain(manualKey);
    expect(everything).not.toContain(TOTP_SECRET_PURPOSE);
  });
});

/* ------------------------------------------------------------------ */
/* The administrator's reset                                           */
/* ------------------------------------------------------------------ */

describe("an administrator's reset", () => {
  it("switches it off, records it, notifies the person and leaves their sessions alone", async () => {
    await enrolled(actor);
    const adminUser = await makeUser({ name: "Tielora Administrator", role: "ADMIN", orgId: actor.orgId });
    const adminActor = await actorForUser(adminUser.id);

    await prisma.session.create({
      data: {
        tokenHash: `session-${actor.userId}`,
        userId: actor.userId,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    await adminResetTwoFactor(adminActor, { id: actor.userId });

    expect((await twoFactorStatus(actor)).enabled).toBe(false);
    expect(await prisma.twoFactorRecoveryCode.count({ where: { userId: actor.userId } })).toBe(0);
    expect(await prisma.session.count({ where: { userId: actor.userId } })).toBe(1);

    const audit = await prisma.activityLog.findFirstOrThrow({
      where: { entityId: actor.userId, action: "TWO_FACTOR_RESET_BY_ADMIN" },
      select: { actorId: true, summary: true },
    });
    expect(audit.actorId).toBe(adminActor.userId);
    expect(audit.summary).toContain("Aisha al-Kindi");

    const notice = await prisma.notification.findFirstOrThrow({
      where: { userId: actor.userId },
      select: { body: true, linkUrl: true },
    });
    expect(notice.body).toContain("Tielora Administrator");
    expect(notice.linkUrl).toBe("/account");
  });

  it("refuses an administrator's own account, and says where to go instead", async () => {
    const adminUser = await makeUser({ name: "Sole Admin", role: "ADMIN", orgId: actor.orgId });
    const adminActor = await actorForUser(adminUser.id);
    await enrolled(adminActor);

    await expect(adminResetTwoFactor(adminActor, { id: adminActor.userId })).rejects.toThrow(
      /your account page/,
    );
    expect((await twoFactorStatus(adminActor)).enabled).toBe(true);
  });

  it("is refused to somebody who does not manage people", async () => {
    await enrolled(actor);
    const engineer = await makeUser({ name: "John Carter", role: "ENGINEER", orgId: actor.orgId });
    const engineerActor = await actorForUser(engineer.id);

    await expect(adminResetTwoFactor(engineerActor, { id: actor.userId })).rejects.toThrow();
    expect((await twoFactorStatus(actor)).enabled).toBe(true);
  });

  it("says plainly when there is nothing to reset", async () => {
    const adminUser = await makeUser({ name: "Tielora Administrator", role: "ADMIN", orgId: actor.orgId });
    const adminActor = await actorForUser(adminUser.id);

    await expect(adminResetTwoFactor(adminActor, { id: actor.userId })).rejects.toThrow(/not on/);
  });

  it("cannot reach another company's person — that person is not found", async () => {
    await enrolled(actor);
    const otherOrg = await makeOrg("Northern Works");
    const otherAdmin = await makeUser({
      name: "Other Administrator",
      role: "ADMIN",
      orgId: otherOrg.id,
    });
    const otherAdminActor = await actorForUser(otherAdmin.id);

    await expect(adminResetTwoFactor(otherAdminActor, { id: actor.userId })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await twoFactorStatus(actor)).enabled).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* A contractor gets exactly the same thing                            */
/* ------------------------------------------------------------------ */

describe("a contractor", () => {
  it("enrols, confirms, replaces codes and turns it off like everybody else", async () => {
    const contractor = await makeUser({ name: "Sara Vidal", role: "EXTERNAL", orgId: actor.orgId });
    const contractorActor = await actorForUser(contractor.id);

    const { manualKey, codes } = await enrolled(contractorActor);
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect((await twoFactorStatus(contractorActor)).enabled).toBe(true);

    const replaced = await regenerateRecoveryCodes(contractorActor, { recoveryCode: codes[0] });
    expect(replaced.codes).toHaveLength(RECOVERY_CODE_COUNT);

    await disableTwoFactor(contractorActor, { code: codeFor(manualKey, 1) });
    expect((await twoFactorStatus(contractorActor)).enabled).toBe(false);
  });

  it("can be reset by an administrator of their own company, and by nobody else's", async () => {
    const contractor = await makeUser({ name: "Sara Vidal", role: "EXTERNAL", orgId: actor.orgId });
    const contractorActor = await actorForUser(contractor.id);
    await enrolled(contractorActor);

    const otherOrg = await makeOrg("Northern Works");
    const otherAdmin = await makeUser({ name: "Other Admin", role: "ADMIN", orgId: otherOrg.id });
    await expect(
      adminResetTwoFactor(await actorForUser(otherAdmin.id), { id: contractor.id }),
    ).rejects.toBeInstanceOf(NotFoundError);

    const ourAdmin = await makeUser({ name: "Our Admin", role: "ADMIN", orgId: actor.orgId });
    await adminResetTwoFactor(await actorForUser(ourAdmin.id), { id: contractor.id });
    expect((await twoFactorStatus(contractorActor)).enabled).toBe(false);
  });
});
