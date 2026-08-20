// Service-level tests for the document half of the golden rule: no revision is ever altered or lost,
// revision numbers only ever go up, a mandatory document really does open the completion gate, and a
// document can never be removed out from under a completed task.

import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

// Test uploads go to a throwaway folder, never the development data directory.
process.env.DATA_DIR = path.join(os.tmpdir(), "nexus-test-data");

import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/permissions";
import { storeFile, storedFilePath, validateUpload } from "@/lib/upload";
import type { UploadMeta } from "@/lib/zod-schemas";
import type { ActorContext } from "@/server/actor";
import { ServiceError } from "@/server/errors";
import {
  getVersionForDownload,
  listDocumentsForDisciplineTask,
  listDocumentsForMainTask,
  listVersions,
  softDeleteDocument,
  uploadDocumentVersion,
} from "@/server/services/documents";
import {
  completeDisciplineTask,
  createMainTask,
  reopenDisciplineTask,
} from "@/server/services/tasks";
import {
  inThirtyDays,
  makeProjectFixture,
  resetDatabase,
  subtaskIdsByTitle,
  type Fixture,
} from "@/server/__tests__/harness";

let fixture: Fixture;

beforeEach(async () => {
  await resetDatabase();
  fixture = await makeProjectFixture();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const CIVIL_TASK = "Civil foundation load check";
const OTHER_TASK = "Process safeguarding review sign-off";

/** A main task with two discipline tasks, each with one mandatory document outstanding. */
async function makeWork() {
  const mainTask = await createMainTask(fixture.adminActor, {
    projectId: fixture.projectId,
    title: "Complete engineering design review",
    description: "The test main task.",
    priority: "MEDIUM",
    deadline: inThirtyDays(),
    disciplineTasks: [CIVIL_TASK, OTHER_TASK].map((title) => ({
      disciplineId: fixture.disciplineId,
      title,
      assigneeId: fixture.engineerActor.userId,
      deadline: inThirtyDays(),
      isMandatory: true,
      requiredDocuments: [{ name: `${title} — signed report`, isMandatory: true }],
    })),
  });

  const byTitle = await subtaskIdsByTitle(mainTask.id);
  const civilId = byTitle.get(CIVIL_TASK) as string;
  const otherId = byTitle.get(OTHER_TASK) as string;

  const requirements = await prisma.requiredDocument.findMany({
    where: { disciplineTaskId: { in: [civilId, otherId] } },
    select: { id: true, disciplineTaskId: true },
  });
  const requirementFor = (taskId: string) =>
    requirements.find((item) => item.disciplineTaskId === taskId)?.id as string;

  return {
    mainTaskId: mainTask.id,
    civilId,
    otherId,
    civilRequirementId: requirementFor(civilId),
    otherRequirementId: requirementFor(otherId),
  };
}

/** Writes real bytes to disk the way the upload route does, then records them through the service. */
async function upload(
  actor: ActorContext,
  meta: Omit<UploadMeta, "projectId">,
  options: { filename?: string; body?: string } = {},
) {
  const filename = options.filename ?? "Master Engineering Review Register.csv";
  const buffer = Buffer.from(options.body ?? "item,discipline,status\n1,CIVIL,open\n", "utf8");

  const checked = validateUpload(buffer, filename);
  if (!checked.ok) throw new Error(checked.error);
  const stored = await storeFile(buffer, checked.ext);

  return uploadDocumentVersion(
    actor,
    { ...meta, projectId: fixture.projectId },
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

describe("revisions are only ever added, never altered or lost", () => {
  it("adds Rev 1 to the same document and leaves Rev 0 and its file untouched", async () => {
    const work = await makeWork();

    const first = await upload(fixture.pmActor, { mainTaskId: work.mainTaskId });
    expect(first.revisionNumber).toBe(0);

    const rev0Row = await prisma.documentVersion.findUniqueOrThrow({ where: { id: first.id } });
    const rev0Bytes = await readFile(storedFilePath(rev0Row.storedFilename));

    const second = await upload(
      fixture.pmActor,
      { documentId: first.documentId },
      { body: "item,discipline,status\n1,CIVIL,closed\n" },
    );
    expect(second.revisionNumber).toBe(1);
    expect(second.documentId).toBe(first.documentId);

    const rev0After = await prisma.documentVersion.findUniqueOrThrow({ where: { id: first.id } });
    expect(rev0After.revisionNumber).toBe(0);
    expect(rev0After.storedFilename).toBe(rev0Row.storedFilename);
    expect(rev0After.checksumSha256).toBe(rev0Row.checksumSha256);
    expect(await readFile(storedFilePath(rev0After.storedFilename))).toEqual(rev0Bytes);

    const document = await prisma.document.findUniqueOrThrow({ where: { id: first.documentId } });
    expect(document.currentVersionId).toBe(second.id);

    const history = await listVersions(fixture.pmActor, first.documentId);
    expect(history.map((version) => version.revisionNumber)).toEqual([1, 0]);
    expect(history[0].downloadUrl).toBe(`/api/documents/versions/${second.id}/download`);
  });

  it("gives two uploads that land together two different revision numbers", async () => {
    // The smallest possible race, written out on its own: two people press Upload on the same
    // document at the same moment. Neither may overwrite the other, and the document must end up
    // pointing at the higher of the two.
    const work = await makeWork();
    const first = await upload(fixture.pmActor, { mainTaskId: work.mainTaskId });

    const [a, b] = await Promise.all([
      upload(fixture.pmActor, { documentId: first.documentId }, { body: "revision,a\n" }),
      upload(fixture.engineerActor, { documentId: first.documentId }, { body: "revision,b\n" }),
    ]);

    expect(a.revisionNumber).not.toBe(b.revisionNumber);
    expect([a.revisionNumber, b.revisionNumber].sort()).toEqual([1, 2]);
    expect(a.id).not.toBe(b.id);

    const rows = await prisma.documentVersion.findMany({ where: { documentId: first.documentId } });
    expect(rows).toHaveLength(3);

    const document = await prisma.document.findUniqueOrThrow({ where: { id: first.documentId } });
    const highest = rows.reduce((best, row) => (row.revisionNumber > best.revisionNumber ? row : best));
    expect(highest.revisionNumber).toBe(2);
    expect(document.currentVersionId).toBe(highest.id);

    // Both uploads are in the audit trail — one row each, nothing swallowed by the race.
    expect(
      await prisma.activityLog.count({
        where: { entityType: "Document", entityId: first.documentId, action: "DOCUMENT_UPLOADED" },
      }),
    ).toBe(3);
  });

  it("keeps revision numbers monotonic when four uploads land at once", async () => {
    const work = await makeWork();
    const first = await upload(fixture.pmActor, { mainTaskId: work.mainTaskId });

    const concurrent = await Promise.all(
      [1, 2, 3, 4].map((n) =>
        upload(fixture.pmActor, { documentId: first.documentId }, { body: `revision,${n}\n` }),
      ),
    );

    const numbers = [first, ...concurrent].map((version) => version.revisionNumber).sort((a, b) => a - b);
    expect(numbers).toEqual([0, 1, 2, 3, 4]);

    const rows = await prisma.documentVersion.findMany({ where: { documentId: first.documentId } });
    expect(rows).toHaveLength(5);

    const document = await prisma.document.findUniqueOrThrow({ where: { id: first.documentId } });
    const highest = rows.reduce((best, row) => (row.revisionNumber > best.revisionNumber ? row : best));
    expect(document.currentVersionId).toBe(highest.id);
    expect(highest.revisionNumber).toBe(4);
  });

  it("appends exactly one audit row per upload", async () => {
    const work = await makeWork();
    const first = await upload(fixture.pmActor, { mainTaskId: work.mainTaskId });

    const afterOne = await prisma.activityLog.findMany({
      where: { entityType: "Document", entityId: first.documentId },
    });
    expect(afterOne).toHaveLength(1);
    expect(afterOne[0].action).toBe("DOCUMENT_UPLOADED");
    expect(afterOne[0].summary).toContain("Rev 0");

    await upload(fixture.pmActor, { documentId: first.documentId });
    const afterTwo = await prisma.activityLog.findMany({
      where: { entityType: "Document", entityId: first.documentId },
    });
    expect(afterTwo).toHaveLength(2);
    expect(afterTwo.some((row) => row.summary.includes("Rev 1"))).toBe(true);
  });
});

describe("mandatory documents open and close the completion gate", () => {
  it("lets a task complete once its mandatory document is in, and not before", async () => {
    const work = await makeWork();

    await expect(completeDisciplineTask(fixture.engineerActor, { id: work.civilId })).rejects.toThrow(
      ServiceError,
    );

    await upload(fixture.engineerActor, {
      disciplineTaskId: work.civilId,
      requiredDocumentId: work.civilRequirementId,
    });

    const requirement = await prisma.requiredDocument.findUniqueOrThrow({
      where: { id: work.civilRequirementId },
    });
    expect(requirement.documentId).not.toBeNull();
    expect(requirement.satisfiedAt).not.toBeNull();

    const completed = await completeDisciplineTask(fixture.engineerActor, { id: work.civilId });
    expect(completed.status).toBe("COMPLETED");
  });

  it("refuses a checklist item that belongs to a different task", async () => {
    const work = await makeWork();

    await expect(
      upload(fixture.engineerActor, {
        disciplineTaskId: work.civilId,
        requiredDocumentId: work.otherRequirementId,
      }),
    ).rejects.toThrow(ServiceError);

    const untouched = await prisma.requiredDocument.findUniqueOrThrow({
      where: { id: work.otherRequirementId },
    });
    expect(untouched.documentId).toBeNull();
    expect(untouched.satisfiedAt).toBeNull();
  });
});

describe("only people on the project see the files", () => {
  it("refuses a download to someone who is not on the project", async () => {
    const work = await makeWork();
    const version = await upload(fixture.pmActor, { mainTaskId: work.mainTaskId });

    await expect(getVersionForDownload(fixture.outsiderActor, version.id)).rejects.toThrow(ForbiddenError);

    const allowed = await getVersionForDownload(fixture.engineerActor, version.id);
    expect(allowed.originalFilename).toBe("Master Engineering Review Register.csv");
    expect(allowed.mimeType).toBe("text/csv");
  });

  it("shows a main task both its own documents and its discipline tasks' documents", async () => {
    const work = await makeWork();
    await upload(fixture.pmActor, { mainTaskId: work.mainTaskId });
    await upload(fixture.engineerActor, { disciplineTaskId: work.civilId }, { filename: "Markup.csv" });

    const documents = await listDocumentsForMainTask(fixture.engineerActor, work.mainTaskId);
    expect(documents).toHaveLength(2);
    expect(documents.filter((doc) => doc.disciplineTaskId === work.civilId)).toHaveLength(1);
    expect(documents.filter((doc) => doc.mainTaskId === work.mainTaskId)).toHaveLength(1);
    expect(documents.every((doc) => doc.currentRevision?.revisionNumber === 0)).toBe(true);
  });
});

describe("removing a document never removes a revision", () => {
  it("is refused while the task it proves is complete, and reopens the checklist item afterwards", async () => {
    const work = await makeWork();
    const version = await upload(fixture.engineerActor, {
      disciplineTaskId: work.civilId,
      requiredDocumentId: work.civilRequirementId,
    });
    await upload(fixture.engineerActor, { documentId: version.documentId });
    await completeDisciplineTask(fixture.engineerActor, { id: work.civilId });

    await expect(softDeleteDocument(fixture.adminActor, { id: version.documentId })).rejects.toThrow(
      "This document satisfies a requirement on a completed task. Reopen the task first.",
    );

    // A refused delete leaves nothing behind — no audit row for a deletion that never happened.
    expect(
      await prisma.activityLog.count({
        where: { entityType: "Document", entityId: version.documentId, action: "DOCUMENT_DELETED" },
      }),
    ).toBe(0);

    const stillSatisfied = await prisma.requiredDocument.findUniqueOrThrow({
      where: { id: work.civilRequirementId },
    });
    expect(stillSatisfied.documentId).toBe(version.documentId);
    expect(await prisma.documentVersion.count({ where: { documentId: version.documentId } })).toBe(2);

    await reopenDisciplineTask(fixture.adminActor, {
      id: work.civilId,
      reason: "The load calculation was superseded.",
    });

    const result = await softDeleteDocument(fixture.adminActor, { id: version.documentId });
    expect(result.deleted).toBe(true);

    const reopened = await prisma.requiredDocument.findUniqueOrThrow({
      where: { id: work.civilRequirementId },
    });
    expect(reopened.documentId).toBeNull();
    expect(reopened.satisfiedAt).toBeNull();

    // Both revisions and their files are still there — only the document is out of sight.
    const rows = await prisma.documentVersion.findMany({ where: { documentId: version.documentId } });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect((await readFile(storedFilePath(row.storedFilename))).length).toBeGreaterThan(0);
    }

    expect(await listDocumentsForDisciplineTask(fixture.adminActor, work.civilId)).toHaveLength(0);
    await expect(getVersionForDownload(fixture.adminActor, version.id)).rejects.toThrow(ServiceError);

    // And the task can no longer be completed, because its mandatory document is outstanding again.
    await expect(completeDisciplineTask(fixture.engineerActor, { id: work.civilId })).rejects.toThrow(
      ServiceError,
    );

    const audit = await prisma.activityLog.findMany({
      where: { entityType: "Document", entityId: version.documentId, action: "DOCUMENT_DELETED" },
    });
    expect(audit).toHaveLength(1);
    // Written inside the same transaction as the delete, so it records exactly what that
    // transaction reopened and how many revisions it kept.
    expect(audit[0].summary).toContain("1 checklist item is open again");
    expect(audit[0].metadata).toMatchObject({
      documentId: version.documentId,
      reopenedRequirements: [{ id: work.civilRequirementId }],
      versionsKept: 2,
    });
  });

  it("only lets an administrator or project manager remove a document", async () => {
    const work = await makeWork();
    const version = await upload(fixture.engineerActor, { disciplineTaskId: work.civilId });

    await expect(softDeleteDocument(fixture.engineerActor, { id: version.documentId })).rejects.toThrow(
      ForbiddenError,
    );
    expect(await prisma.documentVersion.count({ where: { documentId: version.documentId } })).toBe(1);
  });
});
