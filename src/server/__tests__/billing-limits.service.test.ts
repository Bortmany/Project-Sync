// Plans and limits, proved at the three choke points.
//
// The rule under test is the same one in all three places: what a company already has is never
// blocked — it reads, opens and downloads exactly as before — and only ADDING MORE is refused once
// the plan's ceiling is reached. That is what makes a future downgrade safe, and it is the case
// most likely to be broken by accident, so it is tested directly.

import { readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

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
import { PLANS, planOf } from "@/lib/plan-limits";
import { storeFile, uploadsDir, validateUpload } from "@/lib/upload";
import type { ActorContext } from "@/server/actor";
import { ServiceError } from "@/server/errors";
import { createUser, updateUser } from "@/server/services/admin";
import { billingStatus } from "@/server/services/billing";
import { uploadDocumentVersion } from "@/server/services/documents";
import { createProject, listProjectsForActor } from "@/server/services/projects";
import { createMainTask } from "@/server/services/tasks";
import {
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
      "Your plan has room for 10 people. Free plans include 10 — upgrade to Pro for unlimited. See plans in Admin → Billing.",
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

  it("does not count a contractor whose access has run out", async () => {
    const before = (await billingStatus(fixture.adminActor)).usage.users;
    await addExpiredContractor(5);

    const after = await billingStatus(fixture.adminActor);
    expect(after.usage.users).toBe(before);
  });

  it("does count a contractor whose last day has not passed yet", async () => {
    const before = (await billingStatus(fixture.adminActor)).usage.users;
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

    expect((await billingStatus(fixture.adminActor)).usage.users).toBe(before + 1);
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
