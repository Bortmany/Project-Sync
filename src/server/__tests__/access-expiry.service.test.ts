// CONTRACTOR ACCESS EXPIRY, proved end to end.
//
// An administrator can put a last day on an external contractor's account. Once it has passed the
// contractor is refused at the door — at `getSessionUser()` and at the login route — in exactly the
// words a deactivated account gets, and the sessions they still hold are dropped so a browser
// already open dies with the date. Extending the date lets them straight back in.
//
// Two rules ride alongside it and are proved here too: nobody but an EXTERNAL may carry a date at
// all, and the hourly sweep warns a company's own administrators a week before access ends —
// once per date, and again when the date moves.
//
// Only the cookie jar is stubbed; everything else is the real thing, against the test database.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/** The cookie jar next/headers would give a route. Replaced per test so each starts empty. */
const jar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const found = jar.get(name);
      return found ? { name, value: found } : undefined;
    },
    set: (name: string, value: string) => {
      jar.set(name, value);
    },
    delete: (name: string) => {
      jar.delete(name);
    },
  }),
}));

import { POST as login } from "@/app/api/auth/login/route";
import { isAccessExpired } from "@/lib/access-expiry";
import { createSession, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CreateUserInput, UpdateUserInput } from "@/lib/zod-schemas";
import type { ActorContext } from "@/server/actor";
import { createUser, updateUser } from "@/server/services/admin";
import { runSweepOnce } from "@/server/sweep";
import { makeProjectFixture, makeUser, resetDatabase, type Fixture } from "@/server/__tests__/harness";

const PASSWORD = "coordination-2026";
const DAY_MS = 24 * 60 * 60 * 1000;
const CONTRACTOR_COMPANY = "Al Hassan Engineering";

/** UTC midnight, `offset` days from today — exactly what the date field on the admin form sends. */
function day(offset: number): Date {
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(today + offset * DAY_MS);
}

let fixture: Fixture;
let admin: ActorContext;
let emailCounter = 0;

function nextEmail(): string {
  emailCounter += 1;
  return `contractor.${emailCounter}.${Math.random().toString(36).slice(2)}@partner.example`;
}

/** A contractor account made the way the admin screen makes one — through the service. */
async function makeContractor(accessExpiresAt: Date | null, email = nextEmail()) {
  return createUser(admin, {
    email,
    name: "Sami al-Harthy",
    password: PASSWORD,
    role: "EXTERNAL",
    companyName: CONTRACTOR_COMPANY,
    accessExpiresAt,
  });
}

let ipCounter = 0;

/** A sign-in attempt from an address nobody else in this file has used. */
async function signIn(email: string, password = PASSWORD) {
  ipCounter += 1;
  const response = await login(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `198.51.100.${ipCounter}`,
        "user-agent": "vitest",
      },
      body: JSON.stringify({ email, password }),
    }),
  );
  return { status: response.status, body: await response.json() };
}

beforeEach(async () => {
  await resetDatabase();
  jar.clear();
  fixture = await makeProjectFixture();
  admin = fixture.adminActor;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("a contractor whose access has ended is locked out", () => {
  it("is refused by getSessionUser, while one still inside their date is let in", async () => {
    const expired = await makeContractor(day(-2));
    const current = await makeContractor(day(30));

    await createSession(current.id);
    expect((await getSessionUser())?.id).toBe(current.id);

    jar.clear();
    await createSession(expired.id);
    expect(await getSessionUser()).toBeNull();
  });

  it("keeps the access-end day itself: they are refused the day after, not on it", async () => {
    const lastDayToday = await makeContractor(day(0));
    await createSession(lastDayToday.id);
    expect((await getSessionUser())?.id).toBe(lastDayToday.id);

    // The same account, one day later, is out — the rule is derived from the date, never stored.
    expect(isAccessExpired({ role: "EXTERNAL", accessExpiresAt: day(0) })).toBe(false);
    expect(
      isAccessExpired({ role: "EXTERNAL", accessExpiresAt: day(0) }, new Date(Date.now() + DAY_MS)),
    ).toBe(true);
  });

  it("drops the sessions they still hold, so an open browser dies with the date", async () => {
    const contractor = await makeContractor(day(5));
    await createSession(contractor.id);
    expect(await prisma.session.count({ where: { userId: contractor.id } })).toBe(1);

    // The administrator shortens the date to one that has passed — the manual "revoke now".
    await updateUser(admin, { id: contractor.id, accessExpiresAt: day(-1) });

    expect(await getSessionUser()).toBeNull();
    expect(await prisma.session.count({ where: { userId: contractor.id } })).toBe(0);
  });

  it("is turned away at sign-in in exactly the words a deactivated account gets", async () => {
    const expired = await makeContractor(day(-3));
    const deactivated = await createUser(admin, {
      email: nextEmail(),
      name: "Nadia Hassan",
      password: PASSWORD,
      role: "ENGINEER",
      disciplineId: fixture.disciplineId,
    });
    await updateUser(admin, { id: deactivated.id, isActive: false });

    const refusedContractor = await signIn(expired.email);
    const refusedColleague = await signIn(deactivated.email);

    expect(refusedContractor.status).toBe(401);
    expect(refusedContractor.body).toEqual(refusedColleague.body);
    // Nothing in the answer says which of the two it was, or that expiry exists at all.
    expect(JSON.stringify(refusedContractor.body).toLowerCase()).not.toContain("expir");
    expect(await prisma.session.count({ where: { userId: expired.id } })).toBe(0);
  });

  it("lets them straight back in once the date is extended", async () => {
    const contractor = await makeContractor(day(-1));
    expect((await signIn(contractor.email)).status).toBe(401);

    const extended = await updateUser(admin, { id: contractor.id, accessExpiresAt: day(14) });
    expect(extended.accessExpiresAt?.getTime()).toBe(day(14).getTime());

    const allowed = await signIn(contractor.email);
    expect(allowed.status).toBe(200);
    expect(allowed.body.ok).toBe(true);

    await createSession(contractor.id);
    expect((await getSessionUser())?.id).toBe(contractor.id);
  });

  it("clears the date completely when the administrator empties the field", async () => {
    const contractor = await makeContractor(day(-1));
    const forever = await updateUser(admin, { id: contractor.id, accessExpiresAt: null });

    expect(forever.accessExpiresAt).toBeNull();
    expect((await signIn(contractor.email)).status).toBe(200);
  });
});

describe("an access end date belongs to a contractor and to nobody else", () => {
  it("is refused by zod on any role but external", async () => {
    const base = {
      email: "engineer@tielora.example",
      name: "Priya Nair",
      password: PASSWORD,
      accessExpiresAt: day(10),
    };

    const internal = CreateUserInput.safeParse({ ...base, role: "ENGINEER" });
    expect(internal.success).toBe(false);
    expect(internal.success === false && internal.error.issues[0]?.path).toEqual(["accessExpiresAt"]);

    expect(CreateUserInput.safeParse({ ...base, role: "EXTERNAL", companyName: "Partner" }).success).toBe(
      true,
    );
    expect(
      UpdateUserInput.safeParse({ id: "abc", role: "PROJECT_MANAGER", accessExpiresAt: day(10) })
        .success,
    ).toBe(false);
    expect(UpdateUserInput.safeParse({ id: "abc", accessExpiresAt: day(10) }).success).toBe(true);
  });

  it("is cleared by the service when a date reaches somebody internal anyway", async () => {
    const engineer = await createUser(admin, {
      email: nextEmail(),
      name: "John Carter",
      password: PASSWORD,
      role: "ENGINEER",
      disciplineId: fixture.disciplineId,
    });

    // No role in the input, so zod cannot know — the service checks the role on the account.
    const saved = await updateUser(admin, { id: engineer.id, accessExpiresAt: day(-5) });
    expect(saved.accessExpiresAt).toBeNull();

    await createSession(engineer.id);
    expect((await getSessionUser())?.id).toBe(engineer.id);
  });

  it("is dropped when a contractor becomes a colleague", async () => {
    const contractor = await makeContractor(day(-2));
    const promoted = await updateUser(admin, {
      id: contractor.id,
      role: "ENGINEER",
      disciplineId: fixture.disciplineId,
      companyName: null,
    });

    expect(promoted.accessExpiresAt).toBeNull();
    expect((await signIn(contractor.email)).status).toBe(200);
  });

  it("never locks a colleague out, even with a stale date left on the row", async () => {
    const colleague = await makeUser({ name: "Layla Said", role: "PROJECT_MANAGER", orgId: fixture.orgId });
    await prisma.user.update({
      where: { id: colleague.id },
      data: { accessExpiresAt: day(-30) },
    });

    await createSession(colleague.id);
    expect((await getSessionUser())?.id).toBe(colleague.id);
  });
});

describe("the audit trail records that the date moved, never the date", () => {
  it("names the field in the summary and keeps the value out of the row", async () => {
    const contractor = await makeContractor(day(5));
    await updateUser(admin, { id: contractor.id, accessExpiresAt: day(20) });

    const row = await prisma.activityLog.findFirstOrThrow({
      where: { entityType: "User", entityId: contractor.id, action: "USER_UPDATED" },
      orderBy: { createdAt: "desc" },
    });

    expect(row.summary).toContain("access end date");
    expect(JSON.stringify(row)).not.toContain(day(20).toISOString().slice(0, 10));
  });
});

describe("the sweep warns the administrators before a contractor's access ends", () => {
  async function warnings(userId: string) {
    return prisma.notification.findMany({
      where: { type: "DEADLINE_APPROACHING", linkUrl: { contains: `expiring=${userId}` } },
      orderBy: { createdAt: "asc" },
    });
  }

  it("writes one notification per administrator, and never the same date twice", async () => {
    const secondAdmin = await makeUser({ name: "Huda al-Balushi", role: "ADMIN", orgId: fixture.orgId });
    const contractor = await makeContractor(day(3));

    const first = await runSweepOnce();
    expect(first.ran && first.counts.accessExpiring).toBe(2);

    const sent = await warnings(contractor.id);
    expect(sent.map((row) => row.userId).sort()).toEqual([admin.userId, secondAdmin.id].sort());
    expect(sent[0]?.title).toBe("A contractor's access is ending");
    expect(sent[0]?.linkUrl).toBe(
      `/admin/users?expiring=${contractor.id}&on=${day(3).toISOString().slice(0, 10)}`,
    );

    // Nobody else in the company hears about it — not the project manager, not the engineer.
    const others = sent.filter(
      (row) => row.userId !== admin.userId && row.userId !== secondAdmin.id,
    );
    expect(others).toEqual([]);

    const second = await runSweepOnce();
    expect(second.ran && second.counts.accessExpiring).toBe(0);
    expect((await warnings(contractor.id)).length).toBe(2); // still one each, not two each
  });

  it("earns a fresh warning when the date is extended, about the new date", async () => {
    const contractor = await makeContractor(day(2));
    await runSweepOnce();

    await updateUser(admin, { id: contractor.id, accessExpiresAt: day(6) });
    const again = await runSweepOnce();

    expect(again.ran && again.counts.accessExpiring).toBe(1);
    const sent = await warnings(contractor.id);
    expect(sent.length).toBe(2);
    expect(sent[1]?.linkUrl).toContain(day(6).toISOString().slice(0, 10));
  });

  it("says nothing about a date further out than a week, or one already passed", async () => {
    const distant = await makeContractor(day(30));
    const gone = await makeContractor(day(-4));

    const result = await runSweepOnce();

    expect(result.ran && result.counts.accessExpiring).toBe(0);
    expect(await warnings(distant.id)).toEqual([]);
    expect(await warnings(gone.id)).toEqual([]);
  });

  it("says nothing about a contractor with no end date at all", async () => {
    const forever = await makeContractor(null);
    const result = await runSweepOnce();

    expect(result.ran && result.counts.accessExpiring).toBe(0);
    expect(await warnings(forever.id)).toEqual([]);
  });
});
