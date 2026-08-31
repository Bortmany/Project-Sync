// THE TENANT GUARANTEE, proved: two companies live in one database and neither can reach the other.
//
// Two organisations are built side by side with deliberately identical-looking work — the same task
// title, the same discipline codes, the same project code — and then every door in the app is tried
// from the wrong side. An ADMINISTRATOR does the trying, because an administrator is the most
// powerful person there is: being an admin makes you the administrator of your OWN company only.
//
// A cross-company read is "not found", never "forbidden": telling an outsider that an id is real is
// itself a leak.

import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.DATA_DIR = path.join(os.tmpdir(), "tielora-test-data");

import { prisma } from "@/lib/db";
import { searchEverything } from "@/lib/search";
import { ForbiddenError } from "@/lib/permissions";
import { storeFile, validateUpload } from "@/lib/upload";
import type { ActorContext } from "@/server/actor";
import { NotFoundError, ServiceError } from "@/server/errors";
import { createUser, deactivateUser, listAllUsers, updateUser } from "@/server/services/admin";
import { createComment, listComments } from "@/server/services/comments";
import { listUsers } from "@/server/services/directory";
import {
  getVersionForDownload,
  listDocumentsForDisciplineTask,
  listDocumentsForMainTask,
  listDocumentsForProject,
  listVersions,
  uploadDocumentVersion,
} from "@/server/services/documents";
import { toggleFavorite } from "@/server/services/favorites";
import {
  deleteIntegration,
  listIntegrationsForAdmin,
  saveIntegration,
  sendIntegrationTest,
  setEventToggles,
  setIntegrationEnabled,
} from "@/server/services/integrations";
import {
  createPhase,
  deletePhase,
  listPhasesForProject,
  overridePhaseLock,
  renamePhase,
  reorderPhases,
} from "@/server/services/phases";
import { getProjectForActor, listProjectsForActor } from "@/server/services/projects";
import {
  completeDisciplineTask,
  createMainTask,
  getDisciplineTaskForActor,
  getMainTaskForActor,
  listMainTasksForProject,
  setMainTaskPhase,
  updateDisciplineTaskStatus,
} from "@/server/services/tasks";
import { runSweepOnce } from "@/server/sweep";
import { deliverToOrgWebhooks } from "@/server/services/webhooks";
import {
  inThirtyDays,
  makeOrg,
  makeProjectFixture,
  resetDatabase,
  subtaskIdsByTitle,
  type Fixture,
} from "@/server/__tests__/harness";

/** Both companies name their work exactly the same, so nothing passes by accident. */
const SHARED_TITLE = "Flare tip replacement study";
const SUBTASK_TITLE = "Mechanical tip inspection";

type Company = {
  fixture: Fixture;
  admin: ActorContext;
  engineer: ActorContext;
  projectId: string;
  mainTaskId: string;
  disciplineTaskId: string;
  documentId: string;
  versionId: string;
};

let acme: Company;
let rival: Company;

async function buildCompany(name: string): Promise<Company> {
  const org = await makeOrg(name);
  const fixture = await makeProjectFixture(org.id);

  const mainTask = await createMainTask(fixture.adminActor, {
    projectId: fixture.projectId,
    title: SHARED_TITLE,
    description: `Work that belongs to ${name} and to nobody else.`,
    priority: "HIGH",
    deadline: inThirtyDays(),
    disciplineTasks: [
      {
        disciplineId: fixture.disciplineId,
        title: SUBTASK_TITLE,
        assigneeId: fixture.engineerActor.userId,
        deadline: inThirtyDays(),
        isMandatory: true,
        requiredDocuments: [],
      },
    ],
  });
  const disciplineTaskId = (await subtaskIdsByTitle(mainTask.id)).get(SUBTASK_TITLE) as string;

  const buffer = Buffer.from(`item,discipline,status\n1,MECH,${name}\n`, "utf8");
  const checked = validateUpload(buffer, "Register.csv");
  if (!checked.ok) throw new Error(checked.error);
  const stored = await storeFile(buffer, checked.ext);
  const version = await uploadDocumentVersion(
    fixture.pmActor,
    { projectId: fixture.projectId, mainTaskId: mainTask.id },
    {
      buffer,
      originalName: "Register.csv",
      mimeType: checked.mimeType,
      ext: checked.ext,
      sizeBytes: stored.sizeBytes,
      checksumSha256: stored.checksumSha256,
      storedFilename: stored.storedFilename,
    },
  );

  await createComment(fixture.pmActor, {
    mainTaskId: mainTask.id,
    body: `A note only ${name} should ever read.`,
    mentions: [],
  });

  return {
    fixture,
    admin: fixture.adminActor,
    engineer: fixture.engineerActor,
    projectId: fixture.projectId,
    mainTaskId: mainTask.id,
    disciplineTaskId,
    documentId: version.documentId,
    versionId: version.id,
  };
}

beforeEach(async () => {
  await resetDatabase();
  acme = await buildCompany("Acme Energy");
  rival = await buildCompany("Rival Energy");
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("an administrator of one company cannot reach another company's work", () => {
  it("cannot open their project, and does not learn that it exists", async () => {
    await expect(getProjectForActor(acme.admin, rival.projectId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listMainTasksForProject(acme.admin, rival.projectId)).rejects.toBeInstanceOf(
      NotFoundError,
    );

    // Their own company still works, which is what makes the refusal meaningful.
    const mine = await getProjectForActor(acme.admin, acme.projectId);
    expect(mine.id).toBe(acme.projectId);
  });

  it("only ever lists their own company's projects", async () => {
    const projects = await listProjectsForActor(acme.admin);
    expect(projects.map((project) => project.id)).toEqual([acme.projectId]);
  });

  it("cannot open their tasks", async () => {
    await expect(getMainTaskForActor(acme.admin, rival.mainTaskId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      getDisciplineTaskForActor(acme.admin, rival.disciplineTaskId),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("cannot move or complete their work", async () => {
    await expect(
      updateDisciplineTaskStatus(acme.admin, { id: rival.disciplineTaskId, status: "IN_PROGRESS" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      completeDisciplineTask(acme.admin, { id: rival.disciplineTaskId }),
    ).rejects.toBeInstanceOf(NotFoundError);

    const untouched = await prisma.disciplineTask.findUniqueOrThrow({
      where: { id: rival.disciplineTaskId },
    });
    expect(untouched.status).toBe("NOT_STARTED");
  });

  it("cannot list their documents or download one of their files", async () => {
    await expect(listDocumentsForProject(acme.admin, rival.projectId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(listDocumentsForMainTask(acme.admin, rival.mainTaskId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      listDocumentsForDisciplineTask(acme.admin, rival.disciplineTaskId),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(listVersions(acme.admin, rival.documentId)).rejects.toBeInstanceOf(NotFoundError);

    // The download metadata is where a filename and a path on disk would leak.
    await expect(getVersionForDownload(acme.admin, rival.versionId)).rejects.toBeInstanceOf(
      NotFoundError,
    );

    // Their own file still downloads.
    const mine = await getVersionForDownload(acme.admin, acme.versionId);
    expect(mine.originalFilename).toBe("Register.csv");
  });

  it("cannot read or write their comment threads", async () => {
    await expect(listComments(acme.admin, { mainTaskId: rival.mainTaskId })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      createComment(acme.admin, {
        mainTaskId: rival.mainTaskId,
        body: "Hello from next door.",
        mentions: [],
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    const thread = await listComments(rival.admin, { mainTaskId: rival.mainTaskId });
    expect(thread).toHaveLength(1);
    expect(thread[0].body).toContain("Rival Energy");
  });

  it("cannot star their work", async () => {
    await expect(
      toggleFavorite(acme.admin, { targetType: "MAIN_TASK", targetId: rival.mainTaskId }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      toggleFavorite(acme.admin, { targetType: "DISCIPLINE_TASK", targetId: rival.disciplineTaskId }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      toggleFavorite(acme.admin, { targetType: "PROJECT", targetId: rival.projectId }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(await prisma.favorite.count()).toBe(0);

    // Starring their own task is fine, which proves the refusals above are about the company.
    expect(
      await toggleFavorite(acme.admin, { targetType: "MAIN_TASK", targetId: acme.mainTaskId }),
    ).toEqual({ favorited: true });
  });
});

describe("the stage gates belong to one company too", () => {
  it("cannot list, rename, reorder, delete or override another company's phases", async () => {
    const theirs = await createPhase(rival.admin, {
      projectId: rival.projectId,
      name: "Construction",
    });

    await expect(listPhasesForProject(acme.admin, rival.projectId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      createPhase(acme.admin, { projectId: rival.projectId, name: "Ours now" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      renamePhase(acme.admin, { id: theirs.id, name: "Renamed by a stranger" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      reorderPhases(acme.admin, { projectId: rival.projectId, phaseIds: [theirs.id] }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(deletePhase(acme.admin, { id: theirs.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      overridePhaseLock(acme.admin, { id: theirs.id, reason: "Opening someone else's gate" }),
    ).rejects.toBeInstanceOf(NotFoundError);

    // Nothing of theirs moved, and no override was recorded on it.
    const untouched = await prisma.projectPhase.findUniqueOrThrow({ where: { id: theirs.id } });
    expect(untouched.name).toBe("Construction");
    expect(untouched.overriddenById).toBeNull();
    expect(await prisma.projectPhase.count({ where: { projectId: acme.projectId } })).toBe(0);
  });

  it("cannot move their work into a phase, or their phase onto their work", async () => {
    const theirs = await createPhase(rival.admin, { projectId: rival.projectId, name: "FEED" });

    await expect(
      setMainTaskPhase(acme.admin, { id: rival.mainTaskId, phaseId: theirs.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    // Their phase is not found even for a task of their own company's neighbour.
    await expect(
      setMainTaskPhase(acme.admin, { id: acme.mainTaskId, phaseId: theirs.id }),
    ).rejects.toBeInstanceOf(NotFoundError);

    const untouched = await prisma.mainTask.findUniqueOrThrow({ where: { id: acme.mainTaskId } });
    expect(untouched.phaseId).toBeNull();
  });
});

describe("search never crosses the boundary, even when the words match exactly", () => {
  it("finds each company only its own identically named work", async () => {
    const mine = await searchEverything(acme.admin, "Flare tip");
    const theirs = await searchEverything(rival.admin, "Flare tip");

    expect(mine.mainTasks.map((task) => task.id)).toEqual([acme.mainTaskId]);
    expect(theirs.mainTasks.map((task) => task.id)).toEqual([rival.mainTaskId]);

    expect(mine.disciplineTasks.map((task) => task.id)).toEqual([]);
    expect(mine.projects.map((project) => project.id)).toEqual([]);

    // Nothing of the other company appears anywhere in the answer.
    expect(JSON.stringify(mine)).not.toContain(rival.mainTaskId);
    expect(JSON.stringify(theirs)).not.toContain(acme.mainTaskId);
  });

  it("keeps documents and people apart too", async () => {
    const mine = await searchEverything(acme.admin, "Register");
    expect(mine.documents.map((document) => document.id)).toEqual([acme.documentId]);

    const people = await searchEverything(acme.admin, "Carter");
    const acmeUserIds = new Set(
      (await prisma.user.findMany({ where: { orgId: acme.fixture.orgId } })).map((user) => user.id),
    );
    expect(people.users.length).toBeGreaterThan(0);
    for (const person of people.users) expect(acmeUserIds.has(person.id)).toBe(true);
  });
});

describe("the people directory stops at the company door", () => {
  it("lists only colleagues, however the search is worded", async () => {
    const everyone = await listUsers(acme.admin);
    const rivalIds = new Set(
      (await prisma.user.findMany({ where: { orgId: rival.fixture.orgId } })).map((user) => user.id),
    );

    expect(everyone.length).toBeGreaterThan(0);
    for (const person of everyone) expect(rivalIds.has(person.id)).toBe(false);

    // Both companies have a "John Carter"; each sees exactly one.
    const named = await listUsers(acme.admin, "Carter");
    expect(named).toHaveLength(1);
    expect(rivalIds.has(named[0].id)).toBe(false);
  });
});

describe("the Admin section administers one company only", () => {
  it("lists only its own people", async () => {
    const people = await listAllUsers(acme.admin);
    const emails = people.map((person) => person.email);
    const rivalEmails = (
      await prisma.user.findMany({ where: { orgId: rival.fixture.orgId }, select: { email: true } })
    ).map((row) => row.email);

    expect(people).toHaveLength(4);
    for (const email of rivalEmails) expect(emails).not.toContain(email);
  });

  it("creates new people inside the administrator's own company", async () => {
    const created = await createUser(acme.admin, {
      email: "new.starter@acme.example",
      name: "New Starter",
      password: "coordination-2026",
      role: "PROJECT_MANAGER",
    });

    const row = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.orgId).toBe(acme.fixture.orgId);
    expect(row.orgId).not.toBe(rival.fixture.orgId);
  });

  it("cannot change or deactivate somebody in the other company", async () => {
    await expect(
      updateUser(acme.admin, { id: rival.engineer.userId, name: "Renamed by a stranger" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(deactivateUser(acme.admin, { id: rival.engineer.userId })).rejects.toBeInstanceOf(
      NotFoundError,
    );

    const untouched = await prisma.user.findUniqueOrThrow({ where: { id: rival.engineer.userId } });
    expect(untouched.name).toBe("John Carter");
    expect(untouched.isActive).toBe(true);
  });

  it("refuses a colleague from the other company as a project member", async () => {
    // Not "forbidden" but "that person is not one of yours" — the same answer as a person who left.
    await expect(
      createMainTask(acme.admin, {
        projectId: acme.projectId,
        title: "Work for a stranger",
        description: "Assigning across companies must be impossible.",
        priority: "LOW",
        deadline: inThirtyDays(),
        disciplineTasks: [
          {
            disciplineId: acme.fixture.disciplineId,
            title: "Nope",
            assigneeId: rival.engineer.userId,
            deadline: inThirtyDays(),
            isMandatory: true,
            requiredDocuments: [],
          },
        ],
      }),
      // A stranger is refused the way somebody who has left is: "not one of yours", not a crash.
    ).rejects.toBeInstanceOf(ServiceError);
  });
});

describe("someone inside the company is still bound by the ordinary rules", () => {
  it("refuses a colleague who is not on the project — forbidden, not missing", async () => {
    // The organisation check must not have replaced the per-project check: inside one company an
    // outsider to a project is still refused, and still told so.
    await expect(
      getProjectForActor(acme.fixture.outsiderActor, acme.projectId),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("the hourly deadline sweep stays inside each company", () => {
  it("only ever notifies the person the task is assigned to", async () => {
    // Both companies now have an overdue task with the same title, assigned to their own engineer.
    const overdue = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    await prisma.disciplineTask.updateMany({
      where: { id: { in: [acme.disciplineTaskId, rival.disciplineTaskId] } },
      data: { deadline: overdue },
    });
    await prisma.mainTask.updateMany({
      where: { id: { in: [acme.mainTaskId, rival.mainTaskId] } },
      data: { deadline: overdue },
    });

    const result = await runSweepOnce();
    expect(result.ran).toBe(true);

    const notifications = await prisma.notification.findMany({
      include: { user: { select: { orgId: true } } },
    });
    expect(notifications.length).toBeGreaterThan(0);

    // The sweep writes per assignee, and an assignee always belongs to the same company as the task
    // they were given — this walks every row it wrote and proves it.
    for (const notification of notifications) {
      const taskId = notification.linkUrl.split("/").pop() as string;
      const task = await prisma.disciplineTask.findUnique({
        where: { id: taskId },
        select: { mainTask: { select: { project: { select: { orgId: true } } } } },
      });
      const mainTask = task
        ? null
        : await prisma.mainTask.findUnique({
            where: { id: taskId },
            select: { project: { select: { orgId: true } } },
          });
      const taskOrgId = task?.mainTask.project.orgId ?? mainTask?.project.orgId;
      expect(taskOrgId).toBe(notification.user.orgId);
    }
  });
});

describe("one company's chat channel is not another company's", () => {
  const ACME_SLACK = "https://hooks.slack.com/services/TACME/BACME/AcmeSecretTokenValue";

  beforeEach(async () => {
    await saveIntegration(acme.admin, { kind: "SLACK", webhookUrl: ACME_SLACK });
    await setIntegrationEnabled(acme.admin, { kind: "SLACK", enabled: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not appear on the other company's Integrations screen", async () => {
    const mine = await listIntegrationsForAdmin(acme.admin);
    const theirs = await listIntegrationsForAdmin(rival.admin);

    expect(mine.find((item) => item.kind === "SLACK")?.configured).toBe(true);
    // The rival administrator sees an empty card, not a masked address and not an error.
    expect(theirs.find((item) => item.kind === "SLACK")?.configured).toBe(false);
    expect(JSON.stringify(theirs)).not.toContain("hooks.slack.com");
  });

  it("is NOT FOUND to the other company's administrator, never merely forbidden", async () => {
    // Not found, not forbidden: a rival must not even learn that Acme has Slack connected.
    await expect(
      setIntegrationEnabled(rival.admin, { kind: "SLACK", enabled: false }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      setEventToggles(rival.admin, {
        kind: "SLACK",
        eventToggles: {
          taskAssigned: false,
          mention: false,
          statusChange: false,
          overdueReminder: false,
          gateOverride: false,
        },
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      sendIntegrationTest(rival.admin, { kind: "SLACK" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      deleteIntegration(rival.admin, { kind: "SLACK" }),
    ).rejects.toBeInstanceOf(NotFoundError);

    // And Acme's connection is untouched by any of that.
    expect(await prisma.orgIntegration.count()).toBe(1);
  });

  it("never carries the other company's news, even for the same kind of event", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200 }));

    await deliverToOrgWebhooks(rival.fixture.orgId, {
      type: "ASSIGNED",
      title: "New task assigned to you",
      body: `A rival company's work: ${SHARED_TITLE}`,
      linkUrl: `/discipline-tasks/${rival.disciplineTaskId}`,
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    // Acme's own event still reaches Acme's channel.
    await deliverToOrgWebhooks(acme.fixture.orgId, {
      type: "ASSIGNED",
      title: "New task assigned to you",
      body: SHARED_TITLE,
      linkUrl: `/discipline-tasks/${acme.disciplineTaskId}`,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe(ACME_SLACK);
  });
});
