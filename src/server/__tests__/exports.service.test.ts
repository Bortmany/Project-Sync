// DATA RIGHTS, proved: a company's export holds that company and nothing else, a person's export
// holds that person and nothing else, and neither one ever carries a password, a token or a
// webhook address.
//
// The company half is checked by unzipping the archive the job actually wrote and reading it — both
// row by row (every `orgId` in it is the right one) and byte by byte (the other company's words do
// not appear anywhere in the file, JSON, file names and README included).

import { readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

process.env.DATA_DIR = path.join(os.tmpdir(), "tielora-test-exports");
process.env.SWEEP_DISABLED = "1";

import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/permissions";
import { storeFile, validateUpload } from "@/lib/upload";
import { readZip } from "@/lib/zip";
import { actorForUser, type ActorContext } from "@/server/actor";
import { NotFoundError, ServiceError } from "@/server/errors";
import { uploadDocumentVersion } from "@/server/services/documents";
import { createComment } from "@/server/services/comments";
import { saveIntegration } from "@/server/services/integrations";
import { createMainTask } from "@/server/services/tasks";
import { createPersonalTask } from "@/server/services/personal-tasks";
import { toggleFavorite } from "@/server/services/favorites";
import { deleteMyAccount } from "@/server/services/account-deletion";
import { downloadMyData, personalExportThrottle } from "@/server/services/personal-export";
import {
  EXPORT_FILE_TTL_MS,
  exportDownload,
  exportsDir,
  forgetExportLinks,
  startWorkspaceExport,
  sweepExportFiles,
  whenExportSettles,
  workspaceExportStatus,
} from "@/server/services/workspace-export";
import {
  inThirtyDays,
  makeOrg,
  makeProjectFixture,
  makeUser,
  resetDatabase,
  subtaskIdsByTitle,
  type Fixture,
} from "@/server/__tests__/harness";

/** A distinctive word per company, so a leak is visible in the raw bytes of the archive. */
const ALPHA = "AlphaOnlyMarker";
const BETA = "BetaOnlyMarker";

/** A password hash that could not possibly appear by accident. */
const SECRET_HASH = "$argon2id$v=19$m=65536$NEVER-IN-AN-EXPORT";

/** A Slack address whose secret half must never leave the database. */
const SLACK_URL = "https://hooks.slack.com/services/T00000000/B00000000/NEVERexportTHISbit";

let alpha: Fixture;
let beta: Fixture;

async function seedCompany(fixture: Fixture, marker: string): Promise<void> {
  const deadline = inThirtyDays();
  const mainTask = await createMainTask(fixture.adminActor, {
    projectId: fixture.projectId,
    title: `${marker} main task`,
    description: `Everything about ${marker}.`,
    priority: "MEDIUM",
    deadline,
    ownerId: fixture.pmActor.userId,
    disciplineTasks: [
      {
        disciplineId: fixture.disciplineId,
        title: `${marker} discipline task`,
        assigneeId: fixture.engineerActor.userId,
        deadline,
        isMandatory: true,
        requiredDocuments: [],
      },
    ],
  });

  const disciplineTaskId = (await subtaskIdsByTitle(mainTask.id)).get(
    `${marker} discipline task`,
  ) as string;

  await createComment(fixture.engineerActor, {
    disciplineTaskId,
    body: `A comment that only ${marker} should ever hold.`,
    mentions: [],
  });

  const buffer = Buffer.from(`line,value\n1,${marker}\n`, "utf8");
  const checked = validateUpload(buffer, `${marker}.csv`);
  if (!checked.ok) throw new Error(checked.error);
  const stored = await storeFile(buffer, checked.ext);
  await uploadDocumentVersion(
    fixture.pmActor,
    { projectId: fixture.projectId, mainTaskId: mainTask.id },
    {
      buffer,
      originalName: `${marker}.csv`,
      mimeType: checked.mimeType,
      ext: checked.ext,
      sizeBytes: stored.sizeBytes,
      checksumSha256: stored.checksumSha256,
      storedFilename: stored.storedFilename,
    },
  );

  await prisma.user.update({
    where: { id: fixture.adminActor.userId },
    data: { passwordHash: SECRET_HASH },
  });
}

type Archive = { entries: Map<string, Buffer>; raw: Buffer; token: string };

/** Runs the whole journey: ask for an export, wait for the job, then fetch and unzip the file. */
async function exportFor(actor: ActorContext): Promise<Archive> {
  await startWorkspaceExport(actor);
  await whenExportSettles();

  const status = await workspaceExportStatus(actor);
  expect(status.state).toBe("READY");
  expect(status.downloadUrl).toBeTruthy();

  const token = new URL(status.downloadUrl!, "https://example.test").searchParams.get("token")!;
  const file = await exportDownload(actor, token);
  const raw = await readFile(file.absolutePath);

  return { entries: new Map(readZip(raw).map((e) => [e.name, e.data])), raw, token };
}

function rowsOf(archive: Archive, name: string): Record<string, unknown>[] {
  const entry = archive.entries.get(name);
  if (!entry) throw new Error(`The archive has no ${name}`);
  return JSON.parse(entry.toString("utf8")) as Record<string, unknown>[];
}

beforeEach(async () => {
  await resetDatabase();
  forgetExportLinks();

  alpha = await makeProjectFixture((await makeOrg("Alpha Engineering")).id);
  beta = await makeProjectFixture((await makeOrg("Beta Engineering")).id);
  await seedCompany(alpha, ALPHA);
  await seedCompany(beta, BETA);
});

afterAll(async () => {
  await rm(exportsDir(), { recursive: true, force: true });
  await prisma.$disconnect();
});

/* ------------------------------------------------------------------ */
/* The workspace export                                                */
/* ------------------------------------------------------------------ */

describe("the workspace export", () => {
  it("holds this company's rows and not one row of the other's", async () => {
    const archive = await exportFor(alpha.adminActor);

    for (const name of ["users.json", "disciplines.json", "projects.json"]) {
      const rows = rowsOf(archive, name);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.orgId === alpha.orgId)).toBe(true);
      expect(rows.some((row) => row.orgId === beta.orgId)).toBe(false);
    }

    const comments = rowsOf(archive, "comments.json");
    expect(comments).toHaveLength(1);
    expect(String(comments[0]!.body)).toContain(ALPHA);

    const mainTasks = rowsOf(archive, "main-tasks.json");
    expect(mainTasks.every((row) => row.projectId === alpha.projectId)).toBe(true);

    // And nothing of the other company anywhere in the file — not in a JSON row, not in a file
    // name, not in the readme.
    expect(archive.raw.includes(Buffer.from(BETA, "utf8"))).toBe(false);
    expect(archive.raw.includes(Buffer.from(beta.orgId, "utf8"))).toBe(false);
    expect(archive.raw.includes(Buffer.from(beta.projectId, "utf8"))).toBe(false);
  });

  it("carries no password, no token and no webhook address", async () => {
    await saveIntegration(alpha.adminActor, { kind: "SLACK", webhookUrl: SLACK_URL });
    await prisma.session.create({
      data: {
        userId: alpha.adminActor.userId,
        tokenHash: "session-hash-that-must-never-be-exported",
        expiresAt: inThirtyDays(),
      },
    });
    await prisma.emailToken.create({
      data: {
        userId: alpha.adminActor.userId,
        purpose: "RESET",
        tokenHash: "email-token-hash-that-must-never-be-exported",
        expiresAt: inThirtyDays(),
      },
    });

    const archive = await exportFor(alpha.adminActor);

    expect(archive.raw.includes(Buffer.from(SECRET_HASH, "utf8"))).toBe(false);
    expect(archive.raw.includes(Buffer.from("passwordHash", "utf8"))).toBe(false);
    expect(archive.raw.includes(Buffer.from("tokenHash", "utf8"))).toBe(false);
    expect(archive.raw.includes(Buffer.from("session-hash-that-must-never-be-exported", "utf8"))).toBe(false);
    expect(archive.raw.includes(Buffer.from("email-token-hash-that-must-never-be-exported", "utf8"))).toBe(false);
    expect(archive.raw.includes(Buffer.from("NEVERexportTHISbit", "utf8"))).toBe(false);
    expect(archive.raw.includes(Buffer.from("webhookUrl", "utf8"))).toBe(false);

    // The chat channel is still in the export — as scheme and host, exactly what the admin screen
    // is allowed to show.
    const integrations = rowsOf(archive, "chat-integrations.json");
    expect(integrations).toHaveLength(1);
    expect(String(integrations[0]!.webhookAddress)).toContain("hooks.slack.com");
    expect(String(integrations[0]!.webhookAddress)).not.toContain("NEVERexport");
  });

  it("includes this company's uploaded files and not the other's", async () => {
    const mine = await prisma.documentVersion.findMany({
      where: { document: { project: { orgId: alpha.orgId } } },
      select: { storedFilename: true },
    });
    const theirs = await prisma.documentVersion.findMany({
      where: { document: { project: { orgId: beta.orgId } } },
      select: { storedFilename: true },
    });

    const archive = await exportFor(alpha.adminActor);
    const files = [...archive.entries.keys()].filter((name) => name.startsWith("files/"));

    expect(files).toHaveLength(mine.length);
    for (const version of mine) expect(files).toContain(`files/${version.storedFilename}`);
    for (const version of theirs) expect(files).not.toContain(`files/${version.storedFilename}`);

    expect(archive.entries.get(`files/${mine[0]!.storedFilename}`)?.toString("utf8")).toContain(ALPHA);
    expect(archive.entries.has("README.txt")).toBe(true);
  });

  it("writes an organisation-level audit row for the request and the result, carrying no link", async () => {
    await exportFor(alpha.adminActor);

    const rows = await prisma.activityLog.findMany({
      where: { entityType: "Organization", entityId: alpha.orgId },
      orderBy: { createdAt: "asc" },
      select: { action: true, projectId: true, metadata: true, summary: true },
    });

    const actions = rows.map((row) => row.action);
    expect(actions).toContain("EXPORT_STARTED");
    expect(actions).toContain("EXPORT_READY");
    expect(rows.every((row) => row.projectId === null)).toBe(true);

    const ready = rows.find((row) => row.action === "EXPORT_READY")!;
    const metadata = ready.metadata as Record<string, unknown>;
    expect(typeof metadata.sizeBytes).toBe("number");
    expect(metadata.fileCount).toBe(1);
    expect(JSON.stringify(metadata)).not.toContain("token");
    expect(JSON.stringify(metadata)).not.toContain(".zip");
  });

  it("refuses a second export the same day, and says so plainly", async () => {
    await exportFor(alpha.adminActor);

    await expect(startWorkspaceExport(alpha.adminActor)).rejects.toBeInstanceOf(ServiceError);
    await expect(startWorkspaceExport(alpha.adminActor)).rejects.toThrow(/already asked for a full export today/i);

    const status = await workspaceExportStatus(alpha.adminActor);
    expect(status.canStart).toBe(false);
    expect(status.nextAllowedAt).not.toBeNull();

    // The other company is not held up by it in any way.
    const other = await workspaceExportStatus(beta.adminActor);
    expect(other.canStart).toBe(true);
  });

  it("lets the day's window reopen once 24 hours have passed", async () => {
    await exportFor(alpha.adminActor);
    const tomorrow = new Date(Date.now() + 25 * 60 * 60 * 1000);

    const status = await workspaceExportStatus(alpha.adminActor, tomorrow);
    expect(status.canStart).toBe(true);
    expect(status.nextAllowedAt).toBeNull();
  });

  it("is refused to anybody who is not an administrator", async () => {
    await expect(startWorkspaceExport(alpha.engineerActor)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(workspaceExportStatus(alpha.pmActor)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("the export download", () => {
  it("needs the token AND an administrator of that same company", async () => {
    const archive = await exportFor(alpha.adminActor);

    // The administrator who asked: fine, and again, because a GET spends nothing.
    await expect(exportDownload(alpha.adminActor, archive.token)).resolves.toMatchObject({
      sizeBytes: expect.any(Number),
    });
    await expect(exportDownload(alpha.adminActor, archive.token)).resolves.toBeTruthy();

    // Another company's administrator, holding a perfectly valid token: not found.
    await expect(exportDownload(beta.adminActor, archive.token)).rejects.toBeInstanceOf(NotFoundError);

    // Somebody of the right company who is not an administrator: refused before the token counts.
    await expect(exportDownload(alpha.engineerActor, archive.token)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("refuses an expired link", async () => {
    const archive = await exportFor(alpha.adminActor);

    await prisma.emailToken.updateMany({
      where: { purpose: "EXPORT" },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    await expect(exportDownload(alpha.adminActor, archive.token)).rejects.toBeInstanceOf(NotFoundError);
    await expect(exportDownload(alpha.adminActor, archive.token)).rejects.toThrow(/no longer works/i);
  });

  it("refuses a token that was never minted", async () => {
    await exportFor(alpha.adminActor);
    await expect(exportDownload(alpha.adminActor, "f".repeat(64))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("gives each administrator a link of their own, so one leaving cannot break the others", async () => {
    const archive = await exportFor(alpha.adminActor);

    const second = await makeUser({ name: "Second Admin", role: "ADMIN", orgId: alpha.orgId });
    const secondActor = await actorForUser(second.id);

    // The second administrator's status read mints a token against THEIR account, not a shared one.
    const theirs = await workspaceExportStatus(secondActor);
    const theirToken = new URL(theirs.downloadUrl!, "https://example.test").searchParams.get("token")!;
    expect(theirToken).not.toBe(archive.token);
    await expect(exportDownload(secondActor, theirToken)).resolves.toBeTruthy();

    // Now the administrator who asked for the export deletes their account — their EXPORT tokens go
    // with it. The other administrator's link keeps working; theirs stops, as it must.
    await deleteMyAccount(alpha.adminActor, { confirm: "DELETE" });

    await expect(exportDownload(secondActor, theirToken)).resolves.toBeTruthy();
    await expect(exportDownload(secondActor, archive.token)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("stores only the hash of the download token, never the token itself", async () => {
    const archive = await exportFor(alpha.adminActor);
    const rows = await prisma.emailToken.findMany({ where: { purpose: "EXPORT" } });

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.tokenHash !== archive.token)).toBe(true);
    expect(rows.every((row) => row.userId === alpha.adminActor.userId)).toBe(true);
  });
});

describe("cleaning up old archives", () => {
  it("deletes an archive older than 48 hours and leaves a fresh one alone", async () => {
    await exportFor(alpha.adminActor);

    const old = path.join(exportsDir(), "an-old-export.zip");
    await writeFile(old, Buffer.from("PK", "utf8"));
    const longAgo = new Date(Date.now() - EXPORT_FILE_TTL_MS - 60_000);
    await utimes(old, longAgo, longAgo);

    const removed = await sweepExportFiles();
    expect(removed).toBeGreaterThanOrEqual(1);
    await expect(stat(old)).rejects.toBeTruthy();

    // Today's export is untouched, and still downloadable.
    const status = await workspaceExportStatus(alpha.adminActor);
    expect(status.state).toBe("READY");
  });
});

/* ------------------------------------------------------------------ */
/* The personal export                                                 */
/* ------------------------------------------------------------------ */

describe("downloading your own data", () => {
  it("carries this person's own rows and nobody else's", async () => {
    const disciplineTaskId = (
      await prisma.disciplineTask.findFirstOrThrow({
        where: { mainTask: { project: { orgId: alpha.orgId } } },
        select: { id: true },
      })
    ).id;

    await createComment(alpha.pmActor, {
      disciplineTaskId,
      body: "The manager's own note.",
      mentions: [],
    });
    await createPersonalTask(alpha.engineerActor, { title: "Ring the vendor" });
    await toggleFavorite(alpha.engineerActor, { targetType: "PROJECT", targetId: alpha.projectId });

    // One notification each, so "your own and nobody else's" can be checked in both directions.
    await prisma.notification.createMany({
      data: [
        {
          userId: alpha.engineerActor.userId,
          type: "ASSIGNED",
          title: "For the engineer only",
          body: "Yours.",
          linkUrl: "/my-tasks",
        },
        {
          userId: alpha.pmActor.userId,
          type: "ASSIGNED",
          title: "For the manager only",
          body: "Theirs.",
          linkUrl: "/my-tasks",
        },
      ],
    });

    const engineer = await downloadMyData(alpha.engineerActor);

    expect(engineer.profile.email).toBe(alpha.engineerActor.email);
    expect(engineer.comments).toHaveLength(1);
    expect(engineer.comments[0]!.body).toContain(ALPHA);
    expect(engineer.comments.some((row) => row.body.includes("manager's own note"))).toBe(false);
    expect(engineer.assignedTasks).toHaveLength(1);
    expect(engineer.personalList.map((row) => row.title)).toEqual(["Ring the vendor"]);
    expect(engineer.favorites).toHaveLength(1);

    const engineerTitles = engineer.notifications.map((row) => row.title);
    expect(engineerTitles).toContain("For the engineer only");
    expect(engineerTitles).not.toContain("For the manager only");

    const manager = await downloadMyData(alpha.pmActor);
    expect(manager.personalList).toHaveLength(0);
    expect(manager.favorites).toHaveLength(0);
    expect(manager.comments).toHaveLength(1);
    expect(manager.comments[0]!.body).toContain("manager's own note");

    const managerTitles = manager.notifications.map((row) => row.title);
    expect(managerTitles).toContain("For the manager only");
    expect(managerTitles).not.toContain("For the engineer only");
  });

  it("writes exactly one audit row, naming nothing that was in the file", async () => {
    await downloadMyData(alpha.engineerActor);

    const rows = await prisma.activityLog.findMany({
      where: { action: "PERSONAL_EXPORT" },
      select: { actorId: true, projectId: true, entityType: true, entityId: true, summary: true },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: alpha.engineerActor.userId,
      projectId: null,
      entityType: "User",
      entityId: alpha.engineerActor.userId,
    });
    expect(rows[0]!.summary).not.toContain("@");
  });

  it("holds no password, hash or token, even though it holds the person's own profile", async () => {
    const mine = await downloadMyData(alpha.adminActor);
    const bytes = JSON.stringify(mine);

    expect(bytes).not.toContain(SECRET_HASH);
    expect(bytes).not.toContain("passwordHash");
    expect(bytes).not.toContain("tokenHash");
    expect(bytes).toContain(alpha.adminActor.email);
  });

  it("narrows a contractor's copy to their own reach", async () => {
    const contractor = await makeUser({ name: "Yusuf Contractor", role: "EXTERNAL", orgId: alpha.orgId });
    await prisma.projectMember.create({
      data: { projectId: alpha.projectId, userId: contractor.id, projectRole: "EXTERNAL" },
    });
    const contractorActor = await actorForUser(contractor.id);

    // A membership row with no live work on it: the project must NOT appear in their copy.
    const empty = await downloadMyData(contractorActor);
    expect(empty.projects).toHaveLength(0);
    expect(empty.assignedTasks).toHaveLength(0);
    expect(empty.comments).toHaveLength(0);

    // Now give them one task, and only that one appears.
    const theirTask = await prisma.disciplineTask.findFirstOrThrow({
      where: { mainTask: { project: { orgId: alpha.orgId } } },
      select: { id: true },
    });
    await prisma.disciplineTask.update({
      where: { id: theirTask.id },
      data: { assigneeId: contractor.id },
    });
    const withWork = await downloadMyData(await actorForUser(contractor.id));

    expect(withWork.projects.map((row) => row.projectCode)).toHaveLength(1);
    expect(withWork.assignedTasks).toHaveLength(1);
    // Somebody else's comment on that same task is still not theirs to take away.
    expect(withWork.comments).toHaveLength(0);
  });

  it("allows three copies a day and refuses the fourth", () => {
    const userId = `rate-limit-${Date.now()}`;

    expect(personalExportThrottle(userId).ok).toBe(true);
    expect(personalExportThrottle(userId).ok).toBe(true);
    expect(personalExportThrottle(userId).ok).toBe(true);

    const refused = personalExportThrottle(userId);
    expect(refused.ok).toBe(false);
    expect(refused.retryAfterSec).toBeGreaterThan(0);
  });
});
