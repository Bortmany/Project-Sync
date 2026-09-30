// "Sign in with Microsoft", through the real route handlers, against a fake Microsoft behind
// global.fetch whose ID tokens are REALLY signed with an RSA key generated here — so every check the
// validator makes is made for real. The only other stand-in is the cookie jar next/headers would
// give a live request.
//
// What is proved here (the tenant half lives in org-isolation.service.test.ts, the contractor half
// in external-scoping.service.test.ts, the two-factor half in two-factor-signin.route.test.ts):
//  - the first link needs `email` AND `xms_edov === true`; after it, the oid alone signs somebody in;
//  - a different oid on a linked account is refused; two simultaneous first sign-ins link once;
//  - every refusal is the same redirect, and the sentence is the password route's own constant;
//  - with the Azure app unregistered, every route answers "not set up" and redirects nowhere;
//  - switching on needs the administrator's own verified Microsoft email; a workspace holding
//    another tenant must switch off first; a tenant another company holds is "taken";
//  - switching off clears this company's links, signs nobody out, and says how many in the audit;
//  - a failed Microsoft sign-in never touches `login-account:<email>`;
//  - the MICROSOFT_IDENTITY_LINKED row carries no identifier at all.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.SWEEP_DISABLED = "1";

const jar = vi.hoisted(() => new Map<string, { value: string; options?: Record<string, unknown> }>());
vi.mock("next/headers", async () => {
  const fixtures = await import("@/server/__tests__/microsoft-signin-fixtures");
  return fixtures.cookieJarModule(jar);
});
// Server actions call revalidatePath, which needs a live Next.js request.
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { POST as passwordLogin } from "@/app/api/auth/login/route";
import { GET as startRoute } from "@/app/api/auth/microsoft/route";
import { GET as callbackRoute } from "@/app/api/auth/microsoft/callback/route";
import { GET as enableRoute } from "@/app/api/auth/microsoft/enable/route";
import { disableMicrosoftSignIn as disableAction } from "@/server/actions/microsoft-signin";
import { homePathFor } from "@/components/shell/nav-items";
import { SESSION_COOKIE, getSessionUser, hashPassword, mintSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { MICROSOFT_NOT_CONFIGURED } from "@/lib/ms-graph";
import { checkOnly } from "@/lib/rate-limit";
import { SIGN_IN_REFUSED_MESSAGE } from "@/lib/sign-in-messages";
import type { RoleName } from "@/lib/zod-schemas";
import { actorForUser } from "@/server/actor";
import {
  ATTEMPT_COOKIE,
  completeMicrosoftSignIn,
  disableMicrosoftSignIn,
  microsoftSignInAvailable,
  microsoftSignInStatus,
  signingKeys,
  type SignInAttempt,
} from "@/server/services/microsoft-signin";
import { makeOrg, resetDatabase } from "@/server/__tests__/harness";
import {
  TEST_BASE_URL,
  claimsFor,
  configureMicrosoftEnv,
  installFakeMicrosoft,
  makeKey,
  newOid,
  newTenant,
  signToken,
  unsetMicrosoftEnv,
  type FakeMicrosoft,
} from "@/server/__tests__/microsoft-signin-fixtures";

const KEY = makeKey("kid-route");
const FAILED_LOCATION = `${TEST_BASE_URL}/login?microsoft=failed`;
const PASSWORD = "coordination-2026";

let fake: FakeMicrosoft;
let restoreEnv: () => void;
let ipCounter = 0;

function nextIp(): string {
  ipCounter += 1;
  return `203.0.113.${ipCounter % 250}`;
}

function get(url: string, ip = nextIp()): Request {
  return new Request(`http://localhost${url}`, {
    headers: { "x-forwarded-for": ip, "user-agent": "vitest" },
  });
}

type Company = { id: string; tid: string };

async function company(name: string, switchedOn = true): Promise<Company> {
  const org = await makeOrg(name);
  const tid = newTenant();
  if (switchedOn) {
    await prisma.organization.update({ where: { id: org.id }, data: { entraTenantId: tid } });
  }
  return { id: org.id, tid };
}

async function person(
  orgId: string,
  options: { name?: string; email?: string; role?: RoleName } = {},
): Promise<{ id: string; email: string }> {
  const email =
    options.email ?? `p.${Math.random().toString(36).slice(2)}@contoso.example`.toLowerCase();
  const user = await prisma.user.create({
    data: {
      orgId,
      email,
      name: options.name ?? "Salim al-Harthy",
      passwordHash: await hashPassword(PASSWORD),
      role: options.role ?? "ENGINEER",
    },
  });
  return { id: user.id, email };
}

/** Puts a real session for this person into the jar, as a signed-in browser would hold. */
async function signInAs(userId: string): Promise<string> {
  const minted = mintSession();
  await prisma.session.create({
    data: { tokenHash: minted.tokenHash, userId, expiresAt: minted.expiresAt },
  });
  jar.set(SESSION_COOKIE, { value: minted.rawToken });
  return minted.rawToken;
}

type Claims = { tid: string; oid: string; email?: string | null; edov?: unknown };

/**
 * One whole round trip: press the button (or Switch on), "sign in at Microsoft" as `claims`, come
 * back. Returns the callback's answer.
 */
async function roundTrip(
  claims: Claims,
  options: { start?: "signin" | "enable"; error?: string; ip?: string; mutate?: (c: Record<string, unknown>) => void } = {},
): Promise<Response> {
  const ip = options.ip ?? nextIp();
  const started =
    options.start === "enable" ? await enableRoute(get("/api/auth/microsoft/enable", ip)) : await startRoute(get("/api/auth/microsoft", ip));
  expect(started.status).toBe(302);
  const authorize = new URL(started.headers.get("location") ?? "");
  const state = authorize.searchParams.get("state") ?? "";
  const nonce = authorize.searchParams.get("nonce") ?? "";

  const tokenClaims = claimsFor({ ...claims, nonce });
  options.mutate?.(tokenClaims);
  fake.idTokenFor = () => signToken(tokenClaims, KEY);

  const query = options.error
    ? `error=${options.error}&state=${encodeURIComponent(state)}`
    : `code=the-code&state=${encodeURIComponent(state)}`;
  return callbackRoute(get(`/api/auth/microsoft/callback?${query}`, ip));
}

const linkRows = (userId: string) =>
  prisma.activityLog.findMany({ where: { actorId: userId, action: "MICROSOFT_IDENTITY_LINKED" } });
const loginRows = (userId: string) =>
  prisma.activityLog.findMany({ where: { actorId: userId, action: "LOGIN" } });

beforeEach(async () => {
  await resetDatabase();
  jar.clear();
  restoreEnv = configureMicrosoftEnv();
  signingKeys.clear();
  fake = installFakeMicrosoft([KEY.jwk]);
});

afterEach(() => {
  restoreEnv();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.$disconnect();
});

/* ------------------------------------------------------------------ */
/* Starting                                                            */
/* ------------------------------------------------------------------ */

describe("the start route", () => {
  it("sends the browser to Microsoft's work-account sign-in with PKCE, state and nonce, and the narrow scopes", async () => {
    const response = await startRoute(get("/api/auth/microsoft"));
    expect(response.status).toBe(302);

    const url = new URL(response.headers.get("location") ?? "");
    expect(url.origin).toBe("https://login.microsoftonline.com");
    expect(url.pathname).toBe("/organizations/oauth2/v2.0/authorize");
    expect(url.searchParams.get("scope")).toBe("openid profile email");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("nonce")).toBeTruthy();
    expect(url.searchParams.get("redirect_uri")).toBe(`${TEST_BASE_URL}/api/auth/microsoft/callback`);

    const cookie = jar.get(ATTEMPT_COOKIE);
    expect(cookie?.options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/api/auth/microsoft",
      maxAge: 600,
    });
    // The verifier never leaves in the clear: the sealed cookie does not contain the state as text.
    expect(cookie?.value).not.toContain(url.searchParams.get("state") ?? "---");
  });

  it("sends the PKCE verifier and never asks Microsoft for offline access", async () => {
    const org = await company("Pkce Co");
    const who = await person(org.id);
    await roundTrip({ tid: org.tid, oid: newOid(), email: who.email, edov: true });
    expect(fake.lastTokenBody?.get("code_verifier")).toBeTruthy();
    expect(fake.lastTokenBody?.get("scope")).toBe("openid profile email");
    expect(fake.otherCalls).toEqual([]);
  });

  it("is rate limited by address, twenty a minute, with a plain sentence and Retry-After", async () => {
    let last: Response | null = null;
    for (let i = 0; i < 21; i += 1) last = await startRoute(get("/api/auth/microsoft", "192.0.2.77"));
    expect(last?.status).toBe(429);
    expect(last?.headers.get("Retry-After")).toBeTruthy();
    expect((await last?.json()).error).toMatch(/Please wait/);
  });
});

/* ------------------------------------------------------------------ */
/* Dormant                                                             */
/* ------------------------------------------------------------------ */

describe("with the Azure app unregistered", () => {
  it("every route answers 'not set up' and redirects nowhere", async () => {
    unsetMicrosoftEnv();
    expect(microsoftSignInAvailable()).toBe(false);

    for (const route of [
      () => startRoute(get("/api/auth/microsoft")),
      () => callbackRoute(get("/api/auth/microsoft/callback?code=x&state=y")),
      () => enableRoute(get("/api/auth/microsoft/enable")),
    ]) {
      const response = await route();
      expect(response.status).toBe(404);
      expect(response.headers.get("location")).toBeNull();
      expect(await response.json()).toEqual({ ok: false, error: MICROSOFT_NOT_CONFIGURED });
    }
    expect(jar.has(ATTEMPT_COOKIE)).toBe(false);
    expect(fake.jwksCalls + fake.tokenCalls).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Signing in                                                          */
/* ------------------------------------------------------------------ */

describe("signing in", () => {
  it("links on the first sign-in with a Microsoft-verified email and lands on the home page", async () => {
    const org = await company("Contoso");
    const who = await person(org.id);
    const oid = newOid();

    const response = await roundTrip({ tid: org.tid, oid, email: who.email.toUpperCase(), edov: true });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`${TEST_BASE_URL}${homePathFor("ENGINEER")}`);
    expect(jar.get(SESSION_COOKIE)).toBeDefined();
    expect(jar.has(ATTEMPT_COOKIE)).toBe(false);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: who.id } });
    expect(user.microsoftOid).toBe(oid);
    expect(user.microsoftTenantId).toBe(org.tid);
    expect(user.lastLoginAt).not.toBeNull();

    const logins = await loginRows(who.id);
    expect(logins).toHaveLength(1);
    expect(logins[0].metadata).toMatchObject({ twoFactor: false, method: "microsoft" });
    expect(await linkRows(who.id)).toHaveLength(1);
  });

  it("puts nothing sensitive in the MICROSOFT_IDENTITY_LINKED row", async () => {
    const org = await company("Contoso");
    const who = await person(org.id);
    const oid = newOid();
    await roundTrip({ tid: org.tid, oid, email: who.email, edov: true });

    const [row] = await linkRows(who.id);
    expect(row.metadata ?? {}).toEqual({});
    const everything = JSON.stringify(row);
    expect(everything).not.toContain(oid);
    expect(everything).not.toContain(org.tid);
    expect(everything).not.toContain(who.email);
  });

  it("refuses a first sign-in without the email claim, or without xms_edov === true", async () => {
    const org = await company("Contoso");
    const who = await person(org.id);

    for (const claims of [
      { email: null, edov: true },
      { email: who.email, edov: undefined },
      { email: who.email, edov: false },
      { email: who.email, edov: "true" },
    ]) {
      const response = await roundTrip({ tid: org.tid, oid: newOid(), ...claims });
      expect(response.headers.get("location")).toBe(FAILED_LOCATION);
    }
    const user = await prisma.user.findUniqueOrThrow({ where: { id: who.id } });
    expect(user.microsoftOid).toBeNull();
    expect(jar.get(SESSION_COOKIE)).toBeUndefined();
  });

  it("signs a linked person in by oid alone, with no email claim at all", async () => {
    const org = await company("Contoso");
    const who = await person(org.id);
    const oid = newOid();
    await prisma.user.update({
      where: { id: who.id },
      data: { microsoftOid: oid, microsoftTenantId: org.tid },
    });

    const response = await roundTrip({ tid: org.tid, oid, email: null });
    expect(response.headers.get("location")).toBe(`${TEST_BASE_URL}${homePathFor("ENGINEER")}`);
    expect(jar.get(SESSION_COOKIE)).toBeDefined();
    expect(await linkRows(who.id)).toHaveLength(0);
  });

  it("refuses a different oid on an account already linked, even with the right verified email", async () => {
    const org = await company("Contoso");
    const who = await person(org.id);
    const oid = newOid();
    await prisma.user.update({
      where: { id: who.id },
      data: { microsoftOid: oid, microsoftTenantId: org.tid },
    });

    const response = await roundTrip({ tid: org.tid, oid: newOid(), email: who.email, edov: true });
    expect(response.headers.get("location")).toBe(FAILED_LOCATION);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: who.id } });
    expect(user.microsoftOid).toBe(oid);
  });

  it("refuses a deactivated person and an unknown email with the same redirect", async () => {
    const org = await company("Contoso");
    const who = await person(org.id);
    await prisma.user.update({ where: { id: who.id }, data: { isActive: false } });

    for (const email of [who.email, "nobody@contoso.example"]) {
      const response = await roundTrip({ tid: org.tid, oid: newOid(), email, edov: true });
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(FAILED_LOCATION);
    }
  });

  it("lets exactly one of two simultaneous first sign-ins link the account", async () => {
    const org = await company("Contoso");
    const who = await person(org.id);

    // Two Microsoft accounts claiming the same verified address, racing each other.
    const attempts: SignInAttempt[] = ["a", "b"].map((tag) => ({
      purpose: "signin",
      state: `state-${tag}`,
      nonce: `nonce-${tag}`,
      verifier: `verifier-${tag}`,
      ts: Date.now(),
    }));
    const oids = { "code-a": newOid(), "code-b": newOid() } as Record<string, string>;
    fake.idTokenFor = (code) =>
      signToken(
        claimsFor({ tid: org.tid, oid: oids[code], nonce: code === "code-a" ? "nonce-a" : "nonce-b", email: who.email, edov: true }),
        KEY,
      );

    const outcomes = await Promise.all([
      completeMicrosoftSignIn(attempts[0], { code: "code-a", state: "state-a", error: null }, {}),
      completeMicrosoftSignIn(attempts[1], { code: "code-b", state: "state-b", error: null }, {}),
    ]);

    expect(outcomes.filter((o) => o.kind === "signed-in")).toHaveLength(1);
    expect(outcomes.filter((o) => o.kind === "refused")).toHaveLength(1);
    expect(await linkRows(who.id)).toHaveLength(1);
    expect(await loginRows(who.id)).toHaveLength(1);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: who.id } });
    expect(Object.values(oids)).toContain(user.microsoftOid);
  });

  it("refuses a cancelled screen, a missing or tampered attempt, a wrong state and a Microsoft error — all identically", async () => {
    const org = await company("Contoso");
    const who = await person(org.id);
    const claims = { tid: org.tid, oid: newOid(), email: who.email, edov: true };

    const locations: (string | null)[] = [];
    const statuses: number[] = [];
    const record = (response: Response) => {
      locations.push(response.headers.get("location"));
      statuses.push(response.status);
    };

    record(await roundTrip(claims, { error: "access_denied" }));

    // No attempt cookie at all.
    jar.clear();
    record(await callbackRoute(get("/api/auth/microsoft/callback?code=x&state=y")));

    // A tampered attempt cookie.
    await startRoute(get("/api/auth/microsoft"));
    const cookie = jar.get(ATTEMPT_COOKIE);
    jar.set(ATTEMPT_COOKIE, { value: `${cookie?.value.slice(0, -4)}AAAA` });
    record(await callbackRoute(get("/api/auth/microsoft/callback?code=x&state=y")));

    // The right cookie, the wrong state.
    await startRoute(get("/api/auth/microsoft"));
    record(await callbackRoute(get("/api/auth/microsoft/callback?code=x&state=not-mine")));

    // Microsoft refuses the code.
    fake.tokenStatus = 400;
    record(await roundTrip(claims));
    fake.tokenStatus = 200;

    // A token signed by somebody else's key.
    const forger = makeKey("kid-route");
    const started = await startRoute(get("/api/auth/microsoft"));
    const nonce = new URL(started.headers.get("location") ?? "").searchParams.get("nonce") ?? "";
    const state = new URL(started.headers.get("location") ?? "").searchParams.get("state") ?? "";
    fake.idTokenFor = () => signToken(claimsFor({ ...claims, nonce }), forger);
    record(await callbackRoute(get(`/api/auth/microsoft/callback?code=c&state=${encodeURIComponent(state)}`)));

    // An expired attempt (eleven minutes old).
    const realNow = Date.now;
    await startRoute(get("/api/auth/microsoft"));
    vi.spyOn(Date, "now").mockReturnValue(realNow() + 11 * 60_000);
    record(await callbackRoute(get("/api/auth/microsoft/callback?code=x&state=y")));
    vi.mocked(Date.now).mockRestore();

    expect(new Set(locations)).toEqual(new Set([FAILED_LOCATION]));
    expect(new Set(statuses)).toEqual(new Set([302]));
    expect(jar.get(SESSION_COOKIE)).toBeUndefined();
    expect(await loginRows(who.id)).toHaveLength(0);
  });

  it("uses the password route's own sentence, byte for byte, from one exported constant", async () => {
    const org = await company("Contoso");
    const who = await person(org.id);
    const response = await passwordLogin(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": nextIp() },
        body: JSON.stringify({ email: who.email, password: "wrong-password-here" }),
      }),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: SIGN_IN_REFUSED_MESSAGE });
    expect(SIGN_IN_REFUSED_MESSAGE).toBe("Incorrect email or password.");

    const refusedByMicrosoft = await roundTrip({ tid: newTenant(), oid: newOid(), email: who.email, edov: true });
    expect(refusedByMicrosoft.status).toBe(302);
    expect(refusedByMicrosoft.headers.get("location")).toBe(FAILED_LOCATION);
  });

  it("never counts a failed Microsoft sign-in against the password limiter for that address", async () => {
    const org = await company("Contoso");
    const who = await person(org.id);
    await prisma.user.update({ where: { id: who.id }, data: { isActive: false } });

    for (let i = 0; i < 6; i += 1) {
      await roundTrip({ tid: org.tid, oid: newOid(), email: who.email, edov: true });
    }
    expect(checkOnly(`login-account:${who.email}`, 1).ok).toBe(true);
  });

  it("pauses an address after ten failures in fifteen minutes", async () => {
    const ip = "192.0.2.91";
    for (let i = 0; i < 10; i += 1) {
      const response = await callbackRoute(get("/api/auth/microsoft/callback?code=x&state=y", ip));
      expect(response.status).toBe(302);
    }
    // The failures-only counter for this address is spent (the per-minute ceiling is ten as well).
    expect(checkOnly(`ip:microsoft-signin-failures:${ip}`, 10).ok).toBe(false);
    const paused = await callbackRoute(get("/api/auth/microsoft/callback?code=x&state=y", ip));
    expect(paused.status).toBe(429);
    expect(paused.headers.get("Retry-After")).toBeTruthy();
    expect((await paused.json()).error).toMatch(/Please wait/);
  });
});

/* ------------------------------------------------------------------ */
/* Switching it on                                                     */
/* ------------------------------------------------------------------ */

describe("switching Microsoft sign-in on", () => {
  async function adminOf(orgId: string, email?: string) {
    const admin = await person(orgId, { role: "ADMIN", name: "Maryam al-Balushi", email });
    await signInAs(admin.id);
    return admin;
  }

  const outcomeOf = (response: Response) =>
    new URL(response.headers.get("location") ?? "").searchParams.get("microsoftSignIn");

  it("captures the tenant from the administrator's own sign-in, links them, and audits company facts only", async () => {
    const org = await company("Fresh Co", false);
    const admin = await adminOf(org.id, "maryam@fresh.example");
    const tid = newTenant();
    const oid = newOid();

    const response = await roundTrip({ tid, oid, email: "Maryam@Fresh.example", edov: true }, { start: "enable" });

    expect(response.headers.get("location")).toBe(`${TEST_BASE_URL}/admin/integrations?microsoftSignIn=enabled`);
    const row = await prisma.organization.findUniqueOrThrow({ where: { id: org.id } });
    expect(row.entraTenantId).toBe(tid);
    const me = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(me.microsoftOid).toBe(oid);

    const audit = await prisma.activityLog.findFirstOrThrow({ where: { action: "MICROSOFT_SIGNIN_ENABLED" } });
    expect(audit.actorId).toBe(admin.id);
    expect(audit.metadata).toEqual({ tenantId: tid, domain: "fresh.example" });
    expect(audit.summary).toContain("fresh.example");
    expect(JSON.stringify(audit)).not.toContain(oid);

    const status = await microsoftSignInStatus(await actorForUser(admin.id));
    expect(status).toEqual({
      enabled: true,
      domain: "fresh.example",
      enabledByName: "Maryam al-Balushi",
      enabledAt: audit.createdAt.toISOString(),
      linkedPeople: 1,
      callbackReady: true,
    });
  });

  it("answers mismatch when the Microsoft email is not the administrator's Tielora email, and changes nothing", async () => {
    const org = await company("Fresh Co", false);
    await adminOf(org.id, "maryam@fresh.example");

    for (const claims of [
      { email: "someone.else@fresh.example", edov: true },
      { email: "maryam@fresh.example", edov: false },
      { email: null, edov: true },
    ]) {
      const response = await roundTrip({ tid: newTenant(), oid: newOid(), ...claims }, { start: "enable" });
      expect(outcomeOf(response)).toBe("mismatch");
    }
    const row = await prisma.organization.findUniqueOrThrow({ where: { id: org.id } });
    expect(row.entraTenantId).toBeNull();
  });

  it("answers switchOffFirst when this workspace already holds a different tenant", async () => {
    const org = await company("Held Co");
    await adminOf(org.id, "maryam@held.example");

    const response = await roundTrip(
      { tid: newTenant(), oid: newOid(), email: "maryam@held.example", edov: true },
      { start: "enable" },
    );
    expect(outcomeOf(response)).toBe("switchOffFirst");
    const row = await prisma.organization.findUniqueOrThrow({ where: { id: org.id } });
    expect(row.entraTenantId).toBe(org.tid);
  });

  it("answers taken when another company holds the tenant, and leaves that company alone", async () => {
    const other = await company("Other Co");
    const mine = await company("Mine Co", false);
    await adminOf(mine.id, "maryam@mine.example");

    const response = await roundTrip(
      { tid: other.tid, oid: newOid(), email: "maryam@mine.example", edov: true },
      { start: "enable" },
    );
    expect(outcomeOf(response)).toBe("taken");
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: other.id } })).entraTenantId).toBe(other.tid);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: mine.id } })).entraTenantId).toBeNull();
  });

  it("answers denied when the administrator cancels at Microsoft", async () => {
    const org = await company("Fresh Co", false);
    await adminOf(org.id, "maryam@fresh.example");
    const response = await roundTrip({ tid: newTenant(), oid: newOid() }, { start: "enable", error: "access_denied" });
    expect(outcomeOf(response)).toBe("denied");
  });

  it("answers failed when a different person's session comes back", async () => {
    const org = await company("Fresh Co", false);
    await adminOf(org.id, "maryam@fresh.example");
    const started = await enableRoute(get("/api/auth/microsoft/enable"));
    const authorize = new URL(started.headers.get("location") ?? "");

    const colleague = await person(org.id, { role: "ADMIN", email: "khalid@fresh.example" });
    await signInAs(colleague.id);
    fake.idTokenFor = () =>
      signToken(
        claimsFor({ tid: newTenant(), oid: newOid(), nonce: authorize.searchParams.get("nonce") ?? "", email: "khalid@fresh.example", edov: true }),
        KEY,
      );
    const response = await callbackRoute(
      get(`/api/auth/microsoft/callback?code=c&state=${encodeURIComponent(authorize.searchParams.get("state") ?? "")}`),
    );
    expect(outcomeOf(response)).toBe("failed");
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).entraTenantId).toBeNull();
  });

  it("refuses somebody who may not manage integrations before anything leaves for Microsoft", async () => {
    const org = await company("Fresh Co", false);
    const engineer = await person(org.id, { role: "ENGINEER" });
    await signInAs(engineer.id);
    const response = await enableRoute(get("/api/auth/microsoft/enable"));
    expect(response.status).toBe(403);
    expect(jar.has(ATTEMPT_COOKIE)).toBe(false);
  });

  it("is rate limited per administrator, five a minute", async () => {
    const org = await company("Fresh Co", false);
    await adminOf(org.id);
    let last: Response | null = null;
    for (let i = 0; i < 6; i += 1) last = await enableRoute(get("/api/auth/microsoft/enable"));
    expect(last?.status).toBe(429);
    expect(last?.headers.get("Retry-After")).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/* Switching it off                                                    */
/* ------------------------------------------------------------------ */

describe("switching Microsoft sign-in off", () => {
  it("clears the tenant and every link in this company, signs nobody out, and audits the count", async () => {
    const org = await company("Contoso");
    const admin = await person(org.id, { role: "ADMIN" });
    const a = await person(org.id);
    const b = await person(org.id);
    await prisma.user.update({ where: { id: a.id }, data: { microsoftOid: newOid(), microsoftTenantId: org.tid } });
    await prisma.user.update({ where: { id: b.id }, data: { microsoftOid: newOid(), microsoftTenantId: org.tid } });
    const token = await signInAs(a.id);

    await signInAs(admin.id);
    const result = await disableAction();
    expect(result).toEqual({ ok: true, data: { removed: true } });

    expect((await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).entraTenantId).toBeNull();
    expect(await prisma.user.count({ where: { orgId: org.id, microsoftOid: { not: null } } })).toBe(0);

    // Person a's browser is still signed in.
    jar.set(SESSION_COOKIE, { value: token });
    expect((await getSessionUser())?.id).toBe(a.id);

    const audit = await prisma.activityLog.findFirstOrThrow({ where: { action: "MICROSOFT_SIGNIN_DISABLED" } });
    expect(audit.actorId).toBe(admin.id);
    expect(audit.metadata).toEqual({ peopleUnlinked: 2 });
  });

  it("then refuses a Microsoft sign-in from that tenant with the same redirect", async () => {
    const org = await company("Contoso");
    const admin = await person(org.id, { role: "ADMIN" });
    const who = await person(org.id);
    const oid = newOid();
    await prisma.user.update({ where: { id: who.id }, data: { microsoftOid: oid, microsoftTenantId: org.tid } });

    await disableMicrosoftSignIn(await actorForUser(admin.id));
    const response = await roundTrip({ tid: org.tid, oid, email: who.email, edov: true });
    expect(response.headers.get("location")).toBe(FAILED_LOCATION);
  });

  it("says so plainly when it is already off, and refuses a non-administrator", async () => {
    const org = await company("Off Co", false);
    const admin = await person(org.id, { role: "ADMIN" });
    await expect(disableMicrosoftSignIn(await actorForUser(admin.id))).rejects.toThrow(/already switched off/);

    const on = await company("On Co");
    const engineer = await person(on.id);
    await signInAs(engineer.id);
    const refused = await disableAction();
    expect(refused.ok).toBe(false);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: on.id } })).entraTenantId).toBe(on.tid);
  });

  it("is rate limited, ten a minute", async () => {
    const org = await company("Busy Co", false);
    const admin = await person(org.id, { role: "ADMIN" });
    await signInAs(admin.id);
    let last = await disableAction();
    for (let i = 0; i < 10; i += 1) last = await disableAction();
    expect(last.ok).toBe(false);
    if (!last.ok) expect(last.error).toMatch(/Please wait/);
  });
});
