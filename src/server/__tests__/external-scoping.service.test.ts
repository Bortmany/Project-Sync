// THE EXTERNAL GUARANTEE, proved: a contractor sees the work assigned to them and nothing else.
//
// Modelled on org-isolation.service.test.ts, and for the same reason. There, the wrong company is
// refused; here, the wrong PERSON inside the right company is refused — a contractor invited to
// deliver two discipline tasks must never be able to reach the rest of the project, the team list,
// the file drawer, the audit trail or the people directory.
//
// Every miss is "not found", never "forbidden": telling an outsider that an id is real is itself a
// leak, exactly as it is across companies. The second half of the file proves the sign-off: a
// contractor's "done" is a request, the real completion gate still runs when somebody confirms it,
// and a contractor can never sign off their own work.

import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Sign in with Microsoft runs through the real routes below; this is the cookie jar next/headers
// would give a live request. Nothing else in this file reads next/headers.
const jar = vi.hoisted(() => new Map<string, { value: string; options?: Record<string, unknown> }>());
vi.mock("next/headers", async () => {
  const fixtures = await import("@/server/__tests__/microsoft-signin-fixtures");
  return fixtures.cookieJarModule(jar);
});

import { GET as microsoftStartRoute } from "@/app/api/auth/microsoft/route";
import TeamsTabPage from "@/app/teams/tab/page";
import { TeamsBrief } from "@/components/teams/teams-brief";
import { TeamsSignIn } from "@/components/teams/teams-sign-in";
import { TEAMS_COOKIE } from "@/lib/teams-app";
import { signInWithTeamsToken } from "@/server/services/teams-signin";
import { GET as microsoftCallbackRoute } from "@/app/api/auth/microsoft/callback/route";
import { homePathFor } from "@/components/shell/nav-items";
import { POST as askRoute } from "@/app/api/ai/ask/route";
import { SESSION_COOKIE, getSessionUser, mintSession } from "@/lib/auth";
import DashboardPage from "@/app/(app)/dashboard/page";
import ProjectPage from "@/app/(app)/projects/[id]/page";
import { askTielora } from "@/server/services/ai-ask";
import { askTieloraAvailable, askTieloraProjects } from "@/server/services/ai-panel";
import { aiSettingsFor, setAiSettings } from "@/server/services/ai-settings";
import { goDormantAi, installFakeAnthropic, sentText, switchAiOn } from "@/server/__tests__/ai-harness";
import { signingKeys } from "@/server/services/microsoft-signin";
import { sendDailyBriefEmails, sendWeeklyBriefEmails } from "@/server/sweep";
import {
  EMAIL_BASE,
  configureEmail,
  goDormant,
  mockFetchOk as mockEmailFetchOk,
  optIn,
  sentEmails,
  settle,
} from "@/server/__tests__/email-harness";
import {
  TEST_BASE_URL,
  claimsFor,
  configureMicrosoftEnv,
  configureTeamsEnv,
  installFakeMicrosoft,
  makeKey,
  newOid,
  newTenant,
  signToken,
  teamsClaimsFor,
  type FakeMicrosoft,
} from "@/server/__tests__/microsoft-signin-fixtures";

process.env.DATA_DIR = path.join(os.tmpdir(), "tielora-test-data");

import { prisma } from "@/lib/db";
import { ForbiddenError, can } from "@/lib/permissions";
import { searchEverything } from "@/lib/search";
import { storeFile, validateUpload } from "@/lib/upload";
import { actorForUser, type ActorContext } from "@/server/actor";
import { NotFoundError, ServiceError } from "@/server/errors";
import { personBrief, projectBrief } from "@/server/services/briefs";
import {
  listActivity,
  createComment,
  deleteComment,
  editComment,
  listComments,
} from "@/server/services/comments";
import { getDashboardForActor, listTileWork } from "@/server/services/dashboard";
import { listAllUsers, updateUser } from "@/server/services/admin";
import { listUsers } from "@/server/services/directory";
import {
  getVersionForDownload,
  listDocumentsForDisciplineTask,
  listDocumentsForMainTask,
  listDocumentsForProject,
  listVersions,
  uploadDocumentVersion,
} from "@/server/services/documents";
import { toggleFavorite, listFavorites } from "@/server/services/favorites";
import { listNotifications } from "@/server/services/notifications";
import {
  acknowledgePost,
  createPost,
  deletePost,
  dismissAnnouncement,
  editPost,
  listAnnouncementsForUser,
  listAudiences,
  listBoard,
  replyToPost,
} from "@/server/services/posts";
import {
  getProjectForActor,
  listProjectsForActor,
  setExternalSignoffRequired,
  upsertMember,
} from "@/server/services/projects";
import {
  addDependency,
  removeDependency,
  completeDisciplineTask,
  confirmDisciplineTaskReview,
  createDisciplineTask,
  createMainTask,
  ganttForProject,
  getDisciplineTaskForActor,
  getMainTaskForActor,
  listAwaitingMySignoff,
  listMainTasksForProject,
  overrideMainTaskStatus,
  rejectDisciplineTaskReview,
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

const MINE = "Contractor weld inspection";
const THEIRS = "Internal design review";
const REQUIRED_DOC = "Weld inspection report";

let fixture: Fixture;
/** The contractor: an EXTERNAL of the SAME company, holding one task on one project. */
let contractor: ActorContext;
let sharedMainTaskId: string;
let myTaskId: string;
let theirTaskId: string;
/** A main task in the same project with none of the contractor's work under it. */
let otherMainTaskId: string;
/** A second project the contractor holds nothing on at all. */
let otherProjectId: string;
let otherProjectTaskId: string;
/** A document on the internal task — the contractor must never see it. */
let internalDocumentId: string;
let internalVersionId: string;

async function uploadTo(
  actor: ActorContext,
  target: { projectId: string; disciplineTaskId?: string; mainTaskId?: string; requiredDocumentId?: string },
  filename = "Report.csv",
) {
  // A real PDF where the checklist is concerned: a CSV can no longer tick off a mandatory item.
  const buffer = filename.endsWith(".pdf")
    ? Buffer.from(`%PDF-1.4\n% ${filename}\n%%EOF\n`, "utf8")
    : Buffer.from(`line,value\n1,${filename}\n`, "utf8");
  const checked = validateUpload(buffer, filename);
  if (!checked.ok) throw new Error(checked.error);
  const stored = await storeFile(buffer, checked.ext);
  return uploadDocumentVersion(actor, target, {
    buffer,
    originalName: filename,
    mimeType: checked.mimeType,
    ext: checked.ext,
    sizeBytes: stored.sizeBytes,
    checksumSha256: stored.checksumSha256,
    storedFilename: stored.storedFilename,
  });
}

beforeEach(async () => {
  await resetDatabase();
  fixture = await makeProjectFixture();

  const external = await makeUser({ name: "Yusuf Contractor", role: "EXTERNAL", orgId: fixture.orgId });
  await prisma.user.update({
    where: { id: external.id },
    data: { companyName: "Al Hassan Engineering" },
  });
  await prisma.projectMember.create({
    data: { projectId: fixture.projectId, userId: external.id, projectRole: "EXTERNAL" },
  });
  contractor = await actorForUser(external.id);

  // One main task with two pieces of work under it: the contractor's, and a colleague's.
  const shared = await createMainTask(fixture.adminActor, {
    projectId: fixture.projectId,
    title: "Flare tip replacement",
    description: "Shared parent task.",
    priority: "HIGH",
    deadline: inThirtyDays(),
    disciplineTasks: [
      {
        disciplineId: fixture.disciplineId,
        title: MINE,
        assigneeId: contractor.userId,
        deadline: inThirtyDays(),
        isMandatory: true,
        requiredDocuments: [{ name: REQUIRED_DOC, isMandatory: true }],
      },
      {
        disciplineId: fixture.otherDisciplineId,
        title: THEIRS,
        assigneeId: fixture.engineerActor.userId,
        deadline: inThirtyDays(),
        isMandatory: true,
        requiredDocuments: [],
      },
    ],
  });
  sharedMainTaskId = shared.id;
  const subtasks = await subtaskIdsByTitle(shared.id);
  myTaskId = subtasks.get(MINE) as string;
  theirTaskId = subtasks.get(THEIRS) as string;

  // A second main task on the same project, entirely internal.
  const other = await createMainTask(fixture.adminActor, {
    projectId: fixture.projectId,
    title: "Pipe rack survey",
    description: "Nothing here belongs to the contractor.",
    priority: "MEDIUM",
    deadline: inThirtyDays(),
    disciplineTasks: [
      {
        disciplineId: fixture.disciplineId,
        title: "Survey walkdown",
        assigneeId: fixture.engineerActor.userId,
        deadline: inThirtyDays(),
        isMandatory: true,
        requiredDocuments: [],
      },
    ],
  });
  otherMainTaskId = other.id;

  // A whole project the contractor is not on.
  const secondProject = await prisma.project.create({
    data: {
      orgId: fixture.orgId,
      name: "Second project",
      code: `SEC-${Math.floor(Math.random() * 1_000_000)}`,
      description: "The contractor holds no work here.",
      createdById: fixture.adminActor.userId,
      disciplines: { create: [{ disciplineId: fixture.disciplineId }] },
      members: {
        create: [
          { userId: fixture.adminActor.userId, projectRole: "ADMIN" },
          {
            userId: fixture.engineerActor.userId,
            projectRole: "ENGINEER",
            disciplineId: fixture.disciplineId,
          },
        ],
      },
    },
  });
  otherProjectId = secondProject.id;
  const secondMain = await createMainTask(fixture.adminActor, {
    projectId: secondProject.id,
    title: "Second project work",
    description: "Internal only.",
    priority: "LOW",
    deadline: inThirtyDays(),
    disciplineTasks: [
      {
        disciplineId: fixture.disciplineId,
        title: "Second project subtask",
        assigneeId: fixture.engineerActor.userId,
        deadline: inThirtyDays(),
        isMandatory: true,
        requiredDocuments: [],
      },
    ],
  });
  otherProjectTaskId = (await subtaskIdsByTitle(secondMain.id)).get(
    "Second project subtask",
  ) as string;

  const internal = await uploadTo(
    fixture.pmActor,
    { projectId: fixture.projectId, disciplineTaskId: theirTaskId },
    "Internal.csv",
  );
  internalDocumentId = internal.documentId;
  internalVersionId = internal.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("a contractor only sees the projects they hold work on", () => {
  it("lists the one project with their work, and nothing else", async () => {
    const projects = await listProjectsForActor(contractor);
    expect(projects.map((project) => project.id)).toEqual([fixture.projectId]);
  });

  it("cannot open a project they hold no work on, and does not learn it exists", async () => {
    await expect(getProjectForActor(contractor, otherProjectId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listMainTasksForProject(contractor, otherProjectId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(ganttForProject(contractor, otherProjectId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("loses the project the moment their last task there is reassigned", async () => {
    await prisma.disciplineTask.update({
      where: { id: myTaskId },
      data: { assigneeId: fixture.engineerActor.userId },
    });
    const stillMember = await prisma.projectMember.findFirst({
      where: { projectId: fixture.projectId, userId: contractor.userId },
    });
    expect(stillMember).not.toBeNull();

    const fresh = await actorForUser(contractor.userId);
    expect(await listProjectsForActor(fresh)).toEqual([]);
    await expect(getProjectForActor(fresh, fixture.projectId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("sees no team roster and no other discipline on the project they are on", async () => {
    const project = await getProjectForActor(contractor, fixture.projectId);
    expect(project.members).toEqual([]);
    expect(project.disciplines.map((row) => row.disciplineId)).toEqual([fixture.disciplineId]);
    // Their card counts their own work: one main task, not the project's two.
    expect(project.counts.mainTasks).toBe(1);
  });
});

describe("a contractor has no status report", () => {
  it("is not found, even for a project they hold work on, before any data is read, and is never audited", async () => {
    const { buildReportData, exportStatusReport } = await import("@/server/services/report");

    // The project they hold work on, and the one they do not: the same answer for both.
    for (const projectId of [fixture.projectId, otherProjectId]) {
      await expect(buildReportData(contractor, projectId)).rejects.toBeInstanceOf(NotFoundError);
      await expect(exportStatusReport(contractor, projectId, "pdf")).rejects.toBeInstanceOf(NotFoundError);
      await expect(exportStatusReport(contractor, projectId, "pptx")).rejects.toBeInstanceOf(NotFoundError);
    }
    // Not a single audit row: a refusal is not an export.
    expect(await prisma.activityLog.count({ where: { action: "REPORT_EXPORTED" } })).toBe(0);
  });
});

describe("a contractor only sees their own tasks", () => {
  it("sees their own task under its parent, and not the colleague's beside it", async () => {
    const parent = await getMainTaskForActor(contractor, sharedMainTaskId);
    expect(parent.title).toBe("Flare tip replacement");
    expect(parent.disciplineSummary.map((row) => row.title)).toEqual([MINE]);
  });

  it("cannot open a main task with none of their work under it", async () => {
    await expect(getMainTaskForActor(contractor, otherMainTaskId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("cannot open somebody else's discipline task, here or on another project", async () => {
    await expect(getDisciplineTaskForActor(contractor, theirTaskId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(getDisciplineTaskForActor(contractor, otherProjectTaskId)).rejects.toBeInstanceOf(
      NotFoundError,
    );

    const mine = await getDisciplineTaskForActor(contractor, myTaskId);
    expect(mine.title).toBe(MINE);
    expect(mine.assigneeCompanyName).toBe("Al Hassan Engineering");
  });

  it("lists only the main tasks their work sits under", async () => {
    const list = await listMainTasksForProject(contractor, fixture.projectId);
    expect(list.map((item) => item.id)).toEqual([sharedMainTaskId]);
    expect(list[0]?.disciplineSummary.map((row) => row.title)).toEqual([MINE]);
  });

  it("gets a timeline of their own bars only", async () => {
    const gantt = await ganttForProject(contractor, fixture.projectId);
    expect(gantt.mainTasks.map((task) => task.id)).toEqual([sharedMainTaskId]);
    expect(gantt.mainTasks[0]?.disciplineTasks.map((task) => task.title)).toEqual([MINE]);
  });

  it("cannot change, or even see, a task belonging to somebody else", async () => {
    await expect(
      updateDisciplineTaskStatus(contractor, { id: theirTaskId, status: "IN_PROGRESS" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("cannot create work, on their own parent task or anywhere else", async () => {
    await expect(
      createDisciplineTask(contractor, {
        mainTaskId: sharedMainTaskId,
        disciplineId: fixture.disciplineId,
        title: "Something I invented",
        deadline: inThirtyDays(),
        priority: "MEDIUM",
        isMandatory: true,
        requiredDocuments: [],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("a contractor cannot sequence work", () => {
  it("is refused when adding or removing a dependency, even on their own task", async () => {
    // Two pieces of work that are both the contractor's own.
    const mineToo = (
      await createDisciplineTask(fixture.pmActor, {
        mainTaskId: sharedMainTaskId,
        disciplineId: fixture.disciplineId,
        title: "Contractor punch list",
        assigneeId: contractor.userId,
        deadline: inThirtyDays(),
        priority: "MEDIUM",
        isMandatory: true,
        requiredDocuments: [],
      })
    ).id;
    const pair = { predecessorId: myTaskId, successorId: mineToo };

    await expect(addDependency(contractor, pair)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await prisma.taskDependency.count()).toBe(0);

    await addDependency(fixture.pmActor, pair);
    await expect(removeDependency(contractor, pair)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await prisma.taskDependency.count()).toBe(1);
  });

  it("is a miss, not a refusal, on a task that is not theirs", async () => {
    for (const pair of [
      { predecessorId: myTaskId, successorId: theirTaskId },
      { predecessorId: theirTaskId, successorId: myTaskId },
    ]) {
      await expect(addDependency(contractor, pair)).rejects.toBeInstanceOf(NotFoundError);
    }
    expect(await prisma.taskDependency.count()).toBe(0);
  });

  it("never names somebody else's task on the timeline, though a colleague sees the wait", async () => {
    await addDependency(fixture.pmActor, { predecessorId: theirTaskId, successorId: myTaskId });

    const colleague = await ganttForProject(fixture.pmActor, fixture.projectId);
    const colleagueBar = colleague.mainTasks
      .flatMap((task) => task.disciplineTasks)
      .find((bar) => bar.id === myTaskId);
    expect(colleagueBar?.waitingOn).toEqual([THEIRS]);

    const theirs = await ganttForProject(contractor, fixture.projectId);
    expect(JSON.stringify(theirs)).not.toContain(THEIRS);
    expect(
      theirs.mainTasks.flatMap((task) => task.disciplineTasks).every((bar) => bar.waitingOn?.length === 0),
    ).toBe(true);
  });
});

describe("a contractor's documents, search, directory and briefs are all narrowed", () => {
  it("sees only the files on their own tasks", async () => {
    const mine = await uploadTo(
      contractor,
      { projectId: fixture.projectId, disciplineTaskId: myTaskId },
      "Mine.csv",
    );

    const projectDocuments = await listDocumentsForProject(contractor, fixture.projectId);
    expect(projectDocuments.map((document) => document.id)).toEqual([mine.documentId]);

    const parentDocuments = await listDocumentsForMainTask(contractor, sharedMainTaskId);
    expect(parentDocuments.map((document) => document.id)).toEqual([mine.documentId]);

    await expect(
      listDocumentsForDisciplineTask(contractor, theirTaskId),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("cannot list the revisions of, or download, a colleague's file", async () => {
    await expect(listVersions(contractor, internalDocumentId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getVersionForDownload(contractor, internalVersionId)).rejects.toBeInstanceOf(
      NotFoundError,
    );

    // Their own file still downloads, which is what makes the refusal meaningful.
    const mine = await uploadTo(
      contractor,
      { projectId: fixture.projectId, disciplineTaskId: myTaskId },
      "Mine.csv",
    );
    const file = await getVersionForDownload(contractor, mine.id);
    expect(file.originalFilename).toBe("Mine.csv");
  });

  it("searches inside their own work, and gets no people at all", async () => {
    const byProject = await searchEverything(contractor, "Test");
    expect(byProject.users).toEqual([]);
    expect(byProject.projects.map((project) => project.id)).toEqual([fixture.projectId]);

    // The colleague's task is in the same project and matches the words; it is still not theirs.
    const byTask = await searchEverything(contractor, "design review");
    expect(byTask.disciplineTasks).toEqual([]);
    expect(byTask.mainTasks).toEqual([]);

    const mine = await searchEverything(contractor, "inspection");
    expect(mine.disciplineTasks.map((task) => task.title)).toEqual([MINE]);

    // The project card in a search result is the SAME narrowed card the projects page gives them:
    // their own task counts, their own progress and their own disciplines — never the whole
    // project's. Search is a second door onto the project list and must not open any wider.
    const [card] = byProject.projects;
    const [listed] = await listProjectsForActor(contractor);
    expect(card.mainTaskCount).toBe(listed.mainTaskCount);
    expect(card.overdueCount).toBe(listed.overdueCount);
    expect(card.progressPct).toBe(listed.progressPct);
    expect(card.disciplines.map((row) => row.code)).toEqual(listed.disciplines.map((row) => row.code));

    // Only the main task their own work sits under is counted — the internal one is not.
    expect(card.mainTaskCount).toBe(1);
    const managerCard = (await searchEverything(fixture.pmActor, "Test")).projects.find(
      (project) => project.id === fixture.projectId,
    );
    expect(managerCard?.mainTaskCount).toBeGreaterThan(card.mainTaskCount);
    expect(managerCard!.disciplines.length).toBeGreaterThan(card.disciplines.length);

    const files = await searchEverything(contractor, "Internal");
    expect(files.documents.map((document) => document.id)).not.toContain(internalDocumentId);
    // The project manager finds exactly what the contractor could not.
    const asManager = await searchEverything(fixture.pmActor, "Internal");
    expect(asManager.documents.map((document) => document.id)).toContain(internalDocumentId);
  });

  it("gets an empty people directory", async () => {
    expect(await listUsers(contractor)).toEqual([]);
    // Their colleagues still have one.
    expect((await listUsers(fixture.pmActor)).length).toBeGreaterThan(0);
  });

  it("cannot read the project brief, but their own day still works", async () => {
    await expect(projectBrief(contractor, fixture.projectId)).rejects.toBeInstanceOf(NotFoundError);

    const brief = await personBrief(contractor);
    expect(brief.awaitingReview.items).toEqual([]);
    expect(brief.generatedAt).toBeInstanceOf(Date);
  });

  it("cannot read the project's or the parent task's audit trail", async () => {
    await expect(
      listActivity(contractor, { projectId: fixture.projectId }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      listActivity(contractor, { mainTaskId: sharedMainTaskId }),
    ).rejects.toBeInstanceOf(NotFoundError);

    const own = await listActivity(contractor, { disciplineTaskId: myTaskId });
    expect(own.length).toBeGreaterThan(0);
  });

  it("comments on their own task only", async () => {
    await expect(
      createComment(contractor, { mainTaskId: sharedMainTaskId, body: "Parent thread", mentions: [] }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      createComment(contractor, { disciplineTaskId: theirTaskId, body: "Not mine", mentions: [] }),
    ).rejects.toBeInstanceOf(NotFoundError);

    const comment = await createComment(contractor, {
      disciplineTaskId: myTaskId,
      body: "Welds complete, report attached.",
      mentions: [],
    });
    expect(comment.authorCompanyName).toBe("Al Hassan Engineering");

    const thread = await listComments(contractor, { disciplineTaskId: myTaskId });
    expect(thread.map((row) => row.body)).toContain("Welds complete, report attached.");
  });

  it("can edit and remove their own comment, and nobody else's", async () => {
    const mine = await createComment(contractor, {
      disciplineTaskId: myTaskId,
      body: "First pass done.",
      mentions: [],
    });

    const edited = await editComment(contractor, { id: mine.id, body: "Second pass done." });
    expect(edited.body).toBe("Second pass done.");

    // A colleague's comment on the contractor's OWN task is one they may read and never change.
    const colleagues = await createComment(fixture.pmActor, {
      disciplineTaskId: myTaskId,
      body: "Noted, thank you.",
      mentions: [],
    });
    await expect(
      editComment(contractor, { id: colleagues.id, body: "Not mine to change" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(deleteComment(contractor, { id: colleagues.id })).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    // A comment on work that is not theirs does not exist for them at all.
    const elsewhere = await createComment(fixture.pmActor, {
      disciplineTaskId: theirTaskId,
      body: "Internal chatter.",
      mentions: [],
    });
    await expect(
      editComment(contractor, { id: elsewhere.id, body: "Not mine to change" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteComment(contractor, { id: elsewhere.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );

    const removed = await deleteComment(contractor, { id: mine.id });
    expect(removed.removed).toBe(true);
    const thread = await listComments(contractor, { disciplineTaskId: myTaskId });
    expect(thread.find((row) => row.id === mine.id)?.isDeleted).toBe(true);
  });

  it("is never notified about a comment on a thread they cannot open", async () => {
    // A colleague @-mentions the contractor on the PARENT thread, which a contractor cannot read.
    // The notification would name a task whose link answers "not found".
    await createComment(fixture.pmActor, {
      mainTaskId: sharedMainTaskId,
      body: "Any update here?",
      mentions: [contractor.userId, fixture.engineerActor.userId],
    });

    // Nor on a colleague's discipline task, where the contractor is a project member but holds
    // none of the work.
    await createComment(fixture.pmActor, {
      disciplineTaskId: theirTaskId,
      body: "And here?",
      mentions: [contractor.userId],
    });

    expect(
      await prisma.notification.count({ where: { userId: contractor.userId, type: "MENTIONED" } }),
    ).toBe(0);
    expect(
      await prisma.notification.count({
        where: { userId: contractor.userId, type: "COMMENT_ADDED" },
      }),
    ).toBe(0);

    // The colleague mentioned in the same breath did hear about it, which is what makes the
    // omission deliberate rather than a broken fan-out.
    expect(
      await prisma.notification.count({
        where: { userId: fixture.engineerActor.userId, type: "MENTIONED" },
      }),
    ).toBe(1);

    // And on their own task a mention still reaches them.
    await createComment(fixture.pmActor, {
      disciplineTaskId: myTaskId,
      body: "Please confirm the weld report.",
      mentions: [contractor.userId],
    });
    expect(
      await prisma.notification.count({ where: { userId: contractor.userId, type: "MENTIONED" } }),
    ).toBe(1);

    // As does a plain comment on it, because they are its assignee.
    await createComment(fixture.pmActor, {
      disciplineTaskId: myTaskId,
      body: "One more thing.",
      mentions: [],
    });
    expect(
      await prisma.notification.count({
        where: { userId: contractor.userId, type: "COMMENT_ADDED" },
      }),
    ).toBe(1);
  });

  it("is left out of a department mention, except on their own task", async () => {
    // The contractor works in this department on this project, which is the only way a department
    // mention could ever reach them.
    await prisma.projectMember.updateMany({
      where: { projectId: fixture.projectId, userId: contractor.userId },
      data: { disciplineId: fixture.disciplineId },
    });

    await createComment(fixture.pmActor, {
      mainTaskId: sharedMainTaskId,
      body: "@MECH discipline can you all look at this?",
      mentions: [],
      disciplineMentions: [fixture.disciplineId],
    });

    expect(
      await prisma.notification.count({ where: { userId: contractor.userId, type: "MENTIONED" } }),
    ).toBe(0);

    // The colleague in the same department did hear about it, which is what makes the omission
    // deliberate rather than a broken fan-out.
    expect(
      await prisma.notification.count({
        where: { userId: fixture.engineerActor.userId, type: "MENTIONED" },
      }),
    ).toBe(1);

    // On their own task the same department mention reaches them, exactly as a personal one does.
    await createComment(fixture.pmActor, {
      disciplineTaskId: myTaskId,
      body: "@MECH discipline the weld report, please.",
      mentions: [],
      disciplineMentions: [fixture.disciplineId],
    });
    expect(
      await prisma.notification.count({ where: { userId: contractor.userId, type: "MENTIONED" } }),
    ).toBe(1);
  });

  it("is never told the NAMES of the departments a comment mentioned", async () => {
    // The project screen already hides every department but their own from a contractor. A
    // notification body is the one door read scoping cannot close, so it says "your department"
    // and never which ones — not even the one they are in.
    await prisma.projectMember.updateMany({
      where: { projectId: fixture.projectId, userId: contractor.userId },
      data: { disciplineId: fixture.disciplineId },
    });

    await createComment(fixture.pmActor, {
      disciplineTaskId: myTaskId,
      body: "@MECH discipline and @ELEC discipline, please look at this.",
      mentions: [],
      disciplineMentions: [fixture.disciplineId, fixture.otherDisciplineId],
    });

    const told = await prisma.notification.findMany({
      where: { userId: contractor.userId, type: "MENTIONED" },
    });
    expect(told).toHaveLength(1);
    expect(told[0].body).toContain("mentioned your department");
    expect(told[0].body).not.toContain("MECH");
    expect(told[0].body).not.toContain("ELEC");
  });

  it("can only star something they can see", async () => {
    await expect(
      toggleFavorite(contractor, { targetType: "DISCIPLINE_TASK", targetId: theirTaskId }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      toggleFavorite(contractor, { targetType: "PROJECT", targetId: otherProjectId }),
    ).rejects.toBeInstanceOf(NotFoundError);

    const starred = await toggleFavorite(contractor, {
      targetType: "DISCIPLINE_TASK",
      targetId: myTaskId,
    });
    expect(starred.favorited).toBe(true);
    expect((await listFavorites(contractor)).map((favorite) => favorite.targetId)).toEqual([myTaskId]);
  });

  it("gets a dashboard of their own work, with no project activity feed", async () => {
    const dashboard = await getDashboardForActor(contractor);
    expect(dashboard.counts.total).toBe(1);
    expect(dashboard.recentActivity).toEqual([]);
    expect(dashboard.myTasks.map((task) => task.title)).toEqual([MINE]);
    expect(dashboard.awaitingMySignoff).toEqual([]);
  });

  it("reads 'Your work': every tile and list counts only their own tasks, never a colleague's", async () => {
    // A colleague's task under the same parent and the parent itself run late; so does the
    // contractor's own task. Only the contractor's own counts on their tiles.
    const past = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    await prisma.mainTask.updateMany({ where: { id: sharedMainTaskId }, data: { deadline: past } });
    await prisma.disciplineTask.update({ where: { id: theirTaskId }, data: { deadline: past } });
    await prisma.disciplineTask.update({ where: { id: myTaskId }, data: { deadline: past } });

    const dashboard = await getDashboardForActor(contractor);
    expect(dashboard.scope).toBe("OWN");
    expect(dashboard.counts.total).toBe(1);
    expect(dashboard.counts.overdue).toBe(1);
    expect(dashboard.lateTasks.map((row) => row.id)).toEqual([myTaskId]);

    const colleague = await getDashboardForActor(fixture.engineerActor);
    expect(colleague.scope).toBe("COMPANY");
    expect(colleague.counts.overdue).toBe(3);

    for (const tile of ["all", "late", "in-progress", "blocked", "completed", "upcoming"] as const) {
      const list = await listTileWork(contractor, tile);
      expect(list.scope).toBe("OWN");
      for (const row of list.items) {
        expect(row.id).toBe(myTaskId);
        expect(row.title).not.toBe(THEIRS);
      }
    }
    expect((await listTileWork(contractor, "all")).total).toBe(dashboard.counts.total);
  });

  it("gets no discipline aggregate at all — a department's standing is not theirs to read", async () => {
    // "Discipline progress" summarises a whole department's work, most of which a contractor may
    // not see. Their variant carries no such bar; a colleague on the same project still gets one.
    const dashboard = await getDashboardForActor(contractor);
    expect(dashboard.disciplineProgress).toEqual([]);

    const colleague = await getDashboardForActor(fixture.engineerActor);
    expect(colleague.disciplineProgress.length).toBeGreaterThan(0);
  });

  it("is left out of a project-wide announcement about work they cannot see", async () => {
    // An override on the INTERNAL main task notifies "the whole project". A contractor is not part
    // of that whole: the message would name work they may not see.
    await overrideMainTaskStatus(fixture.pmActor, {
      id: otherMainTaskId,
      status: "COMPLETED",
      reason: "Agreed at the site meeting.",
    });

    const theirs = await prisma.notification.findMany({ where: { userId: contractor.userId } });
    expect(theirs.some((row) => row.type === "OVERRIDE_APPLIED")).toBe(false);

    // The colleague on the project did hear about it, which is what makes the omission deliberate.
    const engineers = await prisma.notification.findMany({
      where: { userId: fixture.engineerActor.userId, type: "OVERRIDE_APPLIED" },
    });
    expect(engineers.length).toBe(1);
  });

  it("only ever reads their own notifications", async () => {
    const notifications = await listNotifications(contractor);
    for (const notification of notifications) {
      expect(notification.title.length).toBeGreaterThan(0);
    }
    const rows = await prisma.notification.findMany({ where: { userId: contractor.userId } });
    expect(notifications.length).toBe(rows.length);
  });
});

describe("the sign-off: a contractor hands work in, somebody here signs it off", () => {
  it("turns their completion into a request for review, and never completes it", async () => {
    const task = await completeDisciplineTask(contractor, { id: myTaskId });
    expect(task.status).toBe("AWAITING_REVIEW");
    expect(task.completedAt).toBeNull();

    const activity = await listActivity(contractor, { disciplineTaskId: myTaskId });
    expect(activity.some((row) => row.action === "SUBMITTED_FOR_REVIEW")).toBe(true);
  });

  it("does the same when they move the status straight to COMPLETED", async () => {
    const task = await updateDisciplineTaskStatus(contractor, { id: myTaskId, status: "COMPLETED" });
    expect(task.status).toBe("AWAITING_REVIEW");
  });

  it("treats a straight move to AWAITING_REVIEW as a submission, notification and all", async () => {
    // The API path to the same status must not be a quieter one: a contractor moving their own work
    // to "Awaiting review" is handing it in, so it earns the same audit row and the same message to
    // the people who sign it off.
    const task = await updateDisciplineTaskStatus(contractor, {
      id: myTaskId,
      status: "AWAITING_REVIEW",
    });
    expect(task.status).toBe("AWAITING_REVIEW");

    const activity = await listActivity(contractor, { disciplineTaskId: myTaskId });
    expect(activity.some((row) => row.action === "SUBMITTED_FOR_REVIEW")).toBe(true);
    expect(activity.some((row) => row.action === "STATUS_CHANGED")).toBe(false);

    const told = await prisma.notification.findMany({
      where: { userId: fixture.pmActor.userId, linkUrl: `/discipline-tasks/${myTaskId}` },
    });
    expect(told.some((row) => row.title === "Work is waiting for your sign-off")).toBe(true);

    // And it shows up where a submission shows up.
    const queue = await listAwaitingMySignoff(fixture.pmActor);
    expect(queue.map((item) => item.id)).toEqual([myTaskId]);
  });

  it("leaves a colleague's move to AWAITING_REVIEW exactly as it was", async () => {
    const task = await updateDisciplineTaskStatus(fixture.engineerActor, {
      id: theirTaskId,
      status: "AWAITING_REVIEW",
    });
    expect(task.status).toBe("AWAITING_REVIEW");

    const activity = await listActivity(fixture.pmActor, { disciplineTaskId: theirTaskId });
    expect(activity.some((row) => row.action === "STATUS_CHANGED")).toBe(true);
    expect(activity.some((row) => row.action === "SUBMITTED_FOR_REVIEW")).toBe(false);
  });

  it("with the sign-off switched off, a contractor's move to AWAITING_REVIEW is an ordinary one", async () => {
    await setExternalSignoffRequired(fixture.pmActor, {
      projectId: fixture.projectId,
      required: false,
    });

    await updateDisciplineTaskStatus(contractor, { id: myTaskId, status: "AWAITING_REVIEW" });
    const activity = await listActivity(contractor, { disciplineTaskId: myTaskId });
    expect(activity.some((row) => row.action === "STATUS_CHANGED")).toBe(true);
    expect(activity.some((row) => row.action === "SUBMITTED_FOR_REVIEW")).toBe(false);
  });

  it("still runs the real completion gate when the lead confirms it", async () => {
    await completeDisciplineTask(contractor, { id: myTaskId });

    // The mandatory document is still missing, so confirming is refused in plain English —
    // signing off is not a way around the gate.
    await expect(confirmDisciplineTaskReview(fixture.pmActor, { id: myTaskId })).rejects.toBeInstanceOf(
      ServiceError,
    );

    const requirement = await prisma.requiredDocument.findFirstOrThrow({
      where: { disciplineTaskId: myTaskId, name: REQUIRED_DOC },
    });
    await uploadTo(
      contractor,
      { projectId: fixture.projectId, disciplineTaskId: myTaskId, requiredDocumentId: requirement.id },
      "Weld inspection report.pdf",
    );

    const confirmed = await confirmDisciplineTaskReview(fixture.pmActor, { id: myTaskId });
    expect(confirmed.status).toBe("COMPLETED");
    expect(confirmed.completedAt).not.toBeNull();
  });

  it("shows the work in the reviewer's sign-off queue, and never in the contractor's", async () => {
    await completeDisciplineTask(contractor, { id: myTaskId });

    const queue = await listAwaitingMySignoff(fixture.pmActor);
    expect(queue.map((item) => item.id)).toEqual([myTaskId]);
    expect(queue[0]?.assigneeCompanyName).toBe("Al Hassan Engineering");

    expect(await listAwaitingMySignoff(contractor)).toEqual([]);
  });

  it("never lets the contractor sign off their own work", async () => {
    await completeDisciplineTask(contractor, { id: myTaskId });

    await expect(confirmDisciplineTaskReview(contractor, { id: myTaskId })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      rejectDisciplineTaskReview(contractor, { id: myTaskId, note: "Looks fine to me" }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const task = await getDisciplineTaskForActor(contractor, myTaskId);
    expect(task.status).toBe("AWAITING_REVIEW");
  });

  it("sends work back with a note of at least five characters", async () => {
    await completeDisciplineTask(contractor, { id: myTaskId });

    await expect(
      rejectDisciplineTaskReview(fixture.pmActor, { id: myTaskId, note: "no" }),
    ).rejects.toBeInstanceOf(ServiceError);

    const sentBack = await rejectDisciplineTaskReview(fixture.pmActor, {
      id: myTaskId,
      note: "Page 2 of the report is missing.",
    });
    expect(sentBack.status).toBe("IN_PROGRESS");

    const activity = await listActivity(fixture.pmActor, { disciplineTaskId: myTaskId });
    expect(activity.some((row) => row.action === "REVIEW_REJECTED")).toBe(true);
  });

  it("refuses a sign-off on work that was never submitted", async () => {
    await expect(confirmDisciplineTaskReview(fixture.pmActor, { id: theirTaskId })).rejects.toBeInstanceOf(
      ServiceError,
    );
  });

  it("with the setting switched off, a contractor completes exactly as an engineer does", async () => {
    await setExternalSignoffRequired(fixture.pmActor, {
      projectId: fixture.projectId,
      required: false,
    });

    const requirement = await prisma.requiredDocument.findFirstOrThrow({
      where: { disciplineTaskId: myTaskId, name: REQUIRED_DOC },
    });
    await uploadTo(
      contractor,
      { projectId: fixture.projectId, disciplineTaskId: myTaskId, requiredDocumentId: requirement.id },
      "Weld inspection report.pdf",
    );

    const task = await completeDisciplineTask(contractor, { id: myTaskId });
    expect(task.status).toBe("COMPLETED");
  });

  it("with the setting switched off, the completion gate is still the gate", async () => {
    await setExternalSignoffRequired(fixture.pmActor, {
      projectId: fixture.projectId,
      required: false,
    });

    // The mandatory document has not been uploaded, so this is refused exactly as it would be for
    // a colleague — switching the sign-off off never switches the golden rule off.
    await expect(completeDisciplineTask(contractor, { id: myTaskId })).rejects.toBeInstanceOf(
      ServiceError,
    );
  });
});

describe("a contractor's seat cannot be widened by a project role", () => {
  it("refuses to add them to a project as an engineer", async () => {
    await expect(
      upsertMember(fixture.adminActor, {
        projectId: otherProjectId,
        userId: contractor.userId,
        projectRole: "ENGINEER",
      }),
    ).rejects.toBeInstanceOf(ServiceError);
  });

  it("adds them the ordinary way, as a contractor in their own discipline", async () => {
    // The normal path the Team tab walks: pick the person, the form locks the role to External
    // contractor and the discipline to the one on their account, and the service accepts it. This
    // is the pairing the screen must offer — anything else is refused, which is the test above.
    const member = await upsertMember(fixture.adminActor, {
      projectId: otherProjectId,
      userId: contractor.userId,
      projectRole: "EXTERNAL",
      disciplineId: fixture.disciplineId,
    });

    expect(member.projectRole).toBe("EXTERNAL");
    expect(member.disciplineId).toBe(fixture.disciplineId);
    expect(member.userId).toBe(contractor.userId);

    // And the row is there for the discipline-task assignee list to find, under that discipline.
    const project = await getProjectForActor(fixture.adminActor, otherProjectId);
    const inDiscipline = project.members.filter(
      (row) => row.disciplineId === fixture.disciplineId,
    );
    expect(inDiscipline.some((row) => row.userId === contractor.userId)).toBe(true);
  });

  it("refuses to give a colleague the contractor's seat", async () => {
    await expect(
      upsertMember(fixture.adminActor, {
        projectId: fixture.projectId,
        userId: fixture.engineerActor.userId,
        projectRole: "EXTERNAL",
      }),
    ).rejects.toBeInstanceOf(ServiceError);
  });

  it("ignores a project-manager row already in the database", async () => {
    // Written straight into the database, behind the service's back: the permission rules must not
    // trust it. A contractor is a contractor whatever a ProjectMember row says.
    await prisma.projectMember.updateMany({
      where: { projectId: fixture.projectId, userId: contractor.userId },
      data: { projectRole: "PROJECT_MANAGER" },
    });

    const escalated = await actorForUser(contractor.userId);
    await expect(getDisciplineTaskForActor(escalated, theirTaskId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      createDisciplineTask(escalated, {
        mainTaskId: sharedMainTaskId,
        disciplineId: fixture.disciplineId,
        title: "Escalated task",
        deadline: inThirtyDays(),
        priority: "MEDIUM",
        isMandatory: true,
        requiredDocuments: [],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("a contractor has no noticeboard at all", () => {
  it("answers every board read and write with not found, never forbidden", async () => {
    const announcement = await createPost(fixture.adminActor, {
      kind: "ANNOUNCEMENT",
      title: "Company briefing",
      body: "Everybody here should read this.",
    });
    const projectPost = await createPost(fixture.pmActor, {
      kind: "BOARD",
      projectId: fixture.projectId,
      body: "A conversation on the project the contractor works on.",
    });

    // Reads: the tabs, the announcements, the company board and the board of the project they
    // actually hold work on. All four are misses, so no id is ever confirmed as real.
    await expect(listAudiences(contractor)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listAnnouncementsForUser(contractor)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      listBoard(contractor, { kind: "EVERYONE", projectId: null, disciplineId: null }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      listBoard(contractor, { kind: "PROJECT", projectId: fixture.projectId, disciplineId: null }),
    ).rejects.toBeInstanceOf(NotFoundError);

    // Writes: posting, replying, dismissing and editing are all the same answer.
    await expect(
      createPost(contractor, { kind: "BOARD", projectId: fixture.projectId, body: "Hello?" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      replyToPost(contractor, { parentId: projectPost.id, body: "Hello?" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      dismissAnnouncement(contractor, { id: announcement.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      acknowledgePost(contractor, { id: announcement.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      editPost(contractor, { id: projectPost.id, body: "Not mine." }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(deletePost(contractor, { id: projectPost.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("is left out of every announcement fan-out, company-wide and project", async () => {
    await createPost(fixture.adminActor, { kind: "ANNOUNCEMENT", body: "Company-wide news." });
    await createPost(fixture.pmActor, {
      kind: "ANNOUNCEMENT",
      projectId: fixture.projectId,
      body: "News about the very project they work on.",
    });

    // A notification body names news a contractor may not read, and a notification is the one door
    // read scoping cannot close — so the fan-out leaves them out, exactly as a task override does.
    // Their own notifications — assigned, status changed, sent back for more work — are untouched;
    // it is company news specifically that never reaches them.
    const mine = await prisma.notification.findMany({
      where: { userId: contractor.userId, type: "ANNOUNCEMENT" },
    });
    expect(mine).toEqual([]);
    expect((await listNotifications(contractor)).some((row) => row.type === "ANNOUNCEMENT")).toBe(
      false,
    );

    const told = await prisma.notification.findMany({
      where: { type: "ANNOUNCEMENT" },
      select: { userId: true },
    });
    expect(told.some((row) => row.userId === fixture.engineerActor.userId)).toBe(true);
  });

  it("keeps their own daily brief working, with an empty announcements section", async () => {
    await createPost(fixture.adminActor, { kind: "ANNOUNCEMENT", body: "Company-wide news." });

    const brief = await personBrief(contractor);
    expect(brief.announcements).toEqual({ items: [], total: 0 });
  });

  it("is never asked to acknowledge anything, and is never counted in a total", async () => {
    const asking = await createPost(fixture.adminActor, {
      kind: "ANNOUNCEMENT",
      body: "Everybody here, please confirm.",
      requiresAck: true,
    });

    // No announcements surface, so no Acknowledge button and no acknowledgement: a miss, as always.
    await expect(acknowledgePost(contractor, { id: asking.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    // And the section that would nag them about it never appears on their brief.
    const brief = await personBrief(contractor);
    expect(brief.awaitingAcknowledgement).toEqual({ items: [], total: 0 });

    // The author's total counts the company's own people only — a contractor who can never confirm
    // would otherwise make it a number nobody could ever finish.
    const internals = await prisma.user.count({
      where: { orgId: fixture.orgId, isActive: true, role: { not: "EXTERNAL" } },
    });
    const forAuthor = (await listAnnouncementsForUser(fixture.adminActor)).find(
      (post) => post.id === asking.id,
    );
    expect(forAuthor?.ackProgress?.audienceCount).toBe(internals);
  });
});

describe("the one door onto the noticeboard: an announcement that included them", () => {
  it("puts an included company-wide notice on their brief, read-only, and nothing else", async () => {
    await createPost(fixture.adminActor, {
      kind: "ANNOUNCEMENT",
      title: "Site access closures this weekend",
      body: "Gate 3 will be shut Sat–Sun for repaving.",
      includeExternals: true,
    });
    await createPost(fixture.adminActor, {
      kind: "ANNOUNCEMENT",
      title: "Ordinary notice",
      body: "Not for contractors.",
    });

    const brief = await personBrief(contractor);
    expect(brief.announcements.total).toBe(1);
    const notice = brief.announcements.items[0];
    expect(notice?.title).toBe("Site access closures this weekend");
    expect(notice?.body).toBe("Gate 3 will be shut Sat–Sun for repaving.");
    expect(notice?.note).toBe(`Posted by ${fixture.adminActor.name}`);
    // Nowhere to click: /messages is a page they may not open, so the line carries the whole notice.
    expect(notice?.linkUrl).toBe("");

    // Nothing else about the noticeboard has opened up. It is one read and no more.
    await expect(listAudiences(contractor)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listAnnouncementsForUser(contractor)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      listBoard(contractor, { kind: "EVERYONE", projectId: null, disciplineId: null }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      listBoard(contractor, { kind: "PROJECT", projectId: fixture.projectId, disciplineId: null }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("only reaches them on a project they hold live work on", async () => {
    // The project they work on: included, so it reaches them.
    await createPost(fixture.pmActor, {
      kind: "ANNOUNCEMENT",
      projectId: fixture.projectId,
      title: "Scaffold coming down",
      body: "Thursday morning.",
      includeExternals: true,
    });
    // A project they hold nothing on: included, and it still does not.
    await createPost(fixture.adminActor, {
      kind: "ANNOUNCEMENT",
      projectId: otherProjectId,
      title: "Somewhere else entirely",
      body: "Never their business.",
      includeExternals: true,
    });

    const brief = await personBrief(contractor);
    expect(brief.announcements.items.map((item) => item.title)).toEqual(["Scaffold coming down"]);

    const told = await prisma.notification.findMany({
      where: { userId: contractor.userId, type: "ANNOUNCEMENT" },
    });
    expect(told).toHaveLength(1);
    // The link never sends them anywhere they may not go.
    expect(told[0]?.linkUrl).toBe("/my-tasks/brief");
  });

  it("still asks them for nothing, even when the notice also required acknowledgement", async () => {
    const asking = await createPost(fixture.adminActor, {
      kind: "ANNOUNCEMENT",
      title: "Please confirm",
      body: "Everybody here, please confirm.",
      requiresAck: true,
      includeExternals: true,
    });

    const brief = await personBrief(contractor);
    expect(brief.announcements.items.map((item) => item.title)).toEqual(["Please confirm"]);
    // Included means they read it. It never means they are asked to sign for it.
    expect(brief.awaitingAcknowledgement).toEqual({ items: [], total: 0 });
    await expect(acknowledgePost(contractor, { id: asking.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(await prisma.postAck.count()).toBe(0);

    const internals = await prisma.user.count({
      where: { orgId: fixture.orgId, isActive: true, role: { not: "EXTERNAL" } },
    });
    const forAuthor = (await listAnnouncementsForUser(fixture.adminActor)).find(
      (post) => post.id === asking.id,
    );
    expect(forAuthor?.ackProgress?.audienceCount).toBe(internals);
  });

  it("hides an included notice again the moment their work on that project ends", async () => {
    await createPost(fixture.pmActor, {
      kind: "ANNOUNCEMENT",
      projectId: fixture.projectId,
      title: "Scaffold coming down",
      body: "Thursday morning.",
      includeExternals: true,
    });
    expect((await personBrief(contractor)).announcements.total).toBe(1);

    // Their only live work here goes away — the same narrowing that takes the project itself away.
    await prisma.disciplineTask.update({
      where: { id: myTaskId },
      data: { deletedAt: new Date() },
    });
    expect((await personBrief(contractor)).announcements.total).toBe(0);
  });
});

describe("their access can be given an end date", () => {
  it("shows the date on the admin screen and nowhere a picker can reach", async () => {
    await updateUser(fixture.adminActor, {
      id: contractor.userId,
      accessExpiresAt: new Date(Date.UTC(2030, 8, 30)),
    });

    const onAdminScreen = (await listAllUsers(fixture.adminActor)).find(
      (person) => person.id === contractor.userId,
    );
    expect(onAdminScreen?.accessExpiresAt?.toISOString().slice(0, 10)).toBe("2030-09-30");

    // The people picker is the same DTO with less on it: sign-in history and the access end date
    // are admin-screen facts, and the picker must not carry either.
    for (const person of await listUsers(fixture.adminActor)) {
      expect(person.accessExpiresAt).toBeUndefined();
      expect(person.lastLoginAt).toBeUndefined();
    }
  });

  it("is not the same as deactivating them: the account and their work stay exactly as they were", async () => {
    // A date that has passed locks the door (proved in access-expiry.service.test.ts) and changes
    // nothing else — the row stays active, and the work they did is still there for the team.
    await updateUser(fixture.adminActor, {
      id: contractor.userId,
      accessExpiresAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    });

    const row = await prisma.user.findUniqueOrThrow({ where: { id: contractor.userId } });
    expect(row.isActive).toBe(true);

    const theirWork = await getDisciplineTaskForActor(fixture.adminActor, myTaskId);
    expect(theirWork.assigneeId).toBe(contractor.userId);
  });

  it("is cleared the moment they stop being a contractor", async () => {
    await updateUser(fixture.adminActor, {
      id: contractor.userId,
      accessExpiresAt: new Date(Date.UTC(2030, 8, 30)),
    });

    const promoted = await updateUser(fixture.adminActor, {
      id: contractor.userId,
      role: "ENGINEER",
      disciplineId: fixture.disciplineId,
      companyName: null,
    });
    expect(promoted.accessExpiresAt).toBeNull();
  });
});

describe("a contractor is emailed only their own notification rows", () => {
  let contractorEmail: string;

  beforeEach(async () => {
    configureEmail();
    contractorEmail = await optIn(contractor.userId, { alerts: true });
  });

  afterEach(() => {
    goDormant();
    vi.restoreAllMocks();
  });

  /** Waits until a colleague who SHOULD be emailed has been, so a missing email is a real "no". */
  async function afterCanary(spy: ReturnType<typeof mockEmailFetchOk>, canaryEmail: string) {
    await vi.waitFor(() =>
      expect(sentEmails(spy).some((email) => email.to.includes(canaryEmail))).toBe(true),
    );
    await settle();
    return sentEmails(spy);
  }

  it("sends exactly their own row — the same title, sentence and link — and nothing else", async () => {
    const spy = mockEmailFetchOk();

    await createDisciplineTask(fixture.adminActor, {
      mainTaskId: sharedMainTaskId,
      disciplineId: fixture.disciplineId,
      title: "Contractor flange torque check",
      assigneeId: contractor.userId,
      deadline: inThirtyDays(),
      priority: "MEDIUM",
      isMandatory: true,
      requiredDocuments: [],
    });

    await vi.waitFor(() => expect(sentEmails(spy)).toHaveLength(1));
    await settle();

    const rows = await prisma.notification.findMany({
      where: { userId: contractor.userId, type: "ASSIGNED", actorId: fixture.adminActor.userId },
      orderBy: { createdAt: "desc" },
    });
    const row = rows[0]!;
    const sent = sentEmails(spy);
    expect(sent).toHaveLength(1);
    const [email] = sent;
    expect(email!.to).toEqual([contractorEmail]);
    expect(email!.subject).toBe(row.title);
    expect(email!.text).toContain(row.body);
    expect(email!.text).toContain(`${EMAIL_BASE}${row.linkUrl}`);
    // Nothing wider than the row: no colleague's work, no colleague's name, no parent roster.
    for (const outside of [THEIRS, "Pipe rack survey", fixture.engineerActor.name, fixture.pmActor.name]) {
      expect(email!.text).not.toContain(outside);
    }
  });

  it("sends nothing for a project-wide override on work they cannot see", async () => {
    const spy = mockEmailFetchOk();
    const colleagueEmail = await optIn(fixture.engineerActor.userId, { alerts: true });

    await overrideMainTaskStatus(fixture.pmActor, {
      id: otherMainTaskId,
      status: "COMPLETED",
      reason: "Agreed at the site meeting.",
    });

    const sent = await afterCanary(spy, colleagueEmail);
    expect(sent.some((email) => email.to.includes(contractorEmail))).toBe(false);
  });

  it("sends nothing for a mention on a colleague's task", async () => {
    const spy = mockEmailFetchOk();
    const colleagueEmail = await optIn(fixture.engineerActor.userId, { alerts: true });

    await createComment(fixture.pmActor, {
      disciplineTaskId: theirTaskId,
      body: "Both of you, a look at this please.",
      mentions: [contractor.userId, fixture.engineerActor.userId],
    });

    const sent = await afterCanary(spy, colleagueEmail);
    expect(sent.some((email) => email.to.includes(contractorEmail))).toBe(false);
  });

  it("sends nothing for an announcement that did not include contractors", async () => {
    const spy = mockEmailFetchOk();
    const colleagueEmail = await optIn(fixture.engineerActor.userId, { alerts: true });

    await createPost(fixture.adminActor, {
      kind: "ANNOUNCEMENT",
      title: "Internal all-hands on Thursday",
      body: "Staff only.",
    });

    const sent = await afterCanary(spy, colleagueEmail);
    expect(sent.some((email) => email.to.includes(contractorEmail))).toBe(false);
  });

  it("sends nothing for the contractor half of an announcement that did include them", async () => {
    const spy = mockEmailFetchOk();
    const colleagueEmail = await optIn(fixture.engineerActor.userId, { alerts: true });

    await createPost(fixture.adminActor, {
      kind: "ANNOUNCEMENT",
      title: "Site access closures this weekend",
      body: "Gate 3 will be shut Sat–Sun for repaving.",
      includeExternals: true,
    });

    const sent = await afterCanary(spy, colleagueEmail);
    // They have the in-app row (it lands on their brief page) and no email copy of it.
    expect(
      await prisma.notification.count({ where: { userId: contractor.userId, type: "ANNOUNCEMENT" } }),
    ).toBe(1);
    expect(sent.some((email) => email.to.includes(contractorEmail))).toBe(false);
  });

  it("never sends them a daily brief, even with both briefs forced on in the database", async () => {
    await prisma.user.update({
      where: { id: contractor.userId },
      data: { emailDailyBrief: true, emailWeeklyBrief: true },
    });
    // Their day is not empty — only the role rule stands between them and an email.
    await prisma.disciplineTask.update({
      where: { id: myTaskId },
      data: { deadline: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) },
    });
    expect((await personBrief(contractor)).overdue.total).toBe(1);
    const spy = mockEmailFetchOk();

    const now = new Date();
    const morning = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 6));
    expect(await sendDailyBriefEmails(morning)).toEqual({ people: 0, sent: 0 });
    expect(sentEmails(spy)).toHaveLength(0);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: contractor.userId } })).dailyBriefEmailedAt,
    ).toBeNull();
  });

  it("never sends them a weekly brief, even with the weekly email forced on in the database", async () => {
    // A confirmed address and the switch on: only the role rule stands between them and an email.
    await prisma.user.update({
      where: { id: contractor.userId },
      data: { emailDailyBrief: true, emailWeeklyBrief: true, emailVerifiedAt: new Date() },
    });
    const spy = mockEmailFetchOk();

    // A Monday morning after the 05:00 line, inside the catch-up window.
    const now = new Date();
    const sinceMonday = (now.getUTCDay() + 6) % 7;
    const monday = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - sinceMonday, 6),
    );
    expect(await sendWeeklyBriefEmails(monday)).toEqual({ people: 0, sent: 0 });
    expect(sentEmails(spy)).toHaveLength(0);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: contractor.userId } })).weeklyBriefEmailedAt,
    ).toBeNull();
  });
});

describe("a contractor at Sign in with Microsoft", () => {
  const key = makeKey("kid-external");
  const FAILED_LOCATION = `${TEST_BASE_URL}/login?microsoft=failed`;
  let fake: FakeMicrosoft;
  let restoreEnv: () => void = () => undefined;
  let tid: string;
  let ipCounter = 0;

  function get(url: string, ip: string): Request {
    return new Request(`http://localhost${url}`, {
      headers: { "x-forwarded-for": ip, "user-agent": "vitest" },
    });
  }

  /** Press the button, "sign in at Microsoft" as this contractor, come back. */
  async function roundTrip(oid: string): Promise<Response> {
    ipCounter += 1;
    const ip = `198.18.0.${ipCounter}`;
    const started = await microsoftStartRoute(get("/api/auth/microsoft", ip));
    expect(started.status).toBe(302);
    const authorize = new URL(started.headers.get("location") ?? "");
    const state = authorize.searchParams.get("state") ?? "";
    const nonce = authorize.searchParams.get("nonce") ?? "";
    fake.idTokenFor = () =>
      signToken(claimsFor({ tid, oid, email: contractor.email, edov: true, nonce }), key);
    return microsoftCallbackRoute(
      get(`/api/auth/microsoft/callback?code=the-code&state=${encodeURIComponent(state)}`, ip),
    );
  }

  beforeEach(async () => {
    jar.clear();
    restoreEnv = configureMicrosoftEnv();
    signingKeys.clear();
    fake = installFakeMicrosoft([key.jwk]);
    tid = newTenant();
    await prisma.organization.update({ where: { id: fixture.orgId }, data: { entraTenantId: tid } });
  });

  afterEach(() => {
    restoreEnv();
    vi.restoreAllMocks();
    jar.clear();
  });

  it("refuses a contractor whose access has ended, with the same redirect as everybody else", async () => {
    await prisma.user.update({
      where: { id: contractor.userId },
      data: { accessExpiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });

    const response = await roundTrip(newOid());

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(FAILED_LOCATION);
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    expect(await prisma.session.count({ where: { userId: contractor.userId } })).toBe(0);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: contractor.userId } })).microsoftOid,
    ).toBeNull();
  });

  it("refuses a contractor whose account was deactivated, with the same redirect", async () => {
    // Already linked, so the refusal is not merely a failed first match.
    const oid = newOid();
    await prisma.user.update({
      where: { id: contractor.userId },
      data: { isActive: false, microsoftOid: oid, microsoftTenantId: tid },
    });

    const response = await roundTrip(oid);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(FAILED_LOCATION);
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    expect(await prisma.session.count({ where: { userId: contractor.userId } })).toBe(0);
  });

  it("lets a live contractor from the company's own Microsoft tenant in — as EXTERNAL, on My tasks", async () => {
    const response = await roundTrip(newOid());

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`${TEST_BASE_URL}${homePathFor("EXTERNAL")}`);
    expect(homePathFor("EXTERNAL")).toBe("/my-tasks");
    expect(jar.has(SESSION_COOKIE)).toBe(true);

    const signedIn = await getSessionUser();
    expect(signedIn?.id).toBe(contractor.userId);
    expect(signedIn?.role).toBe("EXTERNAL");
  });
});

// The Teams tab is the contractor's own "Your day" in another frame: built from the very same
// `personBrief(actor)`, so it can only ever hold what that page holds — their assigned work and the
// opt-in notices, never a colleague's task, the roster or a project they hold no work on.

describe("a contractor in the Teams tab", () => {
  const key = makeKey("kid-external-teams");
  let restoreEnv: () => void = () => undefined;
  let tid: string;
  let oid: string;

  const token = () => signToken(teamsClaimsFor({ tid, oid }), key);

  type Page = { type: unknown; props: { brief: Record<string, unknown>; contractor?: boolean } };
  async function tab(): Promise<Page> {
    return (await TeamsTabPage({ searchParams: Promise.resolve({}) })) as unknown as Page;
  }

  /** Signs the contractor in to the tab, and keeps the tab's cookie the way a browser would. */
  async function signInToTab() {
    const outcome = await signInWithTeamsToken(token(), {});
    if (outcome.kind !== "signed-in") throw new Error(`expected a sign-in, got ${outcome.kind}`);
    jar.set(TEAMS_COOKIE, { value: outcome.sessionToken });
  }

  const plain = (value: unknown) => JSON.parse(JSON.stringify(value)) as Record<string, unknown>;

  beforeEach(async () => {
    jar.clear();
    restoreEnv = configureTeamsEnv();
    signingKeys.clear();
    installFakeMicrosoft([key.jwk]);
    tid = newTenant();
    oid = newOid();
    await prisma.organization.update({ where: { id: fixture.orgId }, data: { entraTenantId: tid } });
    await prisma.user.update({
      where: { id: contractor.userId },
      data: { microsoftOid: oid, microsoftTenantId: tid },
    });
  });

  afterEach(() => {
    restoreEnv();
    vi.restoreAllMocks();
    jar.clear();
  });

  it("receives exactly the brief a contractor gets in the browser — their own work, nobody else's", async () => {
    await prisma.disciplineTask.updateMany({
      where: { id: { in: [myTaskId, theirTaskId] } },
      data: { deadline: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) },
    });
    await signInToTab();

    const page = await tab();
    const browser = await personBrief(contractor);

    expect(page.type).toBe(TeamsBrief);
    expect(page.props.contractor).toBe(true);
    for (const section of ["dueToday", "overdue", "newlyUnblocked", "mentions", "awaitingReview", "announcements", "awaitingAcknowledgement"]) {
      expect(plain(page.props.brief)[section], section).toEqual(plain(browser)[section]);
    }

    const text = JSON.stringify(page.props.brief);
    expect(text).toContain(MINE);
    // Not another person's task, not the team roster, not a project they hold no work on.
    expect(text).not.toContain(THEIRS);
    expect(text).not.toContain("Pipe rack survey");
    expect(text).not.toContain("Survey walkdown");
    expect(text).not.toContain("Second project");
    expect(text).not.toContain(theirTaskId);
    for (const colleague of [fixture.adminActor, fixture.engineerActor, fixture.pmActor]) {
      expect(text).not.toContain(colleague.name);
      expect(text).not.toContain(colleague.email);
    }
  });

  it("sees an opt-in notice as plain text with an empty link, and no acknowledgement request", async () => {
    await createPost(fixture.adminActor, {
      kind: "ANNOUNCEMENT",
      title: "Gate 4 closed Friday",
      body: "Use gate 2 instead.",
      requiresAck: true,
      includeExternals: true,
    });
    await createPost(fixture.adminActor, {
      kind: "ANNOUNCEMENT",
      title: "Internal only",
      body: "Not for contractors.",
    });
    await signInToTab();

    const page = await tab();
    const brief = page.props.brief as {
      announcements: { items: { title: string; body: string | null; linkUrl: string }[] };
      awaitingAcknowledgement: { total: number };
    };

    expect(brief.announcements.items).toHaveLength(1);
    expect(brief.announcements.items[0]).toMatchObject({
      title: "Gate 4 closed Friday",
      body: "Use gate 2 instead.",
      linkUrl: "",
    });
    expect(brief.awaitingAcknowledgement.total).toBe(0);
    expect(JSON.stringify(page.props.brief)).not.toContain("Internal only");
  });

  it("is refused at token exchange once their access has ended, or their account is deactivated", async () => {
    await prisma.user.update({
      where: { id: contractor.userId },
      data: { accessExpiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });
    expect((await signInWithTeamsToken(token(), {})).kind).toBe("refused");

    await prisma.user.update({
      where: { id: contractor.userId },
      data: { accessExpiresAt: null, isActive: false },
    });
    expect((await signInWithTeamsToken(token(), {})).kind).toBe("refused");
    expect(await prisma.session.count({ where: { userId: contractor.userId } })).toBe(0);
  });

  it("is sent back to the sign-in state at the tab read when access ends while the tab is open", async () => {
    await signInToTab();
    expect((await tab()).type).toBe(TeamsBrief);

    await prisma.user.update({
      where: { id: contractor.userId },
      data: { accessExpiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });

    expect((await tab()).type).toBe(TeamsSignIn);
    expect(await prisma.session.count({ where: { userId: contractor.userId } })).toBe(0);
  });

  it("cannot be signed in from their employer's own Microsoft tenant", async () => {
    // A contractor's own company has a different tenant; it owns no Tielora workspace.
    const employerTenant = newTenant();
    const outcome = await signInWithTeamsToken(signToken(teamsClaimsFor({ tid: employerTenant, oid }), key), {});
    expect(outcome.kind).toBe("refused");
    expect(await prisma.session.count()).toBe(0);
  });
});

// Ask Tielora does not exist for a contractor: not found, before the key, the switch, the rate
// limit or any load, so they learn nothing about whether AI is even configured. And when an INTERNAL
// person asks about a project where a contractor works, the contractor is not in the prompt as a
// person: v1 sends no names and no emails at all. The provider is mocked; nothing reaches Anthropic.
describe("a contractor and Ask Tielora", () => {
  let fetchMock: ReturnType<typeof installFakeAnthropic>;

  beforeEach(async () => {
    jar.clear();
    fetchMock = installFakeAnthropic();
    await switchAiOn(fixture.orgId);
  });

  afterEach(() => {
    jar.clear();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function signInAsContractor(): Promise<void> {
    const minted = mintSession();
    await prisma.session.create({
      data: { tokenHash: minted.tokenHash, userId: contractor.userId, expiresAt: minted.expiresAt },
    });
    jar.set(SESSION_COOKIE, { value: minted.rawToken });
  }

  const post = (body: unknown) =>
    askRoute(new Request("http://localhost/api/ai/ask", { method: "POST", body: JSON.stringify(body) }));

  it("is refused by the permission table, whatever the contractor holds", () => {
    expect(can(contractor, "ASK_ASSISTANT")).toBe(false);
    expect(
      can(contractor, "ASK_ASSISTANT", {
        projectId: fixture.projectId,
        orgId: fixture.orgId,
        assigneeId: contractor.userId,
      }),
    ).toBe(false);
  });

  it("answers the route 'not found' — with the key set, with it unset, with the switch off — and calls nothing", async () => {
    await signInAsContractor();

    for (const state of ["configured", "switched-off", "dormant"]) {
      if (state === "switched-off") await switchAiOn(fixture.orgId, { assistant: false, briefs: false });
      if (state === "dormant") goDormantAi();
      const response = await post({ question: "What is late?", projectId: fixture.projectId });
      expect(response.status).toBe(404);
      expect((await response.json()).error).toBe("We could not find that.");
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await prisma.aiUsage.count()).toBe(0);
    expect(await prisma.activityLog.count({ where: { action: "AI_QUESTION_ASKED" } })).toBe(0);
  });

  it("answers the service 'not found' as well, so no other door lets a contractor through", async () => {
    await expect(askTielora(contractor, { question: "What is late?" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      askTielora(contractor, { question: "What is late?", projectId: fixture.projectId }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives them no AI settings and no way to change them", async () => {
    await expect(aiSettingsFor(contractor)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setAiSettings(contractor, { aiAssistant: false })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("puts no contractor name, email or company in an internal person's prompt, and no AI text in the contractor's own brief", async () => {
    const contractorRow = await prisma.user.findUniqueOrThrow({ where: { id: contractor.userId } });

    // The engineer asks about the project the contractor works on, and across all their projects.
    await askTielora(fixture.engineerActor, { question: "What is late?", projectId: fixture.projectId });
    await askTielora(fixture.engineerActor, { question: "What is late?" });
    await askTielora(fixture.adminActor, { question: "What is late?" });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (let call = 0; call < 3; call++) {
      const sent = sentText(fetchMock, call);
      expect(sent).not.toContain("Yusuf Contractor");
      expect(sent).not.toContain(contractorRow.email);
      expect(sent).not.toContain("Al Hassan Engineering");
      expect(sent).not.toContain(contractor.userId);
    }

    // Their own "Your day" is per person and carries no AI text at all.
    const brief = JSON.stringify(await personBrief(contractor));
    expect(brief).not.toMatch(/written by AI/i);
    expect(brief).not.toMatch(/Ask Tielora/i);
  });
});

// THE EXTERNAL RULE on screen: the panel is never DRAWN for a contractor. The server decides when
// the page is built (isExternal), so the flag handed to the project page, and the project list handed
// to the dashboard, are the whole story: there is nothing for CSS to hide. These call the real pages
// with a real session cookie, then read what each page hands its screen.
describe("a contractor's pages carry no Ask Tielora panel", () => {
  beforeEach(async () => {
    jar.clear();
    installFakeAnthropic();
    await switchAiOn(fixture.orgId);
  });

  afterEach(() => {
    jar.clear();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function signInAs(userId: string): Promise<void> {
    const minted = mintSession();
    await prisma.session.create({ data: { tokenHash: minted.tokenHash, userId, expiresAt: minted.expiresAt } });
    jar.set(SESSION_COOKIE, { value: minted.rawToken });
  }

  async function projectPageFlag(): Promise<boolean> {
    const element = (await ProjectPage({ params: Promise.resolve({ id: fixture.projectId }) })) as unknown as {
      props: { askTielora: boolean };
    };
    return element.props.askTielora;
  }

  it("builds the project page without the panel for a contractor, with the key set and the switch on", async () => {
    await signInAs(contractor.userId);
    expect(await projectPageFlag()).toBe(false);
    expect(await askTieloraAvailable(contractor)).toBe(false);
  });

  it("builds the project page with the panel for an internal person on the same project", async () => {
    await signInAs(fixture.engineerActor.userId);
    expect(await projectPageFlag()).toBe(true);
  });

  it("never gives a contractor a dashboard that draws the card: they are redirected, and the card's list is null", async () => {
    await signInAs(contractor.userId);
    await expect(DashboardPage()).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
    expect(await askTieloraProjects(contractor)).toBeNull();
  });

  it("hands an internal person's dashboard only the projects they are on", async () => {
    await signInAs(fixture.engineerActor.userId);
    const element = (await DashboardPage()) as unknown as {
      props: { children: { props: { askProjects?: { id: string }[] | null } }[] };
    };
    const view = element.props.children.find((child) => child?.props && "askProjects" in child.props);
    // The engineer is a member of exactly these two projects of the company, and no others.
    expect(view?.props.askProjects?.map((project) => project.id).sort()).toEqual(
      [fixture.projectId, otherProjectId].sort(),
    );
  });

  it("draws nothing for anybody while the company switch is off or the key is unset", async () => {
    await signInAs(fixture.engineerActor.userId);
    await switchAiOn(fixture.orgId, { assistant: false, briefs: false });
    expect(await projectPageFlag()).toBe(false);
    expect(await askTieloraProjects(fixture.engineerActor)).toBeNull();

    await switchAiOn(fixture.orgId);
    goDormantAi();
    expect(await projectPageFlag()).toBe(false);
    expect(await askTieloraProjects(fixture.adminActor)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Contractors are free: they are never counted as office staff        */
/* ------------------------------------------------------------------ */

describe("a contractor and the plan's people ceilings", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  async function onFree() {
    const { setPlan } = await import("@/server/__tests__/harness");
    await setPlan(fixture.orgId, "FREE");
  }

  async function bulk(count: number, role: "ENGINEER" | "EXTERNAL", extra: { accessExpiresAt?: Date; isActive?: boolean } = {}) {
    const { bulkUsers } = await import("@/server/__tests__/harness");
    return bulkUsers(fixture.orgId, count, role, { ...extra, disciplineId: role === "ENGINEER" ? fixture.disciplineId : null });
  }

  async function addContractor() {
    const { createUser } = await import("@/server/services/admin");
    return createUser(fixture.adminActor, {
      email: `ext.${Date.now()}.${Math.random()}@test.example`,
      name: "Another Contractor",
      password: "A-strong-test-password-1",
      role: "EXTERNAL",
      companyName: "Al Hassan Engineering",
    });
  }

  async function addStaff() {
    const { createUser } = await import("@/server/services/admin");
    return createUser(fixture.adminActor, {
      email: `staff.${Date.now()}.${Math.random()}@test.example`,
      name: "Another Engineer",
      password: "A-strong-test-password-1",
      role: "ENGINEER",
      disciplineId: fixture.disciplineId,
    });
  }

  it("a contractor is not counted as office staff: contractors up to the ceiling still leave room for staff, and the reverse", async () => {
    await onFree();
    const { billingStatus } = await import("@/server/services/billing");

    // The company has 4 staff and the one contractor from the fixture. Fill contractors to 10.
    await bulk(9, "EXTERNAL");
    let usage = (await billingStatus(fixture.adminActor)).usage;
    expect(usage.contractors).toBe(10);
    expect(usage.users).toBe(4);

    // Contractors are full; one more is refused, but staff are still welcome.
    await expect(addContractor()).rejects.toThrow(/Your plan has room for 10 contractors\./);
    expect((await addStaff()).role).toBe("ENGINEER");

    // Fill staff to 10; the 11th staff is refused while contractors are untouched.
    await bulk(5, "ENGINEER");
    usage = (await billingStatus(fixture.adminActor)).usage;
    expect(usage.users).toBe(10);
    expect(usage.contractors).toBe(10);
    await expect(addStaff()).rejects.toThrow(/Your plan has room for 10 office staff\./);
  });

  it("a contractor whose access has ended is not counted, and re-extending is what is refused when the group is full", async () => {
    await onFree();
    const { billingStatus } = await import("@/server/services/billing");

    await bulk(9, "EXTERNAL"); // 10 active contractors with the fixture's one
    const [ended] = await bulk(1, "EXTERNAL", { accessExpiresAt: new Date(Date.now() - 5 * DAY_MS) });
    expect((await billingStatus(fixture.adminActor)).usage.contractors).toBe(10);

    await expect(
      updateUser(fixture.adminActor, { id: ended, accessExpiresAt: new Date(Date.now() + 30 * DAY_MS) }),
    ).rejects.toThrow(/Your plan has room for 10 contractors\./);

    // Make room, and the same extension works: the ended contractor never held a place.
    await updateUser(fixture.adminActor, { id: contractor.userId, isActive: false });
    const back = await updateUser(fixture.adminActor, {
      id: ended,
      accessExpiresAt: new Date(Date.now() + 30 * DAY_MS),
    });
    expect(back.isActive).toBe(true);
  });

  it("billingStatus refuses a contractor — they hold no billing permission and never see a meter", async () => {
    const { billingStatus } = await import("@/server/services/billing");
    await expect(billingStatus(contractor)).rejects.toBeInstanceOf(ForbiddenError);
    expect(can(contractor, "MANAGE_BILLING")).toBe(false);
    expect(can(contractor, "MANAGE_USERS")).toBe(false);
  });

  it("a company over its contractor ceiling locks no contractor out: their own reads carry on, and nothing about counts reaches them", async () => {
    await onFree();
    await bulk(14, "EXTERNAL");

    // The contractor can still read their own work, and the people directory stays empty for them.
    expect((await listMainTasksForProject(contractor, fixture.projectId)).length).toBeGreaterThan(0);
    expect(await listUsers(contractor)).toEqual([]);
    const stillActive = await prisma.user.findUniqueOrThrow({
      where: { id: contractor.userId },
      select: { isActive: true },
    });
    expect(stillActive.isActive).toBe(true);
  });
});
