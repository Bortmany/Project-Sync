// Service-level tests for transactional email and the single-use links it carries.
//
// The rules being proved: with no keys set nothing is sent and nothing else changes; with keys set
// the message goes to Resend in the shape Resend expects; a "too many requests" answer is retried
// exactly once at the pace the provider asked for; a failure is logged and never thrown; a link
// works exactly once, only for its own purpose, only while it is live, and a fresh one retires the
// old; and the audit row records the kind and the recipient — never the token, never the address.
//
// No test here touches the network: global.fetch is replaced everywhere it would be called.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { EmailPurposeSchema, EmailTokenSchema } from "@/lib/zod-schemas";
import {
  appendEmailActivity,
  emailAvailable,
  emailConfigured,
  emailLink,
  emailRetryAfterMs,
  emailStatus,
  sendEmail,
  sendInviteEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "@/server/services/email";
import {
  EMAIL_TOKEN_TTL_MS,
  consumeEmailToken,
  hashEmailToken,
  issueEmailToken,
  previewEmailToken,
} from "@/server/services/email-tokens";
import { makeUser, resetDatabase } from "@/server/__tests__/harness";

process.env.SWEEP_DISABLED = "1";

const API_KEY = "re_Sup3rSecretResendKeyValue";
const FROM = "Tielora <no-reply@tielora.example>";
const BASE = "https://tielora.example";

let person: { id: string; name: string; orgId: string };
let personEmail: string;

/** Turns the whole feature on for one test. */
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

/** Replaces the network with a spy that always answers 200 OK, like Resend does. */
function mockFetchOk() {
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify({ id: "msg_1" }), { status: 200 }));
}

/** The parsed JSON body of the nth (default first) call to the mocked fetch. */
function sentBody(spy: ReturnType<typeof mockFetchOk>, call = 0): Record<string, unknown> {
  const init = spy.mock.calls[call][1] as RequestInit;
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

beforeEach(async () => {
  await resetDatabase();
  person = await makeUser({ name: "Jane Marsh", role: "ENGINEER" });
  const row = await prisma.user.findUniqueOrThrow({
    where: { id: person.id },
    select: { email: true },
  });
  personEmail = row.email;
  goDormant();
});

afterEach(() => {
  vi.restoreAllMocks();
  goDormant();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const recipient = () => ({ id: person.id, name: person.name, email: personEmail });

/* ------------------------------------------------------------------ */

describe("dormant until it is keyed", () => {
  it("needs both mail variables before it counts as configured", () => {
    expect(emailConfigured()).toBe(false);

    process.env.RESEND_API_KEY = API_KEY;
    expect(emailConfigured()).toBe(false);

    process.env.EMAIL_FROM = FROM;
    expect(emailConfigured()).toBe(true);
  });

  it("still reads as dormant when there is no address to build a link from", () => {
    process.env.RESEND_API_KEY = API_KEY;
    process.env.EMAIL_FROM = FROM;

    // Keys but no APP_BASE_URL: every one of these emails exists to carry a link, so a link with
    // nowhere to point is treated as "not set up" rather than as a broken email.
    expect(emailConfigured()).toBe(true);
    expect(emailAvailable()).toBe(false);
    expect(emailStatus()).toBe("dormant");
    expect(emailLink("RESET", "abc")).toBeNull();

    process.env.APP_BASE_URL = BASE;
    expect(emailAvailable()).toBe(true);
    expect(emailStatus()).toBe("configured");
  });

  it("sends nothing at all, and says so, while dormant", async () => {
    const spy = mockFetchOk();

    expect(await sendEmail({ to: personEmail, subject: "Hello", text: "Hi" })).toEqual({
      status: "dormant",
    });
    expect(await sendInviteEmail({ ...recipient(), inviterName: "Sam", organizationName: "Acme" }, "https://x/y")).toEqual({
      status: "dormant",
    });
    expect(await sendPasswordResetEmail(recipient(), "https://x/y")).toEqual({ status: "dormant" });
    expect(await sendVerificationEmail(recipient(), "https://x/y")).toEqual({ status: "dormant" });

    expect(spy).not.toHaveBeenCalled();
  });

  it("still issues and consumes links while dormant — tokens are not the email", async () => {
    // The flows on top of this can be built and tested before anybody buys a mail provider; only
    // the delivery half is switched off.
    const { rawToken } = await issueEmailToken(person.id, "RESET");
    const consumed = await consumeEmailToken(rawToken, "RESET");
    expect(consumed?.id).toBe(person.id);
  });
});

describe("what actually goes to Resend", () => {
  beforeEach(() => configureEmail());

  it("posts one plain-text message in the shape Resend expects", async () => {
    const spy = mockFetchOk();
    const link = emailLink("RESET", "a".repeat(64));
    expect(link).toBe(`${BASE}/reset-password?token=${"a".repeat(64)}`);

    const outcome = await sendPasswordResetEmail(recipient(), link as string);

    expect(outcome).toEqual({ status: "sent" });
    expect(spy).toHaveBeenCalledTimes(1);

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${API_KEY}`);
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");

    const body = sentBody(spy);
    expect(body.from).toBe(FROM);
    expect(body.to).toEqual([personEmail]);
    expect(body.subject).toBe("Reset your Tielora password");
    expect(body.html).toBeUndefined();
    expect(String(body.text)).toContain("Tielora");
    expect(String(body.text)).toContain("Hi Jane Marsh,");
    expect(String(body.text)).toContain(link as string);
    expect(String(body.text)).toContain("This link expires in 1 hour.");
  });

  it("writes the invitation and verification copy the spec asks for", async () => {
    const spy = mockFetchOk();

    await sendInviteEmail(
      { ...recipient(), inviterName: "Layla al-Riyami", organizationName: "Meridian Energy" },
      `${BASE}/set-password?token=x`,
    );
    let body = sentBody(spy);
    expect(body.subject).toBe("You're invited to Tielora");
    expect(String(body.text)).toContain(
      "Layla al-Riyami has invited you to join Meridian Energy on Tielora.",
    );
    expect(String(body.text)).toContain("This link expires in 7 days.");

    await sendVerificationEmail(recipient(), `${BASE}/verify-email?token=x`);
    body = sentBody(spy, 1);
    expect(body.subject).toBe("Verify your Tielora email");
    expect(String(body.text)).toContain("This link expires in 24 hours.");
    expect(String(body.text)).toContain("Didn't sign up for Tielora? You can ignore this email.");
  });

  it("retries exactly once when Resend says too many requests", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("slow down", { status: 429, headers: { "retry-after": "0.01" } }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const outcome = await sendVerificationEmail(recipient(), `${BASE}/verify-email?token=x`);

    expect(outcome).toEqual({ status: "sent" });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("gives up after the one retry, and never throws", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("slow down", { status: 429, headers: { "retry-after": "0.01" } }));
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    const outcome = await sendPasswordResetEmail(recipient(), `${BASE}/reset-password?token=x`);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(outcome.status).toBe("failed");
    expect(warn).toHaveBeenCalled();
  });

  it("waits as long as it is asked to, never longer than ten seconds", () => {
    expect(emailRetryAfterMs("2")).toBe(2_000);
    expect(emailRetryAfterMs("600")).toBe(10_000);
    expect(emailRetryAfterMs(null)).toBe(1_000);
    expect(emailRetryAfterMs("nonsense")).toBe(1_000);
  });

  it("logs a failure without the key, the address or the link, and returns instead of throwing", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("connect ECONNREFUSED"));
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    const link = `${BASE}/reset-password?token=${"b".repeat(64)}`;
    const outcome = await sendPasswordResetEmail(recipient(), link);

    expect(outcome).toEqual({
      status: "failed",
      reason: "we could not reach the mail provider",
    });

    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain("RESET");
    expect(logged).toContain(person.id);
    expect(logged).not.toContain(API_KEY);
    expect(logged).not.toContain(FROM);
    expect(logged).not.toContain(personEmail);
    expect(logged).not.toContain("b".repeat(64));
  });
});

describe("the links themselves", () => {
  it("stores only a hash — the raw token is never in the database", async () => {
    const { rawToken, expiresAt } = await issueEmailToken(person.id, "INVITE");

    expect(EmailTokenSchema.safeParse(rawToken).success).toBe(true);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + EMAIL_TOKEN_TTL_MS.INVITE - 5_000);

    const rows = await prisma.emailToken.findMany({ where: { userId: person.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashEmailToken(rawToken));
    expect(JSON.stringify(rows)).not.toContain(rawToken);
  });

  it("works exactly once", async () => {
    const { rawToken } = await issueEmailToken(person.id, "RESET");

    expect((await consumeEmailToken(rawToken, "RESET"))?.id).toBe(person.id);
    expect(await consumeEmailToken(rawToken, "RESET")).toBeNull();
  });

  it("cannot be used for another purpose", async () => {
    const { rawToken } = await issueEmailToken(person.id, "RESET");

    expect(await consumeEmailToken(rawToken, "INVITE")).toBeNull();
    expect(await consumeEmailToken(rawToken, "VERIFY")).toBeNull();
    // Refused, not spent: the real link still works.
    expect((await consumeEmailToken(rawToken, "RESET"))?.id).toBe(person.id);
  });

  it("stops working once it has expired", async () => {
    const { rawToken } = await issueEmailToken(person.id, "RESET", -1_000);

    expect(await previewEmailToken(rawToken, "RESET")).toBeNull();
    expect(await consumeEmailToken(rawToken, "RESET")).toBeNull();
  });

  it("is retired the moment a fresh one of the same purpose is issued", async () => {
    const first = await issueEmailToken(person.id, "RESET");
    const second = await issueEmailToken(person.id, "RESET");

    expect(await consumeEmailToken(first.rawToken, "RESET")).toBeNull();
    expect((await consumeEmailToken(second.rawToken, "RESET"))?.id).toBe(person.id);

    // A different purpose is untouched by a reissue: an invitation in flight survives a reset.
    const invite = await issueEmailToken(person.id, "INVITE");
    await issueEmailToken(person.id, "RESET");
    expect((await consumeEmailToken(invite.rawToken, "INVITE"))?.id).toBe(person.id);
  });

  it("can be looked at without being used up", async () => {
    const { rawToken } = await issueEmailToken(person.id, "INVITE");

    const previewed = await previewEmailToken(rawToken, "INVITE");
    expect(previewed?.email).toBe(personEmail);
    expect(previewed?.emailVerifiedAt).toBeNull();
    expect(JSON.stringify(previewed)).not.toContain("passwordHash");

    // Rendering the page did not spend the link.
    expect((await consumeEmailToken(rawToken, "INVITE"))?.id).toBe(person.id);
  });

  it("answers the same nothing for a made-up token", async () => {
    expect(await consumeEmailToken("f".repeat(64), "RESET")).toBeNull();
    expect(await previewEmailToken("f".repeat(64), "RESET")).toBeNull();
  });

  it("refuses a link belonging to a deactivated account, without saying so", async () => {
    const { rawToken } = await issueEmailToken(person.id, "RESET");
    await prisma.user.update({ where: { id: person.id }, data: { isActive: false } });

    expect(await previewEmailToken(rawToken, "RESET")).toBeNull();
    expect(await consumeEmailToken(rawToken, "RESET")).toBeNull();
  });

  it("knows only the three purposes", () => {
    expect(EmailPurposeSchema.safeParse("INVITE").success).toBe(true);
    expect(EmailPurposeSchema.safeParse("RESET").success).toBe(true);
    expect(EmailPurposeSchema.safeParse("VERIFY").success).toBe(true);
    expect(EmailPurposeSchema.safeParse("MARKETING").success).toBe(false);
  });

  it("goes with the account when the account goes", async () => {
    await issueEmailToken(person.id, "RESET");
    await prisma.user.delete({ where: { id: person.id } });

    expect(await prisma.emailToken.count()).toBe(0);
  });
});

describe("the audit row behind an email", () => {
  it("records the kind and the recipient, and never the token or the address", async () => {
    const admin = await makeUser({ name: "Tielora Administrator", role: "ADMIN" });

    const rawToken = await prisma.$transaction(async (tx) => {
      const issued = await issueEmailToken(person.id, "INVITE", EMAIL_TOKEN_TTL_MS.INVITE, tx);
      await appendEmailActivity(tx, {
        actorId: admin.id,
        actorName: admin.name,
        recipientId: person.id,
        recipientName: person.name,
        purpose: "INVITE",
      });
      return issued.rawToken;
    });

    const rows = await prisma.activityLog.findMany({ where: { entityType: "Email" } });
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("EMAIL_SENT");
    expect(rows[0].entityId).toBe(person.id);
    expect(rows[0].projectId).toBeNull();
    expect(rows[0].summary).toBe("Tielora Administrator sent Jane Marsh an invitation email");
    expect(rows[0].metadata).toEqual({ kind: "INVITE", userId: person.id });

    const serialised = JSON.stringify(rows);
    expect(serialised).not.toContain(rawToken);
    expect(serialised).not.toContain(personEmail);
  });

  it("names a self-service email plainly, with no inviter", async () => {
    await prisma.$transaction(async (tx) => {
      await appendEmailActivity(tx, {
        actorId: person.id,
        recipientId: person.id,
        recipientName: person.name,
        purpose: "RESET",
      });
      await appendEmailActivity(tx, {
        actorId: person.id,
        recipientId: person.id,
        recipientName: person.name,
        purpose: "VERIFY",
      });
    });

    const rows = await prisma.activityLog.findMany({
      where: { entityType: "Email" },
      orderBy: { summary: "asc" },
    });
    expect(rows.map((row) => row.summary)).toEqual([
      "A password reset link was sent to Jane Marsh",
      "A verification email was sent to Jane Marsh",
    ]);
  });

  it("is rolled back with its transaction — the record of intent and the token stay together", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await issueEmailToken(person.id, "VERIFY", EMAIL_TOKEN_TTL_MS.VERIFY, tx);
        await appendEmailActivity(tx, {
          actorId: person.id,
          recipientId: person.id,
          recipientName: person.name,
          purpose: "VERIFY",
        });
        throw new Error("something later in the service failed");
      }),
    ).rejects.toThrow();

    expect(await prisma.emailToken.count()).toBe(0);
    expect(await prisma.activityLog.count({ where: { entityType: "Email" } })).toBe(0);
  });
});
