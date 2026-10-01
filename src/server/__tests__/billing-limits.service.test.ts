// Plans and limits, proved at the three choke points.
//
// The rule under test is the same one in all three places: what a company already has is never
// blocked — it reads, opens and downloads exactly as before — and only ADDING MORE is refused once
// the plan's ceiling is reached. That is what makes a future downgrade safe, and it is the case
// most likely to be broken by accident, so it is tested directly.

import { readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Test uploads go to a throwaway folder, never the development data directory.
process.env.DATA_DIR = path.join(os.tmpdir(), "nexus-test-data");

// The upload ROUTE reads the session cookie, which only exists inside a real request. It is called
// directly here because the promise being tested — a refused upload leaves no file behind — is
// about what the route does before it reaches the service.
const session = vi.hoisted(() => ({ actor: null as unknown }));
vi.mock("@/server/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/session")>();
  return { ...actual, currentActor: async () => session.actor };
});

import { POST as uploadRoute } from "@/app/api/uploads/route";
import { prisma } from "@/lib/db";
import { isAccessExpired } from "@/lib/access-expiry";
import { PLANS, limitAmount, limitRefusal, planOf } from "@/lib/plan-limits";
import { storeFile, uploadsDir, validateUpload } from "@/lib/upload";
import type { ActorContext } from "@/server/actor";
import { ServiceError } from "@/server/errors";
import { createUser, updateUser } from "@/server/services/admin";
import { monthKey, nextMonthStart } from "@/server/services/ai";
import {
  assertUserRoom,
  billingStatus,
  countContractors,
  countOfficeStaff,
  peopleGroupOf,
} from "@/server/services/billing";
import { uploadDocumentVersion } from "@/server/services/documents";
import { createProject, listProjectsForActor } from "@/server/services/projects";
import { createMainTask } from "@/server/services/tasks";
import {
  bulkUsers,
  inThirtyDays,
  makeProjectFixture,
  resetDatabase,
  setPlan,
  type Fixture,
} from "@/server/__tests__/harness";

let fixture: Fixture;

beforeEach(async () => {
  await resetDatabase();
  // Every test here says which plan it means; the fixture's own company starts on FREE.
  fixture = await makeProjectFixture();
  await setPlan(fixture.orgId, "FREE");
});

afterAll(async () => {
  await prisma.$disconnect();
});

let codeCounter = 0;
const nextCode = () => `PL-${codeCounter++}-${Math.floor(Math.random() * 100000)}`;

let emailCounter = 0;
const nextEmail = () => `plan.person.${emailCounter++}.${Date.now()}@test.example`;

async function addProject(actor: ActorContext, name = "Another project") {
  return createProject(actor, {
    name,
    code: nextCode(),
    description: "A project for the plan-limit tests.",
    disciplineIds: [],
    members: [],
  });
}

async function addPerson(actor: ActorContext) {
  return createUser(actor, {
    email: nextEmail(),
    name: "Nadia Hassan",
    password: "A-strong-test-password-1",
    role: "ENGINEER",
    disciplineId: fixture.disciplineId,
  });
}

/** Fills a company's storage without writing a byte: the cap is counted from `sizeBytes`. */
async function storeFakeBytes(projectId: string, uploaderId: string, bytes: number) {
  const document = await prisma.document.create({
    data: { projectId, title: "Big drawing set", uploadedById: uploaderId },
  });
  await prisma.documentVersion.create({
    data: {
      documentId: document.id,
      revisionNumber: 0,
      storedFilename: `fake-${document.id}.bin`,
      originalFilename: "Big drawing set.pdf",
      mimeType: "application/pdf",
      sizeBytes: bytes,
      checksumSha256: "0".repeat(64),
      uploadedById: uploaderId,
    },
  });
  return document.id;
}

/** A real upload through the one function every upload path in the app walks through. */
async function upload(actor: ActorContext, mainTaskId: string, body = "small,file\n1,ok\n") {
  const filename = "Register.csv";
  const buffer = Buffer.from(body, "utf8");
  const checked = validateUpload(buffer, filename);
  if (!checked.ok) throw new Error(checked.error);
  const stored = await storeFile(buffer, checked.ext);

  return uploadDocumentVersion(
    actor,
    { projectId: fixture.projectId, mainTaskId },
    {
      buffer,
      originalName: filename,
      mimeType: checked.mimeType,
      ext: checked.ext,
      sizeBytes: stored.sizeBytes,
      checksumSha256: stored.checksumSha256,
      storedFilename: stored.storedFilename,
    },
  );
}

async function makeMainTask() {
  const task = await createMainTask(fixture.adminActor, {
    projectId: fixture.projectId,
    title: "Complete engineering design review",
    description: "The test main task.",
    priority: "MEDIUM",
    deadline: inThirtyDays(),
    disciplineTasks: [],
  });
  return task.id;
}

/* ------------------------------------------------------------------ */
/* The limit matrix                                                    */
/* ------------------------------------------------------------------ */

describe("FREE: the three ceilings", () => {
  it("refuses a second project when the plan allows one", async () => {
    // The fixture's company already has its one project.
    await expect(addProject(fixture.adminActor)).rejects.toBeInstanceOf(ServiceError);
  });

  it("allows a project while there is still room", async () => {
    await prisma.project.update({
      where: { id: fixture.projectId },
      data: { deletedAt: new Date() },
    });
    const created = await addProject(fixture.adminActor);
    expect(created.code).toBeTruthy();
  });

  it("allows people up to the limit and refuses the one after it", async () => {
    const limit = PLANS.FREE.users as number;
    const already = await prisma.user.count({ where: { orgId: fixture.orgId, isActive: true } });

    for (let i = already; i < limit; i += 1) {
      await addPerson(fixture.adminActor);
    }
    const atLimit = await prisma.user.count({ where: { orgId: fixture.orgId, isActive: true } });
    expect(atLimit).toBe(limit);

    await expect(addPerson(fixture.adminActor)).rejects.toBeInstanceOf(ServiceError);
  });

  it("does not count a deactivated account against the people limit", async () => {
    const limit = PLANS.FREE.users as number;
    const already = await prisma.user.count({ where: { orgId: fixture.orgId, isActive: true } });
    for (let i = already; i < limit; i += 1) await addPerson(fixture.adminActor);

    await expect(addPerson(fixture.adminActor)).rejects.toBeInstanceOf(ServiceError);

    // Giving a seat back makes room again — the account, its work and its audit trail all stay.
    const someone = await prisma.user.findFirst({
      where: { orgId: fixture.orgId, role: "ENGINEER" },
      select: { id: true },
    });
    await prisma.user.update({ where: { id: someone?.id as string }, data: { isActive: false } });

    const created = await addPerson(fixture.adminActor);
    expect(created.id).toBeTruthy();
  });

  it("refuses an upload that would take the company past its storage cap", async () => {
    const mainTaskId = await makeMainTask();
    const cap = PLANS.FREE.documentBytes as number;
    await storeFakeBytes(fixture.projectId, fixture.adminActor.userId, cap);

    await expect(upload(fixture.adminActor, mainTaskId)).rejects.toBeInstanceOf(ServiceError);
  });

  it("allows an upload while there is still room under the cap", async () => {
    const mainTaskId = await makeMainTask();
    await storeFakeBytes(fixture.projectId, fixture.adminActor.userId, 1024);

    const version = await upload(fixture.adminActor, mainTaskId);
    expect(version.revisionNumber).toBe(0);
  });

  it("counts the revisions of a soft-deleted document — the files are still on our disk", async () => {
    const mainTaskId = await makeMainTask();
    const cap = PLANS.FREE.documentBytes as number;
    const documentId = await storeFakeBytes(fixture.projectId, fixture.adminActor.userId, cap);
    await prisma.document.update({ where: { id: documentId }, data: { deletedAt: new Date() } });

    await expect(upload(fixture.adminActor, mainTaskId)).rejects.toBeInstanceOf(ServiceError);
  });
});

describe("PRO: no ceiling on projects or people, and a much larger one on storage", () => {
  beforeEach(async () => {
    await setPlan(fixture.orgId, "PRO");
  });

  it("allows project after project", async () => {
    await addProject(fixture.adminActor, "Second train");
    await addProject(fixture.adminActor, "Third train");
    const projects = await listProjectsForActor(fixture.adminActor);
    expect(projects.length).toBe(3);
  });

  it("allows more people than a free plan ever would", async () => {
    const limit = PLANS.FREE.users as number;
    const already = await prisma.user.count({ where: { orgId: fixture.orgId, isActive: true } });
    for (let i = already; i <= limit; i += 1) await addPerson(fixture.adminActor);

    const total = await prisma.user.count({ where: { orgId: fixture.orgId, isActive: true } });
    expect(total).toBeGreaterThan(limit);
  });

  it("still enforces the storage cap", async () => {
    const mainTaskId = await makeMainTask();
    const cap = PLANS.PRO.documentBytes as number;
    // sizeBytes is a 32-bit column, so a 10 GB total is several rows — as it would be in real life.
    const chunk = 2_000_000_000;
    for (let stored = 0; stored <= cap; stored += chunk) {
      await storeFakeBytes(fixture.projectId, fixture.adminActor.userId, chunk);
    }

    await expect(upload(fixture.adminActor, mainTaskId)).rejects.toBeInstanceOf(ServiceError);
  });
});

/* ------------------------------------------------------------------ */
/* Grandfathering                                                      */
/* ------------------------------------------------------------------ */

describe("grandfathering: over the limit is never a locked door", () => {
  it("keeps all three projects readable on a FREE plan and refuses the fourth", async () => {
    await setPlan(fixture.orgId, "PRO");
    await addProject(fixture.adminActor, "Second train");
    await addProject(fixture.adminActor, "Third train");

    // The company drops to FREE with three projects — exactly a downgrade's morning after.
    await setPlan(fixture.orgId, "FREE");

    const projects = await listProjectsForActor(fixture.adminActor);
    expect(projects.length).toBe(3);
    for (const project of projects) {
      expect(project.name).toBeTruthy();
    }

    await expect(addProject(fixture.adminActor, "Fourth train")).rejects.toBeInstanceOf(ServiceError);
  });

  it("still lets an over-limit company read its billing page", async () => {
    await setPlan(fixture.orgId, "PRO");
    await addProject(fixture.adminActor, "Second train");
    await setPlan(fixture.orgId, "FREE");

    const status = await billingStatus(fixture.adminActor);
    expect(status.plan).toBe("FREE");
    expect(status.usage.projects).toBe(2);
    expect(status.limits.projects).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* The invite path                                                     */
/* ------------------------------------------------------------------ */

describe("both ways of adding somebody are counted", () => {
  it("refuses an invitation at the people limit, exactly as it refuses a first password", async () => {
    const limit = PLANS.FREE.users as number;
    const already = await prisma.user.count({ where: { orgId: fixture.orgId, isActive: true } });
    for (let i = already; i < limit; i += 1) await addPerson(fixture.adminActor);

    const invited = createUser(fixture.adminActor, {
      email: nextEmail(),
      name: "Invited person",
      role: "ENGINEER",
      disciplineId: fixture.disciplineId,
      mode: "INVITE",
    });
    await expect(invited).rejects.toThrow(/Your plan has room for/);
  });
});

/* ------------------------------------------------------------------ */
/* An unrecognised plan                                                */
/* ------------------------------------------------------------------ */

describe("a plan name this build does not recognise reads as FREE", () => {
  it("reads it as FREE everywhere — the status page and the limit alike", async () => {
    expect(planOf({ plan: "PLATINUM" })).toBe("FREE");
    expect(planOf({ plan: null })).toBe("FREE");
    expect(planOf(null)).toBe("FREE");

    await setPlan(fixture.orgId, "PLATINUM");

    const status = await billingStatus(fixture.adminActor);
    expect(status.plan).toBe("FREE");
    expect(status.limits.projects).toBe(PLANS.FREE.projects);

    await expect(addProject(fixture.adminActor)).rejects.toBeInstanceOf(ServiceError);
  });
});

/* ------------------------------------------------------------------ */
/* The usage DTO                                                       */
/* ------------------------------------------------------------------ */

describe("what the billing page is told", () => {
  it("counts live projects, active people and every stored byte", async () => {
    const mainTaskId = await makeMainTask();
    await upload(fixture.adminActor, mainTaskId, "one,two\n3,4\n");
    await storeFakeBytes(fixture.projectId, fixture.adminActor.userId, 2048);

    const status = await billingStatus(fixture.adminActor);
    const people = await prisma.user.count({ where: { orgId: fixture.orgId, isActive: true } });

    expect(status.plan).toBe("FREE");
    expect(status.usage.projects).toBe(1);
    expect(status.usage.users).toBe(people);
    expect(status.usage.documentBytes).toBeGreaterThan(2048);
    expect(status.limits).toEqual(PLANS.FREE);
  });

  it("is refused to anybody who is not an administrator", async () => {
    await expect(billingStatus(fixture.pmActor)).rejects.toThrow();
    await expect(billingStatus(fixture.engineerActor)).rejects.toThrow();
  });
});

/* ------------------------------------------------------------------ */
/* The refusal copy                                                    */
/* ------------------------------------------------------------------ */

describe("the refusal is written for whoever is reading it", () => {
  it("points an administrator at the billing page", async () => {
    await expect(addProject(fixture.adminActor)).rejects.toThrow(
      "Your plan has room for 1 project. Free plans include 1 — upgrade to Pro for unlimited. See plans in Admin → Billing.",
    );
  });

  it("tells everybody else who to ask, and never mentions a page they cannot open", async () => {
    // A project manager may start a project, so this is the same refusal in another person's words.
    await expect(addProject(fixture.pmActor)).rejects.toThrow(
      "Your plan has room for 1 project. Free plans include 1. Ask your administrator to upgrade your plan.",
    );
  });

  it("says the same two ways about storage, in the size somebody recognises", async () => {
    const mainTaskId = await makeMainTask();
    await storeFakeBytes(fixture.projectId, fixture.adminActor.userId, PLANS.FREE.documentBytes as number);

    await expect(upload(fixture.adminActor, mainTaskId)).rejects.toThrow(
      "Your plan has room for 500 MB of documents. Free plans include 500 MB — upgrade to Pro for 10 GB. See plans in Admin → Billing.",
    );
    // A project manager on this project may upload here, and is not an administrator — the other
    // half of the role branch.
    await expect(upload(fixture.pmActor, mainTaskId)).rejects.toThrow(
      "Your plan has room for 500 MB of documents. Free plans include 500 MB. Ask your administrator to upgrade your plan.",
    );
  });

  it("counts people in plain English too", async () => {
    const limit = PLANS.FREE.users as number;
    const already = await prisma.user.count({ where: { orgId: fixture.orgId, isActive: true } });
    for (let i = already; i < limit; i += 1) await addPerson(fixture.adminActor);

    await expect(addPerson(fixture.adminActor)).rejects.toThrow(
      "Your plan has room for 10 office staff. Free plans include 10 — upgrade to Pro for 100. Outside contractors don't count. See plans in Admin → Billing.",
    );
  });
});

/* ------------------------------------------------------------------ */
/* Giving a seat back is taking a seat                                 */
/* ------------------------------------------------------------------ */

/** Fills the company to exactly its people limit and hands back one person who is on it. */
async function fillSeats(): Promise<string> {
  const limit = PLANS.FREE.users as number;
  let last = "";
  let already = await prisma.user.count({ where: { orgId: fixture.orgId, isActive: true } });
  while (already < limit) {
    last = (await addPerson(fixture.adminActor)).id;
    already += 1;
  }
  return last;
}

describe("reactivating somebody asks for room, exactly as creating them does", () => {
  it("refuses a reactivation that would put the company over its seat limit", async () => {
    const someone = await fillSeats();

    // Deactivate one, and the seat really is given back — the replacement is allowed.
    await updateUser(fixture.adminActor, { id: someone, isActive: false });
    await addPerson(fixture.adminActor);

    // Now switching the first one back on would make eleven people who can sign in. Without this
    // check, deactivate-and-re-add would be a way around the plan entirely.
    await expect(
      updateUser(fixture.adminActor, { id: someone, isActive: true }),
    ).rejects.toThrow(/Your plan has room for/);

    const active = await prisma.user.count({ where: { orgId: fixture.orgId, isActive: true } });
    expect(active).toBe(PLANS.FREE.users);
  });

  it("allows a reactivation while there is still room, and never asks on an ordinary edit", async () => {
    const someone = await fillSeats();
    await updateUser(fixture.adminActor, { id: someone, isActive: false });

    const back = await updateUser(fixture.adminActor, { id: someone, isActive: true });
    expect(back.isActive).toBe(true);

    // An edit that changes nothing about who can sign in is never refused, even at the limit.
    const renamed = await updateUser(fixture.adminActor, { id: someone, name: "Nadia H" });
    expect(renamed.name).toBe("Nadia H");
  });
});

/* ------------------------------------------------------------------ */
/* A contractor whose access has run out                               */
/* ------------------------------------------------------------------ */

describe("a seat is somebody who can still sign in", () => {
  async function addExpiredContractor(daysAgo: number) {
    return prisma.user.create({
      data: {
        orgId: fixture.orgId,
        email: nextEmail(),
        name: "Sami al-Harthy",
        passwordHash: "not-a-real-hash",
        role: "EXTERNAL",
        companyName: "Gulf Inspection Services",
        accessExpiresAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
      },
    });
  }

  it("does not count a contractor whose access has run out — as staff or as a contractor", async () => {
    const before = (await billingStatus(fixture.adminActor)).usage;
    await addExpiredContractor(5);

    const after = (await billingStatus(fixture.adminActor)).usage;
    expect(after.users).toBe(before.users);
    expect(after.contractors).toBe(before.contractors);
  });

  it("counts a contractor whose last day has not passed yet as a contractor, never as office staff", async () => {
    const before = (await billingStatus(fixture.adminActor)).usage;
    await prisma.user.create({
      data: {
        orgId: fixture.orgId,
        email: nextEmail(),
        name: "Still working",
        passwordHash: "not-a-real-hash",
        role: "EXTERNAL",
        companyName: "Gulf Inspection Services",
        accessExpiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      },
    });

    const after = (await billingStatus(fixture.adminActor)).usage;
    expect(after.contractors).toBe(before.contractors + 1);
    expect(after.users).toBe(before.users);
  });

  it("counts everybody who has no end date at all — a NULL is never quietly dropped", async () => {
    const status = await billingStatus(fixture.adminActor);
    const plain = await prisma.user.count({
      where: { orgId: fixture.orgId, isActive: true, accessExpiresAt: null },
    });
    expect(status.usage.users).toBe(plain);
  });

  it("lets an expired contractor's seat be used by somebody else", async () => {
    await fillSeats();
    await addExpiredContractor(5);

    // The company is at ten people who can sign in plus one who cannot, so there is no room…
    await expect(addPerson(fixture.adminActor)).rejects.toThrow(/Your plan has room for/);

    // …and freeing a real seat makes room, while the expired contractor still costs nothing.
    const someone = await prisma.user.findFirstOrThrow({
      where: { orgId: fixture.orgId, role: "ENGINEER", isActive: true },
      select: { id: true },
    });
    await updateUser(fixture.adminActor, { id: someone.id, isActive: false });
    const created = await addPerson(fixture.adminActor);
    expect(created.id).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/* A refused upload leaves nothing behind                              */
/* ------------------------------------------------------------------ */

describe("the storage cap is judged before the bytes reach the disk", () => {
  async function filesOnDisk(): Promise<number> {
    try {
      return (await readdir(uploadsDir())).length;
    } catch {
      return 0;
    }
  }

  async function postUpload(actor: ActorContext, mainTaskId: string) {
    session.actor = actor;
    const form = new FormData();
    form.set("file", new File([Buffer.from("a,b\n1,2\n")], "Register.csv", { type: "text/csv" }));
    form.set("projectId", fixture.projectId);
    form.set("mainTaskId", mainTaskId);
    const response = await uploadRoute(
      new Request("http://localhost/api/uploads", { method: "POST", body: form }),
    );
    session.actor = null;
    return response;
  }

  it("refuses over the cap and writes NO file — an orphan nothing points at is never made", async () => {
    const mainTaskId = await makeMainTask();
    await storeFakeBytes(fixture.projectId, fixture.adminActor.userId, PLANS.FREE.documentBytes as number);

    const before = await filesOnDisk();
    const response = await postUpload(fixture.adminActor, mainTaskId);
    const body = (await response.json()) as { ok: boolean; error?: string };

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toContain("Your plan has room for");
    expect(await filesOnDisk()).toBe(before);

    // And nothing was recorded either: no document, no revision.
    const versions = await prisma.documentVersion.count({
      where: { document: { project: { orgId: fixture.orgId } }, originalFilename: "Register.csv" },
    });
    expect(versions).toBe(0);
  });

  it("still accepts an upload with room to spare, and writes exactly one file", async () => {
    const mainTaskId = await makeMainTask();
    const before = await filesOnDisk();

    const response = await postUpload(fixture.adminActor, mainTaskId);
    expect(response.status).toBe(200);
    expect(await filesOnDisk()).toBe(before + 1);
  });
});

/* ------------------------------------------------------------------ */
/* The monthly AI allowance                                            */
/* ------------------------------------------------------------------ */

describe("the monthly AI allowance (aiMonthlyUsd)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("exists for both plans as a real number, and is never null", () => {
    for (const plan of ["FREE", "PRO"] as const) {
      expect(typeof PLANS[plan].aiMonthlyUsd).toBe("number");
      expect(PLANS[plan].aiMonthlyUsd).toBeGreaterThanOrEqual(0);
    }
    expect(PLANS.FREE.aiMonthlyUsd).toBe(2);
    expect(PLANS.PRO.aiMonthlyUsd).toBe(25);
  });

  it("reads an unrecognised plan as FREE's allowance, and upgrading raises it at once", async () => {
    await setPlan(fixture.orgId, "PLATINUM");
    expect((await billingStatus(fixture.adminActor)).limits.aiMonthlyUsd).toBe(PLANS.FREE.aiMonthlyUsd);

    await setPlan(fixture.orgId, "PRO");
    expect((await billingStatus(fixture.adminActor)).limits.aiMonthlyUsd).toBe(PLANS.PRO.aiMonthlyUsd);
  });

  it("carries the month's dollars, requests and cap only while the deployment is configured, worked out from tokens", async () => {
    await prisma.aiUsage.create({
      data: { orgId: fixture.orgId, month: monthKey(new Date()), inputTokens: 250_000, outputTokens: 40_000, requests: 17 },
    });

    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(await billingStatus(fixture.adminActor)).not.toHaveProperty("ai");

    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-not-a-real-key");
    const status = await billingStatus(fixture.adminActor);
    // 250,000 in at $4/M plus 40,000 out at $20/M.
    expect(status.ai?.usedUsd).toBeCloseTo(1.8, 10);
    expect(status.ai?.requests).toBe(17);
    expect(status.ai?.atAllowance).toBe(false);
    expect(status.ai?.capUsd).toBe(PLANS.FREE.aiMonthlyUsd);
    expect(status.ai?.resetsOn.getTime()).toBe(nextMonthStart(new Date()).getTime());
  });

  it("says 'at the allowance' as soon as the next question would be refused, not only once spent", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-not-a-real-key");
    // $1.98 of the $2 allowance: under the cap, but the worst case of one question ($0.04) no longer fits.
    await prisma.aiUsage.create({
      data: { orgId: fixture.orgId, month: monthKey(new Date()), inputTokens: 0, outputTokens: 99_000, requests: 50 },
    });
    const status = await billingStatus(fixture.adminActor);
    expect(status.ai?.usedUsd).toBeLessThan(status.ai?.capUsd ?? 0);
    expect(status.ai?.atAllowance).toBe(true);
  });

  it("never blocks a read when a company is over its AI allowance", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-not-a-real-key");
    await prisma.aiUsage.create({
      data: { orgId: fixture.orgId, month: monthKey(new Date()), inputTokens: 0, outputTokens: 10_000_000, requests: 99 },
    });
    const status = await billingStatus(fixture.adminActor);
    expect(status.ai?.usedUsd).toBeGreaterThan(status.ai?.capUsd ?? 0);
    expect(status.ai?.atAllowance).toBe(true);
    expect((await listProjectsForActor(fixture.adminActor)).length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* October 2026: office staff and contractors, counted separately      */
/* ------------------------------------------------------------------ */
//
// Contractors are free: they never count as office staff, and have a safety ceiling of their own.
// Everything below is on the one rule in `plan-limits.ts` and the one pair of counts in billing.ts.

const DAY = 24 * 60 * 60 * 1000;

const STAFF_FREE_ADMIN =
  "Your plan has room for 10 office staff. Free plans include 10 — upgrade to Pro for 100. Outside contractors don't count. See plans in Admin → Billing.";
const STAFF_FREE_OTHER =
  "Your plan has room for 10 office staff. Free plans include 10. Outside contractors don't count. Ask your administrator to upgrade your plan.";
const STAFF_PRO_ADMIN =
  "Your plan has room for 100 office staff. Pro plans include 100. Outside contractors don't count. Deactivate someone who no longer needs to sign in to make room.";
const STAFF_PRO_OTHER =
  "Your plan has room for 100 office staff. Pro plans include 100. Outside contractors don't count. Ask your administrator to make room.";
const CONTRACTORS_FREE_ADMIN =
  "Your plan has room for 10 contractors. Free plans include 10 — upgrade to Pro for 50. Deactivated contractors, and ones whose access has ended, don't count. See plans in Admin → Billing.";
const CONTRACTORS_FREE_OTHER =
  "Your plan has room for 10 contractors. Free plans include 10. Deactivated contractors, and ones whose access has ended, don't count. Ask your administrator to upgrade your plan.";
const CONTRACTORS_PRO_ADMIN =
  "Your plan has room for 50 contractors. Pro plans include 50. Deactivated contractors, and ones whose access has ended, don't count. Deactivate one you no longer work with, or let their access end, to make room.";
const CONTRACTORS_PRO_OTHER =
  "Your plan has room for 50 contractors. Pro plans include 50. Deactivated contractors, and ones whose access has ended, don't count. Ask your administrator to make room.";

/** The message a promise is refused with, or a marker when it was not refused at all. */
async function refusalOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as Error).message;
  }
  return "NOT REFUSED";
}

async function fillStaffTo(target: number): Promise<void> {
  const have = await countOfficeStaff(fixture.orgId);
  if (have < target) {
    await bulkUsers(fixture.orgId, target - have, "ENGINEER", { disciplineId: fixture.disciplineId });
  }
}

async function fillContractorsTo(target: number): Promise<void> {
  const have = await countContractors(fixture.orgId);
  if (have < target) await bulkUsers(fixture.orgId, target - have, "EXTERNAL");
}

function addContractor(actor: ActorContext, extra: { mode?: "INVITE"; accessExpiresAt?: Date } = {}) {
  return createUser(actor, {
    email: nextEmail(),
    name: "Sami al-Harthy",
    ...(extra.mode === "INVITE" ? { mode: "INVITE" as const } : { password: "A-strong-test-password-1" }),
    role: "EXTERNAL",
    companyName: "Gulf Inspection Services",
    ...(extra.accessExpiresAt ? { accessExpiresAt: extra.accessExpiresAt } : {}),
  });
}

describe("contractors are free: they never count as office staff", () => {
  it("at 10 staff with 3 contractors on FREE, the 11th staff is refused and the 4th contractor is allowed", async () => {
    await fillStaffTo(10);
    await fillContractorsTo(3);

    expect(await countOfficeStaff(fixture.orgId)).toBe(10);
    expect(await countContractors(fixture.orgId)).toBe(3);

    expect(await refusalOf(addPerson(fixture.adminActor))).toBe(STAFF_FREE_ADMIN);
    const fourth = await addContractor(fixture.adminActor);
    expect(fourth.role).toBe("EXTERNAL");
    expect(await countContractors(fixture.orgId)).toBe(4);
    expect(await countOfficeStaff(fixture.orgId)).toBe(10);
  });

  it("and the reverse: a company full of contractors can still add office staff", async () => {
    await fillContractorsTo(10);
    expect(await refusalOf(addContractor(fixture.adminActor))).toBe(CONTRACTORS_FREE_ADMIN);

    const staff = await addPerson(fixture.adminActor);
    expect(staff.role).toBe("ENGINEER");
  });
});

describe("the contractor ceiling", () => {
  it("FREE: the 11th contractor is refused, in the administrator's words and in everybody else's", async () => {
    await fillContractorsTo(10);

    expect(await refusalOf(addContractor(fixture.adminActor))).toBe(CONTRACTORS_FREE_ADMIN);
    // Only an administrator can open Admin → Users, so the other voice is asked of the same
    // function the service calls, with a project manager's seat.
    expect(await refusalOf(assertUserRoom(fixture.pmActor, "EXTERNAL"))).toBe(CONTRACTORS_FREE_OTHER);
  });

  it("PRO: the 51st contractor is refused, and 49 leaves room for exactly one more", async () => {
    await setPlan(fixture.orgId, "PRO");
    await fillContractorsTo(50);

    expect(await refusalOf(addContractor(fixture.adminActor))).toBe(CONTRACTORS_PRO_ADMIN);
    expect(await refusalOf(assertUserRoom(fixture.pmActor, "EXTERNAL"))).toBe(CONTRACTORS_PRO_OTHER);

    await prisma.user.updateMany({
      where: { orgId: fixture.orgId, role: "EXTERNAL" },
      data: { isActive: false },
    });
    await fillContractorsTo(49);
    expect((await addContractor(fixture.adminActor)).id).toBeTruthy();
    expect(await refusalOf(addContractor(fixture.adminActor))).toBe(CONTRACTORS_PRO_ADMIN);
  });
});

describe("PRO caps office staff at the plan's number", () => {
  beforeEach(async () => {
    await setPlan(fixture.orgId, "PRO");
  });

  it("refuses the 101st with the exact Pro sentence, which never says upgrade", async () => {
    await fillStaffTo(100);

    const message = await refusalOf(addPerson(fixture.adminActor));
    expect(message).toBe(STAFF_PRO_ADMIN);
    expect(message.toLowerCase()).not.toContain("upgrade");
    expect(await refusalOf(assertUserRoom(fixture.pmActor, "ENGINEER"))).toBe(STAFF_PRO_OTHER);
  });

  it("allows one more at 99, and contractors are no part of the 100", async () => {
    await fillStaffTo(99);
    await fillContractorsTo(5);
    expect(await countOfficeStaff(fixture.orgId)).toBe(99);

    expect((await addPerson(fixture.adminActor)).id).toBeTruthy();
    expect(await refusalOf(addPerson(fixture.adminActor))).toBe(STAFF_PRO_ADMIN);
  });
});

describe("the refusal wording, word for word", () => {
  it("writes all eight sentences exactly", () => {
    expect(limitRefusal("users", "FREE", "ADMIN")).toBe(STAFF_FREE_ADMIN);
    expect(limitRefusal("users", "FREE", "PROJECT_MANAGER")).toBe(STAFF_FREE_OTHER);
    expect(limitRefusal("users", "PRO", "ADMIN")).toBe(STAFF_PRO_ADMIN);
    expect(limitRefusal("users", "PRO", "ENGINEER")).toBe(STAFF_PRO_OTHER);
    expect(limitRefusal("contractors", "FREE", "ADMIN")).toBe(CONTRACTORS_FREE_ADMIN);
    expect(limitRefusal("contractors", "FREE", "PROJECT_MANAGER")).toBe(CONTRACTORS_FREE_OTHER);
    expect(limitRefusal("contractors", "PRO", "ADMIN")).toBe(CONTRACTORS_PRO_ADMIN);
    expect(limitRefusal("contractors", "PRO", "ENGINEER")).toBe(CONTRACTORS_PRO_OTHER);
  });

  it("reads every number in them from PLANS, so editing the file edits the sentence", () => {
    const original = { FREE: { ...PLANS.FREE }, PRO: { ...PLANS.PRO } };
    try {
      PLANS.FREE.users = 7;
      PLANS.PRO.users = 70;
      PLANS.FREE.contractors = 6;
      PLANS.PRO.contractors = 33;

      expect(limitRefusal("users", "FREE", "ADMIN")).toContain("room for 7 office staff");
      expect(limitRefusal("users", "FREE", "ADMIN")).toContain("include 7 — upgrade to Pro for 70.");
      expect(limitRefusal("users", "PRO", "ADMIN")).toContain("room for 70 office staff. Pro plans include 70.");
      expect(limitRefusal("contractors", "FREE", "ADMIN")).toContain("room for 6 contractors");
      expect(limitRefusal("contractors", "FREE", "ADMIN")).toContain("include 6 — upgrade to Pro for 33.");
      expect(limitRefusal("contractors", "PRO", "ADMIN")).toContain("room for 33 contractors. Pro plans include 33.");
      for (const text of [
        limitRefusal("users", "FREE", "ADMIN"),
        limitRefusal("users", "PRO", "ADMIN"),
        limitRefusal("contractors", "FREE", "ADMIN"),
        limitRefusal("contractors", "PRO", "ADMIN"),
      ]) {
        expect(text).not.toMatch(/\b(10|100|50)\b/);
      }
    } finally {
      Object.assign(PLANS.FREE, original.FREE);
      Object.assign(PLANS.PRO, original.PRO);
    }
  });

  it("says '1 contractor' in the singular", () => {
    expect(limitAmount("contractors", 1)).toBe("1 contractor");
    expect(limitAmount("contractors", 10)).toBe("10 contractors");
    expect(limitAmount("users", 10)).toBe("10 office staff");
  });
});

describe("every way in is asked for room", () => {
  it("refuses creating an office-staff account (password and invite) when staff is full", async () => {
    await fillStaffTo(10);
    expect(await refusalOf(addPerson(fixture.adminActor))).toBe(STAFF_FREE_ADMIN);
    expect(
      await refusalOf(
        createUser(fixture.adminActor, {
          email: nextEmail(),
          name: "Invited person",
          role: "PROJECT_MANAGER",
          mode: "INVITE",
        }),
      ),
    ).toBe(STAFF_FREE_ADMIN);
  });

  it("refuses creating a contractor (password and invite) when contractors are full", async () => {
    await fillContractorsTo(10);
    expect(await refusalOf(addContractor(fixture.adminActor))).toBe(CONTRACTORS_FREE_ADMIN);
    expect(await refusalOf(addContractor(fixture.adminActor, { mode: "INVITE" }))).toBe(CONTRACTORS_FREE_ADMIN);
  });

  it("refuses reactivating a deactivated person when their group is full — staff and contractors", async () => {
    await fillStaffTo(10);
    await fillContractorsTo(10);
    const [offStaff] = await bulkUsers(fixture.orgId, 1, "ENGINEER", {
      isActive: false,
      disciplineId: fixture.disciplineId,
    });
    const [offContractor] = await bulkUsers(fixture.orgId, 1, "EXTERNAL", { isActive: false });

    expect(await refusalOf(updateUser(fixture.adminActor, { id: offStaff, isActive: true }))).toBe(STAFF_FREE_ADMIN);
    expect(await refusalOf(updateUser(fixture.adminActor, { id: offContractor, isActive: true }))).toBe(
      CONTRACTORS_FREE_ADMIN,
    );
  });

  it("refuses extending a contractor whose access had ended — a new date or no date — when contractors are full", async () => {
    await fillContractorsTo(10);
    const [ended] = await bulkUsers(fixture.orgId, 1, "EXTERNAL", {
      accessExpiresAt: new Date(Date.now() - 5 * DAY),
    });

    expect(
      await refusalOf(updateUser(fixture.adminActor, { id: ended, accessExpiresAt: new Date(Date.now() + 30 * DAY) })),
    ).toBe(CONTRACTORS_FREE_ADMIN);
    expect(await refusalOf(updateUser(fixture.adminActor, { id: ended, accessExpiresAt: null }))).toBe(
      CONTRACTORS_FREE_ADMIN,
    );
  });

  it("refuses a contractor becoming office staff when staff is full, and the reverse", async () => {
    await fillStaffTo(10);
    await fillContractorsTo(9);
    const [contractor] = await bulkUsers(fixture.orgId, 1, "EXTERNAL");

    expect(
      await refusalOf(
        updateUser(fixture.adminActor, { id: contractor, role: "ENGINEER", disciplineId: fixture.disciplineId }),
      ),
    ).toBe(STAFF_FREE_ADMIN);

    // Now contractors are full (10) and staff has room: an engineer becoming a contractor is refused.
    await prisma.user.update({ where: { id: fixture.engineerActor.userId }, data: { isActive: false } });
    const [engineer] = await bulkUsers(fixture.orgId, 1, "ENGINEER", { disciplineId: fixture.disciplineId });
    expect(
      await refusalOf(
        updateUser(fixture.adminActor, { id: engineer, role: "EXTERNAL", companyName: "Gulf Inspection Services" }),
      ),
    ).toBe(CONTRACTORS_FREE_ADMIN);
  });

  it("writes no ActivityLog row for any of these refusals", async () => {
    await fillStaffTo(10);
    await fillContractorsTo(10);
    const [contractor] = await bulkUsers(fixture.orgId, 1, "EXTERNAL", { isActive: false });
    const before = await prisma.activityLog.count();

    await refusalOf(addPerson(fixture.adminActor));
    await refusalOf(addContractor(fixture.adminActor));
    await refusalOf(updateUser(fixture.adminActor, { id: contractor, isActive: true }));
    await refusalOf(
      updateUser(fixture.adminActor, {
        id: contractor,
        role: "ENGINEER",
        disciplineId: fixture.disciplineId,
        isActive: true,
      }),
    );

    expect(await prisma.activityLog.count()).toBe(before);
  });
});

describe("what is never refused, even with both groups full", () => {
  beforeEach(async () => {
    await fillStaffTo(10);
    await fillContractorsTo(10);
  });

  it("deactivating, renaming and changing job title or company", async () => {
    const [staffId] = await bulkUsers(fixture.orgId, 1, "PROJECT_MANAGER", { isActive: false });
    await prisma.user.update({ where: { id: staffId }, data: { isActive: true } });
    const [contractorId] = await bulkUsers(fixture.orgId, 1, "EXTERNAL");

    const renamed = await updateUser(fixture.adminActor, { id: staffId, name: "Layla R", jobTitle: "Lead" });
    expect(renamed.name).toBe("Layla R");
    const moved = await updateUser(fixture.adminActor, { id: contractorId, companyName: "New Employer LLC" });
    expect(moved.companyName).toBe("New Employer LLC");

    expect((await updateUser(fixture.adminActor, { id: staffId, isActive: false })).isActive).toBe(false);
    expect((await updateUser(fixture.adminActor, { id: contractorId, isActive: false })).isActive).toBe(false);
  });

  it("moving within a group (engineer to project manager), and shortening or extending a live contractor's date", async () => {
    const changed = await updateUser(fixture.adminActor, { id: fixture.engineerActor.userId, role: "PROJECT_MANAGER" });
    expect(changed.role).toBe("PROJECT_MANAGER");

    const [live] = await bulkUsers(fixture.orgId, 1, "EXTERNAL", { accessExpiresAt: new Date(Date.now() + 60 * DAY) });
    await updateUser(fixture.adminActor, { id: live, accessExpiresAt: new Date(Date.now() + 5 * DAY) });
    await updateUser(fixture.adminActor, { id: live, accessExpiresAt: new Date(Date.now() + 90 * DAY) });
    const open = await updateUser(fixture.adminActor, { id: live, accessExpiresAt: null });
    expect(open.isActive).toBe(true);
    // Shortening to a date that has already passed is never refused either.
    await updateUser(fixture.adminActor, { id: live, accessExpiresAt: new Date(Date.now() - 5 * DAY) });
  });

  it("resending an invitation", async () => {
    const { configureEmail, goDormant, mockFetchOk } = await import("@/server/__tests__/email-harness");
    const { resendInvite } = await import("@/server/services/account");
    configureEmail();
    const spy = mockFetchOk();
    try {
      const [pending] = await bulkUsers(fixture.orgId, 1, "PROJECT_MANAGER", { isActive: false });
      await prisma.user.update({ where: { id: pending }, data: { isActive: true } });
      await expect(resendInvite(fixture.adminActor, { id: pending })).resolves.toEqual({ sent: true });
    } finally {
      spy.mockRestore();
      goDormant();
    }
  });
});

describe("who counts, exactly", () => {
  it("counts neither a deactivated account nor an expired contractor, and the one-day grace matches isAccessExpired()", async () => {
    const staffBefore = await countOfficeStaff(fixture.orgId);
    await bulkUsers(fixture.orgId, 1, "ENGINEER", { isActive: false });
    await bulkUsers(fixture.orgId, 1, "EXTERNAL", { isActive: false });
    await bulkUsers(fixture.orgId, 1, "EXTERNAL", { accessExpiresAt: new Date(Date.now() - 5 * DAY) });
    expect(await countOfficeStaff(fixture.orgId)).toBe(staffBefore);
    expect(await countContractors(fixture.orgId)).toBe(0);

    // The date is "the last day they may work": an hour ago still counts, 25 hours ago does not.
    const now = new Date();
    const recent = new Date(now.getTime() - 60 * 60 * 1000);
    const older = new Date(now.getTime() - 25 * 60 * 60 * 1000);
    await bulkUsers(fixture.orgId, 1, "EXTERNAL", { accessExpiresAt: recent });
    await bulkUsers(fixture.orgId, 1, "EXTERNAL", { accessExpiresAt: older });
    expect(isAccessExpired({ role: "EXTERNAL", accessExpiresAt: recent }, now)).toBe(false);
    expect(isAccessExpired({ role: "EXTERNAL", accessExpiresAt: older }, now)).toBe(true);
    expect(await countContractors(fixture.orgId, now)).toBe(1);
  });

  it("the count query and updateUser's before/after question agree for every role, active and date", async () => {
    // Both groups full, so any move INTO a counted group is refused and any other move is not.
    await fillStaffTo(10);
    await fillContractorsTo(10);

    type State = { role: "ENGINEER" | "EXTERNAL"; isActive: boolean; accessExpiresAt: Date | null };
    const dates: (Date | null)[] = [
      null,
      new Date(Date.now() + 30 * DAY),
      new Date(Date.now() - 12 * 60 * 60 * 1000),
      new Date(Date.now() - 5 * DAY),
    ];
    const states: State[] = [];
    for (const isActive of [true, false]) {
      states.push({ role: "ENGINEER", isActive, accessExpiresAt: null });
      for (const accessExpiresAt of dates) states.push({ role: "EXTERNAL", isActive, accessExpiresAt });
    }

    const subjectId = (await bulkUsers(fixture.orgId, 1, "ENGINEER", { disciplineId: fixture.disciplineId }))[0];
    async function setState(state: State) {
      await prisma.user.update({
        where: { id: subjectId },
        data: {
          role: state.role,
          isActive: state.isActive,
          accessExpiresAt: state.accessExpiresAt,
          companyName: state.role === "EXTERNAL" ? "Gulf Inspection Services" : null,
          disciplineId: state.role === "ENGINEER" ? fixture.disciplineId : null,
        },
      });
    }
    async function counts() {
      return { staff: await countOfficeStaff(fixture.orgId), contractors: await countContractors(fixture.orgId) };
    }

    for (const before of states) {
      for (const after of states) {
        // What the count query says about this one person, before and after.
        await setState(before);
        const c0 = await counts();
        await setState(after);
        const c1 = await counts();
        const expectRefused = c1.staff > c0.staff || c1.contractors > c0.contractors;

        // And the app's own answer: the real updateUser, from the before state to the after state.
        await setState(before);
        const refused = await refusalOf(
          updateUser(fixture.adminActor, {
            id: subjectId,
            role: after.role,
            isActive: after.isActive,
            accessExpiresAt: after.role === "EXTERNAL" ? after.accessExpiresAt : undefined,
            companyName: after.role === "EXTERNAL" ? "Gulf Inspection Services" : undefined,
            disciplineId: after.role === "ENGINEER" ? fixture.disciplineId : undefined,
          }),
        );
        expect(refused !== "NOT REFUSED", `${JSON.stringify(before)} -> ${JSON.stringify(after)}`).toBe(expectRefused);

        // The pure helper says the same thing the two counts do.
        expect(peopleGroupOf(after) !== null && peopleGroupOf(after) !== peopleGroupOf(before)).toBe(expectRefused);
      }
    }
  }, 120_000);
});

describe("upgrading raises every ceiling at once", () => {
  it("moves office staff 10 to 100, contractors 10 to 50 and the AI allowance 2 to 25, and an unknown plan reads as FREE", async () => {
    const free = (await billingStatus(fixture.adminActor)).limits;
    expect(free.users).toBe(10);
    expect(free.contractors).toBe(10);
    expect(free.aiMonthlyUsd).toBe(2);

    await setPlan(fixture.orgId, "PRO");
    const pro = (await billingStatus(fixture.adminActor)).limits;
    expect(pro.users).toBe(100);
    expect(pro.contractors).toBe(50);
    expect(pro.aiMonthlyUsd).toBe(25);

    await setPlan(fixture.orgId, "PLATINUM");
    expect((await billingStatus(fixture.adminActor)).limits).toEqual(PLANS.FREE);
  });
});

describe("what the billing page is told about people", () => {
  it("reports office staff and contractors separately, and only an administrator may read it", async () => {
    await fillContractorsTo(4);
    await bulkUsers(fixture.orgId, 2, "EXTERNAL", { accessExpiresAt: new Date(Date.now() - 5 * DAY) });
    await bulkUsers(fixture.orgId, 1, "ENGINEER", { isActive: false });

    const { usage } = await billingStatus(fixture.adminActor);
    expect(usage.users).toBe(4);
    expect(usage.contractors).toBe(4);

    await expect(billingStatus(fixture.pmActor)).rejects.toThrow();
    await expect(billingStatus(fixture.engineerActor)).rejects.toThrow();
  });

  it("the plans carry real numbers for every people ceiling and the AI allowance", () => {
    for (const plan of ["FREE", "PRO"] as const) {
      expect(typeof PLANS[plan].users).toBe("number");
      expect(typeof PLANS[plan].contractors).toBe("number");
      expect(typeof PLANS[plan].aiMonthlyUsd).toBe("number");
    }
    expect(PLANS.PRO.projects).toBeNull();
  });
});
