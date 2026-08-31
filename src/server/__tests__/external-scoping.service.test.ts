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
import { afterAll, beforeEach, describe, expect, it } from "vitest";

process.env.DATA_DIR = path.join(os.tmpdir(), "tielora-test-data");

import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/permissions";
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
import { getDashboardForActor } from "@/server/services/dashboard";
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
  const buffer = Buffer.from(`line,value\n1,${filename}\n`, "utf8");
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
    await uploadTo(contractor, {
      projectId: fixture.projectId,
      disciplineTaskId: myTaskId,
      requiredDocumentId: requirement.id,
    });

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
    await uploadTo(contractor, {
      projectId: fixture.projectId,
      disciplineTaskId: myTaskId,
      requiredDocumentId: requirement.id,
    });

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
});
