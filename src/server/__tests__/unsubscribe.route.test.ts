// One-click unsubscribe, through the real route handlers and the real page.
//
// The rules being proved here:
//  - a POST carrying the RFC 8058 body and a genuine token switches off ONLY that kind of email for
//    ONLY that person, and records it once with `via: "unsubscribe-link"`;
//  - pressing it again changes nothing and records nothing;
//  - a GET never unsubscribes anybody — it only sends the visitor on to the page (303);
//  - a genuine, a tampered, an old-format and a deactivated account's token all get the same status
//    and the same bytes back, so the route never says which one it was;
//  - the /unsubscribe page shows the same words for a genuine token, a tampered one and none;
//  - the ceiling is 300 a minute per address.
//
// No test here touches the network.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.SWEEP_DISABLED = "1";

const incoming = vi.hoisted(() => ({ ip: "198.51.100.1" }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": incoming.ip, "user-agent": "vitest" }),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));

import { renderToStaticMarkup } from "react-dom/server";
import { GET, POST } from "@/app/api/email/unsubscribe/route";
import { default as UnsubscribePage } from "@/app/(auth)/unsubscribe/page";
import { prisma } from "@/lib/db";
import { UNSUBSCRIBE_DONE_MESSAGE, UNSUBSCRIBE_LIMIT } from "@/lib/email-text";
import { byIp, limit } from "@/lib/rate-limit";
import { unsubscribeToken } from "@/lib/unsubscribe-token";
import type { UnsubscribeKindName } from "@/lib/zod-schemas";
import { ACTIVITY } from "@/server/services/activity";
import { EMAIL_BASE, configureEmail, goDormant, optIn } from "@/server/__tests__/email-harness";
import { makeProjectFixture, resetDatabase, type Fixture } from "@/server/__tests__/harness";

const ONE_CLICK_BODY = "List-Unsubscribe=One-Click";

let fixture: Fixture;
let ipCounter = 0;

function nextIp(): string {
  ipCounter += 1;
  return `203.0.113.${ipCounter % 250}`;
}

function tokenFor(userId: string, kind: UnsubscribeKindName): string {
  const token = unsubscribeToken(userId, kind);
  if (!token) throw new Error("SESSION_SECRET must be set for these tests");
  return token;
}

function oneClick(token: string | null, ip = nextIp()): Request {
  const query = token === null ? "" : `?t=${encodeURIComponent(token)}`;
  return new Request(`http://localhost/api/email/unsubscribe${query}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-forwarded-for": ip,
      "user-agent": "vitest",
    },
    body: ONE_CLICK_BODY,
  });
}

const choicesOf = (userId: string) =>
  prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { emailAlerts: true, emailDailyBrief: true, emailWeeklyBrief: true },
  });

const unsubscribeRows = () =>
  prisma.activityLog.findMany({ where: { action: ACTIVITY.EMAIL_PREFERENCES_CHANGED } });

/** What the page shows a person: its words, with the markup and the form's address taken away. */
async function pageWords(t?: string): Promise<string> {
  const element = await UnsubscribePage({ searchParams: Promise.resolve(t === undefined ? {} : { t }) });
  return renderToStaticMarkup(element)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

beforeEach(async () => {
  await resetDatabase();
  configureEmail();
  fixture = await makeProjectFixture();
});

afterEach(() => {
  goDormant();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.$disconnect();
});

/* ------------------------------------------------------------------ */
/* The one-click POST                                                  */
/* ------------------------------------------------------------------ */

describe("a one-click unsubscribe", () => {
  it("switches off only that kind, for only that person, and records it once", async () => {
    const engineer = fixture.engineerActor.userId;
    const colleague = fixture.pmActor.userId;
    await optIn(engineer, { alerts: true, daily: true, weekly: true });
    await optIn(colleague, { alerts: true, daily: true, weekly: true });

    const response = await POST(oneClick(tokenFor(engineer, "DAILY")));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(UNSUBSCRIBE_DONE_MESSAGE);

    expect(await choicesOf(engineer)).toEqual({
      emailAlerts: true,
      emailDailyBrief: false,
      emailWeeklyBrief: true,
    });
    expect(await choicesOf(colleague)).toEqual({
      emailAlerts: true,
      emailDailyBrief: true,
      emailWeeklyBrief: true,
    });

    const rows = await unsubscribeRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorId).toBe(engineer);
    expect(rows[0]!.entityId).toBe(engineer);
    expect(rows[0]!.metadata).toEqual({ changed: { emailDailyBrief: false }, via: "unsubscribe-link" });
    // Never the token.
    expect(JSON.stringify(rows[0])).not.toContain(tokenFor(engineer, "DAILY"));
  });

  it("changes nothing and records nothing the second time", async () => {
    const engineer = fixture.engineerActor.userId;
    await optIn(engineer, { alerts: true });
    const token = tokenFor(engineer, "ALERTS");

    const first = await POST(oneClick(token));
    const second = await POST(oneClick(token));

    expect(second.status).toBe(first.status);
    expect(await second.text()).toBe(await first.text());
    expect((await choicesOf(engineer)).emailAlerts).toBe(false);
    expect(await unsubscribeRows()).toHaveLength(1);
  });

  it("answers every token alike — genuine, tampered, old-format, deactivated or missing", async () => {
    const live = fixture.engineerActor.userId;
    const gone = fixture.outsiderActor.userId;
    await optIn(live, { alerts: true });
    await optIn(gone, { alerts: true });
    await prisma.user.update({ where: { id: gone }, data: { isActive: false } });

    const genuine = tokenFor(live, "ALERTS");
    const lastChar = genuine.at(-1) === "A" ? "B" : "A";
    const tampered = `${genuine.slice(0, -1)}${lastChar}`;
    // Another person's id under this person's signature, and another kind under it.
    const swappedPerson = `${gone}.${genuine.split(".").slice(1).join(".")}`;
    const swappedKind = genuine.replace(".ALERTS.", ".DAILY.");
    // An old single-use link's shape: 64 hex characters, no parts at all.
    const oldFormat = "a".repeat(64);
    const deactivated = tokenFor(gone, "ALERTS");

    const answers: { status: number; body: string; type: string | null }[] = [];
    for (const token of [genuine, tampered, swappedPerson, swappedKind, oldFormat, deactivated, "", null]) {
      const response = await POST(oneClick(token));
      answers.push({
        status: response.status,
        body: await response.text(),
        type: response.headers.get("content-type"),
      });
    }

    for (const answer of answers) expect(answer).toEqual(answers[0]);
    expect(answers[0]).toMatchObject({ status: 200, body: UNSUBSCRIBE_DONE_MESSAGE });

    // Only the genuine one did anything; the deactivated account was left alone.
    expect((await choicesOf(live)).emailAlerts).toBe(false);
    expect((await choicesOf(gone)).emailAlerts).toBe(true);
    expect(await unsubscribeRows()).toHaveLength(1);
  });

  it("sends a no-token press from the page's own form back to the page, reaching nobody", async () => {
    // The page's form carries the token in the address; without one there is nobody to reach.
    const response = await POST(
      new Request("http://localhost/api/email/unsubscribe", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": nextIp() },
        body: "confirm=yes",
      }),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${EMAIL_BASE}/unsubscribe?done=1`);
    expect(await unsubscribeRows()).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* A GET — what a mail scanner does                                    */
/* ------------------------------------------------------------------ */

describe("opening the link", () => {
  it("never unsubscribes anybody, and sends them on to the page with the button", async () => {
    const engineer = fixture.engineerActor.userId;
    await optIn(engineer, { alerts: true, daily: true });
    const token = tokenFor(engineer, "ALERTS");

    const response = await GET(
      new Request(`http://localhost/api/email/unsubscribe?t=${encodeURIComponent(token)}`, {
        headers: { "x-forwarded-for": nextIp() },
      }),
    );

    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin).toBe(EMAIL_BASE);
    expect(location.pathname).toBe("/unsubscribe");
    expect(location.searchParams.get("t")).toBe(token);

    expect(await choicesOf(engineer)).toEqual({
      emailAlerts: true,
      emailDailyBrief: true,
      emailWeeklyBrief: false,
    });
    expect(await unsubscribeRows()).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* The page                                                            */
/* ------------------------------------------------------------------ */

describe("the /unsubscribe page", () => {
  it("says the same words for a genuine token, a tampered one and none, and changes nothing", async () => {
    const engineer = fixture.engineerActor.userId;
    await optIn(engineer, { alerts: true });
    const genuine = tokenFor(engineer, "ALERTS");
    const tampered = `${genuine.slice(0, -2)}xx`;

    incoming.ip = nextIp();
    const words = await pageWords(genuine);
    expect(words).toContain("Stop these emails?");
    expect(words).toContain("Press the button to confirm.");
    expect(words).toContain("Unsubscribe");
    expect(await pageWords(tampered)).toBe(words);
    expect(await pageWords()).toBe(words);
    expect(await pageWords("a".repeat(64))).toBe(words);

    // Looking at the page is not pressing the button.
    expect((await choicesOf(engineer)).emailAlerts).toBe(true);
    expect(await unsubscribeRows()).toHaveLength(0);
  });

  it("never names the person, their address or their company", async () => {
    await optIn(fixture.engineerActor.userId, { alerts: true });
    incoming.ip = nextIp();
    const html = renderToStaticMarkup(
      await UnsubscribePage({
        searchParams: Promise.resolve({ t: tokenFor(fixture.engineerActor.userId, "ALERTS") }),
      }),
    );
    expect(html).not.toContain(fixture.engineerActor.name);
    expect(html).not.toContain(fixture.engineerActor.email);
  });
});

/* ------------------------------------------------------------------ */
/* The ceiling                                                         */
/* ------------------------------------------------------------------ */

describe("the rate limit", () => {
  it("allows 300 a minute from one address and refuses the next with a calm sentence", async () => {
    const ip = "192.0.2.199";
    expect(UNSUBSCRIBE_LIMIT).toBe(300);
    // Spend 299 of this address's minute on the route's own key, then the 300th is still served.
    const key = byIp(oneClick(null, ip), "email-unsubscribe");
    for (let i = 0; i < UNSUBSCRIBE_LIMIT - 1; i += 1) expect(limit(key, UNSUBSCRIBE_LIMIT, 60_000).ok).toBe(true);

    const last = await POST(oneClick(tokenFor(fixture.engineerActor.userId, "ALERTS"), ip));
    expect(last.status).toBe(200);

    const refused = await POST(oneClick(tokenFor(fixture.engineerActor.userId, "ALERTS"), ip));
    expect(refused.status).toBe(429);
    expect(refused.headers.get("Retry-After")).toBeTruthy();
    expect(await refused.text()).toMatch(/Wait a minute/);

    // Another address is untouched.
    expect((await POST(oneClick(null, "192.0.2.200"))).status).toBe(200);
  });

  it("holds the page to the same ceiling, showing the calm sentence instead of the button's promise", async () => {
    incoming.ip = "192.0.2.201";
    const key = byIp(
      new Request("https://tielora.local/unsubscribe", {
        headers: new Headers({ "x-forwarded-for": incoming.ip }),
      }),
      "unsubscribe-page",
    );
    for (let i = 0; i < UNSUBSCRIBE_LIMIT; i += 1) limit(key, UNSUBSCRIBE_LIMIT, 60_000);
    expect(await pageWords()).toMatch(/Too many tries just now/);
  });
});
