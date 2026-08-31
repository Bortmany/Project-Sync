// Scoping proved at the service layer: someone who is not on a project is refused, not quietly
// handed an empty answer.
//
// The distinction matters. A listing that returns [] to an outsider looks fine in the UI and hides
// a missing check — the day the filter is written slightly differently, the outsider sees the lot.
// Every read below is asked twice: once by a member (who gets the data) and once by someone on a
// different project (who gets a refusal). The second person is deliberately a member of ANOTHER
// project, so "they have no projects" can never be the reason a test passes.

import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

process.env.DATA_DIR = path.join(os.tmpdir(), "nexus-test-data");

import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/permissions";
import { storeFile, validateUpload } from "@/lib/upload";
import { actorForUser, type ActorContext } from "@/server/actor";
import { NotFoundError } from "@/server/errors";
import { listActivity, listComments } from "@/server/services/comments";
import { getDashboardForActor } from "@/server/services/dashboard";
import {
  getVersionForDownload,
  listDocumentsForDisciplineTask,
  listDocumentsForMainTask,
  listDocumentsForProject,
  listVersions,
  uploadDocumentVersion,
} from "@/server/services/documents";
import { getProjectForActor, listProjectsForActor } from "@/server/services/projects";
import {
  createMainTask,
  getDisciplineTaskForActor,
  getMainTaskForActor,
  listMainTasksForProject,
  updateDisciplineTaskStatus,
} from "@/server/services/tasks";
import {
  inThirtyDays,
  makeProjectFixture,
  makeUser,
  resetDatabase,
  subtaskIdsByTitle,
  type Fixture,
} from "@/server/__tests__/harness";

let fixture: Fixture;

/** Everything in the project the outsider is NOT on. */
let theirs: {
  mainTaskId: string;
  disciplineTaskId: string;
  documentId: string;
  versionId: string;
};

/** The outsider, who is a full member of a different project of their own. */
let stranger: ActorContext;
let strangerProjectId: string;

const SECRET_TITLE = "Confidential flare tip replacement study";

beforeEach(async () => {
  await resetDatabase();
  fixture = await makeProjectFixture();

  const mainTask = await createMainTask(fixture.adminActor, {
    projectId: fixture.projectId,
    title: SECRET_TITLE,
    description: "Only people on this project may read this.",
    priority: "HIGH",
    deadline: inThirtyDays(),
    disciplineTasks: [
      {
        disciplineId: fixture.disciplineId,
        title: "Mechanical tip inspection",
        assigneeId: fixture.engineerActor.userId,
        deadline: inThirtyDays(),
        isMandatory: true,
        requiredDocuments: [],
      },
    ],
  });
  const disciplineTaskId = (await subtaskIdsByTitle(mainTask.id)).get(
    "Mechanical tip inspection",
  ) as string;

  const buffer = Buffer.from("item,discipline,status\n1,MECH,open\n", "utf8");
  const checked = validateUpload(buffer, "Flare tip register.csv");
  if (!checked.ok) throw new Error(checked.error);
  const stored = await storeFile(buffer, checked.ext);
  const version = await uploadDocumentVersion(
    fixture.pmActor,
    { projectId: fixture.projectId, mainTaskId: mainTask.id },
    {
      buffer,
      originalName: "Flare tip register.csv",
      mimeType: checked.mimeType,
      ext: checked.ext,
      sizeBytes: stored.sizeBytes,
      checksumSha256: stored.checksumSha256,
      storedFilename: stored.storedFilename,
    },
  );

  theirs = {
    mainTaskId: mainTask.id,
    disciplineTaskId,
    documentId: version.documentId,
    versionId: version.id,
  };

  // The stranger's own project, so every refusal below is about this project, not about having none.
  const other = await prisma.project.create({
    data: {
      orgId: fixture.orgId,
      name: "The stranger's own project",
      code: `OTHER-${Math.floor(Math.random() * 1_000_000)}`,
      description: "A project the outsider really is on.",
      createdById: fixture.adminActor.userId,
      members: { create: [{ userId: fixture.outsiderActor.userId, projectRole: "ENGINEER" }] },
    },
  });
  strangerProjectId = other.id;
  stranger = await actorForUser(fixture.outsiderActor.userId);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("a person on another project is refused, never given an empty answer", () => {
  it("refuses the project, its tasks and its discipline tasks", async () => {
    await expect(getProjectForActor(stranger, fixture.projectId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getMainTaskForActor(stranger, theirs.mainTaskId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getDisciplineTaskForActor(stranger, theirs.disciplineTaskId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("refuses the task listing rather than returning nothing", async () => {
    await expect(listMainTasksForProject(stranger, fixture.projectId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    // The same call for their own project works, which is what makes the refusal above meaningful.
    expect(await listMainTasksForProject(stranger, strangerProjectId)).toEqual([]);
  });

  it("refuses a filtered search of another project's tasks, however the search is worded", async () => {
    for (const q of ["flare", "Confidential", ""]) {
      await expect(
        listMainTasksForProject(stranger, fixture.projectId, { q }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }

    // And a member searching the same words does find it.
    const found = await listMainTasksForProject(fixture.engineerActor, fixture.projectId, {
      q: "flare tip",
    });
    expect(found.map((task) => task.title)).toEqual([SECRET_TITLE]);
  });

  it("refuses every document listing and the download metadata for a file it holds", async () => {
    await expect(listDocumentsForProject(stranger, fixture.projectId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(listDocumentsForMainTask(stranger, theirs.mainTaskId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(listDocumentsForDisciplineTask(stranger, theirs.disciplineTaskId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(listVersions(stranger, theirs.documentId)).rejects.toBeInstanceOf(ForbiddenError);

    // The download metadata is where a filename and a path would leak, so it is refused too.
    await expect(getVersionForDownload(stranger, theirs.versionId)).rejects.toBeInstanceOf(ForbiddenError);

    const allowed = await getVersionForDownload(fixture.engineerActor, theirs.versionId);
    expect((await readFile(allowed.absolutePath)).length).toBeGreaterThan(0);
  });

  it("refuses the comment threads and the audit trail", async () => {
    await expect(listComments(stranger, { mainTaskId: theirs.mainTaskId })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      listComments(stranger, { disciplineTaskId: theirs.disciplineTaskId }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listActivity(stranger, { projectId: fixture.projectId })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(listActivity(stranger, { mainTaskId: theirs.mainTaskId })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      listActivity(stranger, { disciplineTaskId: theirs.disciplineTaskId }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("shows them only their own project in the places that need no project id", async () => {
    const projects = await listProjectsForActor(stranger);
    expect(projects.map((project) => project.id)).toEqual([strangerProjectId]);

    const dashboard = await getDashboardForActor(stranger);
    const asText = JSON.stringify(dashboard);
    expect(asText).not.toContain(SECRET_TITLE);
    expect(asText).not.toContain(theirs.mainTaskId);
    expect(asText).not.toContain(fixture.projectId);
  });

  it("cannot change another project's work either", async () => {
    await expect(
      updateDisciplineTaskStatus(stranger, { id: theirs.disciplineTaskId, status: "IN_PROGRESS" }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const untouched = await prisma.disciplineTask.findUniqueOrThrow({
      where: { id: theirs.disciplineTaskId },
    });
    expect(untouched.status).toBe("NOT_STARTED");
  });
});

describe("being on the project is not the same as owning the work", () => {
  it("lets a member read the task but refuses them somebody else's assignment", async () => {
    const colleague = await makeUser({ name: "Sara Al Hinai", role: "ENGINEER" });
    await prisma.projectMember.create({
      data: {
        projectId: fixture.projectId,
        userId: colleague.id,
        projectRole: "ENGINEER",
        disciplineId: fixture.disciplineId,
      },
    });
    const colleagueActor = await actorForUser(colleague.id);

    // They may read it — they are on the project.
    const task = await getDisciplineTaskForActor(colleagueActor, theirs.disciplineTaskId);
    expect(task.id).toBe(theirs.disciplineTaskId);

    // They may not move it — it belongs to someone else.
    await expect(
      updateDisciplineTaskStatus(colleagueActor, {
        id: theirs.disciplineTaskId,
        status: "IN_PROGRESS",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("something that does not exist is not found, whoever asks", () => {
  it("says not found rather than leaking whether the id is real", async () => {
    const missing = "clzzzzzzzzzzzzzzzzzzzzzzzz";
    await expect(getMainTaskForActor(fixture.adminActor, missing)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getMainTaskForActor(stranger, missing)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getVersionForDownload(stranger, missing)).rejects.toBeInstanceOf(NotFoundError);
  });
});
