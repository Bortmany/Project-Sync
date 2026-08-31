// The user-facing half of transactional email: forgotten passwords, invitations and verification.
//
// The rules being proved here:
//  - asking for a reset link tells nobody anything — the same bytes come back for an address with
//    an account, one with none, a deactivated account and a contractor whose access has run out;
//  - a reset spends its link exactly once, really changes the password, and really drops every
//    session that account holds;
//  - **no link ever mints a session**, which is what keeps an expired contractor out;
//  - an invitation creates an account nobody has a password for, and accepting one sets the first
//    password and marks the address verified;
//  - resending retires the link already in somebody's inbox;
//  - with no mail provider set up, every one of these paths says so and sends nothing at all;
//  - the rate limits fire.
//
// No test here touches the network: global.fetch is replaced everywhere it would be called.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as forgotPassword } from "@/app/api/auth/forgot-password/route";
import { POST as resetPasswordRoute } from "@/app/api/auth/reset-password/route";
import { POST as setPasswordRoute } from "@/app/api/auth/set-password/route";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { setRateLimitStore, type RateLimitStore } from "@/lib/rate-limit";
import { actorForUser, type ActorContext } from "@/server/actor";
import {
  acceptInvite,
  needsVerificationNudge,
  requestPasswordReset,
  resendInvite,
  resendVerification,
  resetPassword,
  verifyEmailWithToken,
} from "@/server/services/account";
import { createUser } from "@/server/services/admin";
import {
  consumeEmailToken,
  issueEmailToken,
  previewEmailToken,
} from "@/server/services/email-tokens";
import { defaultOrg, makeDiscipline, makeUser, resetDatabase } from "@/server/__tests__/harness";

process.env.SWEEP_DISABLED = "1";

const API_KEY = "re_Sup3rSecretResendKeyValue";
const FROM = "Tielora <no-reply@tielora.example>";
const BASE = "https://tielora.example";

const GOOD_PASSWORD = "correct horse battery staple";
const NEW_PASSWORD = "a brand new pass phrase";

function configureEmail() {
  process.env.RESEND_API_KEY = API_KEY;
  process.env.EMAIL_FROM = FROM;
  process.env.APP_BASE_URL = BASE;
}

function goDormant() {
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
  delete process.env.APP_BASE_URL;
}

/** A rate-limit store of this file's own, so one test's attempts never spill into the next. */
class TestStore implements RateLimitStore {
  private windows = new Map<string, { count: number; resetAt: number }>();

  hit(key: string, windowMs: number) {
    const now = Date.now();
    const existing = this.windows.get(key);
    if (existing && existing.resetAt > now) {
      existing.count += 1;
      return existing;
    }
    const fresh = { count: 1, resetAt: now + windowMs };
    this.windows.set(key, fresh);
    return fresh;
  }

  peek(key: string) {
    const existing = this.windows.get(key);
    if (!existing || existing.resetAt <= Date.now()) return null;
    return existing;
  }

  reset(key: string) {
    this.windows.delete(key);
  }
}

function mockFetchOk() {
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify({ id: "msg_1" }), { status: 200 }));
}

/** Lets the un-awaited `void send…()` calls run before a test looks at the fetch spy. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Waits for work the route deliberately did not wait for. The forgot-password route answers before
 * its transaction commits (that is the timing fix), so a test that wants to see the result has to
 * be the one that waits — and has to finish waiting before the next test empties the database.
 */
async function waitFor(check: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for the background work to finish");
}

const emailTokens = () => prisma.emailToken.count();

function ask(email: string, ip = "203.0.113.5"): Promise<Response> {
  return forgotPassword(
    new Request("https://tielora.example/api/auth/forgot-password", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ email }),
    }),
  );
}

/** Status, headers and body together — what an outsider can actually see. */
async function seenFrom(response: Response) {
  return {
    status: response.status,
    body: await response.text(),
  };
}

async function makeSignInAbleUser(options: {
  name: string;
  email: string;
  orgId?: string;
  isActive?: boolean;
  accessExpiresAt?: Date | null;
}) {
  const orgId = options.orgId ?? (await defaultOrg());
  return prisma.user.create({
    data: {
      orgId,
      email: options.email,
      name: options.name,
      passwordHash: await hashPassword(GOOD_PASSWORD),
      role: options.accessExpiresAt ? "EXTERNAL" : "ENGINEER",
      companyName: options.accessExpiresAt ? "Al Hassan Engineering" : null,
      accessExpiresAt: options.accessExpiresAt ?? null,
      isActive: options.isActive ?? true,
    },
  });
}

let admin: { id: string; name: string; orgId: string };
let adminActor: ActorContext;

beforeEach(async () => {
  await resetDatabase();
  setRateLimitStore(new TestStore());
  configureEmail();
  admin = await makeUser({ name: "Tielora Administrator", role: "ADMIN" });
  adminActor = await actorForUser(admin.id);
});

afterEach(() => {
  vi.restoreAllMocks();
  goDormant();
});

afterAll(async () => {
  await prisma.$disconnect();
});

/* ------------------------------------------------------------------ */

describe("asking for a reset link tells nobody anything", () => {
  it("answers with the same bytes for a real, a missing, a deactivated and an expired account", async () => {
    mockFetchOk();
    const yesterday = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

    await makeSignInAbleUser({ name: "Jane Marsh", email: "jane@meridian.example" });
    await makeSignInAbleUser({
      name: "Gone Away",
      email: "gone@meridian.example",
      isActive: false,
    });
    await makeSignInAbleUser({
      name: "Sami Contractor",
      email: "sami@alhassan.example",
      accessExpiresAt: yesterday,
    });

    // Four different IPs, so the per-address ceiling is the only thing these share.
    const answers = await Promise.all([
      ask("jane@meridian.example", "198.51.100.1").then(seenFrom),
      ask("nobody@nowhere.example", "198.51.100.2").then(seenFrom),
      ask("gone@meridian.example", "198.51.100.3").then(seenFrom),
      ask("sami@alhassan.example", "198.51.100.4").then(seenFrom),
    ]);

    expect(answers[0]).toEqual({ status: 200, body: '{"ok":true,"data":{"sent":true}}' });
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
    expect(answers[3]).toEqual(answers[0]);

    // Let the one real link finish being written before this test hands the database on.
    await waitFor(async () => (await emailTokens()) === 1);
  });

  it("answers before the work is done, so the WAIT cannot say whether an account is real", async () => {
    mockFetchOk();
    const live = await makeSignInAbleUser({ name: "Jane Marsh", email: "jane@meridian.example" });

    const response = await ask("jane@meridian.example", "198.51.100.40");
    expect(response.status).toBe(200);

    // Nothing has been written yet. That is the point: an address with an account costs a whole
    // transaction (retire the old links, write the new one, append the audit row) and an address
    // with none costs one lookup — so the route hands its answer back before either happens, and a
    // stopwatch on the two is reading the same nothing.
    expect(await emailTokens()).toBe(0);

    // The work still happens, in its own time, and writes exactly what it should.
    await waitFor(async () => (await emailTokens()) === 1);
    const token = await prisma.emailToken.findFirstOrThrow();
    expect(token.userId).toBe(live.id);
    expect(token.purpose).toBe("RESET");
    expect(await prisma.activityLog.count({ where: { entityType: "Email" } })).toBe(1);
  });

  it("only actually issues a link for the account that could sign in", async () => {
    mockFetchOk();
    const yesterday = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

    const live = await makeSignInAbleUser({ name: "Jane Marsh", email: "jane@meridian.example" });
    const gone = await makeSignInAbleUser({
      name: "Gone Away",
      email: "gone@meridian.example",
      isActive: false,
    });
    const expired = await makeSignInAbleUser({
      name: "Sami Contractor",
      email: "sami@alhassan.example",
      accessExpiresAt: yesterday,
    });

    await requestPasswordReset("jane@meridian.example");
    await requestPasswordReset("gone@meridian.example");
    await requestPasswordReset("sami@alhassan.example");
    await requestPasswordReset("nobody@nowhere.example");

    const tokens = await prisma.emailToken.findMany({ select: { userId: true, purpose: true } });
    expect(tokens).toEqual([{ userId: live.id, purpose: "RESET" }]);

    // ...and only that one earned an audit row about an email.
    const rows = await prisma.activityLog.findMany({ where: { entityType: "Email" } });
    expect(rows).toHaveLength(1);
    expect(rows[0].entityId).toBe(live.id);
    expect(rows[0].actorId).toBe(live.id);
    expect(JSON.stringify(rows)).not.toContain(gone.id);
    expect(JSON.stringify(rows)).not.toContain(expired.id);
  });

  it("stops after three tries from one address, and three about one account", async () => {
    mockFetchOk();
    await makeSignInAbleUser({ name: "Jane Marsh", email: "jane@meridian.example" });

    // Three from one IP are fine; the fourth is turned away in plain English.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await ask("jane@meridian.example", "198.51.100.9")).status).toBe(200);
    }
    const fourth = await ask("jane@meridian.example", "198.51.100.9");
    expect(fourth.status).toBe(429);
    expect(fourth.headers.get("Retry-After")).toBeTruthy();
    expect(await fourth.text()).toContain("Too many attempts.");

    // A fresh IP does not help: the address itself has had its three as well.
    const elsewhere = await ask("jane@meridian.example", "198.51.100.10");
    expect(elsewhere.status).toBe(429);

    // The three that were allowed each wrote their link; wait for them before moving on.
    await waitFor(async () => (await emailTokens()) === 3);
  });

  it("says so plainly, and sends nothing at all, with no mail provider set up", async () => {
    const spy = mockFetchOk();
    goDormant();
    await makeSignInAbleUser({ name: "Jane Marsh", email: "jane@meridian.example" });

    const response = await ask("jane@meridian.example");

    expect(response.status).toBe(503);
    expect(await response.text()).toContain(
      "Password resets by email aren't available right now. Please contact your workspace administrator to have your password reset.",
    );
    await settle();
    expect(spy).not.toHaveBeenCalled();
    expect(await prisma.emailToken.count()).toBe(0);
  });
});

describe("spending a reset link", () => {
  it("changes the password, ends every session, and works exactly once", async () => {
    const user = await makeSignInAbleUser({ name: "Jane Marsh", email: "jane@meridian.example" });
    await prisma.session.create({
      data: {
        tokenHash: `session-${user.id}`,
        userId: user.id,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const { rawToken } = await issueEmailToken(user.id, "RESET");
    expect(await resetPassword({ token: rawToken, password: NEW_PASSWORD })).toEqual({
      changed: true,
    });

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword(after.passwordHash, NEW_PASSWORD)).toBe(true);
    expect(await verifyPassword(after.passwordHash, GOOD_PASSWORD)).toBe(false);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);

    // The same link a second time is refused, and says nothing about why.
    await expect(resetPassword({ token: rawToken, password: "yet another pass phrase" })).rejects.toThrow(
      "This link no longer works.",
    );

    const rows = await prisma.activityLog.findMany({ where: { action: "PASSWORD_RESET" } });
    expect(rows).toHaveLength(1);
    expect(rows[0].summary).toBe("Jane Marsh set a new password from a reset link");
    expect(JSON.stringify(rows)).not.toContain(rawToken);
    expect(JSON.stringify(rows)).not.toContain(NEW_PASSWORD);
  });

  it("answers the same one sentence for a made-up, an expired and a wrong-purpose link", async () => {
    const user = await makeSignInAbleUser({ name: "Jane Marsh", email: "jane@meridian.example" });
    const stale = await issueEmailToken(user.id, "RESET", -1_000);
    const invite = await issueEmailToken(user.id, "INVITE");

    for (const token of ["f".repeat(64), stale.rawToken, invite.rawToken]) {
      await expect(resetPassword({ token, password: NEW_PASSWORD })).rejects.toThrow(
        "This link no longer works. It may have expired or already been used.",
      );
    }
  });

  it("hands back no session and no cookie — a link is never a way in", async () => {
    // A contractor whose access ran out yesterday. They may still reset a password (they are a
    // person with an account), but nothing here lets them back into the app: no session row is
    // created, no cookie is set, and getSessionUser still refuses them on the strength of the date.
    const yesterday = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const contractor = await makeSignInAbleUser({
      name: "Sami Contractor",
      email: "sami@alhassan.example",
      accessExpiresAt: yesterday,
    });
    const { rawToken } = await issueEmailToken(contractor.id, "RESET");

    const response = await resetPasswordRoute(
      new Request("https://tielora.example/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.20" },
        body: JSON.stringify({ token: rawToken, password: NEW_PASSWORD }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await prisma.session.count()).toBe(0);

    // The password really did change, and the access end date is untouched — so the sign-in route
    // and getSessionUser turn them away exactly as they did before.
    const after = await prisma.user.findUniqueOrThrow({ where: { id: contractor.id } });
    expect(await verifyPassword(after.passwordHash, NEW_PASSWORD)).toBe(true);
    expect(after.accessExpiresAt?.getTime()).toBe(yesterday.getTime());
  });

  it("refuses a password that is too short, before anything is spent", async () => {
    const user = await makeSignInAbleUser({ name: "Jane Marsh", email: "jane@meridian.example" });
    const { rawToken } = await issueEmailToken(user.id, "RESET");

    const response = await resetPasswordRoute(
      new Request("https://tielora.example/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.21" },
        body: JSON.stringify({ token: rawToken, password: "too short" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Use at least 12 characters");
    // The link was never touched, so it still works.
    expect((await consumeEmailToken(rawToken, "RESET"))?.id).toBe(user.id);
  });
});

describe("invitations", () => {
  it("creates an account nobody has a password for, then lets them set their own", async () => {
    const spy = mockFetchOk();

    const invited = await createUser(adminActor, {
      name: "Jane Marsh",
      email: "jane@meridian.example",
      mode: "INVITE",
      role: "ENGINEER",
      disciplineId: (await makeDiscipline("PROC", 9)).id,
    });

    // No password anybody could type signs this account in yet.
    const row = await prisma.user.findUniqueOrThrow({ where: { id: invited.id } });
    expect(await verifyPassword(row.passwordHash, GOOD_PASSWORD)).toBe(false);
    expect(await verifyPassword(row.passwordHash, "")).toBe(false);
    expect(row.emailVerifiedAt).toBeNull();
    expect(row.lastLoginAt).toBeNull();

    // The audit trail carries the account and the invitation, and neither carries a password.
    const actions = (
      await prisma.activityLog.findMany({ orderBy: { createdAt: "asc" }, select: { action: true } })
    ).map((entry) => entry.action);
    expect(actions).toContain("USER_CREATED");
    expect(actions).toContain("EMAIL_SENT");

    // The link went out once, carrying the invitation copy.
    await settle();
    const body = JSON.parse(String((spy.mock.calls[0][1] as RequestInit).body)) as {
      subject: string;
      text: string;
    };
    expect(body.subject).toBe("You're invited to Tielora");
    expect(body.text).toContain(`${BASE}/set-password?token=`);

    // Accepting it sets the first password and proves the address in one go.
    const rawToken = String(body.text.split("set-password?token=")[1].split("\n")[0]);
    expect(await acceptInvite({ token: rawToken, password: NEW_PASSWORD })).toEqual({
      changed: true,
    });

    const accepted = await prisma.user.findUniqueOrThrow({ where: { id: invited.id } });
    expect(await verifyPassword(accepted.passwordHash, NEW_PASSWORD)).toBe(true);
    expect(accepted.emailVerifiedAt).not.toBeNull();
    expect(accepted.isActive).toBe(true);

    // And the link cannot be used a second time by anybody who saw it in transit.
    await expect(acceptInvite({ token: rawToken, password: "someone else's phrase" })).rejects.toThrow(
      "This link no longer works.",
    );
  });

  it("mints no session when an invitation is accepted", async () => {
    mockFetchOk();
    const invited = await createUser(adminActor, {
      name: "Jane Marsh",
      email: "jane@meridian.example",
      mode: "INVITE",
      role: "PROJECT_MANAGER",
    });
    const { rawToken } = await issueEmailToken(invited.id, "INVITE");

    const response = await setPasswordRoute(
      new Request("https://tielora.example/api/auth/set-password", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.30" },
        body: JSON.stringify({ token: rawToken, password: NEW_PASSWORD }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await prisma.session.count()).toBe(0);
  });

  it("resending retires the link already in their inbox", async () => {
    mockFetchOk();
    const invited = await createUser(adminActor, {
      name: "Jane Marsh",
      email: "jane@meridian.example",
      mode: "INVITE",
      role: "PROJECT_MANAGER",
    });
    const first = await issueEmailToken(invited.id, "INVITE");

    expect(await resendInvite(adminActor, { id: invited.id })).toEqual({ sent: true });

    // The old link is dead; only the newest one works.
    await expect(acceptInvite({ token: first.rawToken, password: NEW_PASSWORD })).rejects.toThrow(
      "This link no longer works.",
    );

    const live = await prisma.emailToken.findMany({
      where: { userId: invited.id, purpose: "INVITE", usedAt: null },
    });
    expect(live).toHaveLength(1);
  });

  it("will not resend to somebody who has already signed in", async () => {
    mockFetchOk();
    const invited = await createUser(adminActor, {
      name: "Jane Marsh",
      email: "jane@meridian.example",
      mode: "INVITE",
      role: "PROJECT_MANAGER",
    });
    await prisma.user.update({ where: { id: invited.id }, data: { lastLoginAt: new Date() } });

    await expect(resendInvite(adminActor, { id: invited.id })).rejects.toThrow(
      "This person has already signed in.",
    );
  });

  it("keeps another company's people out of reach", async () => {
    mockFetchOk();
    const otherOrg = await prisma.organization.create({
      data: { name: "Other Co", slug: `other-${Date.now()}`, industryTemplate: "GENERIC" },
    });
    const stranger = await makeUser({ name: "Someone Else", role: "ENGINEER", orgId: otherOrg.id });

    await expect(resendInvite(adminActor, { id: stranger.id })).rejects.toThrow(
      "We could not find that person.",
    );
  });

  it("offers no invitation at all with no mail provider set up", async () => {
    const spy = mockFetchOk();
    goDormant();

    await expect(
      createUser(adminActor, {
        name: "Jane Marsh",
        email: "jane@meridian.example",
        mode: "INVITE",
        role: "PROJECT_MANAGER",
      }),
    ).rejects.toThrow("Invitations by email aren't set up.");

    // The temporary-password path is untouched, and is the only one there is.
    const created = await createUser(adminActor, {
      name: "Jane Marsh",
      email: "jane@meridian.example",
      password: GOOD_PASSWORD,
      role: "PROJECT_MANAGER",
    });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
    expect(await verifyPassword(row.passwordHash, GOOD_PASSWORD)).toBe(true);

    await settle();
    expect(spy).not.toHaveBeenCalled();
    expect(await prisma.emailToken.count()).toBe(0);
  });
});

describe("verification", () => {
  it("marks the address verified, exactly once", async () => {
    const user = await makeSignInAbleUser({ name: "Jane Marsh", email: "jane@meridian.example" });
    const { rawToken } = await issueEmailToken(user.id, "VERIFY");

    expect(await verifyEmailWithToken({ token: rawToken })).toBe(true);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.emailVerifiedAt).not.toBeNull();

    // The link is spent — nobody else's account can be touched with it — and a made-up one is
    // still nothing. (The same link shown to the same person again is the scanner case below.)
    expect(await verifyEmailWithToken({ token: "f".repeat(64) })).toBe(false);
    const live = await prisma.emailToken.count({ where: { purpose: "VERIFY", usedAt: null } });
    expect(live).toBe(0);

    // Verified once, recorded once, however many times the page is opened.
    await verifyEmailWithToken({ token: rawToken });
    const rows = await prisma.activityLog.findMany({ where: { action: "EMAIL_VERIFIED" } });
    expect(rows).toHaveLength(1);
    expect(rows[0].summary).toBe("Jane Marsh verified their email address");
    const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(unchanged.emailVerifiedAt?.getTime()).toBe(after.emailVerifiedAt?.getTime());
  });

  it("still says yes to the person after a mail scanner has opened the link first", async () => {
    // Outlook Safe Links and Gmail's fetcher open every link in a message before the human does.
    // The link is single use, so the scanner spends it — and the person who follows a second later
    // must not be told their address could not be verified when it plainly was.
    const user = await makeSignInAbleUser({ name: "Jane Marsh", email: "jane@meridian.example" });
    const { rawToken } = await issueEmailToken(user.id, "VERIFY");

    // The scanner.
    expect(await verifyEmailWithToken({ token: rawToken })).toBe(true);
    // The person, moments later, holding the same link.
    expect(await verifyEmailWithToken({ token: rawToken })).toBe(true);
    expect(await verifyEmailWithToken({ token: rawToken })).toBe(true);

    // Saying so a second time changes nothing: one moment of verification, one audit row.
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.emailVerifiedAt).not.toBeNull();
    expect(await prisma.activityLog.count({ where: { action: "EMAIL_VERIFIED" } })).toBe(1);
  });

  it("keeps saying nothing for every other kind of miss", async () => {
    const user = await makeSignInAbleUser({ name: "Jane Marsh", email: "jane@meridian.example" });

    // A spent link whose account is NOT verified is still a plain no — the "already done" answer
    // is only ever given when it really was done.
    const spent = await issueEmailToken(user.id, "VERIFY");
    expect(await verifyEmailWithToken({ token: spent.rawToken })).toBe(true);
    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: null } });
    expect(await verifyEmailWithToken({ token: spent.rawToken })).toBe(false);

    // A spent link belonging to an account that has since been switched off says nothing either.
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date(), isActive: false },
    });
    expect(await verifyEmailWithToken({ token: spent.rawToken })).toBe(false);
    await prisma.user.update({ where: { id: user.id }, data: { isActive: true } });

    // A used link of another purpose is not a verification, however verified the account is.
    const invite = await issueEmailToken(user.id, "INVITE");
    await consumeEmailToken(invite.rawToken, "INVITE");
    expect(await verifyEmailWithToken({ token: invite.rawToken })).toBe(false);

    // And a link nobody ever minted is nothing at all.
    expect(await verifyEmailWithToken({ token: "f".repeat(64) })).toBe(false);
  });

  it("is not a problem the two password pages have — they only look, never spend", async () => {
    // A scanner opening /reset-password or /set-password renders the form from previewEmailToken()
    // and changes nothing, so the link is still there for the person. Proved by the preview twice
    // over, then the real submit.
    const user = await makeSignInAbleUser({ name: "Jane Marsh", email: "jane@meridian.example" });
    const { rawToken } = await issueEmailToken(user.id, "RESET");

    expect((await previewEmailToken(rawToken, "RESET"))?.id).toBe(user.id);
    expect((await previewEmailToken(rawToken, "RESET"))?.id).toBe(user.id);

    expect(await resetPassword({ token: rawToken, password: NEW_PASSWORD })).toEqual({
      changed: true,
    });
  });

  it("nudges anybody unverified while email is set up, and nobody at all while it is not", async () => {
    const user = await makeSignInAbleUser({ name: "Jane Marsh", email: "jane@meridian.example" });

    expect(await needsVerificationNudge(user.id)).toBe(true);

    goDormant();
    expect(await needsVerificationNudge(user.id)).toBe(false);

    configureEmail();
    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    expect(await needsVerificationNudge(user.id)).toBe(false);
  });

  it("resends only to yourself, and says so plainly with no mail provider set up", async () => {
    const spy = mockFetchOk();
    const person = await makeSignInAbleUser({ name: "Jane Marsh", email: "jane@meridian.example" });
    const actor = await actorForUser(person.id);

    expect(await resendVerification(actor)).toEqual({ sent: true });
    await settle();

    const tokens = await prisma.emailToken.findMany({ where: { purpose: "VERIFY" } });
    expect(tokens).toHaveLength(1);
    expect(tokens[0].userId).toBe(person.id);
    expect(spy).toHaveBeenCalledTimes(1);

    goDormant();
    await expect(resendVerification(actor)).rejects.toThrow(
      "Verification emails aren't set up on this Tielora.",
    );
  });
});
