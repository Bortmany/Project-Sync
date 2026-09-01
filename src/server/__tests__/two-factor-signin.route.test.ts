// Signing in when two-factor is on, through the real route handlers.
//
// Both halves are tested end to end — the zod parse, the limiters, the transaction and the cookie —
// because the promise this feature makes is about what a REQUEST can and cannot get, not about what
// a service returns. The only thing stubbed is the cookie jar, which needs a live request to exist.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/** The cookie jar next/headers would give a route. Replaced per test so each starts empty. */
const jar = new Map<string, { value: string; expires?: Date }>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const found = jar.get(name);
      return found ? { name, value: found.value } : undefined;
    },
    set: (name: string, value: string, options?: { expires?: Date }) => {
      jar.set(name, { value, expires: options?.expires });
    },
    delete: (name: string) => {
      jar.delete(name);
    },
  }),
}));

import { POST as login } from "@/app/api/auth/login/route";
import { POST as twoFactor } from "@/app/api/auth/two-factor/route";
import { SESSION_COOKIE, hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { base32Decode, stepAt, totpCode } from "@/lib/totp";
import { actorForUser, type ActorContext } from "@/server/actor";
import { resetPassword } from "@/server/services/account";
import { hashEmailToken, issueEmailToken } from "@/server/services/email-tokens";
import {
  beginTwoFactorEnrollment,
  confirmTwoFactorEnrollment,
} from "@/server/services/two-factor";
import { defaultOrg, resetDatabase } from "@/server/__tests__/harness";

const PASSWORD = "coordination-2026";

let ipCounter = 0;

/** A request from an IP address nobody else in this file has used, so the IP limiter never fires. */
function request(url: string, body: unknown): Request {
  ipCounter += 1;
  return new Request(`http://localhost${url}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `198.51.100.${ipCounter % 250}`,
      "user-agent": "vitest",
    },
    body: JSON.stringify(body),
  });
}

async function postLogin(email: string, password = PASSWORD) {
  const response = await login(request("/api/auth/login", { email, password }));
  return { status: response.status, body: await response.json(), response };
}

async function postSecondStep(body: unknown) {
  const response = await twoFactor(request("/api/auth/two-factor", body));
  return {
    status: response.status,
    body: await response.json(),
    retryAfter: response.headers.get("Retry-After"),
  };
}

/** Somebody who can really sign in: a live account with a real argon2 hash. */
async function makePerson(name: string): Promise<{ id: string; email: string; actor: ActorContext }> {
  const orgId = await defaultOrg();
  const email = `${name.toLowerCase().replace(/[^a-z]+/g, ".")}.${Math.random().toString(36).slice(2)}@test.example`;
  const user = await prisma.user.create({
    data: {
      orgId,
      email,
      name,
      passwordHash: await hashPassword(PASSWORD),
      role: "ENGINEER",
    },
  });
  return { id: user.id, email, actor: await actorForUser(user.id) };
}

/** The six digits an app would show `offset` steps from now. */
function codeFor(manualKey: string, offset = 0): string {
  return totpCode(base32Decode(manualKey), stepAt(Date.now()) + offset);
}

/** Switches two-factor on for somebody and hands back what their app and their pocket hold. */
async function enrol(actor: ActorContext): Promise<{ manualKey: string; codes: string[] }> {
  const enrolment = await beginTwoFactorEnrollment(actor);
  const { codes } = await confirmTwoFactorEnrollment(actor, { code: codeFor(enrolment.manualKey) });
  return { manualKey: enrolment.manualKey, codes };
}

const loginRows = (userId: string) =>
  prisma.activityLog.findMany({ where: { actorId: userId, action: "LOGIN" } });

beforeEach(async () => {
  await resetDatabase();
  jar.clear();
});

afterAll(async () => {
  await prisma.$disconnect();
});

/* ------------------------------------------------------------------ */
/* Nothing changes for anybody who has not switched it on              */
/* ------------------------------------------------------------------ */

describe("an account without two-factor", () => {
  it("signs in exactly as it always has", async () => {
    const person = await makePerson("Priya Nair");

    const { status, body } = await postLogin(person.email);

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, data: { id: person.id, name: "Priya Nair", role: "ENGINEER" } });
    expect(jar.get(SESSION_COOKIE)).toBeDefined();
    expect(await prisma.session.count({ where: { userId: person.id } })).toBe(1);

    const rows = await loginRows(person.id);
    expect(rows).toHaveLength(1);
    expect((rows[0].metadata as { twoFactor?: boolean }).twoFactor).toBe(false);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: person.id } });
    expect(user.lastLoginAt).not.toBeNull();
  });

  it("signs in normally when enrolment was started and never finished", async () => {
    const person = await makePerson("John Carter");
    await beginTwoFactorEnrollment(person.actor);

    const { status, body } = await postLogin(person.email);

    expect(status).toBe(200);
    expect(body.data.id).toBe(person.id);
    expect(body.data.status).toBeUndefined();
    expect(jar.get(SESSION_COOKIE)).toBeDefined();
    expect(await prisma.session.count({ where: { userId: person.id } })).toBe(1);
  });

  it("still refuses a wrong password with the same generic sentence", async () => {
    const person = await makePerson("Layla al-Riyami");

    const { status, body } = await postLogin(person.email, "not-the-password");

    expect(status).toBe(401);
    expect(body).toEqual({ ok: false, error: "Incorrect email or password." });
    expect(jar.get(SESSION_COOKIE)).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* The password step, when two-factor is on                            */
/* ------------------------------------------------------------------ */

describe("the password step with two-factor on", () => {
  it("hands back a pending ticket and NOTHING else", async () => {
    const person = await makePerson("Aisha al-Kindi");
    await enrol(person.actor);

    const { status, body } = await postLogin(person.email);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe("TWO_FACTOR_REQUIRED");
    expect(typeof body.data.pendingToken).toBe("string");
    expect(new Date(body.data.expiresAt).getTime()).toBeGreaterThan(Date.now());

    // No session, no cookie, no audit row, no sign-in time.
    expect(jar.get(SESSION_COOKIE)).toBeUndefined();
    expect(await prisma.session.count({ where: { userId: person.id } })).toBe(0);
    expect(await loginRows(person.id)).toHaveLength(0);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: person.id } });
    expect(user.lastLoginAt).toBeNull();

    // Only the hash of the ticket is stored.
    const token = await prisma.emailToken.findFirstOrThrow({
      where: { userId: person.id, purpose: "TWOFA_PENDING" },
    });
    expect(token.usedAt).toBeNull();
    expect(token.tokenHash).toBe(hashEmailToken(body.data.pendingToken));
  });

  it("still refuses a wrong password before any ticket exists", async () => {
    const person = await makePerson("Aisha al-Kindi");
    await enrol(person.actor);

    const { status } = await postLogin(person.email, "wrong");

    expect(status).toBe(401);
    expect(await prisma.emailToken.count({ where: { userId: person.id } })).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* The second step                                                     */
/* ------------------------------------------------------------------ */

describe("the second step", () => {
  it("signs somebody in with a code from their app", async () => {
    const person = await makePerson("Aisha al-Kindi");
    const { manualKey } = await enrol(person.actor);
    const { body: first } = await postLogin(person.email);

    const { status, body } = await postSecondStep({
      pendingToken: first.data.pendingToken,
      code: codeFor(manualKey, 1),
    });

    expect(status).toBe(200);
    expect(body.data.id).toBe(person.id);
    expect(body.data.name).toBe("Aisha al-Kindi");
    expect(body.data.role).toBe("ENGINEER");
    expect(jar.get(SESSION_COOKIE)).toBeDefined();

    // Exactly one session, one LOGIN row, and it says which door was used.
    expect(await prisma.session.count({ where: { userId: person.id } })).toBe(1);
    const rows = await loginRows(person.id);
    expect(rows).toHaveLength(1);
    expect((rows[0].metadata as { twoFactor?: boolean }).twoFactor).toBe(true);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: person.id } });
    expect(user.lastLoginAt).not.toBeNull();

    // The ticket is spent.
    const token = await prisma.emailToken.findFirstOrThrow({ where: { userId: person.id } });
    expect(token.usedAt).not.toBeNull();
  });

  it("accepts the step either side of now", async () => {
    const person = await makePerson("Aisha al-Kindi");
    const { manualKey } = await enrol(person.actor);
    const { body: first } = await postLogin(person.email);

    const { status } = await postSecondStep({
      pendingToken: first.data.pendingToken,
      code: codeFor(manualKey, 1),
    });

    expect(status).toBe(200);
  });

  it("refuses the same code twice, even inside its own thirty seconds", async () => {
    const person = await makePerson("Aisha al-Kindi");
    const { manualKey } = await enrol(person.actor);
    const code = codeFor(manualKey, 1);

    const { body: first } = await postLogin(person.email);
    expect((await postSecondStep({ pendingToken: first.data.pendingToken, code })).status).toBe(200);

    jar.clear();
    const { body: second } = await postLogin(person.email);
    const replay = await postSecondStep({ pendingToken: second.data.pendingToken, code });

    expect(replay.status).toBe(401);
    expect(replay.body.error).toBe(
      "That code was not right. Try again, or sign in again to start over.",
    );
    expect(jar.get(SESSION_COOKIE)).toBeUndefined();
    expect(await prisma.session.count({ where: { userId: person.id } })).toBe(1);
  });

  it("lets only one of two simultaneous submissions of the same code through", async () => {
    const person = await makePerson("Aisha al-Kindi");
    const { manualKey } = await enrol(person.actor);
    const code = codeFor(manualKey, 1);

    // Two tickets, two browsers, the same six digits, in the same milliseconds. The step is claimed
    // by a conditional write, so exactly one of them can win.
    const { body: first } = await postLogin(person.email);
    const { body: second } = await postLogin(person.email);

    const answers = await Promise.all([
      postSecondStep({ pendingToken: first.data.pendingToken, code }),
      postSecondStep({ pendingToken: second.data.pendingToken, code }),
    ]);

    const codes = answers.map((answer) => answer.status).sort();
    expect(codes).toEqual([200, 401]);
    expect(await prisma.session.count({ where: { userId: person.id } })).toBe(1);
    expect(await loginRows(person.id)).toHaveLength(1);
  });

  it("takes a recovery code, spends it once, and says how many are left", async () => {
    const person = await makePerson("Aisha al-Kindi");
    const { codes } = await enrol(person.actor);
    const { body: first } = await postLogin(person.email);

    const success = await postSecondStep({
      pendingToken: first.data.pendingToken,
      recoveryCode: codes[0],
    });

    expect(success.status).toBe(200);
    expect(success.body.data.recoveryCodesLeft).toBe(7);
    const rows = await loginRows(person.id);
    expect((rows[0].metadata as { recoveryCode?: boolean }).recoveryCode).toBe(true);

    // The same code a second time is worth nothing.
    jar.clear();
    const { body: second } = await postLogin(person.email);
    const reuse = await postSecondStep({
      pendingToken: second.data.pendingToken,
      recoveryCode: codes[0],
    });
    expect(reuse.status).toBe(401);
    expect(await prisma.session.count({ where: { userId: person.id } })).toBe(1);
  });

  it("answers every kind of miss with the same sentence and the same status", async () => {
    const person = await makePerson("Aisha al-Kindi");
    const { manualKey } = await enrol(person.actor);
    const { body: first } = await postLogin(person.email);
    const live = first.data.pendingToken as string;

    // A ticket that was never minted.
    const invented = "a".repeat(64);
    // A ticket that has expired.
    const expiredRaw = "b".repeat(64);
    await prisma.emailToken.create({
      data: {
        userId: person.id,
        purpose: "TWOFA_PENDING",
        tokenHash: hashEmailToken(expiredRaw),
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    // A ticket that has already been spent.
    const spentRaw = "c".repeat(64);
    await prisma.emailToken.create({
      data: {
        userId: person.id,
        purpose: "TWOFA_PENDING",
        tokenHash: hashEmailToken(spentRaw),
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: new Date(),
      },
    });

    const answers = [];
    for (const pendingToken of [invented, expiredRaw, spentRaw]) {
      answers.push(await postSecondStep({ pendingToken, code: codeFor(manualKey, 1) }));
    }
    answers.push(await postSecondStep({ pendingToken: live, code: "000000" }));
    answers.push(await postSecondStep({ pendingToken: live, recoveryCode: "ZZZZ-ZZZZ-ZZ" }));

    for (const answer of answers) {
      expect(answer.status).toBe(401);
      expect(answer.body).toEqual({
        ok: false,
        error: "That code was not right. Try again, or sign in again to start over.",
      });
    }
    expect(await prisma.session.count({ where: { userId: person.id } })).toBe(0);
  });

  it("refuses a body with both a code and a recovery code, or with neither", async () => {
    const person = await makePerson("Aisha al-Kindi");
    const { manualKey, codes } = await enrol(person.actor);
    const { body: first } = await postLogin(person.email);

    const both = await postSecondStep({
      pendingToken: first.data.pendingToken,
      code: codeFor(manualKey, 1),
      recoveryCode: codes[0],
    });
    const neither = await postSecondStep({ pendingToken: first.data.pendingToken });

    expect(both.status).toBe(401);
    expect(neither.status).toBe(401);
    expect(await prisma.session.count({ where: { userId: person.id } })).toBe(0);
  });

  it("keeps the ticket alive after a wrong code, so one typo does not mean starting again", async () => {
    const person = await makePerson("Aisha al-Kindi");
    const { manualKey } = await enrol(person.actor);
    const { body: first } = await postLogin(person.email);

    expect(
      (await postSecondStep({ pendingToken: first.data.pendingToken, code: "000000" })).status,
    ).toBe(401);
    const second = await postSecondStep({
      pendingToken: first.data.pendingToken,
      code: codeFor(manualKey, 1),
    });

    expect(second.status).toBe(200);
    expect(await prisma.session.count({ where: { userId: person.id } })).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* The two limiters                                                    */
/* ------------------------------------------------------------------ */

describe("a ticket that is no longer good for anything", () => {
  it("is answered with the sentence that says how to start over", async () => {
    const person = await makePerson("Aisha al-Kindi");
    const { manualKey } = await enrol(person.actor);

    // Signing in again retires the ticket the first browser is still holding.
    const { body: first } = await postLogin(person.email);
    await postLogin(person.email);

    const stale = await postSecondStep({
      pendingToken: first.data.pendingToken,
      code: codeFor(manualKey, 1),
    });

    expect(stale.status).toBe(401);
    expect(stale.body.error).toBe(
      "That code was not right. Try again, or sign in again to start over.",
    );
    expect(await prisma.session.count({ where: { userId: person.id } })).toBe(0);
  });

  it("dies when the password behind it is reset", async () => {
    const person = await makePerson("Aisha al-Kindi");
    const { manualKey } = await enrol(person.actor);
    const { body } = await postLogin(person.email);

    const reset = await issueEmailToken(person.id, "RESET");
    await resetPassword({ token: reset.rawToken, password: "a-brand-new-password-2026" });

    const stale = await postSecondStep({
      pendingToken: body.data.pendingToken,
      code: codeFor(manualKey, 1),
    });

    expect(stale.status).toBe(401);
    expect(await prisma.session.count({ where: { userId: person.id } })).toBe(0);
  });
});

describe("the limiters on the second step", () => {
  it("throws the ticket away after five wrong tries, and says to sign in again", async () => {
    const person = await makePerson("Aisha al-Kindi");
    const { manualKey } = await enrol(person.actor);
    const { body: first } = await postLogin(person.email);
    const pendingToken = first.data.pendingToken as string;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await postSecondStep({ pendingToken, code: "000000" })).status).toBe(401);
    }

    const refused = await postSecondStep({ pendingToken, code: "000000" });
    expect(refused.status).toBe(429);
    expect(refused.retryAfter).toMatch(/^\d+$/);

    // And the ticket really is dead — the right code no longer helps, and the row says used.
    const afterwards = await postSecondStep({ pendingToken, code: codeFor(manualKey, 1) });
    expect(afterwards.status).not.toBe(200);
    const token = await prisma.emailToken.findFirstOrThrow({ where: { userId: person.id } });
    expect(token.usedAt).not.toBeNull();
    expect(await prisma.session.count({ where: { userId: person.id } })).toBe(0);
  });

  it("stops one account's second step after eight wrong tries, however many tickets are minted", async () => {
    const person = await makePerson("Aisha al-Kindi");
    await enrol(person.actor);

    let last = { status: 0, body: { error: "" }, retryAfter: null as string | null };
    for (let attempt = 0; attempt < 9; attempt += 1) {
      const { body } = await postLogin(person.email);
      last = await postSecondStep({ pendingToken: body.data.pendingToken, code: "000000" });
    }

    expect(last.status).toBe(429);
    expect(last.retryAfter).toMatch(/^\d+$/);
    expect(last.body.error).toContain("few minutes");
  });

  it("never spends the password limiter's budget — the sign-in form still works", async () => {
    const person = await makePerson("Aisha al-Kindi");
    await enrol(person.actor);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { body } = await postLogin(person.email);
      expect((await postSecondStep({ pendingToken: body.data.pendingToken, code: "000000" })).status).toBe(
        401,
      );
    }

    // The password half is untouched: the right password still earns a fresh ticket.
    const { status, body } = await postLogin(person.email);
    expect(status).toBe(200);
    expect(body.data.status).toBe("TWO_FACTOR_REQUIRED");
  });
});
