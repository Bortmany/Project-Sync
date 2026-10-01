// A person's own email choices: alerts, the daily brief and the weekly brief.
//
// The rules being proved here:
//  - an existing row is all off (the column default), while every NEW account — invited, created by
//    an administrator with a temporary password, or a company's self-serve first administrator —
//    starts with alerts on and both briefs off, set by the code that creates it;
//  - a change that changes something writes one EMAIL_PREFERENCES_CHANGED row with
//    `{ changed, via: "account" }`, and one that changes nothing writes none — and never a token;
//  - a contractor's two brief flags are ignored;
//  - alerts switched on still reach nobody at an unconfirmed address;
//  - the Email card's server data says `available: false` while email is not set up;
//  - the action is rate limited, thirty presses a minute per person.
//
// No test here touches the network: global.fetch is replaced.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.SWEEP_DISABLED = "1";

const jar = vi.hoisted(() => new Map<string, { value: string; options?: Record<string, unknown> }>());
vi.mock("next/headers", async () => {
  const fixtures = await import("@/server/__tests__/microsoft-signin-fixtures");
  return fixtures.cookieJarModule(jar);
});
// Server actions call revalidatePath, which needs a live Next.js request.
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { SESSION_COOKIE, mintSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { unsubscribeToken } from "@/lib/unsubscribe-token";
import type { SignupInput } from "@/lib/zod-schemas";
import { setEmailPreferences as setEmailPreferencesAction } from "@/server/actions/email-preferences";
import { actorForUser } from "@/server/actor";
import { ServiceError } from "@/server/errors";
import { ACTIVITY } from "@/server/services/activity";
import { createUser } from "@/server/services/admin";
import { emailPreferencesFor, setEmailPreferences } from "@/server/services/email-preferences";
import { notify } from "@/server/services/notify";
import { signUpOrganization } from "@/server/services/signup";
import {
  configureEmail,
  goDormant,
  mockFetchOk,
  optIn,
  sentEmails,
  settle,
} from "@/server/__tests__/email-harness";
import { makeProjectFixture, makeUser, resetDatabase, type Fixture } from "@/server/__tests__/harness";

let fixture: Fixture;

beforeEach(async () => {
  await resetDatabase();
  jar.clear();
  fixture = await makeProjectFixture();
});

afterEach(() => {
  goDormant();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const choicesOf = (userId: string) =>
  prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { emailAlerts: true, emailDailyBrief: true, emailWeeklyBrief: true },
  });

const preferenceRows = (userId: string) =>
  prisma.activityLog.findMany({
    where: { actorId: userId, action: ACTIVITY.EMAIL_PREFERENCES_CHANGED },
    orderBy: { createdAt: "asc" },
  });

/* ------------------------------------------------------------------ */
/* Where everybody starts                                              */
/* ------------------------------------------------------------------ */

describe("the starting choices", () => {
  it("leaves an existing row all off — the migration switched nobody on", async () => {
    // makeUser writes the row directly, as every account made before this build was written.
    const existing = await makeUser({ name: "Old Timer", role: "ENGINEER", orgId: fixture.orgId });
    expect(await choicesOf(existing.id)).toEqual({
      emailAlerts: false,
      emailDailyBrief: false,
      emailWeeklyBrief: false,
    });
  });

  it("starts an invited person with alerts on and both briefs off", async () => {
    configureEmail();
    mockFetchOk();
    const invited = await createUser(fixture.adminActor, {
      name: "Fatma al-Balushi",
      email: "fatma@meridian.example",
      mode: "INVITE",
      role: "ENGINEER",
      disciplineId: fixture.disciplineId,
    });
    expect(await choicesOf(invited.id)).toEqual({
      emailAlerts: true,
      emailDailyBrief: false,
      emailWeeklyBrief: false,
    });
    await settle();
  });

  it("starts a person an administrator created with a temporary password the same way", async () => {
    const created = await createUser(fixture.adminActor, {
      name: "Hamed al-Rawahi",
      email: "hamed@meridian.example",
      mode: "PASSWORD",
      password: "a temporary pass phrase",
      role: "PROJECT_MANAGER",
    });
    expect(await choicesOf(created.id)).toEqual({
      emailAlerts: true,
      emailDailyBrief: false,
      emailWeeklyBrief: false,
    });
  });

  it("starts a company's self-serve first administrator the same way", async () => {
    const email = `aisha.${Math.random().toString(36).slice(2)}@northern.example`;
    await signUpOrganization({
      organizationName: "Northern Works",
      industryTemplate: "OIL_AND_GAS",
      name: "Aisha al-Kindi",
      email,
      password: "correct horse battery staple",
    } as SignupInput);
    const admin = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true, role: true } });
    expect(admin.role).toBe("ADMIN");
    expect(await choicesOf(admin.id)).toEqual({
      emailAlerts: true,
      emailDailyBrief: false,
      emailWeeklyBrief: false,
    });
  });
});

/* ------------------------------------------------------------------ */
/* Changing them from Your account                                     */
/* ------------------------------------------------------------------ */

describe("changing your own choices", () => {
  it("records a change that changes something, and nothing for one that does not", async () => {
    const me = fixture.engineerActor;

    const saved = await setEmailPreferences(me, { emailAlerts: true, emailWeeklyBrief: false });
    expect(saved.emailAlerts).toBe(true);
    // Only alerts moved: the weekly brief was already off.
    let rows = await preferenceRows(me.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.metadata).toEqual({ changed: { emailAlerts: true }, via: "account" });
    expect(rows[0]!.entityId).toBe(me.userId);
    expect(rows[0]!.projectId).toBeNull();

    // The same values again: nothing moves, nothing is written.
    await setEmailPreferences(me, { emailAlerts: true });
    await setEmailPreferences(me, { emailAlerts: true, emailDailyBrief: false });
    rows = await preferenceRows(me.userId);
    expect(rows).toHaveLength(1);

    // A second real change is a second row, naming only what moved.
    await setEmailPreferences(me, { emailAlerts: false, emailDailyBrief: true });
    rows = await preferenceRows(me.userId);
    expect(rows).toHaveLength(2);
    expect(rows[1]!.metadata).toEqual({
      changed: { emailAlerts: false, emailDailyBrief: true },
      via: "account",
    });
  });

  it("never writes a token, a link or an address into the audit trail", async () => {
    const me = fixture.engineerActor;
    await setEmailPreferences(me, { emailAlerts: true, emailDailyBrief: true, emailWeeklyBrief: true });
    const row = (await preferenceRows(me.userId))[0]!;
    const text = JSON.stringify(row);
    expect(text).not.toContain(unsubscribeToken(me.userId, "ALERTS")!);
    expect(text).not.toContain(me.email);
    expect(text).not.toContain("?t=");
  });

  it("changes only the signed-in person's own row", async () => {
    await setEmailPreferences(fixture.engineerActor, { emailAlerts: true });
    expect((await choicesOf(fixture.engineerActor.userId)).emailAlerts).toBe(true);
    for (const other of [fixture.adminActor, fixture.pmActor, fixture.outsiderActor]) {
      expect((await choicesOf(other.userId)).emailAlerts).toBe(false);
    }
  });

  it("refuses an empty change and an unknown field", async () => {
    await expect(setEmailPreferences(fixture.engineerActor, {})).rejects.toBeInstanceOf(ServiceError);
    await expect(
      setEmailPreferences(fixture.engineerActor, { emailAlerts: true, userId: fixture.adminActor.userId }),
    ).rejects.toBeInstanceOf(ServiceError);
    expect(await preferenceRows(fixture.engineerActor.userId)).toHaveLength(0);
  });

  it("ignores a contractor's two brief switches, and records nothing for them", async () => {
    const contractor = await makeUser({ name: "Yusuf Contractor", role: "EXTERNAL", orgId: fixture.orgId });
    const actor = await actorForUser(contractor.id);

    const saved = await setEmailPreferences(actor, { emailDailyBrief: true, emailWeeklyBrief: true });
    expect(saved.emailDailyBrief).toBe(false);
    expect(saved.emailWeeklyBrief).toBe(false);
    expect(await choicesOf(contractor.id)).toEqual({
      emailAlerts: false,
      emailDailyBrief: false,
      emailWeeklyBrief: false,
    });
    expect(await preferenceRows(contractor.id)).toHaveLength(0);

    // Alerts are theirs to change like anybody's.
    await setEmailPreferences(actor, { emailAlerts: true, emailDailyBrief: true });
    expect(await choicesOf(contractor.id)).toEqual({
      emailAlerts: true,
      emailDailyBrief: false,
      emailWeeklyBrief: false,
    });
    const rows = await preferenceRows(contractor.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.metadata).toEqual({ changed: { emailAlerts: true }, via: "account" });

    // And a value forced into the row is read back as off.
    await prisma.user.update({ where: { id: contractor.id }, data: { emailDailyBrief: true } });
    expect((await emailPreferencesFor(actor)).emailDailyBrief).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Who is actually sent anything                                       */
/* ------------------------------------------------------------------ */

describe("an unconfirmed address", () => {
  it("is never emailed, even with alerts switched on", async () => {
    configureEmail();
    const spy = mockFetchOk();
    await optIn(fixture.engineerActor.userId, { alerts: true, verified: false });
    const confirmedEmail = await optIn(fixture.pmActor.userId, { alerts: true });

    await notify(
      { userId: fixture.adminActor.userId, orgId: fixture.orgId },
      [fixture.engineerActor.userId, fixture.pmActor.userId],
      "ASSIGNED",
      { title: "New task assigned to you", body: "You were given a task.", linkUrl: "/my-tasks" },
    );
    await vi.waitFor(() => expect(sentEmails(spy)).toHaveLength(1));
    await settle();

    // The confirmed colleague is emailed; the unconfirmed engineer only has the in-app row.
    expect(sentEmails(spy).map((email) => email.to)).toEqual([[confirmedEmail]]);
    expect(await prisma.notification.count({ where: { userId: fixture.engineerActor.userId } })).toBe(1);
  });

  it("is told so on the card, which also says which address it is", async () => {
    configureEmail();
    await optIn(fixture.engineerActor.userId, { alerts: true, verified: false });
    const card = await emailPreferencesFor(fixture.engineerActor);
    expect(card).toMatchObject({ emailAlerts: true, verified: false, available: true });
    expect(card.email).toBe(fixture.engineerActor.email);
  });
});

describe("the Email card's server data", () => {
  it("says email is not available while it is not set up", async () => {
    goDormant();
    expect((await emailPreferencesFor(fixture.engineerActor)).available).toBe(false);
    configureEmail();
    expect((await emailPreferencesFor(fixture.engineerActor)).available).toBe(true);
  });

  it("is only ever your own", async () => {
    await optIn(fixture.pmActor.userId, { alerts: true, daily: true });
    const mine = await emailPreferencesFor(fixture.engineerActor);
    expect(mine).toMatchObject({ emailAlerts: false, emailDailyBrief: false });
    expect(mine.email).toBe(fixture.engineerActor.email);
  });
});

/* ------------------------------------------------------------------ */
/* The action                                                          */
/* ------------------------------------------------------------------ */

describe("the setEmailPreferences action", () => {
  async function signInAs(userId: string): Promise<void> {
    const minted = mintSession();
    await prisma.session.create({
      data: { tokenHash: minted.tokenHash, userId, expiresAt: minted.expiresAt },
    });
    jar.set(SESSION_COOKIE, { value: minted.rawToken });
  }

  it("saves for the signed-in person, and refuses the 31st press in a minute", async () => {
    await signInAs(fixture.engineerActor.userId);

    const first = await setEmailPreferencesAction({ emailAlerts: true });
    expect(first.ok).toBe(true);

    for (let press = 2; press <= 30; press += 1) {
      const result = await setEmailPreferencesAction({ emailAlerts: press % 2 === 1 });
      expect(result.ok).toBe(true);
    }
    const refused = await setEmailPreferencesAction({ emailAlerts: true });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toMatch(/Please wait \d+ seconds/);

    // The limit is per person: a colleague presses freely.
    jar.clear();
    await signInAs(fixture.pmActor.userId);
    expect((await setEmailPreferencesAction({ emailAlerts: true })).ok).toBe(true);
  });

  it("refuses a signed-out caller and changes nothing", async () => {
    const result = await setEmailPreferencesAction({ emailAlerts: true });
    expect(result.ok).toBe(false);
    expect(await prisma.activityLog.count({ where: { action: ACTIVITY.EMAIL_PREFERENCES_CHANGED } })).toBe(0);
  });
});
