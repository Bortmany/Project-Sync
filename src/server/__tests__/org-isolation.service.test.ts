// THE TENANT GUARANTEE, proved: two companies live in one database and neither can reach the other.
//
// Two organisations are built side by side with deliberately identical-looking work — the same task
// title, the same discipline codes, the same project code — and then every door in the app is tried
// from the wrong side. An ADMINISTRATOR does the trying, because an administrator is the most
// powerful person there is: being an admin makes you the administrator of your OWN company only.
//
// A cross-company read is "not found", never "forbidden": telling an outsider that an id is real is
// itself a leak.

import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.DATA_DIR = path.join(os.tmpdir(), "tielora-test-data");

// The Teams tab's routes and page read the cookie jar next/headers would give a live request.
const jar = vi.hoisted(() => new Map<string, { value: string; options?: Record<string, unknown> }>());
vi.mock("next/headers", async () => {
  const fixtures = await import("@/server/__tests__/microsoft-signin-fixtures");
  return fixtures.cookieJarModule(jar);
});

import { GET as teamsManifestRoute } from "@/app/api/teams/manifest/route";
import TeamsTabPage from "@/app/teams/tab/page";
import { TeamsBrief } from "@/components/teams/teams-brief";
import { TeamsSignIn } from "@/components/teams/teams-sign-in";
import { SESSION_COOKIE, mintSession } from "@/lib/auth";
import { TEAMS_COOKIE } from "@/lib/teams-app";
import { issueEmailToken } from "@/server/services/email-tokens";
import { signInWithHandoff, signInWithTeamsToken } from "@/server/services/teams-signin";

import { prisma } from "@/lib/db";
import { searchEverything } from "@/lib/search";
import { ForbiddenError } from "@/lib/permissions";
import { seal } from "@/lib/secret-box";
import { base32Decode, stepAt, totpCode } from "@/lib/totp";
import { storeFile, validateUpload } from "@/lib/upload";
import { readZip } from "@/lib/zip";
import { actorForUser, type ActorContext } from "@/server/actor";
import { NotFoundError, ServiceError } from "@/server/errors";
import {
  adminResetTwoFactor,
  createUser,
  deactivateUser,
  listAllUsers,
  updateUser,
} from "@/server/services/admin";
import { billingStatus, processBillingWebhook } from "@/server/services/billing";
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
  beginTwoFactorEnrollment,
  confirmTwoFactorEnrollment,
  disableTwoFactor,
  twoFactorStatus,
} from "@/server/services/two-factor";
import { deleteMyAccount, FORMER_MEMBER } from "@/server/services/account-deletion";
import {
  cancelWorkspaceDeletion,
  requestWorkspaceDeletion,
  workspaceDeletionStatus,
} from "@/server/services/workspace-deletion";
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
import {
  attachMicrosoftFile,
  disconnectMicrosoft,
  listMicrosoftDrives,
  listMicrosoftFolder,
  microsoftConnectionFor,
} from "@/server/services/microsoft";
import { orgDigest, personBrief, projectBrief } from "@/server/services/briefs";
import { getDashboardForActor, listTileWork } from "@/server/services/dashboard";
import {
  acknowledgePost,
  createPost,
  deletePost,
  dismissAnnouncement,
  editPost,
  listAnnouncementsForUser,
  listBoard,
  replyToPost,
  setBroadcastPolicy,
} from "@/server/services/posts";
import { createProject, getProjectForActor, listProjectsForActor } from "@/server/services/projects";
import {
  completeDisciplineTask,
  createMainTask,
  getDisciplineTaskForActor,
  getMainTaskForActor,
  listMainTasksForProject,
  setMainTaskPhase,
  updateDisciplineTaskStatus,
} from "@/server/services/tasks";
import { downloadMyData } from "@/server/services/personal-export";
import {
  exportDownload,
  startWorkspaceExport,
  whenExportSettles,
  workspaceExportStatus,
} from "@/server/services/workspace-export";
import {
  DIGEST_HOUR_UTC,
  postDailyDigests,
  postWeeklyBriefs,
  runSweepOnce,
  sendDailyBriefEmails,
  sendWeeklyBriefEmails,
} from "@/server/sweep";
import { notify } from "@/server/services/notify";
import { unsubscribeWithToken } from "@/server/services/email-preferences";
import { unsubscribeToken } from "@/lib/unsubscribe-token";
import {
  configureEmail,
  goDormant,
  mockFetchOk as mockEmailFetchOk,
  optIn,
  sentEmails,
  settle,
} from "@/server/__tests__/email-harness";
import { deliverToOrgWebhooks } from "@/server/services/webhooks";
import {
  inThirtyDays,
  makeOrg,
  makeProjectFixture,
  makeUser,
  resetDatabase,
  subtaskIdsByTitle,
  type Fixture,
} from "@/server/__tests__/harness";
import {
  completeMicrosoftSignIn,
  completeMicrosoftSignInEnable,
  disableMicrosoftSignIn,
  microsoftSignInStatus,
  signingKeys,
  type SignInAttempt,
} from "@/server/services/microsoft-signin";
import {
  claimsFor,
  configureMicrosoftEnv,
  installFakeMicrosoft,
  makeKey,
  newOid,
  newTenant,
  signToken,
  configureTeamsEnv,
  teamsClaimsFor,
  type FakeMicrosoft,
} from "@/server/__tests__/microsoft-signin-fixtures";

/** Both companies name their work exactly the same, so nothing passes by accident. */
const EVERYONE_AUDIENCE = { kind: "EVERYONE" as const, projectId: null, disciplineId: null };

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

  it("cannot mention another company's department", async () => {
    // Both companies run a department with the same name, so the refusal must not name it: the
    // message is the plain one, and it never says whether that id is real anywhere else.
    let message = "";
    try {
      await createComment(acme.admin, {
        mainTaskId: acme.mainTaskId,
        body: "Their mechanical team should see this.",
        mentions: [],
        disciplineMentions: [rival.fixture.disciplineId],
      });
    } catch (error) {
      message = (error as ServiceError).message;
    }
    expect(message).toBe("You can only mention departments that are on this project.");

    // Nothing was written, and no notification left the company.
    expect(await prisma.comment.count()).toBe(2);
    expect(await prisma.notification.count({ where: { type: "MENTIONED" } })).toBe(0);

    // Their own department, on their own project, still works.
    const posted = await createComment(acme.admin, {
      mainTaskId: acme.mainTaskId,
      body: "Ours, though.",
      mentions: [],
      disciplineMentions: [acme.fixture.disciplineId],
    });
    expect(posted.mentions).toEqual([`d:${acme.fixture.disciplineId}`]);
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

describe("the status report stops at the company door", () => {
  it("another company's project on the report is not found, never forbidden, and is never audited", async () => {
    const { exportStatusReport, buildReportData } = await import("@/server/services/report");

    for (const format of ["pdf", "pptx"] as const) {
      await expect(exportStatusReport(acme.admin, rival.projectId, format)).rejects.toBeInstanceOf(NotFoundError);
      await expect(exportStatusReport(rival.admin, acme.projectId, format)).rejects.toBeInstanceOf(NotFoundError);
    }
    await expect(buildReportData(acme.admin, rival.projectId)).rejects.not.toBeInstanceOf(ForbiddenError);
    expect(await prisma.activityLog.count({ where: { action: "REPORT_EXPORTED" } })).toBe(0);

    // Their own project is fine, which proves the refusals above are about the company. Both
    // companies named their work identically, yet each report holds only its own ids' worth.
    const mine = await buildReportData(acme.admin, acme.projectId);
    expect(mine.project.id).toBe(acme.projectId);
    const theirs = await buildReportData(rival.admin, rival.projectId);
    expect(theirs.project.id).toBe(rival.projectId);
    expect(mine.timeline.mainTasks.map((task) => task.id)).toEqual([acme.mainTaskId]);
    expect(theirs.timeline.mainTasks.map((task) => task.id)).toEqual([rival.mainTaskId]);
    expect(await prisma.activityLog.count({ where: { action: "REPORT_EXPORTED" } })).toBe(0);
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

describe("a contractor's access end date is one company's business", () => {
  const IN_THREE_DAYS = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

  /** A contractor of one company, with a last day a few days out. */
  async function contractorFor(company: Company) {
    return createUser(company.admin, {
      email: `contractor.${Math.random().toString(36).slice(2)}@partner.example`,
      name: "Sami al-Harthy",
      password: "coordination-2026",
      role: "EXTERNAL",
      companyName: "Al Hassan Engineering",
      accessExpiresAt: IN_THREE_DAYS,
    });
  }

  it("warns the administrators of that contractor's own company and nobody else", async () => {
    const theirs = await contractorFor(acme);

    const result = await runSweepOnce();
    expect(result.ran).toBe(true);

    const warnings = await prisma.notification.findMany({
      where: { linkUrl: { contains: "expiring=" } },
      include: { user: { select: { orgId: true } } },
    });
    expect(warnings.length).toBeGreaterThan(0);

    // Every warning names Acme's contractor and went to somebody inside Acme.
    for (const warning of warnings) {
      expect(warning.linkUrl).toContain(`expiring=${theirs.id}`);
      expect(warning.user.orgId).toBe(acme.fixture.orgId);
    }
    expect(warnings.some((row) => row.userId === rival.admin.userId)).toBe(false);
  });

  it("is invisible to the other company, who cannot see it or move it", async () => {
    const theirs = await contractorFor(acme);

    const seenByRival = await listAllUsers(rival.admin);
    expect(seenByRival.some((person) => person.id === theirs.id)).toBe(false);

    // Not "forbidden" — an administrator of another company never learns the account is real.
    await expect(
      updateUser(rival.admin, { id: theirs.id, accessExpiresAt: null }),
    ).rejects.toBeInstanceOf(NotFoundError);

    const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: theirs.id } });
    expect(unchanged.accessExpiresAt).not.toBeNull();
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
          announcements: false,

          dailyBrief: false,

          weeklyBrief: false,
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

/* ------------------------------------------------------------------ */
/* Microsoft 365 attachments                                           */
/* ------------------------------------------------------------------ */

describe("a company's Microsoft 365 connection", () => {
  beforeEach(async () => {
    process.env.MS_GRAPH_CLIENT_ID = "isolation-client-id";
    process.env.MS_GRAPH_CLIENT_SECRET = "isolation-client-secret";

    // Only Acme has connected. The connection is resolved from the actor's own orgId and nothing
    // else, so nothing a rival sends can reach it.
    await prisma.microsoftConnection.create({
      data: {
        orgId: acme.fixture.orgId,
        tenantId: "acme-tenant",
        tenantDomain: "acme.example",
        connectedById: acme.admin.userId,
        refreshTokenEnc: seal("microsoft.refresh-token", "acme-refresh-token"),
        accessTokenEnc: seal("microsoft.access-token", "acme-access-token"),
        accessTokenExpiresAt: new Date(Date.now() + 30 * 60_000),
      },
    });
  });

  afterEach(() => {
    delete process.env.MS_GRAPH_CLIENT_ID;
    delete process.env.MS_GRAPH_CLIENT_SECRET;
  });

  it("is invisible to the other company's administrator", async () => {
    const mine = await microsoftConnectionFor(acme.admin);
    const theirs = await microsoftConnectionFor(rival.admin);

    expect(mine.connected).toBe(true);
    expect(mine.tenantDomain).toBe("acme.example");
    // Not "someone else's", not an error — simply nothing.
    expect(theirs.connected).toBe(false);
    expect(theirs.tenantDomain).toBeNull();
    expect(JSON.stringify(theirs)).not.toContain("acme");
  });

  it("cannot be browsed, used or removed from the other company", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));

    // Their own, legitimate target — the refusal is about the connection, not the task.
    await expect(
      listMicrosoftDrives(rival.admin, {
        projectId: rival.projectId,
        mainTaskId: rival.mainTaskId,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    // Acme's project and task, from the rival's session: not found, never forbidden.
    await expect(
      listMicrosoftFolder(rival.admin, {
        projectId: acme.projectId,
        mainTaskId: acme.mainTaskId,
        driveId: "b!acme-drive",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    await expect(
      attachMicrosoftFile(rival.admin, {
        projectId: acme.projectId,
        mainTaskId: acme.mainTaskId,
        driveId: "b!acme-drive",
        itemId: "01ACMEITEM",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    await expect(disconnectMicrosoft(rival.admin)).rejects.toBeInstanceOf(NotFoundError);

    // Nothing ever left the building, and Acme's connection is untouched.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await prisma.microsoftConnection.count()).toBe(1);
  });
});

describe("a brief never reaches across companies", () => {
  const ACME_SLACK = "https://hooks.slack.com/services/TACME/BACME/AcmeSecretTokenValue";

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows one person only their own company's work, though both companies name it the same", async () => {
    // Both companies carry a task with SHARED_TITLE due on the same day. Make it late in both.
    for (const company of [acme, rival]) {
      await prisma.disciplineTask.update({
        where: { id: company.disciplineTaskId },
        data: { deadline: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) },
      });
    }

    const mine = await personBrief(acme.engineer);
    const theirs = await personBrief(rival.engineer);

    expect(mine.overdue.total).toBe(1);
    expect(theirs.overdue.total).toBe(1);
    // Same title on both sides, so the proof is the id: each person sees only their own row.
    expect(mine.overdue.items[0].id).toBe(acme.disciplineTaskId);
    expect(theirs.overdue.items[0].id).toBe(rival.disciplineTaskId);
  });

  it("refuses the other company's project brief as NOT FOUND, never merely forbidden", async () => {
    await expect(projectBrief(acme.admin, rival.projectId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(projectBrief(rival.admin, acme.projectId)).rejects.toBeInstanceOf(NotFoundError);

    // Their own still works, which is what makes the refusal meaningful.
    const mine = await projectBrief(acme.admin, acme.projectId);
    expect(mine.projectId).toBe(acme.projectId);
    expect(mine.progress.total).toBe(1);
  });

  it("builds each company's digest from that company's projects only", async () => {
    const mine = await orgDigest(acme.fixture.orgId);
    const theirs = await orgDigest(rival.fixture.orgId);

    expect(mine?.lines).toHaveLength(1);
    expect(theirs?.lines).toHaveLength(1);
    expect(mine?.lines[0].code).not.toBe(theirs?.lines[0].code);
  });

  it("posts a digest only to the company it belongs to", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200 }));

    // Only Acme asks for a digest. The rival has a channel too, with the digest switched off.
    await saveIntegration(acme.admin, { kind: "SLACK", webhookUrl: ACME_SLACK });
    await setIntegrationEnabled(acme.admin, { kind: "SLACK", enabled: true });
    await setEventToggles(acme.admin, {
      kind: "SLACK",
      eventToggles: {
        taskAssigned: true,
        mention: true,
        statusChange: true,
        overdueReminder: true,
        gateOverride: true,
        announcements: false,

        dailyBrief: true,

        weeklyBrief: false,
      },
    });
    await saveIntegration(rival.admin, {
      kind: "SLACK",
      webhookUrl: "https://hooks.slack.com/services/TRIVAL/BRIVAL/RivalSecretTokenValue",
    });
    await setIntegrationEnabled(rival.admin, { kind: "SLACK", enabled: true });

    const now = new Date();
    const run = await postDailyDigests(
      new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), DIGEST_HOUR_UTC + 1),
      ),
    );

    expect(run.channels).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe(ACME_SLACK);
    // Acme's card carries Acme's project code and nothing of the rival's.
    const acmeProject = await prisma.project.findUniqueOrThrow({ where: { id: acme.projectId } });
    const rivalProject = await prisma.project.findUniqueOrThrow({ where: { id: rival.projectId } });
    const body = String((init as RequestInit).body);
    expect(body).toContain(acmeProject.code);
    expect(body).not.toContain(rivalProject.code);
  });
});

describe("an external contractor is bound by the company door too", () => {
  it("cannot reach the other company's work, and cannot reach anything but their own here", async () => {
    // A contractor of Acme, invited onto Acme's project to do Acme's one discipline task.
    const external = await makeUser({
      name: "Yusuf Contractor",
      role: "EXTERNAL",
      orgId: acme.fixture.orgId,
    });
    await prisma.user.update({
      where: { id: external.id },
      data: { companyName: "Al Hassan Engineering" },
    });
    await prisma.projectMember.create({
      data: { projectId: acme.projectId, userId: external.id, projectRole: "EXTERNAL" },
    });
    await prisma.disciplineTask.update({
      where: { id: acme.disciplineTaskId },
      data: { assigneeId: external.id },
    });
    const contractor = await actorForUser(external.id);

    // The rival company: not found, exactly as it is for Acme's own administrator.
    await expect(getProjectForActor(contractor, rival.projectId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getMainTaskForActor(contractor, rival.mainTaskId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      getDisciplineTaskForActor(contractor, rival.disciplineTaskId),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(getVersionForDownload(contractor, rival.versionId)).rejects.toBeInstanceOf(NotFoundError);

    // Their own company: only the task they were given, and no people directory at all.
    const mine = await getDisciplineTaskForActor(contractor, acme.disciplineTaskId);
    expect(mine.id).toBe(acme.disciplineTaskId);
    expect(await listUsers(contractor)).toEqual([]);
    expect((await listProjectsForActor(contractor)).map((project) => project.id)).toEqual([
      acme.projectId,
    ]);
  });
});

describe("the noticeboard stops at the company door too", () => {
  it("never shows, edits or removes another company's post", async () => {
    const theirs = await createPost(rival.admin, {
      kind: "ANNOUNCEMENT",
      title: "Rival's shutdown plan",
      body: "Only Rival Energy should ever read this.",
    });
    const ours = await createPost(acme.admin, {
      kind: "ANNOUNCEMENT",
      title: "Acme's shutdown plan",
      body: "Only Acme Energy should ever read this.",
    });

    // Two company-wide announcements, one each — and each administrator sees exactly one.
    expect((await listAnnouncementsForUser(acme.admin)).map((post) => post.id)).toEqual([ours.id]);
    expect((await listAnnouncementsForUser(rival.admin)).map((post) => post.id)).toEqual([
      theirs.id,
    ]);
    expect((await listBoard(acme.admin, EVERYONE_AUDIENCE)).map((post) => post.id)).toEqual([]);

    // An administrator is refused across the boundary like everybody else, and told "not found"
    // rather than "forbidden", so an id from the other company is never confirmed as real.
    await expect(
      editPost(acme.admin, { id: theirs.id, body: "Editing somebody else's company." }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(deletePost(acme.admin, { id: theirs.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      dismissAnnouncement(acme.admin, { id: theirs.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      replyToPost(acme.admin, { parentId: theirs.id, body: "Hello over there." }),
    ).rejects.toBeInstanceOf(NotFoundError);

    // And their project's board is not a board this company has at all.
    await expect(
      listBoard(acme.admin, { kind: "PROJECT", projectId: rival.projectId, disciplineId: null }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("keeps an announcement's fan-out inside the company", async () => {
    await createPost(acme.admin, { kind: "ANNOUNCEMENT", body: "Acme news." });

    const rows = await prisma.notification.findMany({
      where: { type: "ANNOUNCEMENT" },
      select: { userId: true },
    });
    const rivalIds = new Set([rival.admin.userId, rival.engineer.userId]);
    expect(rows.some((row) => rivalIds.has(row.userId))).toBe(false);
    expect(rows.some((row) => row.userId === acme.engineer.userId)).toBe(true);
  });

  it("never acknowledges, or counts, across the company door", async () => {
    const theirs = await createPost(rival.admin, {
      kind: "ANNOUNCEMENT",
      body: "Rival Energy: please confirm you have read this.",
      requiresAck: true,
    });

    // Another company's announcement does not exist here, so acknowledging it is a miss — an
    // administrator is refused exactly like anybody else, and never learns the id is real.
    await expect(acknowledgePost(acme.admin, { id: theirs.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(await prisma.postAck.count()).toBe(0);

    // And the count the author sees is their own company's people, nobody else's.
    await acknowledgePost(rival.engineer, { id: theirs.id });
    const forRival = (await listAnnouncementsForUser(rival.admin))[0];
    expect(forRival?.ackProgress?.ackCount).toBe(1);
    expect(forRival?.ackProgress?.audienceCount).toBe(
      await prisma.user.count({ where: { orgId: rival.admin.orgId, isActive: true, role: { not: "EXTERNAL" } } }),
    );
  });

  it("never attaches, or resolves, another company's document to a post", async () => {
    // Rival Energy's document does not exist for Acme, so attaching it is a miss — and the refusal
    // is "not found", so the id is never confirmed as real.
    await expect(
      createPost(acme.admin, {
        kind: "BOARD",
        projectId: acme.projectId,
        body: "Pointing at the rival's file.",
        documentId: rival.documentId,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    // Even a row written straight into the database with the wrong company's document on it shows
    // no chip: the chip is resolved through the READER's own visibility, not the foreign key.
    const smuggled = await createPost(acme.admin, {
      kind: "BOARD",
      projectId: acme.projectId,
      body: "Nothing to see.",
    });
    await prisma.post.update({
      where: { id: smuggled.id },
      data: { documentId: rival.documentId },
    });

    const board = await listBoard(acme.admin, {
      kind: "PROJECT",
      projectId: acme.projectId,
      disciplineId: null,
    });
    expect(board).toHaveLength(1);
    expect(board[0]?.attachment).toBeNull();
  });

  it("keeps an included announcement's contractors inside the company", async () => {
    // One contractor in each company, each with live work on their own company's project.
    const contractors = await Promise.all(
      [acme, rival].map(async (company) => {
        const user = await makeUser({
          name: "Contractor",
          role: "EXTERNAL",
          orgId: company.fixture.orgId,
        });
        await prisma.disciplineTask.update({
          where: { id: company.disciplineTaskId },
          data: { assigneeId: user.id },
        });
        return { orgId: company.fixture.orgId, userId: user.id };
      }),
    );
    const [acmeContractor, rivalContractor] = contractors;

    await createPost(acme.admin, {
      kind: "ANNOUNCEMENT",
      body: "Acme news, contractors included.",
      includeExternals: true,
    });

    const told = (
      await prisma.notification.findMany({ where: { type: "ANNOUNCEMENT" }, select: { userId: true } })
    ).map((row) => row.userId);
    expect(told).toContain(acmeContractor.userId);
    expect(told).not.toContain(rivalContractor.userId);

    // And the other company's contractor is told nothing on their brief either.
    const theirs = await personBrief(await actorForUser(rivalContractor.userId));
    expect(theirs.announcements.total).toBe(0);
  });

  it("changes one company's broadcast setting and nobody else's", async () => {
    await setBroadcastPolicy(acme.admin, { policy: "ADMIN_ONLY" });

    const orgs = await prisma.organization.findMany({ select: { id: true, broadcastPolicy: true } });
    const acmeOrg = orgs.find((org) => org.id === acme.admin.orgId);
    const rivalOrg = orgs.find((org) => org.id === rival.admin.orgId);
    expect(acmeOrg?.broadcastPolicy).toBe("ADMIN_ONLY");
    expect(rivalOrg?.broadcastPolicy).toBe("ADMIN_PM");
  });
});

/* ------------------------------------------------------------------ */
/* Data rights: an export is one company's, and so is its link          */
/* ------------------------------------------------------------------ */

describe("taking a copy of the data out", () => {
  it("exports one company's rows and hands its link to that company alone", async () => {
    await startWorkspaceExport(acme.admin);
    await whenExportSettles();

    const status = await workspaceExportStatus(acme.admin);
    expect(status.state).toBe("READY");
    const token = new URL(status.downloadUrl!, "https://example.test").searchParams.get("token")!;

    // The archive itself: every row is Acme's, and the rival's ids appear nowhere in the bytes.
    const file = await exportDownload(acme.admin, token);
    const raw = await readFile(file.absolutePath);
    const entries = new Map(readZip(raw).map((entry) => [entry.name, entry.data]));
    const projects = JSON.parse(entries.get("projects.json")!.toString("utf8")) as {
      orgId: string;
    }[];

    expect(projects.every((row) => row.orgId === acme.admin.orgId)).toBe(true);
    expect(raw.includes(Buffer.from(rival.admin.orgId, "utf8"))).toBe(false);
    expect(raw.includes(Buffer.from(rival.projectId, "utf8"))).toBe(false);

    // The rival's administrator holding a valid link: not found, like every other cross-company
    // miss — the token is a bearer, and a bearer never walks past the tenant rule.
    await expect(exportDownload(rival.admin, token)).rejects.toBeInstanceOf(NotFoundError);

    // And one company's export never blocks or shows up in the other's.
    const theirs = await workspaceExportStatus(rival.admin);
    expect(theirs.state).toBe("NONE");
    expect(theirs.canStart).toBe(true);
    expect(theirs.downloadUrl).toBeNull();
  });

  it("gives each person their own data and nobody else's, across the two companies", async () => {
    const mine = await downloadMyData(acme.engineer);
    const theirs = await downloadMyData(rival.engineer);

    // Both companies name their work identically on purpose, so the proof is whose rows they are:
    // the workspace, the address on the profile, and the other person's address appearing nowhere.
    expect(mine.workspaceName).not.toBe(theirs.workspaceName);
    expect(mine.profile.email).toBe(acme.engineer.email);
    expect(theirs.profile.email).toBe(rival.engineer.email);
    expect(JSON.stringify(mine)).not.toContain(rival.engineer.email);
    expect(JSON.stringify(theirs)).not.toContain(acme.engineer.email);
  });
});

/* ------------------------------------------------------------------ */
/* Data rights: deleting stops at the company boundary too              */
/* ------------------------------------------------------------------ */

describe("deleting an account and deleting a workspace", () => {
  it("anonymises one company's person and leaves the other company's untouched", async () => {
    const theirName = rival.engineer.name;

    await deleteMyAccount(acme.engineer, { confirm: "DELETE" });

    const mine = await prisma.user.findUniqueOrThrow({ where: { id: acme.engineer.userId } });
    const theirs = await prisma.user.findUniqueOrThrow({ where: { id: rival.engineer.userId } });
    expect(mine.name).toBe(FORMER_MEMBER);
    expect(mine.isActive).toBe(false);
    expect(theirs.name).toBe(theirName);
    expect(theirs.isActive).toBe(true);
    expect(theirs.email).toBe(rival.engineer.email);
  });

  it("schedules one company's deletion and never the other's", async () => {
    const acmeOrg = await prisma.organization.findUniqueOrThrow({
      where: { id: acme.admin.orgId },
    });

    // There is no organisation id in the input at all: it comes from the session, so an
    // administrator can only ever schedule their OWN company.
    await requestWorkspaceDeletion(acme.admin, { confirmName: acmeOrg.name });

    const mine = await workspaceDeletionStatus(acme.admin);
    const theirs = await workspaceDeletionStatus(rival.admin);
    expect(mine.pending).toBe(true);
    expect(mine.workspaceName).toBe(acmeOrg.name);
    expect(theirs.pending).toBe(false);
    expect(theirs.workspaceName).not.toBe(acmeOrg.name);

    const rows = await prisma.organization.findMany({
      select: { id: true, deleteRequestedAt: true },
    });
    expect(rows.find((row) => row.id === acme.admin.orgId)?.deleteRequestedAt).not.toBeNull();
    expect(rows.find((row) => row.id === rival.admin.orgId)?.deleteRequestedAt).toBeNull();

    // The other company's administrator cannot call off a request that is not theirs to cancel —
    // there is nothing pending in their own workspace, so there is nothing to cancel.
    await expect(cancelWorkspaceDeletion(rival.admin)).rejects.toBeInstanceOf(ServiceError);
    expect((await workspaceDeletionStatus(acme.admin)).pending).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Plans and limits                                                    */
/* ------------------------------------------------------------------ */

describe("a company's plan usage is counted from its own rows and nobody else's", () => {
  it("never counts the other company's projects, people or files", async () => {
    // The other company is given plenty of everything. None of it may show up next door.
    await prisma.project.create({
      data: {
        orgId: rival.admin.orgId,
        name: "Their second project",
        code: "THEIRS-2",
        description: "A second project for the other company.",
        createdById: rival.admin.userId,
      },
    });
    const theirDocument = await prisma.document.create({
      data: {
        projectId: rival.projectId,
        title: "Their big drawing set",
        uploadedById: rival.admin.userId,
      },
    });
    await prisma.documentVersion.create({
      data: {
        documentId: theirDocument.id,
        revisionNumber: 0,
        storedFilename: `fake-${theirDocument.id}.bin`,
        originalFilename: "Their big drawing set.pdf",
        mimeType: "application/pdf",
        sizeBytes: 400 * 1024 * 1024,
        checksumSha256: "0".repeat(64),
        uploadedById: rival.admin.userId,
      },
    });

    await prisma.user.create({
      data: {
        orgId: rival.admin.orgId,
        email: `their.extra.${Date.now()}@test.example`,
        name: "Their extra engineer",
        passwordHash: "not-a-real-hash",
        role: "ENGINEER",
      },
    });

    const mine = await billingStatus(acme.admin);
    const theirs = await billingStatus(rival.admin);

    expect(mine.usage.projects).toBe(1);
    expect(theirs.usage.projects).toBe(2);
    expect(theirs.usage.users).toBe(mine.usage.users + 1);
    expect(mine.usage.documentBytes).toBeLessThan(theirs.usage.documentBytes);
    expect(theirs.usage.documentBytes - mine.usage.documentBytes).toBeGreaterThanOrEqual(
      400 * 1024 * 1024,
    );
  });

  it("does not let one company's usage spend another company's plan limit", async () => {
    // Both companies drop to FREE, which allows one project each. The other company is already
    // over — and that must not stop this one adding its first extra project.
    await prisma.organization.updateMany({ data: { plan: "FREE" } });
    await prisma.project.create({
      data: {
        orgId: rival.admin.orgId,
        name: "Their second project",
        code: "THEIRS-2",
        description: "A second project for the other company.",
        createdById: rival.admin.userId,
      },
    });

    // This company has one project, so it is at its own limit — refused on its own count, never
    // on the neighbour's.
    await expect(
      createProject(acme.admin, {
        name: "One too many",
        code: "MINE-2",
        description: "A project this company has no room for.",
        disciplineIds: [],
        members: [],
      }),
    ).rejects.toBeInstanceOf(ServiceError);

    // Soft-delete this company's only project and the room comes back — the neighbour's two
    // projects were never part of the sum.
    await prisma.project.update({
      where: { id: acme.projectId },
      data: { deletedAt: new Date() },
    });
    const created = await createProject(acme.admin, {
      name: "Room again",
      code: "MINE-3",
      description: "The neighbour's projects were never counted here.",
      disciplineIds: [],
      members: [],
    });
    expect(created.id).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/* The payment provider's webhook                                      */
/* ------------------------------------------------------------------ */
//
// The one door into this app that nobody signs in for. Its signature is what stands in for
// authentication, and the company it acts on comes from the payload rather than a session — so the
// tenant rule has to be proved here directly: a verified webhook about one company must never touch
// another, and a webhook naming a company that does not exist must be indistinguishable from one
// that does.

describe("a webhook only ever moves the company it names", () => {
  const WEBHOOK_SECRET = "pdl_ntfset_isolation_test_secret";
  const PROVIDER_KEYS = [
    "PADDLE_API_KEY",
    "PADDLE_WEBHOOK_SECRET",
    "PADDLE_PRICE_ID_PRO",
    "APP_BASE_URL",
  ] as const;
  const before = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of PROVIDER_KEYS) before.set(key, process.env[key]);
    process.env.PADDLE_API_KEY = "pdl_sdbx_isolation_test";
    process.env.PADDLE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.PADDLE_PRICE_ID_PRO = "pri_isolation";
    process.env.APP_BASE_URL = "https://tielora.example";
  });

  afterEach(() => {
    for (const [key, value] of before) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    before.clear();
  });

  function signedFor(orgId: string, eventId: string) {
    const raw = JSON.stringify({
      event_id: eventId,
      event_type: "subscription.activated",
      data: { id: "sub_iso", customer_id: "ctm_iso", custom_data: { org_id: orgId } },
    });
    const ts = String(Math.floor(Date.now() / 1000));
    const h1 = createHmac("sha256", WEBHOOK_SECRET).update(`${ts}:${raw}`).digest("hex");
    return { raw, header: `ts=${ts};h1=${h1}` };
  }

  const planOf = async (orgId: string) =>
    (await prisma.organization.findUnique({ where: { id: orgId }, select: { plan: true } }))?.plan;

  it("upgrades the company in the payload and leaves the neighbour exactly as it was", async () => {
    await prisma.organization.updateMany({ data: { plan: "FREE" } });

    const mine = signedFor(acme.admin.orgId, "evt_iso_1");
    const outcome = await processBillingWebhook(mine.raw, mine.header);

    expect(outcome.httpStatus).toBe(200);
    expect(await planOf(acme.admin.orgId)).toBe("PRO");
    expect(await planOf(rival.admin.orgId)).toBe("FREE");

    // And nothing about the neighbour was recorded either.
    const theirEvents = await prisma.billingEvent.count({ where: { orgId: rival.admin.orgId } });
    expect(theirEvents).toBe(0);
  });

  it("answers a company id that does not exist exactly as it answers one that does", async () => {
    await prisma.organization.updateMany({ data: { plan: "FREE" } });

    const real = signedFor(acme.admin.orgId, "evt_iso_real");
    const invented = signedFor("clnotarealcompanyid00000", "evt_iso_invented");

    const realOutcome = await processBillingWebhook(real.raw, real.header);
    const inventedOutcome = await processBillingWebhook(invented.raw, invented.header);

    // Same status, so nobody outside can tell a real company id from an invented one.
    expect(inventedOutcome.httpStatus).toBe(realOutcome.httpStatus);
    expect(await planOf(rival.admin.orgId)).toBe("FREE");
  });
});

/* ------------------------------------------------------------------ */
/* Two-factor sign-in                                                  */
/* ------------------------------------------------------------------ */
//
// A second factor is a credential, and an administrator administers their OWN company: the reset
// that exists for somebody who has lost their phone must stop at the company door like every other
// admin action, and one company's recovery codes must be worth nothing anywhere else.

describe("two-factor sign-in stops at the company door", () => {
  it("refuses another company's person as NOT FOUND, and leaves their second factor on", async () => {
    const enrolment = await beginTwoFactorEnrollment(acme.engineer);
    await confirmTwoFactorEnrollment(acme.engineer, {
      code: totpCode(base32Decode(enrolment.manualKey), stepAt(Date.now())),
    });

    await expect(
      adminResetTwoFactor(rival.admin, { id: acme.engineer.userId }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect((await twoFactorStatus(acme.engineer)).enabled).toBe(true);
    // Nothing was recorded against the neighbour's person either.
    const rows = await prisma.activityLog.findMany({
      where: { entityId: acme.engineer.userId, action: "TWO_FACTOR_RESET_BY_ADMIN" },
    });
    expect(rows).toHaveLength(0);
  });

  it("keeps each company's recovery codes to itself", async () => {
    const mine = await beginTwoFactorEnrollment(acme.engineer);
    const { codes } = await confirmTwoFactorEnrollment(acme.engineer, {
      code: totpCode(base32Decode(mine.manualKey), stepAt(Date.now())),
    });

    const theirs = await beginTwoFactorEnrollment(rival.engineer);
    await confirmTwoFactorEnrollment(rival.engineer, {
      code: totpCode(base32Decode(theirs.manualKey), stepAt(Date.now())),
    });

    // One company's code is worth nothing on the other company's account.
    await expect(
      disableTwoFactor(rival.engineer, { recoveryCode: codes[0] }),
    ).rejects.toBeInstanceOf(ServiceError);

    expect((await twoFactorStatus(rival.engineer)).enabled).toBe(true);
    expect((await twoFactorStatus(acme.engineer)).recoveryCodesLeft).toBe(8);
  });

  it("never lets one company's administrator read anything about another's second factor", async () => {
    const enrolment = await beginTwoFactorEnrollment(acme.engineer);
    await confirmTwoFactorEnrollment(acme.engineer, {
      code: totpCode(base32Decode(enrolment.manualKey), stepAt(Date.now())),
    });

    const theirList = await listAllUsers(rival.admin);
    expect(theirList.some((person) => person.id === acme.engineer.userId)).toBe(false);

    const ourList = await listAllUsers(acme.admin);
    const enrolled = ourList.find((person) => person.id === acme.engineer.userId);
    // The admin screen learns THAT it is on, and nothing else about it.
    expect(enrolled?.twoFactorEnabled).toBe(true);
    expect(JSON.stringify(ourList)).not.toContain(enrolment.manualKey);
  });
});

// "Sign in with Microsoft" starts from an OUTSIDE party's claim about which company somebody is in.
// The token's own `tid` picks exactly one company, and every person lookup after that is scoped to
// it — so a token from company B's Microsoft tenant can never become a session in company A, even
// when it carries the exact address of somebody in company A. Tokens here are REALLY signed.

describe("Sign in with Microsoft never lands in another company", () => {
  const key = makeKey("kid-isolation");
  let fake: FakeMicrosoft;
  let restoreEnv: () => void = () => undefined;
  let acmeTid: string;
  let rivalTid: string;

  beforeEach(async () => {
    restoreEnv = configureMicrosoftEnv();
    signingKeys.clear();
    fake = installFakeMicrosoft([key.jwk]);
    acmeTid = newTenant();
    rivalTid = newTenant();
    await prisma.organization.update({ where: { id: acme.admin.orgId }, data: { entraTenantId: acmeTid } });
    await prisma.organization.update({ where: { id: rival.admin.orgId }, data: { entraTenantId: rivalTid } });
  });

  afterEach(() => {
    restoreEnv();
    vi.restoreAllMocks();
  });

  /** One attempt, and Microsoft answering it with a genuine token carrying `claims`. */
  function attemptFor(
    claims: { tid: string; oid: string; email?: string | null; edov?: unknown },
    who?: { userId: string; orgId: string },
  ) {
    const tag = Math.random().toString(36).slice(2);
    const attempt: SignInAttempt = {
      purpose: who ? "enable" : "signin",
      state: `state-${tag}`,
      nonce: `nonce-${tag}`,
      verifier: `verifier-${tag}`,
      ts: Date.now(),
      ...(who ?? {}),
    };
    fake.idTokenFor = () => signToken(claimsFor({ ...claims, nonce: attempt.nonce }), key);
    return { attempt, input: { code: "code", state: attempt.state, error: null } };
  }

  it("refuses a valid token from company B's tenant, even carrying a company-A person's exact address", async () => {
    const { attempt, input } = attemptFor({
      tid: rivalTid,
      oid: newOid(),
      email: acme.engineer.email,
      edov: true,
    });

    const outcome = await completeMicrosoftSignIn(attempt, input, {});

    expect(outcome.kind).toBe("refused");
    expect(await prisma.session.count({ where: { userId: acme.engineer.userId } })).toBe(0);
    const acmePerson = await prisma.user.findUniqueOrThrow({ where: { id: acme.engineer.userId } });
    expect(acmePerson.microsoftOid).toBeNull();
    expect(acmePerson.lastLoginAt).toBeNull();
    expect(
      await prisma.activityLog.count({ where: { actorId: acme.engineer.userId, action: "LOGIN" } }),
    ).toBe(0);
  });

  it("refuses company B's tenant even when company A has not switched Microsoft sign-in on", async () => {
    await prisma.organization.update({ where: { id: acme.admin.orgId }, data: { entraTenantId: null } });
    const { attempt, input } = attemptFor({
      tid: rivalTid,
      oid: newOid(),
      email: acme.engineer.email,
      edov: true,
    });
    expect((await completeMicrosoftSignIn(attempt, input, {})).kind).toBe("refused");
    expect(await prisma.session.count({ where: { userId: acme.engineer.userId } })).toBe(0);
  });

  it("never follows a link to a person outside the company that owns the tenant", async () => {
    // A link that somehow names company B's tenant on company A's person is still refused.
    const oid = newOid();
    await prisma.user.update({
      where: { id: acme.engineer.userId },
      data: { microsoftOid: oid, microsoftTenantId: rivalTid },
    });
    const { attempt, input } = attemptFor({ tid: rivalTid, oid, email: null });
    expect((await completeMicrosoftSignIn(attempt, input, {})).kind).toBe("refused");
    expect(await prisma.session.count({ where: { userId: acme.engineer.userId } })).toBe(0);
  });

  it("refuses a token from a tenant no company has claimed", async () => {
    const { attempt, input } = attemptFor({
      tid: newTenant(),
      oid: newOid(),
      email: acme.engineer.email,
      edov: true,
    });
    expect((await completeMicrosoftSignIn(attempt, input, {})).kind).toBe("refused");
    expect(await prisma.session.count({ where: { userId: acme.engineer.userId } })).toBe(0);
  });

  it("lets company A's own tenant in, as the contrast", async () => {
    const { attempt, input } = attemptFor({
      tid: acmeTid,
      oid: newOid(),
      email: acme.engineer.email,
      edov: true,
    });
    const outcome = await completeMicrosoftSignIn(attempt, input, {});
    expect(outcome.kind).toBe("signed-in");
    if (outcome.kind === "signed-in") expect(outcome.userId).toBe(acme.engineer.userId);
  });

  it("refuses company A's administrator switching on with a tenant company B holds, and leaves B alone", async () => {
    await prisma.organization.update({ where: { id: acme.admin.orgId }, data: { entraTenantId: null } });
    const { attempt, input } = attemptFor(
      { tid: rivalTid, oid: newOid(), email: acme.admin.email, edov: true },
      { userId: acme.admin.userId, orgId: acme.admin.orgId },
    );

    expect(await completeMicrosoftSignInEnable(acme.admin, attempt, input)).toBe("taken");

    const rivalOrg = await prisma.organization.findUniqueOrThrow({ where: { id: rival.admin.orgId } });
    expect(rivalOrg.entraTenantId).toBe(rivalTid);
    const acmeOrg = await prisma.organization.findUniqueOrThrow({ where: { id: acme.admin.orgId } });
    expect(acmeOrg.entraTenantId).toBeNull();
    const acmeAdmin = await prisma.user.findUniqueOrThrow({ where: { id: acme.admin.userId } });
    expect(acmeAdmin.microsoftOid).toBeNull();
    expect(
      await prisma.activityLog.count({ where: { action: "MICROSOFT_SIGNIN_ENABLED" } }),
    ).toBe(0);
  });

  it("refuses a switch-on attempt carried into another company's session", async () => {
    await prisma.organization.update({ where: { id: acme.admin.orgId }, data: { entraTenantId: null } });
    const { attempt, input } = attemptFor(
      { tid: newTenant(), oid: newOid(), email: rival.admin.email, edov: true },
      { userId: acme.admin.userId, orgId: acme.admin.orgId },
    );
    expect(await completeMicrosoftSignInEnable(rival.admin, attempt, input)).toBe("failed");
    expect(
      (await prisma.organization.findUniqueOrThrow({ where: { id: acme.admin.orgId } })).entraTenantId,
    ).toBeNull();
  });

  it("switching off clears only the administrator's own company's links", async () => {
    await prisma.user.update({
      where: { id: acme.engineer.userId },
      data: { microsoftOid: newOid(), microsoftTenantId: acmeTid },
    });
    const rivalOid = newOid();
    await prisma.user.update({
      where: { id: rival.engineer.userId },
      data: { microsoftOid: rivalOid, microsoftTenantId: rivalTid },
    });

    await disableMicrosoftSignIn(acme.admin);

    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: acme.engineer.userId } })).microsoftOid,
    ).toBeNull();
    const rivalPerson = await prisma.user.findUniqueOrThrow({ where: { id: rival.engineer.userId } });
    expect(rivalPerson.microsoftOid).toBe(rivalOid);
    expect(
      (await prisma.organization.findUniqueOrThrow({ where: { id: rival.admin.orgId } })).entraTenantId,
    ).toBe(rivalTid);
    const audit = await prisma.activityLog.findFirstOrThrow({
      where: { action: "MICROSOFT_SIGNIN_DISABLED" },
    });
    expect(audit.metadata).toEqual({ peopleUnlinked: 1 });
  });

  it("one company's administrator only ever reads their own company's sign-in status", async () => {
    await prisma.user.update({
      where: { id: acme.engineer.userId },
      data: { microsoftOid: newOid(), microsoftTenantId: acmeTid },
    });
    await prisma.organization.update({ where: { id: rival.admin.orgId }, data: { entraTenantId: null } });

    const theirs = await microsoftSignInStatus(rival.admin);
    expect(theirs.enabled).toBe(false);
    expect(theirs.linkedPeople).toBe(0);
    expect(JSON.stringify(theirs)).not.toContain(acmeTid);

    const ours = await microsoftSignInStatus(acme.admin);
    expect(ours.enabled).toBe(true);
    expect(ours.linkedPeople).toBe(1);
    expect(JSON.stringify(ours)).not.toContain(acmeTid);

    await expect(microsoftSignInStatus(rival.engineer)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("alert and brief emails never cross the company door", () => {
  beforeEach(() => configureEmail());

  afterEach(() => {
    goDormant();
    vi.restoreAllMocks();
  });

  it("notify() sends no email to another company's person, even with alerts on and a confirmed address", async () => {
    const spy = mockEmailFetchOk();
    const acmeEmail = await optIn(acme.engineer.userId, { alerts: true });
    const rivalEmail = await optIn(rival.engineer.userId, { alerts: true });

    // A caller that wrongly hands in the other company's person alongside its own.
    await notify(
      { userId: acme.admin.userId, orgId: acme.admin.orgId },
      [acme.engineer.userId, rival.engineer.userId],
      "ASSIGNED",
      { title: "New task assigned to you", body: "You were given a task.", linkUrl: "/my-tasks" },
    );
    await vi.waitFor(() => expect(sentEmails(spy)).toHaveLength(1));
    await settle();

    const sent = sentEmails(spy);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toEqual([acmeEmail]);
    expect(JSON.stringify(sent)).not.toContain(rivalEmail);
    // No in-app row either — the email copy can never be wider than the rows.
    expect(
      await prisma.notification.count({
        where: { userId: rival.engineer.userId, actorId: acme.admin.userId },
      }),
    ).toBe(0);
  });

  it("the daily brief email run carries each person only their own company's work", async () => {
    const RIVAL_PROJECT = "Rival confidential expansion";
    const RIVAL_TASK = "Rival-only compressor inspection";
    const lateDeadline = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    for (const company of [acme, rival]) {
      await prisma.disciplineTask.update({
        where: { id: company.disciplineTaskId },
        data: { deadline: lateDeadline },
      });
    }
    const rivalProject = await prisma.project.update({
      where: { id: rival.projectId },
      data: { name: RIVAL_PROJECT, code: "RIVAL-SECRET" },
    });
    await prisma.disciplineTask.update({ where: { id: rival.disciplineTaskId }, data: { title: RIVAL_TASK } });

    const acmeEmail = await optIn(acme.engineer.userId, { alerts: false, daily: true });
    const rivalEmail = await optIn(rival.engineer.userId, { alerts: false, daily: false });
    const spy = mockEmailFetchOk();
    const today = new Date();
    const morning = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), DIGEST_HOUR_UTC + 1),
    );

    // Only Acme's person asked for it: exactly one email, to them, about their own work.
    expect(await sendDailyBriefEmails(morning)).toEqual({ people: 1, sent: 1 });
    let sent = sentEmails(spy);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toEqual([acmeEmail]);
    const acmeCopy = JSON.stringify(sent[0]);
    expect(acmeCopy).toContain(SUBTASK_TITLE);
    for (const marker of [RIVAL_PROJECT, RIVAL_TASK, rivalProject.code, rivalEmail, rival.engineer.userId]) {
      expect(acmeCopy).not.toContain(marker);
    }
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: rival.engineer.userId } })).dailyBriefEmailedAt,
    ).toBeNull();

    // When the other company's person asks too, theirs carries their work — and still none of Acme's.
    const acmeProject = await prisma.project.findUniqueOrThrow({ where: { id: acme.projectId } });
    await optIn(rival.engineer.userId, { alerts: false, daily: true });
    expect(await sendDailyBriefEmails(new Date(morning.getTime() + 60 * 60 * 1000))).toEqual({
      people: 1,
      sent: 1,
    });
    sent = sentEmails(spy);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.to).toEqual([rivalEmail]);
    const rivalCopy = JSON.stringify(sent[1]);
    expect(rivalCopy).toContain(RIVAL_TASK);
    expect(rivalCopy).not.toContain(acmeProject.code);
    expect(rivalCopy).not.toContain(acmeEmail);
  });

  it("the weekly brief, in chat and by email, never names another company's project or reaches its people", async () => {
    const RIVAL_PROJECT = "Rival confidential expansion";
    const RIVAL_SLACK = "https://hooks.slack.com/services/TRIVAL/BRIVAL/RivalWeeklySecretTokenValue";
    const ACME_SLACK = "https://hooks.slack.com/services/TACME/BACME/AcmeWeeklySecretTokenValue";
    const rivalProject = await prisma.project.update({
      where: { id: rival.projectId },
      data: { name: RIVAL_PROJECT, code: "RIVAL-SECRET" },
    });
    const acmeProject = await prisma.project.findUniqueOrThrow({ where: { id: acme.projectId } });

    // Both companies run a weekly card into their own channel.
    const weeklyOn = {
      taskAssigned: true,
      mention: true,
      statusChange: true,
      overdueReminder: true,
      gateOverride: true,
      announcements: false,
      dailyBrief: false,
      weeklyBrief: true,
    };
    await saveIntegration(acme.admin, { kind: "SLACK", webhookUrl: ACME_SLACK });
    await setIntegrationEnabled(acme.admin, { kind: "SLACK", enabled: true });
    await setEventToggles(acme.admin, { kind: "SLACK", eventToggles: weeklyOn });
    await saveIntegration(rival.admin, { kind: "SLACK", webhookUrl: RIVAL_SLACK });
    await setIntegrationEnabled(rival.admin, { kind: "SLACK", enabled: true });
    await setEventToggles(rival.admin, { kind: "SLACK", eventToggles: weeklyOn });

    // Each company has one person asking for the email; a third, in Acme, has not asked.
    const acmeEmail = await optIn(acme.engineer.userId, { alerts: false, weekly: true });
    const rivalEmail = await optIn(rival.engineer.userId, { alerts: false, weekly: true });
    await optIn(acme.admin.userId, { alerts: false, weekly: false });
    const spy = mockEmailFetchOk();
    const today = new Date();
    const sinceMonday = (today.getUTCDay() + 6) % 7;
    const mondayMorning = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - sinceMonday, 6),
    );

    await postWeeklyBriefs(mondayMorning);
    await sendWeeklyBriefEmails(mondayMorning);

    const toUrl = (url: string) =>
      spy.mock.calls.filter((call) => String(call[0]) === url).map((call) => String((call[1] as RequestInit).body));
    const acmeCard = toUrl(ACME_SLACK);
    const rivalCard = toUrl(RIVAL_SLACK);
    expect(acmeCard).toHaveLength(1);
    expect(rivalCard).toHaveLength(1);
    expect(acmeCard[0]).toContain(acmeProject.code);
    expect(acmeCard[0]).not.toContain(rivalProject.code);
    expect(acmeCard[0]).not.toContain(RIVAL_PROJECT);
    expect(rivalCard[0]).toContain(rivalProject.code);
    expect(rivalCard[0]).not.toContain(acmeProject.code);

    const emails = sentEmails(spy);
    expect(emails).toHaveLength(2);
    const acmeCopy = emails.find((email) => email.to.includes(acmeEmail));
    const rivalCopy = emails.find((email) => email.to.includes(rivalEmail));
    expect(acmeCopy?.text).toContain(acmeProject.code);
    expect(JSON.stringify(acmeCopy)).not.toContain(rivalProject.code);
    expect(JSON.stringify(acmeCopy)).not.toContain(rivalEmail);
    expect(rivalCopy?.text).toContain(rivalProject.code);
    expect(JSON.stringify(rivalCopy)).not.toContain(acmeProject.code);
    expect(JSON.stringify(rivalCopy)).not.toContain(acmeEmail);
  });

  it("an unsubscribe token changes only the one person it names", async () => {
    const everyone = [acme.engineer, acme.admin, rival.engineer, rival.admin].map((person) => person.userId);
    for (const userId of everyone) await optIn(userId, { alerts: true, daily: true });

    await unsubscribeWithToken(unsubscribeToken(acme.engineer.userId, "ALERTS"));

    const rows = await prisma.user.findMany({
      where: { id: { in: everyone } },
      select: { id: true, emailAlerts: true, emailDailyBrief: true },
    });
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.emailDailyBrief).toBe(true);
      expect(row.emailAlerts).toBe(row.id !== acme.engineer.userId);
    }
    const audit = await prisma.activityLog.findMany({ where: { action: "EMAIL_PREFERENCES_CHANGED" } });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actorId).toBe(acme.engineer.userId);
  });
});

describe("the dashboard's company-wide tiles never count another company's row", () => {
  it("counts only the company's own work, and every tile list holds only its own rows", async () => {
    // Each company holds one main task and one discipline task with identical titles.
    const mine = await getDashboardForActor(acme.admin);
    const theirs = await getDashboardForActor(rival.admin);
    expect(mine.counts.total).toBe(2);
    expect(theirs.counts.total).toBe(2);

    // Make the rival's work late: the acme tiles and lists must not move.
    const past = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    await prisma.mainTask.updateMany({
      where: { project: { orgId: rival.fixture.orgId } },
      data: { deadline: past },
    });
    await prisma.disciplineTask.updateMany({
      where: { mainTask: { project: { orgId: rival.fixture.orgId } } },
      data: { deadline: past },
    });
    const after = await getDashboardForActor(acme.admin);
    expect(after.counts).toEqual(mine.counts);
    expect(after.lateTasks).toEqual([]);
    expect((await getDashboardForActor(rival.admin)).counts.overdue).toBe(2);
    expect((await listTileWork(acme.admin, "late")).total).toBe(0);
    const everything = await listTileWork(acme.admin, "all");
    expect(everything.items.map((row) => row.id).sort()).toEqual(
      [acme.mainTaskId, acme.disciplineTaskId].sort(),
    );
  });
});

// The Teams tab signs people in from a token Teams hands it — also an OUTSIDE party's claim about
// which company somebody is in — and reads their day from the tab's own cookie. The same wall holds:
// the token's `tid` picks exactly one company, `oid` alone finds a person inside it, and nothing the
// tab does can reach another company. Tokens here are REALLY signed.

describe("The Teams tab never lands in another company", () => {
  const key = makeKey("kid-isolation-teams");
  let restoreEnv: () => void = () => undefined;
  let acmeTid: string;
  let rivalTid: string;
  const acmeOid = newOid();

  const token = (tid: string, oid: string) => signToken(teamsClaimsFor({ tid, oid }), key);

  async function sessionFor(userId: string): Promise<void> {
    const minted = mintSession();
    await prisma.session.create({ data: { tokenHash: minted.tokenHash, userId, expiresAt: minted.expiresAt } });
    jar.set(SESSION_COOKIE, { value: minted.rawToken });
  }

  beforeEach(async () => {
    jar.clear();
    restoreEnv = configureTeamsEnv();
    signingKeys.clear();
    installFakeMicrosoft([key.jwk]);
    acmeTid = newTenant();
    rivalTid = newTenant();
    await prisma.organization.update({ where: { id: acme.admin.orgId }, data: { entraTenantId: acmeTid } });
    await prisma.organization.update({ where: { id: rival.admin.orgId }, data: { entraTenantId: rivalTid } });
    await prisma.user.update({
      where: { id: acme.engineer.userId },
      data: { microsoftOid: acmeOid, microsoftTenantId: acmeTid },
    });
  });

  afterEach(() => {
    restoreEnv();
    vi.restoreAllMocks();
    jar.clear();
  });

  it("signs in company A's person from company A's own tenant — the control", async () => {
    const outcome = await signInWithTeamsToken(token(acmeTid, acmeOid), {});
    expect(outcome.kind).toBe("signed-in");
  });

  it("never yields a company-A person from company B's tenant, even with the same oid", async () => {
    // A perfectly valid token from company B's tenant carrying company A's person's exact oid.
    const outcome = await signInWithTeamsToken(token(rivalTid, acmeOid), {});

    expect(outcome.kind).toBe("refused");
    expect(await prisma.session.count({ where: { userId: acme.engineer.userId } })).toBe(0);
    expect(await prisma.activityLog.count({ where: { action: "LOGIN" } })).toBe(0);
  });

  it("answers a tenant no company owns exactly as it answers a wrong company", async () => {
    const wrongCompany = await signInWithTeamsToken(token(rivalTid, acmeOid), {});
    const unknownTenant = await signInWithTeamsToken(token(newTenant(), acmeOid), {});

    expect(wrongCompany.kind).toBe("refused");
    expect(unknownTenant.kind).toBe("refused");
    // Neither outcome carries anything a caller could tell apart.
    expect(Object.keys(wrongCompany).sort()).toEqual(Object.keys(unknownTenant).sort());
    expect(await prisma.session.count()).toBe(0);
  });

  it("refuses a person linked under a tenant their company no longer owns", async () => {
    // Company A switched Microsoft sign-in off and on again with a different tenant; the old link is
    // not trusted against the new tenant.
    await prisma.organization.update({ where: { id: acme.admin.orgId }, data: { entraTenantId: newTenant() } });
    expect((await signInWithTeamsToken(token(acmeTid, acmeOid), {})).kind).toBe("refused");
  });

  it("a hand-off code minted for a company-A person cannot be exchanged into a session for anyone else", async () => {
    const issued = await issueEmailToken(acme.engineer.userId, "TEAMS_HANDOFF");

    const outcome = await signInWithHandoff(issued.rawToken, {});
    expect(outcome.kind).toBe("signed-in");
    const sessions = await prisma.session.findMany({});
    expect(sessions).toHaveLength(1);
    expect(sessions[0].userId).toBe(acme.engineer.userId);

    // …and it is dead after the one use.
    expect((await signInWithHandoff(issued.rawToken, {})).kind).toBe("refused");
    expect(await prisma.session.count()).toBe(1);
  });

  it("a hand-off code for a person whose company has since switched Microsoft sign-in off is refused", async () => {
    const issued = await issueEmailToken(acme.engineer.userId, "TEAMS_HANDOFF");
    await disableMicrosoftSignIn(acme.admin);

    expect((await signInWithHandoff(issued.rawToken, {})).kind).toBe("refused");
    expect(await prisma.session.count()).toBe(0);
  });

  it("the package download is 'not found' for a signed-out caller, a non-admin and a rival's administrator reads nothing of ours", async () => {
    expect((await teamsManifestRoute()).status).toBe(404);

    await sessionFor(acme.engineer.userId);
    expect((await teamsManifestRoute()).status).toBe(404);

    // Another company's administrator gets the same public package — it names no company — and
    // the answer carries no trace of ours.
    jar.clear();
    await sessionFor(rival.admin.userId);
    const response = await teamsManifestRoute();
    expect(response.status).toBe(200);
    const bytes = (await response.arrayBuffer()) as ArrayBuffer;
    const text = Buffer.from(bytes).toString("latin1");
    expect(text).not.toContain(acmeTid);
    expect(text).not.toContain(rivalTid);
  });

  it("the tab page is scoped by the tab session's own company: it draws that person's day and nobody else's", async () => {
    // Give company A's engineer work due today, and confirm company B's tab never shows it.
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    await prisma.disciplineTask.updateMany({
      where: { mainTask: { project: { orgId: acme.admin.orgId } } },
      data: { deadline: today },
    });

    const aOutcome = await signInWithTeamsToken(token(acmeTid, acmeOid), {});
    if (aOutcome.kind !== "signed-in") throw new Error("expected a sign-in");
    jar.set(TEAMS_COOKIE, { value: aOutcome.sessionToken });
    const aPage = (await TeamsTabPage({ searchParams: Promise.resolve({}) })) as unknown as {
      type: unknown;
      props: { brief: { dueToday: { items: { title: string }[] }; overdue: { total: number } } };
    };
    expect(aPage.type).toBe(TeamsBrief);
    const aTitles = JSON.stringify(aPage.props.brief);
    expect(aTitles).toContain(SUBTASK_TITLE);

    // A person of company B, signed in to the tab, sees only company B's own assigned work.
    jar.clear();
    const rivalOid = newOid();
    await prisma.user.update({
      where: { id: rival.engineer.userId },
      data: { microsoftOid: rivalOid, microsoftTenantId: rivalTid },
    });
    const bOutcome = await signInWithTeamsToken(token(rivalTid, rivalOid), {});
    if (bOutcome.kind !== "signed-in") throw new Error("expected a sign-in");
    jar.set(TEAMS_COOKIE, { value: bOutcome.sessionToken });
    const bPage = (await TeamsTabPage({ searchParams: Promise.resolve({}) })) as unknown as {
      props: { brief: unknown };
    };
    const brief = await (await import("@/server/services/briefs")).personBrief(rival.engineer);
    expect(JSON.parse(JSON.stringify(bPage.props.brief)).overdue).toEqual(JSON.parse(JSON.stringify(brief.overdue)));
    // Company A's own ids never appear in company B's tab.
    expect(JSON.stringify(bPage.props.brief)).not.toContain(acme.disciplineTaskId);
    expect(JSON.stringify(bPage.props.brief)).not.toContain(acme.mainTaskId);

    // And a browser session alone never shows a tab at all.
    jar.clear();
    await sessionFor(acme.engineer.userId);
    expect(((await TeamsTabPage({ searchParams: Promise.resolve({}) })) as unknown as { type: unknown }).type).toBe(
      TeamsSignIn,
    );
  });
});
