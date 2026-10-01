// The Teams tab, through the real route handlers and the real page: signing in by Teams' token or by
// the Microsoft popup's one-time code, the second step, the cookie's box, the download, and
// dormancy. A fake Microsoft behind `global.fetch` publishes a key generated here and every token is
// REALLY signed with it. The only other stand-in is the cookie jar next/headers would give a live
// request (a route's own Set-Cookie header is read straight off its response).
//
// The tenant half of this lives in org-isolation.service.test.ts and the contractor half in
// external-scoping.service.test.ts.

import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.SWEEP_DISABLED = "1";
process.env.DATA_DIR = path.join(os.tmpdir(), "tielora-test-data");

const jar = vi.hoisted(() => new Map<string, { value: string; options?: Record<string, unknown> }>());
vi.mock("next/headers", async () => {
  const fixtures = await import("@/server/__tests__/microsoft-signin-fixtures");
  return fixtures.cookieJarModule(jar);
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { POST as passwordLogin } from "@/app/api/auth/login/route";
import { GET as microsoftStart } from "@/app/api/auth/microsoft/route";
import { GET as microsoftCallback } from "@/app/api/auth/microsoft/callback/route";
import { POST as browserTwoFactor } from "@/app/api/auth/two-factor/route";
import { GET as myBrief } from "@/app/api/my-tasks/brief/route";
import { GET as manifestRoute } from "@/app/api/teams/manifest/route";
import { POST as sessionRoute } from "@/app/api/teams/session/route";
import { POST as teamsTwoFactor } from "@/app/api/teams/two-factor/route";
import { POST as uploads } from "@/app/api/uploads/route";
import TeamsTabPage from "@/app/teams/tab/page";
import { TeamsBrief } from "@/components/teams/teams-brief";
import { TeamsSignIn } from "@/components/teams/teams-sign-in";
import {
  SESSION_COOKIE,
  getSessionUser,
  getTeamsTabUser,
  hashPassword,
  mintSession,
  revokeSessions,
} from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkOnly } from "@/lib/rate-limit";
import { TEAMS_COOKIE, TEAMS_SIGN_IN_FAILED_MESSAGE } from "@/lib/teams-app";
import { base32Decode, stepAt, totpCode } from "@/lib/totp";
import { actorForUser } from "@/server/actor";
import { ATTEMPT_COOKIE, signingKeys } from "@/server/services/microsoft-signin";
import {
  TWO_FACTOR_FAILED_MESSAGE,
  beginTwoFactorEnrollment,
  confirmTwoFactorEnrollment,
  twoFactorAccountKey,
} from "@/server/services/two-factor";
import { makeOrg, makeUser, resetDatabase } from "@/server/__tests__/harness";
import {
  TEST_BASE_URL,
  claimsFor,
  configureTeamsEnv,
  installFakeMicrosoft,
  makeKey,
  newOid,
  newTenant,
  signToken,
  teamsClaimsFor,
  unsetMicrosoftEnv,
  type FakeMicrosoft,
} from "@/server/__tests__/microsoft-signin-fixtures";

const KEY = makeKey("kid-teams-route");
const PASSWORD = "coordination-2026";

let fake: FakeMicrosoft;
let restoreEnv: () => void;
let ipCounter = 0;

function nextIp(): string {
  ipCounter += 1;
  return `192.0.2.${ipCounter % 250}`;
}

function post(url: string, body: unknown, ip = nextIp()): Request {
  return new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip, "user-agent": "vitest" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function get(url: string, ip = nextIp()): Request {
  return new Request(`http://localhost${url}`, { headers: { "x-forwarded-for": ip, "user-agent": "vitest" } });
}

type Company = { id: string; tid: string };

async function company(name: string): Promise<Company> {
  const org = await makeOrg(name);
  const tid = newTenant();
  await prisma.organization.update({ where: { id: org.id }, data: { entraTenantId: tid } });
  return { id: org.id, tid };
}

/** A person of this company, already linked to their Microsoft identity (so the token can find them). */
async function linkedPerson(
  org: Company,
  options: { name?: string; role?: "ADMIN" | "ENGINEER" | "EXTERNAL"; linked?: boolean } = {},
) {
  const person = await makeUser({ name: options.name ?? "Salma Al Hinai", role: options.role ?? "ENGINEER", orgId: org.id });
  const oid = newOid();
  if (options.linked !== false) {
    await prisma.user.update({ where: { id: person.id }, data: { microsoftOid: oid, microsoftTenantId: org.tid } });
  }
  return { ...person, oid };
}

function ssoToken(tid: string, oid: string, overrides: Record<string, unknown> = {}): string {
  return signToken({ ...teamsClaimsFor({ tid, oid }), ...overrides }, KEY);
}

async function signInWith(body: unknown, ip = nextIp()) {
  const response = await sessionRoute(post("/api/teams/session", body, ip));
  return { response, status: response.status, body: await response.json() };
}

/** The value of one cookie from a response's Set-Cookie lines, and the whole line. */
function setCookie(response: Response, name: string): { value: string; line: string } | null {
  for (const line of response.headers.getSetCookie()) {
    if (line.startsWith(`${name}=`)) return { value: line.slice(name.length + 1).split(";")[0], line };
  }
  return null;
}

/** What a browser would do with the tab's cookie: keep it, and send it to /teams pages. */
function adoptTeamsCookie(response: Response): string {
  const found = setCookie(response, TEAMS_COOKIE);
  if (!found) throw new Error("expected the tab cookie to be set");
  jar.set(TEAMS_COOKIE, { value: found.value });
  return found.value;
}

async function browserSession(userId: string): Promise<string> {
  const minted = mintSession();
  await prisma.session.create({ data: { tokenHash: minted.tokenHash, userId, expiresAt: minted.expiresAt } });
  jar.set(SESSION_COOKIE, { value: minted.rawToken });
  return minted.rawToken;
}

const loginRows = (userId: string) => prisma.activityLog.findMany({ where: { actorId: userId, action: "LOGIN" } });

async function tabPage() {
  return (await TeamsTabPage({ searchParams: Promise.resolve({}) })) as unknown as {
    type: unknown;
    props: Record<string, unknown>;
  };
}

function codeFor(manualKey: string, offset = 0): string {
  return totpCode(base32Decode(manualKey), stepAt(Date.now()) + offset);
}

async function enrol(userId: string): Promise<{ manualKey: string }> {
  const actor = await actorForUser(userId);
  const enrolment = await beginTwoFactorEnrollment(actor);
  await confirmTwoFactorEnrollment(actor, { code: codeFor(enrolment.manualKey) });
  return { manualKey: enrolment.manualKey };
}

beforeEach(async () => {
  await resetDatabase();
  jar.clear();
  restoreEnv = configureTeamsEnv();
  signingKeys.clear();
  fake = installFakeMicrosoft([KEY.jwk]);
});

afterEach(() => {
  restoreEnv();
  vi.restoreAllMocks();
  jar.clear();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("signing in to the tab with Teams' single-sign-on token", () => {
  it("signs in a linked person: the tab's own cookie, one session, one LOGIN row marked via Teams", async () => {
    const org = await company("Meridian");
    const person = await linkedPerson(org);

    const { response, status, body } = await signInWith({ ssoToken: ssoToken(org.tid, person.oid) });

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, data: { status: "SIGNED_IN" } });
    expect(setCookie(response, TEAMS_COOKIE)).not.toBeNull();
    // The browser cookie is never touched by the tab.
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    expect(setCookie(response, SESSION_COOKIE)).toBeNull();

    expect(await prisma.session.count({ where: { userId: person.id } })).toBe(1);
    const rows = await loginRows(person.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata).toMatchObject({ method: "microsoft", via: "teams-sso", twoFactor: false });
    expect(rows[0].summary).toContain("via Teams");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: person.id } })).lastLoginAt).not.toBeNull();
  });

  it("refuses a token carrying an email when no oid is pinned — the tab never matches on email", async () => {
    const org = await company("Meridian");
    const person = await linkedPerson(org, { linked: false });
    const email = (await prisma.user.findUniqueOrThrow({ where: { id: person.id } })).email;

    const { status, body } = await signInWith({ ssoToken: ssoToken(org.tid, person.oid, { email, xms_edov: true }) });

    expect(status).toBe(401);
    expect(body).toEqual({ ok: false, error: TEAMS_SIGN_IN_FAILED_MESSAGE });
    expect(await prisma.session.count()).toBe(0);
    expect(await prisma.activityLog.count({ where: { action: "LOGIN" } })).toBe(0);
    // Nothing was pinned as a side effect either.
    expect((await prisma.user.findUniqueOrThrow({ where: { id: person.id } })).microsoftOid).toBeNull();
  });

  it("answers every failure with the same sentence and status, and writes no row", async () => {
    const org = await company("Meridian");
    const person = await linkedPerson(org);
    const stranger = newTenant();
    const strangerOid = newOid();

    const cases: unknown[] = [
      { ssoToken: ssoToken(org.tid, person.oid, { exp: Math.floor(Date.now() / 1000) - 3600 }) }, // expired
      { ssoToken: ssoToken(org.tid, person.oid, { aud: "00000000-0000-0000-0000-000000000000" }) }, // wrong audience
      { ssoToken: ssoToken(org.tid, person.oid, { scp: "User.Read" }) }, // wrong scope
      { ssoToken: signToken(teamsClaimsFor({ tid: org.tid, oid: person.oid }), makeKey(KEY.kid)) }, // bad signature
      { ssoToken: ssoToken(stranger, strangerOid) }, // a tenant no company owns
      { ssoToken: ssoToken(org.tid, newOid()) }, // right company, nobody with that oid
      { ssoToken: "not-a-token-at-all-not-a-token" },
      { handoffCode: "f".repeat(64) }, // a code that was never issued
      {},
      { ssoToken: ssoToken(org.tid, person.oid), handoffCode: "f".repeat(64) }, // both proofs
    ];
    for (const body of cases) {
      const answer = await signInWith(body);
      expect(answer.status, JSON.stringify(body).slice(0, 60)).toBe(401);
      expect(answer.body).toEqual({ ok: false, error: TEAMS_SIGN_IN_FAILED_MESSAGE });
      expect(setCookie(answer.response, TEAMS_COOKIE)).toBeNull();
    }
    expect(await prisma.session.count()).toBe(0);
    expect(await prisma.activityLog.count({ where: { action: "LOGIN" } })).toBe(0);
  });

  it("refuses a deactivated person and a contractor whose access has ended, with the same answer", async () => {
    const org = await company("Meridian");
    const gone = await linkedPerson(org, { name: "Gone Person" });
    await prisma.user.update({ where: { id: gone.id }, data: { isActive: false } });
    const expired = await linkedPerson(org, { name: "Yusuf Contractor", role: "EXTERNAL" });
    await prisma.user.update({
      where: { id: expired.id },
      data: { accessExpiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });

    for (const who of [gone, expired]) {
      const answer = await signInWith({ ssoToken: ssoToken(org.tid, who.oid) });
      expect(answer.status).toBe(401);
      expect(answer.body).toEqual({ ok: false, error: TEAMS_SIGN_IN_FAILED_MESSAGE });
    }
    expect(await prisma.session.count()).toBe(0);
  });

  it("never reaches Microsoft for anything but its public signing keys", async () => {
    const org = await company("Meridian");
    const person = await linkedPerson(org);
    await signInWith({ ssoToken: ssoToken(org.tid, person.oid) });

    expect(fake.tokenCalls).toBe(0);
    expect(fake.otherCalls).toEqual([]);
    expect(fake.jwksCalls).toBe(1);
  });
});

describe("signing in through the Microsoft window (the one-time hand-off code)", () => {
  /** Press the tab's button, "sign in at Microsoft" as this person, and come back to the callback. */
  async function popupTrip(org: Company, oid: string, email: string): Promise<Response> {
    const ip = nextIp();
    const started = await microsoftStart(get("/api/auth/microsoft?via=teams", ip));
    expect(started.status).toBe(302);
    const authorize = new URL(started.headers.get("location") ?? "");
    const nonce = authorize.searchParams.get("nonce") ?? "";
    const state = authorize.searchParams.get("state") ?? "";
    fake.idTokenFor = () => signToken(claimsFor({ tid: org.tid, oid, nonce, email, edov: true }), KEY);
    return microsoftCallback(get(`/api/auth/microsoft/callback?code=the-code&state=${encodeURIComponent(state)}`, ip));
  }

  it("ends with a hand-off code in the address fragment and NO session", async () => {
    const org = await company("Meridian");
    const person = await linkedPerson(org, { linked: false });
    const email = (await prisma.user.findUniqueOrThrow({ where: { id: person.id } })).email;

    const callback = await popupTrip(org, person.oid, email);

    expect(callback.status).toBe(302);
    const location = callback.headers.get("location") ?? "";
    expect(location).toMatch(new RegExp(`^${TEST_BASE_URL}/teams/auth-end#code=[0-9a-f]{64}$`));
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    expect(jar.has(TEAMS_COOKIE)).toBe(false);
    expect(setCookie(callback, SESSION_COOKIE)).toBeNull();
    expect(await prisma.session.count()).toBe(0);
    expect(await prisma.activityLog.count({ where: { action: "LOGIN" } })).toBe(0);
    // The ordinary first-link rule ran and pinned the oid.
    expect((await prisma.user.findUniqueOrThrow({ where: { id: person.id } })).microsoftOid).toBe(person.oid);
  });

  it("is exchanged once for the tab's session, marked via the popup, and is dead afterwards", async () => {
    const org = await company("Meridian");
    const person = await linkedPerson(org, { linked: false });
    const email = (await prisma.user.findUniqueOrThrow({ where: { id: person.id } })).email;
    const callback = await popupTrip(org, person.oid, email);
    const code = (callback.headers.get("location") ?? "").split("#code=")[1];

    const first = await signInWith({ handoffCode: code });
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ ok: true, data: { status: "SIGNED_IN" } });
    expect(setCookie(first.response, TEAMS_COOKIE)).not.toBeNull();
    const rows = await loginRows(person.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata).toMatchObject({ method: "microsoft", via: "teams-popup" });

    const replay = await signInWith({ handoffCode: code });
    expect(replay.status).toBe(401);
    expect(replay.body).toEqual({ ok: false, error: TEAMS_SIGN_IN_FAILED_MESSAGE });
    expect(await prisma.session.count({ where: { userId: person.id } })).toBe(1);
  });

  it("does not work after its two minutes", async () => {
    const org = await company("Meridian");
    const person = await linkedPerson(org, { linked: false });
    const email = (await prisma.user.findUniqueOrThrow({ where: { id: person.id } })).email;
    const callback = await popupTrip(org, person.oid, email);
    const code = (callback.headers.get("location") ?? "").split("#code=")[1];

    await prisma.emailToken.updateMany({
      where: { purpose: "TEAMS_HANDOFF" },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect((await signInWith({ handoffCode: code })).status).toBe(401);
    expect(await prisma.session.count()).toBe(0);
  });

  it("sends a refused popup to the same end page with a failure flag — never the login page", async () => {
    const org = await company("Meridian");
    const person = await linkedPerson(org, { linked: false });

    // An unverified address cannot make a first link.
    const callback = await popupTrip(org, person.oid, "nobody@nowhere.example");
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe(`${TEST_BASE_URL}/teams/auth-end#failed=1`);
    expect(await prisma.emailToken.count({ where: { purpose: "TEAMS_HANDOFF" } })).toBe(0);
  });

  it("leaves ordinary browser sign-in exactly as it was — no via flag, a session straight away", async () => {
    const org = await company("Meridian");
    const person = await linkedPerson(org, { linked: false });
    const email = (await prisma.user.findUniqueOrThrow({ where: { id: person.id } })).email;

    const started = await microsoftStart(get("/api/auth/microsoft"));
    const authorize = new URL(started.headers.get("location") ?? "");
    const nonce = authorize.searchParams.get("nonce") ?? "";
    const state = authorize.searchParams.get("state") ?? "";
    fake.idTokenFor = () => signToken(claimsFor({ tid: org.tid, oid: person.oid, nonce, email, edov: true }), KEY);
    const callback = await microsoftCallback(
      get(`/api/auth/microsoft/callback?code=the-code&state=${encodeURIComponent(state)}`),
    );

    expect(callback.status).toBe(302);
    expect(jar.has(SESSION_COOKIE)).toBe(true);
    expect(jar.has(TEAMS_COOKIE)).toBe(false);
    const rows = await loginRows(person.id);
    expect(rows[0].metadata).toEqual({ reportedIp: expect.anything(), twoFactor: false, method: "microsoft" });
    expect(await prisma.emailToken.count({ where: { purpose: "TEAMS_HANDOFF" } })).toBe(0);
    expect(jar.get(ATTEMPT_COOKIE)).toBeUndefined();
  });
});

describe("two-factor is still asked inside Teams", () => {
  async function ticketFor(org: Company, person: { oid: string }) {
    const answer = await signInWith({ ssoToken: ssoToken(org.tid, person.oid) });
    expect(answer.status).toBe(200);
    expect(answer.body.data.status).toBe("TWO_FACTOR_REQUIRED");
    return { ...answer, pendingToken: answer.body.data.pendingToken as string };
  }

  async function teamsCode(body: unknown, ip = nextIp()) {
    const response = await teamsTwoFactor(post("/api/teams/two-factor", body, ip));
    return { response, status: response.status, body: await response.json(), retryAfter: response.headers.get("Retry-After") };
  }

  it("a two-factor account gets a ticket and nothing else: no session, no cookie, no LOGIN row", async () => {
    const org = await company("Meridian");
    const person = await linkedPerson(org);
    await enrol(person.id);

    const ticket = await ticketFor(org, person);

    expect(setCookie(ticket.response, TEAMS_COOKIE)).toBeNull();
    expect(ticket.body.data.pendingToken).toMatch(/^[0-9a-f]{64}$/);
    expect(await prisma.session.count({ where: { userId: person.id } })).toBe(0);
    expect(await loginRows(person.id)).toHaveLength(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: person.id } })).lastLoginAt).toBeNull();
  });

  it("a good code finishes the sign-in with the tab's cookie and a LOGIN row marked via Teams", async () => {
    const org = await company("Meridian");
    const person = await linkedPerson(org);
    const { manualKey } = await enrol(person.id);
    const { pendingToken } = await ticketFor(org, person);

    const done = await teamsCode({ pendingToken, code: codeFor(manualKey, 1) });

    expect(done.status).toBe(200);
    expect(setCookie(done.response, TEAMS_COOKIE)).not.toBeNull();
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    const rows = await loginRows(person.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata).toMatchObject({ method: "microsoft", via: "teams", twoFactor: true });
  });

  it("a wrong code is the usual one sentence, and a fifth wrong try kills the ticket", async () => {
    const org = await company("Meridian");
    const person = await linkedPerson(org);
    const { manualKey } = await enrol(person.id);
    const { pendingToken } = await ticketFor(org, person);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const wrong = await teamsCode({ pendingToken, code: "000000" });
      expect(wrong.status).toBe(401);
      expect(wrong.body).toEqual({ ok: false, error: TWO_FACTOR_FAILED_MESSAGE });
      expect(setCookie(wrong.response, TEAMS_COOKIE)).toBeNull();
    }

    // The ticket is finished: even the right code no longer opens anything.
    const late = await teamsCode({ pendingToken, code: codeFor(manualKey, 1) });
    expect([401, 429]).toContain(late.status);
    expect(setCookie(late.response, TEAMS_COOKIE)).toBeNull();
    expect(await prisma.session.count({ where: { userId: person.id } })).toBe(0);
    expect(await loginRows(person.id)).toHaveLength(0);
  });

  it("refuses a replayed code", async () => {
    const org = await company("Meridian");
    const person = await linkedPerson(org);
    const { manualKey } = await enrol(person.id);
    const code = codeFor(manualKey, 1);

    const first = await ticketFor(org, person);
    expect((await teamsCode({ pendingToken: first.pendingToken, code })).status).toBe(200);

    const second = await ticketFor(org, person);
    const replay = await teamsCode({ pendingToken: second.pendingToken, code });
    expect(replay.status).toBe(401);
    expect(replay.body).toEqual({ ok: false, error: TWO_FACTOR_FAILED_MESSAGE });
  });

  it("the tab and the browser route spend ONE per-account budget", async () => {
    const org = await company("Meridian");
    const person = await linkedPerson(org);
    await enrol(person.id);
    const teamsTicket = await ticketFor(org, person);

    expect((await teamsCode({ pendingToken: teamsTicket.pendingToken, code: "000000" })).status).toBe(401);
    // One wrong try through the tab is one against the account…
    expect(checkOnly(twoFactorAccountKey(person.id), 1).ok).toBe(false);
    expect(checkOnly(twoFactorAccountKey(person.id), 2).ok).toBe(true);

    // …and a wrong try through the browser's route adds to the same count.
    const browserTicket = await ticketFor(org, person);
    const wrong = await browserTwoFactor(
      post("/api/auth/two-factor", { pendingToken: browserTicket.pendingToken, code: "000000" }),
    );
    expect(wrong.status).toBe(401);
    expect(checkOnly(twoFactorAccountKey(person.id), 2).ok).toBe(false);
  });

  it("the browser route still sets the browser cookie, SameSite=Lax, and never the tab's", async () => {
    const org = await company("Meridian");
    const person = await linkedPerson(org);
    const { manualKey } = await enrol(person.id);
    const { pendingToken } = await ticketFor(org, person);

    const done = await browserTwoFactor(
      post("/api/auth/two-factor", { pendingToken, code: codeFor(manualKey, 1) }),
    );

    expect(done.status).toBe(200);
    expect(jar.get(SESSION_COOKIE)?.options).toMatchObject({ sameSite: "lax", path: "/", httpOnly: true });
    expect(setCookie(done, TEAMS_COOKIE)).toBeNull();
    const rows = await loginRows(person.id);
    expect(rows[0].metadata).not.toHaveProperty("via");
  });
});

describe("the tab's cookie is boxed in", () => {
  it("is set as SameSite=None; Secure; Partitioned; HttpOnly; Path=/teams — and nothing else is", async () => {
    const org = await company("Meridian");
    const person = await linkedPerson(org);

    const { response } = await signInWith({ ssoToken: ssoToken(org.tid, person.oid) });
    const cookie = setCookie(response, TEAMS_COOKIE);

    expect(cookie?.line).toMatch(/SameSite=none/i);
    expect(cookie?.line).toMatch(/;\s*Secure/i);
    expect(cookie?.line).toMatch(/;\s*Partitioned/i);
    expect(cookie?.line).toMatch(/;\s*HttpOnly/i);
    expect(cookie?.line).toMatch(/Path=\/teams(;|$)/);
    expect(response.headers.getSetCookie()).toHaveLength(1);
  });

  it("the browser's own sign-in still sets SameSite=Lax on the whole site", async () => {
    const org = await company("Meridian");
    const person = await makeUser({ name: "Browser Person", role: "ENGINEER", orgId: org.id });
    const email = `browser.${Date.now()}@test.example`;
    await prisma.user.update({
      where: { id: person.id },
      data: { email, passwordHash: await hashPassword(PASSWORD) },
    });

    const response = await passwordLogin(post("/api/auth/login", { email, password: PASSWORD }));

    expect(response.status).toBe(200);
    expect(jar.get(SESSION_COOKIE)?.options).toMatchObject({ sameSite: "lax", path: "/" });
    expect(setCookie(response, TEAMS_COOKIE)).toBeNull();
  });

  it("a request carrying only the tab's cookie is signed out everywhere else", async () => {
    const org = await company("Meridian");
    const person = await linkedPerson(org);
    const { response } = await signInWith({ ssoToken: ssoToken(org.tid, person.oid) });
    adoptTeamsCookie(response);
    expect(jar.has(SESSION_COOKIE)).toBe(false);

    // getSessionUser() ignores it…
    expect(await getSessionUser()).toBeNull();
    // …so the brief API answers signed-out…
    const brief = await myBrief();
    expect(brief.status).toBe(401);
    // …and so does a data-changing route.
    const form = new FormData();
    form.set("projectId", "x");
    const upload = await uploads(new Request("http://localhost/api/uploads", { method: "POST", body: form }));
    expect(upload.status).toBe(401);
    // …while the tab itself does know them.
    expect((await getTeamsTabUser())?.id).toBe(person.id);
  });

  it("a request carrying only the browser's cookie shows the tab's sign-in state, never the day", async () => {
    const org = await company("Meridian");
    const person = await linkedPerson(org);
    await browserSession(person.id);

    expect(await getTeamsTabUser()).toBeNull();
    const page = await tabPage();
    expect(page.type).toBe(TeamsSignIn);
    expect(page.props).toEqual({ cookiesBlocked: false });
  });

  it("the tab draws the signed-in person's own day, from the session's own company", async () => {
    const org = await company("Meridian");
    const person = await linkedPerson(org);
    const { response } = await signInWith({ ssoToken: ssoToken(org.tid, person.oid) });
    adoptTeamsCookie(response);

    const page = await tabPage();

    expect(page.type).toBe(TeamsBrief);
    expect(page.props.contractor).toBe(false);
    expect(page.props.brief).toMatchObject({ dueToday: { total: 0 }, overdue: { total: 0 } });
  });

  it("after a sign-in that left no cookie behind, the tab says to open Tielora in the browser", async () => {
    const page = (await TeamsTabPage({ searchParams: Promise.resolve({ tried: "1" }) })) as unknown as {
      type: unknown;
      props: Record<string, unknown>;
    };
    expect(page.type).toBe(TeamsSignIn);
    expect(page.props).toEqual({ cookiesBlocked: true });
  });

  it("dies with the person: deactivation and revoked sessions end the tab's sign-in too", async () => {
    const org = await company("Meridian");
    const person = await linkedPerson(org);
    const { response } = await signInWith({ ssoToken: ssoToken(org.tid, person.oid) });
    adoptTeamsCookie(response);
    expect(await getTeamsTabUser()).not.toBeNull();

    await revokeSessions(person.id);
    expect(await getTeamsTabUser()).toBeNull();

    // And an account deactivated after a sign-in is refused at the next read.
    const again = await signInWith({ ssoToken: ssoToken(org.tid, person.oid) });
    adoptTeamsCookie(again.response);
    await prisma.user.update({ where: { id: person.id }, data: { isActive: false } });
    expect(await getTeamsTabUser()).toBeNull();
  });

  it("carries a contractor's ended access with it", async () => {
    const org = await company("Meridian");
    const contractor = await linkedPerson(org, { name: "Yusuf Contractor", role: "EXTERNAL" });
    const { response } = await signInWith({ ssoToken: ssoToken(org.tid, contractor.oid) });
    adoptTeamsCookie(response);
    expect(await getTeamsTabUser()).not.toBeNull();

    await prisma.user.update({
      where: { id: contractor.id },
      data: { accessExpiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });

    expect(await getTeamsTabUser()).toBeNull();
    expect(await prisma.session.count({ where: { userId: contractor.id } })).toBe(0);
  });
});

describe("the package download", () => {
  it("is ADMIN of the caller's own company only — everybody else just gets 'not found'", async () => {
    const org = await company("Meridian");
    const admin = await linkedPerson(org, { name: "Ada Admin", role: "ADMIN" });
    const engineer = await linkedPerson(org, { name: "Eng Ineer", role: "ENGINEER" });
    const contractor = await linkedPerson(org, { name: "Yusuf Contractor", role: "EXTERNAL" });

    // Signed out.
    expect((await manifestRoute()).status).toBe(404);

    // A non-admin and a contractor.
    for (const person of [engineer, contractor]) {
      jar.clear();
      await browserSession(person.id);
      const response = await manifestRoute();
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ ok: false, error: "That page was not found." });
    }

    // The administrator.
    jar.clear();
    await browserSession(admin.id);
    const response = await manifestRoute();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="tielora-teams-app.zip"');
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.subarray(0, 2).toString()).toBe("PK");
    // Nothing is audited for a download.
    expect(await prisma.activityLog.count()).toBe(0);
  });

  it("is rate limited per person, with Retry-After", async () => {
    const org = await company("Meridian");
    const admin = await linkedPerson(org, { name: "Ada Admin", role: "ADMIN" });
    await browserSession(admin.id);

    let last = await manifestRoute();
    for (let index = 0; index < 10 && last.status === 200; index += 1) last = await manifestRoute();

    expect(last.status).toBe(429);
    expect(last.headers.get("Retry-After")).toMatch(/^\d+$/);
  });
});

describe("rate limits on signing in", () => {
  it("refuses with 429, a plain sentence and Retry-After once ten failures have piled up", async () => {
    const ip = "198.51.100.77";
    for (let index = 0; index < 10; index += 1) {
      expect((await signInWith({ ssoToken: "x".repeat(40) }, ip)).status).toBe(401);
    }
    const blocked = await signInWith({ ssoToken: "x".repeat(40) }, ip);
    expect(blocked.status).toBe(429);
    expect(blocked.response.headers.get("Retry-After")).toMatch(/^\d+$/);
    expect(blocked.body.error).toMatch(/wait/i);
  });
});

describe("which refusals count toward the lockout", () => {
  it("ten ordinary refusals (not linked yet, company not switched on) from one address never lock it", async () => {
    const org = await company("Meridian");
    const person = await linkedPerson(org);
    const stranger = newTenant();
    const ip = "198.51.100.88";
    for (let index = 0; index < 12; index += 1) {
      const body =
        index % 2 === 0
          ? { ssoToken: ssoToken(org.tid, newOid()) } // right company, not linked yet
          : { ssoToken: ssoToken(stranger, newOid()) }; // a company that has not switched Microsoft on
      const answer = await signInWith(body, ip);
      expect(answer.status).toBe(401);
      expect(answer.body).toEqual({ ok: false, error: TEAMS_SIGN_IN_FAILED_MESSAGE });
    }
    // The same office can still sign in.
    const ok = await signInWith({ ssoToken: ssoToken(org.tid, person.oid) }, ip);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ ok: true, data: { status: "SIGNED_IN" } });
  });

  it("ten forged tokens from one address do lock it", async () => {
    const org = await company("Meridian");
    const person = await linkedPerson(org);
    const ip = "198.51.100.89";
    for (let index = 0; index < 10; index += 1) {
      const forged = signToken(teamsClaimsFor({ tid: org.tid, oid: person.oid }), makeKey(KEY.kid));
      const answer = await signInWith({ ssoToken: forged }, ip);
      expect(answer.status).toBe(401);
      expect(answer.body).toEqual({ ok: false, error: TEAMS_SIGN_IN_FAILED_MESSAGE });
    }
    expect((await signInWith({ ssoToken: ssoToken(org.tid, person.oid) }, ip)).status).toBe(429);
  });
});

describe("dormant: TEAMS_APP_ID unset", () => {
  beforeEach(() => {
    delete process.env.TEAMS_APP_ID;
  });

  it("the session and two-factor routes say 'not set up' (503) and nothing happens", async () => {
    const org = await company("Meridian");
    const person = await linkedPerson(org);

    const session = await signInWith({ ssoToken: ssoToken(org.tid, person.oid) });
    expect(session.status).toBe(503);
    expect(session.body.ok).toBe(false);

    const twoFactor = await teamsTwoFactor(post("/api/teams/two-factor", { pendingToken: "a".repeat(64), code: "123456" }));
    expect(twoFactor.status).toBe(503);

    expect(await prisma.session.count()).toBe(0);
    expect(await prisma.activityLog.count({ where: { action: "LOGIN" } })).toBe(0);
  });

  it("the tab page and the download say 'not found', even to an administrator", async () => {
    const org = await company("Meridian");
    const admin = await linkedPerson(org, { name: "Ada Admin", role: "ADMIN" });
    await browserSession(admin.id);

    await expect(tabPage()).rejects.toThrow();
    expect((await manifestRoute()).status).toBe(404);
  });

  it("'?via=teams' on the Microsoft start route is simply 'not set up'", async () => {
    const response = await microsoftStart(get("/api/auth/microsoft?via=teams"));
    expect(response.status).toBe(404);
    expect(jar.has(ATTEMPT_COOKIE)).toBe(false);
  });

  it("the ordinary Microsoft start still works (the Azure app is registered) — behaviour unchanged", async () => {
    const response = await microsoftStart(get("/api/auth/microsoft"));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("login.microsoftonline.com");
  });

  it("with no Azure app either, the Teams routes are still simply not set up", async () => {
    unsetMicrosoftEnv();
    process.env.TEAMS_APP_ID = "9f2b8c1e-4d7a-4e63-8b1f-3a5c6d7e8f90";
    expect((await signInWith({ ssoToken: "x".repeat(40) })).status).toBe(503);
  });
});
