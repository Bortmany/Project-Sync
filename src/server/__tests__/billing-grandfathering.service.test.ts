// GRANDFATHERING, proved for people: a company already over a ceiling keeps everything.
//
// The rule (docs/CONVENTIONS.md, "Plans and limits"): reads are never blocked, nobody is signed
// out, deactivated, re-roled or re-dated, and only ADDING more is refused — until the company is
// back at or under the ceiling, and then only up to it and no further. It is what makes a downgrade
// or a tightened limit safe, and the cases below are the ones the October 2026 pricing change
// creates on day one: a Free company with more than 10 office staff or more than 10 contractors, and
// a Pro company with more than 100 staff (possible only because Pro used to be unlimited) that
// drops to Free.
//
// Companies are put over the line by inserting rows directly (`bulkUsers`): the services would
// refuse to, which is the very thing under test.

import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mintSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PLANS } from "@/lib/plan-limits";
import { actorForUser, type ActorContext } from "@/server/actor";
import { createUser, listAllUsers, updateUser } from "@/server/services/admin";
import { billingStatus, countContractors, countOfficeStaff, processBillingWebhook } from "@/server/services/billing";
import { getDashboardForActor } from "@/server/services/dashboard";
import { listUsers } from "@/server/services/directory";
import { listProjectsForActor } from "@/server/services/projects";
import { listMainTasksForProject } from "@/server/services/tasks";
import {
  bulkUsers,
  makeProjectFixture,
  resetDatabase,
  setPlan,
  type Fixture,
} from "@/server/__tests__/harness";

const DAY = 24 * 60 * 60 * 1000;

let fixture: Fixture;

beforeEach(async () => {
  await resetDatabase();
  fixture = await makeProjectFixture();
  await setPlan(fixture.orgId, "FREE");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await prisma.$disconnect();
});

let emailCounter = 0;
const nextEmail = () => `grandfather.${emailCounter++}.${Date.now()}@test.example`;

async function refusalOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as Error).message;
  }
  return "NOT REFUSED";
}

function addStaff(actor: ActorContext) {
  return createUser(actor, {
    email: nextEmail(),
    name: "Nadia Hassan",
    password: "A-strong-test-password-1",
    role: "ENGINEER",
    disciplineId: fixture.disciplineId,
  });
}

function addContractor(actor: ActorContext) {
  return createUser(actor, {
    email: nextEmail(),
    name: "Sami al-Harthy",
    password: "A-strong-test-password-1",
    role: "EXTERNAL",
    companyName: "Gulf Inspection Services",
  });
}

/** Everything about every person that a grandfathered company must find unchanged the next morning. */
async function peopleSnapshot(orgId: string): Promise<string> {
  const rows = await prisma.user.findMany({
    where: { orgId },
    orderBy: { id: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      accessExpiresAt: true,
      companyName: true,
      disciplineId: true,
    },
  });
  return JSON.stringify(rows);
}

async function sessionSnapshot(orgId: string): Promise<string> {
  const rows = await prisma.session.findMany({
    where: { user: { orgId } },
    orderBy: { id: "asc" },
    select: { id: true, userId: true, tokenHash: true, expiresAt: true },
  });
  return JSON.stringify(rows);
}

/** One live session per person who can sign in, the way a real company mid-day looks. */
async function signEveryoneIn(orgId: string): Promise<void> {
  const people = await prisma.user.findMany({ where: { orgId, isActive: true }, select: { id: true } });
  for (const person of people) {
    const minted = mintSession();
    await prisma.session.create({
      data: { tokenHash: minted.tokenHash, userId: person.id, expiresAt: minted.expiresAt },
    });
  }
}

/** Every read a person's working day is made of. None of them may ever be refused over a limit. */
async function runEveryRead(actor: ActorContext, projectIds: string[]): Promise<void> {
  const admin = actor.role === "ADMIN";
  if (admin) await listAllUsers(actor);
  await listUsers(actor);
  await listProjectsForActor(actor);
  await getDashboardForActor(actor);
  for (const projectId of projectIds) await listMainTasksForProject(actor, projectId);
  if (admin) await billingStatus(actor);
}

/* ------------------------------------------------------------------ */
/* a. A company over the office-staff ceiling                          */
/* ------------------------------------------------------------------ */

describe("a FREE company with 12 office staff and 2 projects", () => {
  let secondProjectId: string;

  beforeEach(async () => {
    // The fixture already has 4 staff; 8 more make 12. A second project is inserted directly.
    await bulkUsers(fixture.orgId, 8, "ENGINEER", { disciplineId: fixture.disciplineId });
    const second = await prisma.project.create({
      data: {
        orgId: fixture.orgId,
        name: "Second train",
        code: `GF-${Math.floor(Math.random() * 1_000_000)}`,
        description: "Added behind the plan's back, as a downgrade leaves it.",
        createdById: fixture.adminActor.userId,
        members: { create: [{ userId: fixture.adminActor.userId, projectRole: "ADMIN" }] },
      },
    });
    secondProjectId = second.id;
    await signEveryoneIn(fixture.orgId);
  });

  it("reads everything exactly as before, and the billing page shows it is over without touching anybody", async () => {
    expect(await countOfficeStaff(fixture.orgId)).toBe(12);

    const peopleBefore = await peopleSnapshot(fixture.orgId);
    const sessionsBefore = await sessionSnapshot(fixture.orgId);

    await runEveryRead(fixture.adminActor, [fixture.projectId, secondProjectId]);
    await runEveryRead(fixture.pmActor, [fixture.projectId]);
    await runEveryRead(fixture.engineerActor, [fixture.projectId]);

    // The list reads are really answering, not quietly empty.
    expect((await listAllUsers(fixture.adminActor)).length).toBe(12);
    expect((await listUsers(fixture.adminActor)).length).toBe(12);
    expect((await listProjectsForActor(fixture.adminActor)).length).toBe(2);

    const status = await billingStatus(fixture.adminActor);
    expect(status.usage.users).toBe(12);
    expect(status.limits.users).toBe(10);
    expect(status.usage.projects).toBe(2);
    expect(status.limits.projects).toBe(1);

    // Everyone can still be signed in as: nobody was deactivated, re-roled or re-dated, no session ended.
    expect(await peopleSnapshot(fixture.orgId)).toBe(peopleBefore);
    expect(await sessionSnapshot(fixture.orgId)).toBe(sessionsBefore);
    const people = await prisma.user.findMany({ where: { orgId: fixture.orgId }, select: { id: true } });
    for (const person of people) await expect(actorForUser(person.id)).resolves.toBeTruthy();
  });

  it("refuses every addition: new staff by password and by invite, reactivation, extending, contractor to staff", async () => {
    const [off] = await bulkUsers(fixture.orgId, 1, "ENGINEER", { isActive: false, disciplineId: fixture.disciplineId });
    const [contractor] = await bulkUsers(fixture.orgId, 1, "EXTERNAL");
    const before = await peopleSnapshot(fixture.orgId);

    expect(await refusalOf(addStaff(fixture.adminActor))).toMatch(/^Your plan has room for 10 office staff\./);
    expect(
      await refusalOf(
        createUser(fixture.adminActor, {
          email: nextEmail(),
          name: "Invited person",
          role: "PROJECT_MANAGER",
          mode: "INVITE",
        }),
      ),
    ).toMatch(/^Your plan has room for 10 office staff\./);

    // A deactivated colleague cannot be switched back on.
    expect(await refusalOf(updateUser(fixture.adminActor, { id: off, isActive: true }))).toMatch(
      /^Your plan has room for 10 office staff\./,
    );

    // A contractor cannot become office staff, even though contractors are well under their own ceiling.
    expect(
      await refusalOf(
        updateUser(fixture.adminActor, { id: contractor, role: "ENGINEER", disciplineId: fixture.disciplineId }),
      ),
    ).toMatch(/^Your plan has room for 10 office staff\./);

    // Nothing about anybody changed, and the staff count is still 12.
    expect(await peopleSnapshot(fixture.orgId)).toBe(before);
    expect(await countOfficeStaff(fixture.orgId)).toBe(12);
  });

  it("refuses extending an expired contractor when the contractors are over their own ceiling", async () => {
    await bulkUsers(fixture.orgId, 12, "EXTERNAL");
    const [ended] = await bulkUsers(fixture.orgId, 1, "EXTERNAL", { accessExpiresAt: new Date(Date.now() - 5 * DAY) });

    expect(await refusalOf(addContractor(fixture.adminActor))).toMatch(/^Your plan has room for 10 contractors\./);
    expect(
      await refusalOf(updateUser(fixture.adminActor, { id: ended, accessExpiresAt: new Date(Date.now() + 30 * DAY) })),
    ).toMatch(/^Your plan has room for 10 contractors\./);
  });

  it("never refuses deactivating, renaming or resending: the way back under is always open", async () => {
    const [target] = await bulkUsers(fixture.orgId, 1, "PROJECT_MANAGER");
    const renamed = await updateUser(fixture.adminActor, { id: target, name: "Renamed Person" });
    expect(renamed.name).toBe("Renamed Person");

    const off = await updateUser(fixture.adminActor, { id: target, isActive: false });
    expect(off.isActive).toBe(false);
    expect(await countOfficeStaff(fixture.orgId)).toBe(12);

    // Resending an invitation is not a limit question at all; with email off it answers its own
    // plain sentence, never the plan's.
    const { resendInvite } = await import("@/server/services/account");
    const { configureEmail, goDormant, mockFetchOk } = await import("@/server/__tests__/email-harness");
    configureEmail();
    const spy = mockFetchOk();
    try {
      await expect(resendInvite(fixture.adminActor, { id: fixture.engineerActor.userId })).resolves.toEqual({ sent: true });
    } finally {
      spy.mockRestore();
      goDormant();
    }
  });

  it("recovers: at the ceiling one more is refused, one under it one more is allowed, and no further", async () => {
    // 12 staff. Deactivate two to be exactly at 10: still full.
    const staff = await prisma.user.findMany({
      where: { orgId: fixture.orgId, role: "ENGINEER", disciplineId: { not: null } },
      select: { id: true },
      take: 3,
    });
    await updateUser(fixture.adminActor, { id: staff[0].id, isActive: false });
    await updateUser(fixture.adminActor, { id: staff[1].id, isActive: false });
    expect(await countOfficeStaff(fixture.orgId)).toBe(10);
    expect(await refusalOf(addStaff(fixture.adminActor))).toMatch(/^Your plan has room for 10 office staff\./);

    // One fewer, and exactly one more is allowed.
    await updateUser(fixture.adminActor, { id: staff[2].id, isActive: false });
    expect(await countOfficeStaff(fixture.orgId)).toBe(9);
    expect((await addStaff(fixture.adminActor)).id).toBeTruthy();
    expect(await countOfficeStaff(fixture.orgId)).toBe(10);
    expect(await refusalOf(addStaff(fixture.adminActor))).toMatch(/^Your plan has room for 10 office staff\./);
  });
});

/* ------------------------------------------------------------------ */
/* e. A company over the contractor ceiling                            */
/* ------------------------------------------------------------------ */

describe("a FREE company with 14 active contractors and 3 staff", () => {
  beforeEach(async () => {
    // Trim the fixture's four staff to three, then add 14 contractors directly.
    await prisma.user.update({ where: { id: fixture.engineerActor.userId }, data: { isActive: false } });
    await bulkUsers(fixture.orgId, 14, "EXTERNAL");
    await signEveryoneIn(fixture.orgId);
  });

  it("reads work, no contractor is signed out, adding a contractor is refused, adding staff is allowed", async () => {
    expect(await countOfficeStaff(fixture.orgId)).toBe(3);
    expect(await countContractors(fixture.orgId)).toBe(14);

    const peopleBefore = await peopleSnapshot(fixture.orgId);
    const sessionsBefore = await sessionSnapshot(fixture.orgId);

    await runEveryRead(fixture.adminActor, [fixture.projectId]);
    const status = await billingStatus(fixture.adminActor);
    expect(status.usage.contractors).toBe(14);
    expect(status.limits.contractors).toBe(10);

    // A contractor's own seat still resolves and still reads their own (empty) world without a word about limits.
    const someContractor = await prisma.user.findFirstOrThrow({
      where: { orgId: fixture.orgId, role: "EXTERNAL" },
      select: { id: true },
    });
    const contractorActor = await actorForUser(someContractor.id);
    await expect(listProjectsForActor(contractorActor)).resolves.toEqual([]);

    expect(await peopleSnapshot(fixture.orgId)).toBe(peopleBefore);
    expect(await sessionSnapshot(fixture.orgId)).toBe(sessionsBefore);

    expect(await refusalOf(addContractor(fixture.adminActor))).toMatch(/^Your plan has room for 10 contractors\./);
    expect((await addStaff(fixture.adminActor)).role).toBe("ENGINEER");

    // And deactivating contractors back under the ceiling re-opens the door, to the ceiling and no further.
    const contractors = await prisma.user.findMany({
      where: { orgId: fixture.orgId, role: "EXTERNAL", isActive: true },
      select: { id: true },
      take: 5,
    });
    for (const contractor of contractors.slice(0, 4)) {
      await updateUser(fixture.adminActor, { id: contractor.id, isActive: false });
    }
    expect(await countContractors(fixture.orgId)).toBe(10);
    expect(await refusalOf(addContractor(fixture.adminActor))).toMatch(/^Your plan has room for 10 contractors\./);
    await updateUser(fixture.adminActor, { id: contractors[4].id, isActive: false });
    expect((await addContractor(fixture.adminActor)).role).toBe("EXTERNAL");
    expect(await refusalOf(addContractor(fixture.adminActor))).toMatch(/^Your plan has room for 10 contractors\./);
  });
});

/* ------------------------------------------------------------------ */
/* f. The downgrade case                                               */
/* ------------------------------------------------------------------ */

const SECRET = "pdl_ntfset_01_test_secret_value_only";

function configureProvider(): void {
  vi.stubEnv("PADDLE_API_KEY", "pdl_sdbx_apikey_for_tests_only");
  vi.stubEnv("PADDLE_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("PADDLE_PRICE_ID_PRO", "pri_01test");
  vi.stubEnv("PADDLE_ENV", "sandbox");
  vi.stubEnv("APP_BASE_URL", "https://tielora.example");
}

function signedWebhook(eventType: string, orgId: string, eventId: string) {
  const raw = JSON.stringify({
    event_id: eventId,
    event_type: eventType,
    occurred_at: new Date().toISOString(),
    data: { id: "sub_gf", customer_id: "ctm_gf", custom_data: { org_id: orgId } },
  });
  const ts = String(Math.floor(Date.now() / 1000));
  const h1 = createHmac("sha256", SECRET).update(`${ts}:${raw}`).digest("hex");
  return { raw, header: `ts=${ts};h1=${h1}` };
}

describe("a PRO company with 60 contractors and 105 staff, downgraded to FREE by a signed webhook", () => {
  it("reads as Free, everybody stays, reads work, additions are refused, and only the plan and its audit row change", async () => {
    configureProvider();
    await setPlan(fixture.orgId, "PRO");
    await prisma.organization.update({
      where: { id: fixture.orgId },
      data: { billingCustomerId: "ctm_gf", billingSubscriptionId: "sub_gf" },
    });
    await bulkUsers(fixture.orgId, 101, "ENGINEER", { disciplineId: fixture.disciplineId }); // 4 + 101 = 105
    await bulkUsers(fixture.orgId, 60, "EXTERNAL");
    await signEveryoneIn(fixture.orgId);
    expect(await countOfficeStaff(fixture.orgId)).toBe(105);
    expect(await countContractors(fixture.orgId)).toBe(60);

    const peopleBefore = await peopleSnapshot(fixture.orgId);
    const sessionsBefore = await sessionSnapshot(fixture.orgId);
    const projectsBefore = await prisma.project.findMany({ where: { orgId: fixture.orgId }, orderBy: { id: "asc" } });
    const orgBefore = await prisma.organization.findUniqueOrThrow({ where: { id: fixture.orgId } });
    const activityBefore = await prisma.activityLog.count();

    const { raw, header } = signedWebhook("subscription.canceled", fixture.orgId, "evt_gf_down");
    const outcome = await processBillingWebhook(raw, header);
    expect(outcome.httpStatus).toBe(200);

    // The plan reads Free, with Free's numbers, and the page that tells the administrator shows it.
    const status = await billingStatus(fixture.adminActor);
    expect(status.plan).toBe("FREE");
    expect(status.limits).toEqual(PLANS.FREE);
    expect(status.usage.users).toBe(105);
    expect(status.usage.contractors).toBe(60);

    // Reads all work.
    await runEveryRead(fixture.adminActor, [fixture.projectId]);

    // Additions are refused, in both groups.
    expect(await refusalOf(addStaff(fixture.adminActor))).toMatch(/^Your plan has room for 10 office staff\./);
    expect(await refusalOf(addContractor(fixture.adminActor))).toMatch(/^Your plan has room for 10 contractors\./);

    // Nobody changed and nobody was signed out.
    expect(await peopleSnapshot(fixture.orgId)).toBe(peopleBefore);
    expect(await sessionSnapshot(fixture.orgId)).toBe(sessionsBefore);
    expect(await prisma.project.findMany({ where: { orgId: fixture.orgId }, orderBy: { id: "asc" } })).toEqual(projectsBefore);

    // The only company row that moved is `plan`; the only new audit row is the plan change.
    const orgAfter = await prisma.organization.findUniqueOrThrow({ where: { id: fixture.orgId } });
    const changedColumns = (Object.keys(orgAfter) as (keyof typeof orgAfter)[]).filter(
      (key) => JSON.stringify(orgAfter[key]) !== JSON.stringify(orgBefore[key]),
    );
    expect(changedColumns).toEqual(["plan"]);
    expect(await prisma.activityLog.count()).toBe(activityBefore + 1);
    const newest = await prisma.activityLog.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
    expect(newest.summary).toBe("Plan changed from PRO to FREE");
  });
});
