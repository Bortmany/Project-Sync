// Service-level tests for the daily briefs, run against DATABASE_URL_TEST.
//
// The rules being proved: every section of "Your day" is derived from data the app already records
// (including the two ways a task becomes newly unblocked — its last dependency closing and its phase
// gate opening), the project brief's seven-day comparison is worked out from completion timestamps
// rather than a stored snapshot, blockers are assembled from live state, the next gate is exactly
// the earliest phase with open work, and the chat digest goes out once a day, only when its toggle
// is on, inside the delivery budget.
//
// No test here touches the network: global.fetch is mocked wherever a digest is delivered.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { SECTION_LIMIT, orgDigest, personBrief, projectBrief } from "@/server/services/briefs";
import { createPhase } from "@/server/services/phases";
import { lateCountsByProject } from "@/server/services/late";
import {
  orgWeeklyBrief,
  weeklyBriefMessage,
  weeklyLineText,
  type WeeklyBrief,
  type WeeklyLine,
} from "@/server/services/weekly-brief";
import {
  addDependency,
  completeDisciplineTask,
  createMainTask,
  updateDisciplineTaskStatus,
} from "@/server/services/tasks";
import { createComment } from "@/server/services/comments";
import { acknowledgePost, createPost } from "@/server/services/posts";
import { saveIntegration, setEventToggles, setIntegrationEnabled } from "@/server/services/integrations";
import { DIGEST_HOUR_UTC, digestBoundary, postDailyDigests } from "@/server/sweep";
import { actorForUser } from "@/server/actor";
import {
  inThirtyDays,
  makeOrg,
  makeProjectFixture,
  makeUser,
  resetDatabase,
  subtaskIdsByTitle,
  type Fixture,
} from "@/server/__tests__/harness";

process.env.SWEEP_DISABLED = "1";

const DAY_MS = 24 * 60 * 60 * 1000;
const SLACK_URL = "https://hooks.slack.com/services/T00000000/B00000000/Sup3rSecretT0kenValue";
const TEAMS_URL =
  "https://prod-07.westeurope.logic.azure.com:443/workflows/9f3/triggers/manual/paths/invoke?api-version=2016-06-01&sv=1.0&sig=Sup3rSecretSignatureValue";

let fixture: Fixture;

beforeEach(async () => {
  await resetDatabase();
  fixture = await makeProjectFixture();
  delete process.env.APP_BASE_URL;
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** A main task with one discipline task per title, all assigned to the engineer. */
async function makeMainTask(
  title: string,
  subtaskTitles: string[],
  options: { phaseId?: string | null; deadline?: Date } = {},
) {
  const deadline = options.deadline ?? inThirtyDays();
  return createMainTask(fixture.adminActor, {
    projectId: fixture.projectId,
    phaseId: options.phaseId ?? null,
    title,
    description: "Work for the brief tests.",
    priority: "MEDIUM",
    deadline,
    ownerId: fixture.pmActor.userId,
    disciplineTasks: subtaskTitles.map((subtaskTitle) => ({
      disciplineId: fixture.disciplineId,
      title: subtaskTitle,
      assigneeId: fixture.engineerActor.userId,
      deadline,
      isMandatory: true,
      requiredDocuments: [],
    })),
  });
}

/**
 * Ages a main task so the seven-day comparison treats it as work that already existed. The brief
 * deliberately compares only the tasks that were there then, so a test about progress has to say
 * that its work was there.
 */
async function ageMainTask(id: string, days = 30) {
  await prisma.mainTask.update({
    where: { id },
    data: { createdAt: new Date(Date.now() - days * DAY_MS) },
  });
}

/** Moves a deadline without going through a service — the tests need dates in the past. */
async function setDeadline(id: string, deadline: Date) {
  await prisma.disciplineTask.update({ where: { id }, data: { deadline } });
}

/** UTC midnight of today, which is where the app stores every deadline. */
function utcMidnight(offsetDays = 0): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + offsetDays * DAY_MS,
  );
}

describe("Your day — the personal brief", () => {
  it("lists what is due today and what is overdue, with the days over", async () => {
    const mainTask = await makeMainTask("Design review", ["Due today", "Late one", "Later on"]);
    const ids = await subtaskIdsByTitle(mainTask.id);
    await setDeadline(ids.get("Due today") as string, utcMidnight(0));
    await setDeadline(ids.get("Late one") as string, utcMidnight(-3));

    const brief = await personBrief(fixture.engineerActor);

    expect(brief.dueToday.items.map((item) => item.title)).toEqual(["Due today"]);
    expect(brief.dueToday.total).toBe(1);
    expect(brief.overdue.items.map((item) => item.title)).toEqual(["Late one"]);
    expect(brief.overdue.items[0].daysOverdue).toBe(3);
    // The links are the app's own paths, so every line goes somewhere.
    expect(brief.dueToday.items[0].linkUrl).toBe(`/discipline-tasks/${ids.get("Due today")}`);
  });

  it("does not call a task overdue on its own deadline day", async () => {
    const mainTask = await makeMainTask("Design review", ["Due today"]);
    const ids = await subtaskIdsByTitle(mainTask.id);
    await setDeadline(ids.get("Due today") as string, utcMidnight(0));

    const brief = await personBrief(fixture.engineerActor);

    expect(brief.overdue.total).toBe(0);
    expect(brief.dueToday.total).toBe(1);
  });

  it("finds work whose last dependency closed inside the window", async () => {
    const mainTask = await makeMainTask("Design review", ["Earlier work", "Later work"]);
    const ids = await subtaskIdsByTitle(mainTask.id);
    const earlier = ids.get("Earlier work") as string;
    const later = ids.get("Later work") as string;
    await addDependency(fixture.adminActor, { predecessorId: earlier, successorId: later });

    // Still waiting: nothing is newly unblocked.
    expect((await personBrief(fixture.engineerActor)).newlyUnblocked.total).toBe(0);

    await completeDisciplineTask(fixture.engineerActor, { id: earlier });

    const brief = await personBrief(fixture.engineerActor);
    expect(brief.newlyUnblocked.items.map((item) => item.title)).toEqual(["Later work"]);
    expect(brief.newlyUnblocked.items[0].note).toContain("Earlier work");
  });

  it("forgets a dependency that closed more than a day ago", async () => {
    const mainTask = await makeMainTask("Design review", ["Earlier work", "Later work"]);
    const ids = await subtaskIdsByTitle(mainTask.id);
    const earlier = ids.get("Earlier work") as string;
    await addDependency(fixture.adminActor, {
      predecessorId: earlier,
      successorId: ids.get("Later work") as string,
    });
    await completeDisciplineTask(fixture.engineerActor, { id: earlier });
    // Age the completion. Derived from the timestamp that is already there — no new column.
    await prisma.disciplineTask.update({
      where: { id: earlier },
      data: { completedAt: new Date(Date.now() - 3 * DAY_MS) },
    });

    expect((await personBrief(fixture.engineerActor)).newlyUnblocked.total).toBe(0);
  });

  it("finds work whose phase gate opened inside the window", async () => {
    const first = await createPhase(fixture.adminActor, {
      projectId: fixture.projectId,
      name: "Foundations",
    });
    const second = await createPhase(fixture.adminActor, {
      projectId: fixture.projectId,
      name: "Structure",
    });
    const early = await makeMainTask("Piling", ["Piling work"], { phaseId: first.id });
    await makeMainTask("Steel", ["Steel work"], { phaseId: second.id });
    const earlyId = (await subtaskIdsByTitle(early.id)).get("Piling work") as string;

    // While the gate is shut, nothing behind it is "newly unblocked".
    expect((await personBrief(fixture.engineerActor)).newlyUnblocked.total).toBe(0);

    await completeDisciplineTask(fixture.engineerActor, { id: earlyId });

    const brief = await personBrief(fixture.engineerActor);
    expect(brief.newlyUnblocked.items.map((item) => item.title)).toEqual(["Steel work"]);
    expect(brief.newlyUnblocked.items[0].note).toContain("Structure");
  });

  it("does not call work unblocked by a gate while a dependency of its own is still open", async () => {
    const first = await createPhase(fixture.adminActor, {
      projectId: fixture.projectId,
      name: "Foundations",
    });
    const second = await createPhase(fixture.adminActor, {
      projectId: fixture.projectId,
      name: "Structure",
    });
    const early = await makeMainTask("Piling", ["Piling work"], { phaseId: first.id });
    const late = await makeMainTask("Steel", ["Steel survey", "Steel erection"], {
      phaseId: second.id,
    });
    const lateIds = await subtaskIdsByTitle(late.id);
    await addDependency(fixture.adminActor, {
      predecessorId: lateIds.get("Steel survey") as string,
      successorId: lateIds.get("Steel erection") as string,
    });

    await completeDisciplineTask(fixture.engineerActor, {
      id: (await subtaskIdsByTitle(early.id)).get("Piling work") as string,
    });

    const brief = await personBrief(fixture.engineerActor);

    // The gate opened, so the survey is free — but the erection still waits on the survey, and the
    // app would refuse it. Calling it "newly unblocked" would send somebody to a task they cannot do.
    expect(brief.newlyUnblocked.items.map((item) => item.title)).toEqual(["Steel survey"]);
  });

  it("counts a gate opened by a recorded override, at the moment it was recorded", async () => {
    const first = await createPhase(fixture.adminActor, {
      projectId: fixture.projectId,
      name: "Foundations",
    });
    const second = await createPhase(fixture.adminActor, {
      projectId: fixture.projectId,
      name: "Structure",
    });
    await makeMainTask("Piling", ["Piling work"], { phaseId: first.id });
    await makeMainTask("Steel", ["Steel work"], { phaseId: second.id });

    const { overridePhaseLock } = await import("@/server/services/phases");
    await overridePhaseLock(fixture.pmActor, { id: second.id, reason: "Client instruction 12" });

    const brief = await personBrief(fixture.engineerActor);
    expect(brief.newlyUnblocked.items.map((item) => item.title)).toEqual(["Steel work"]);
    expect(brief.newlyUnblocked.items[0].note).toContain("Structure");

    // Age the override: the gate opened, but not inside the window any more.
    await prisma.projectPhase.update({
      where: { id: second.id },
      data: { overriddenAt: new Date(Date.now() - 3 * DAY_MS) },
    });
    expect((await personBrief(fixture.engineerActor)).newlyUnblocked.total).toBe(0);
  });

  it("shows mentions from the last 24 hours and nothing older", async () => {
    const mainTask = await makeMainTask("Design review", ["Only one"]);
    await createComment(fixture.pmActor, {
      mainTaskId: mainTask.id,
      body: `Please look at this @[${fixture.engineerActor.name}](${fixture.engineerActor.userId})`,
      mentions: [fixture.engineerActor.userId],
    });

    const brief = await personBrief(fixture.engineerActor);
    expect(brief.mentions.total).toBe(1);
    expect(brief.mentions.items[0].linkUrl).toBe(`/tasks/${mainTask.id}`);

    await prisma.notification.updateMany({
      where: { userId: fixture.engineerActor.userId, type: "MENTIONED" },
      data: { createdAt: new Date(Date.now() - 2 * DAY_MS) },
    });
    expect((await personBrief(fixture.engineerActor)).mentions.total).toBe(0);
  });

  it("lists main tasks the person owns that are awaiting review, and nobody else's", async () => {
    // Awaiting review is what the derivation says when every MANDATORY subtask is done and
    // something optional is still open — so one of the two is made optional first.
    const mainTask = await makeMainTask("Design review", ["The mandatory one", "An optional extra"]);
    const ids = await subtaskIdsByTitle(mainTask.id);
    await prisma.disciplineTask.update({
      where: { id: ids.get("An optional extra") as string },
      data: { isMandatory: false },
    });
    await completeDisciplineTask(fixture.engineerActor, {
      id: ids.get("The mandatory one") as string,
    });

    // The task is owned by the project manager, so it is their review, not the engineer's.
    const owner = await personBrief(fixture.pmActor);
    expect(owner.awaitingReview.items.map((item) => item.title)).toEqual(["Design review"]);
    expect(owner.awaitingReview.items[0].linkUrl).toBe(`/tasks/${mainTask.id}`);
    expect((await personBrief(fixture.engineerActor)).awaitingReview.total).toBe(0);
  });

  it("caps every list and still tells the truth about how many there are", async () => {
    const titles = Array.from({ length: SECTION_LIMIT + 3 }, (_value, index) => `Late ${index}`);
    const mainTask = await makeMainTask("Design review", titles);
    const ids = await subtaskIdsByTitle(mainTask.id);
    for (const title of titles) {
      await setDeadline(ids.get(title) as string, utcMidnight(-5));
    }

    const brief = await personBrief(fixture.engineerActor);
    expect(brief.overdue.items).toHaveLength(SECTION_LIMIT);
    expect(brief.overdue.total).toBe(SECTION_LIMIT + 3);
  });

  it("says nothing at all for somebody with no projects", async () => {
    const brief = await personBrief(fixture.outsiderActor);

    expect(brief.dueToday.total).toBe(0);
    expect(brief.overdue.total).toBe(0);
    expect(brief.newlyUnblocked.total).toBe(0);
    expect(brief.awaitingReview.total).toBe(0);
  });

  it("lists the announcements still waiting for this person's acknowledgement", async () => {
    const asking = await createPost(fixture.adminActor, {
      kind: "ANNOUNCEMENT",
      title: "Site access closures",
      body: "Gate 3 is shut this weekend.",
      requiresAck: true,
    });
    await createPost(fixture.adminActor, {
      kind: "ANNOUNCEMENT",
      title: "Canteen hours",
      body: "Nothing to confirm here.",
    });

    const before = await personBrief(fixture.engineerActor);
    expect(before.announcements.total).toBe(2);
    expect(before.awaitingAcknowledgement.total).toBe(1);
    expect(before.awaitingAcknowledgement.items[0].title).toBe("Site access closures");
    expect(before.awaitingAcknowledgement.items[0].linkUrl).toBe("/messages?tab=everyone");
    expect(before.awaitingAcknowledgement.items[0].projectCode).toBe("Everyone");

    // Acknowledging is the only thing that takes it off the list — dismissing cannot, and is
    // refused until it has been acknowledged anyway.
    await acknowledgePost(fixture.engineerActor, { id: asking.id });
    const after = await personBrief(fixture.engineerActor);
    expect(after.awaitingAcknowledgement.total).toBe(0);
    expect(after.announcements.total).toBe(2);
  });

  it("caps that list too, and still says how many there are", async () => {
    for (let index = 0; index < SECTION_LIMIT + 2; index += 1) {
      await createPost(fixture.adminActor, {
        kind: "ANNOUNCEMENT",
        title: `Please confirm ${index}`,
        body: "Something to acknowledge.",
        requiresAck: true,
      });
    }

    const brief = await personBrief(fixture.engineerActor);
    expect(brief.awaitingAcknowledgement.items).toHaveLength(SECTION_LIMIT);
    expect(brief.awaitingAcknowledgement.total).toBe(SECTION_LIMIT + 2);
  });

  it("carries a contractor's included notices, and caps them the same way", async () => {
    const contractor = await makeUser({
      name: "Idris Contractor",
      role: "EXTERNAL",
      orgId: fixture.orgId,
    });
    const parent = await makeMainTask("Contractor work", ["Weld inspection"]);
    const taskId = (await subtaskIdsByTitle(parent.id)).get("Weld inspection") as string;
    await prisma.disciplineTask.update({
      where: { id: taskId },
      data: { assigneeId: contractor.id },
    });
    const actor = await actorForUser(contractor.id);

    for (let index = 0; index < SECTION_LIMIT + 2; index += 1) {
      await createPost(fixture.adminActor, {
        kind: "ANNOUNCEMENT",
        title: `Included notice ${index}`,
        body: "Something a contractor may read.",
        includeExternals: true,
      });
    }
    // One that nobody included them in: it must not appear, capped list or not.
    await createPost(fixture.adminActor, {
      kind: "ANNOUNCEMENT",
      title: "Internal only",
      body: "Not for contractors.",
    });

    const brief = await personBrief(actor);
    expect(brief.announcements.items).toHaveLength(SECTION_LIMIT);
    expect(brief.announcements.total).toBe(SECTION_LIMIT + 2);
    expect(brief.announcements.items.map((item) => item.title)).not.toContain("Internal only");
    // Every line carries the notice itself and points nowhere, and nothing asks them to confirm.
    expect(brief.announcements.items.every((item) => item.linkUrl === "")).toBe(true);
    expect(brief.announcements.items[0].body).toBe("Something a contractor may read.");
    expect(brief.awaitingAcknowledgement.total).toBe(0);
  });
});

describe("Where we stand — the project brief", () => {
  it("compares progress with seven days ago, from the completion timestamps themselves", async () => {
    const old = await makeMainTask("Finished long ago", ["Old work"]);
    const fresh = await makeMainTask("Finished this week", ["New work"]);
    await makeMainTask("Still going", ["Open work"]);

    for (const task of [old, fresh]) await ageMainTask(task.id);
    const stillGoing = await prisma.mainTask.findFirstOrThrow({ where: { title: "Still going" } });
    await ageMainTask(stillGoing.id);

    const oldId = (await subtaskIdsByTitle(old.id)).get("Old work") as string;
    await completeDisciplineTask(fixture.engineerActor, { id: oldId });
    await prisma.disciplineTask.update({
      where: { id: oldId },
      data: { completedAt: new Date(Date.now() - 30 * DAY_MS) },
    });
    await completeDisciplineTask(fixture.engineerActor, {
      id: (await subtaskIdsByTitle(fresh.id)).get("New work") as string,
    });

    const brief = await projectBrief(fixture.adminActor, fixture.projectId);

    expect(brief.progress.total).toBe(3);
    expect(brief.progress.completed).toBe(2);
    expect(brief.progress.pct).toBe(66);
    // Seven days ago all three existed and only the aged one was done.
    expect(brief.progress.totalThen).toBe(3);
    expect(brief.progress.completedThen).toBe(1);
    expect(brief.progress.pctThen).toBe(33);
  });

  it("counts a main task completed by override as complete, at the moment of the override", async () => {
    const mainTask = await makeMainTask("Forced through", ["Some work"]);
    await ageMainTask(mainTask.id);
    const { overrideMainTaskStatus } = await import("@/server/services/tasks");
    await overrideMainTaskStatus(fixture.pmActor, {
      id: mainTask.id,
      status: "COMPLETED",
      reason: "Closed under site instruction 44",
    });

    const now = await projectBrief(fixture.adminActor, fixture.projectId);
    expect(now.progress.completed).toBe(1);
    expect(now.progress.completedThen).toBe(0);

    await prisma.mainTask.update({
      where: { id: mainTask.id },
      data: { overriddenAt: new Date(Date.now() - 30 * DAY_MS) },
    });
    const later = await projectBrief(fixture.adminActor, fixture.projectId);
    expect(later.progress.completedThen).toBe(1);
  });

  it("does not count work reopened and finished again this week as fresh progress", async () => {
    const mainTask = await makeMainTask("Finished, reopened, finished again", ["The work"]);
    await ageMainTask(mainTask.id);
    const subtaskId = (await subtaskIdsByTitle(mainTask.id)).get("The work") as string;

    // Complete it well before the window, then reopen and complete it again inside the window.
    await completeDisciplineTask(fixture.engineerActor, { id: subtaskId });
    await prisma.disciplineTask.update({
      where: { id: subtaskId },
      data: { completedAt: new Date(Date.now() - 30 * DAY_MS) },
    });
    const { reopenDisciplineTask } = await import("@/server/services/tasks");
    await reopenDisciplineTask(fixture.pmActor, {
      id: subtaskId,
      reason: "Client asked for a second look",
    });
    await completeDisciplineTask(fixture.engineerActor, { id: subtaskId });

    const brief = await projectBrief(fixture.adminActor, fixture.projectId);

    expect(brief.progress.completed).toBe(1);
    // It was complete a week ago too, so nothing new finished — the brief must not claim it did.
    expect(brief.progress.completedThen).toBe(1);
    expect(brief.progress.pct).toBe(brief.progress.pctThen);
  });

  it("counts work reopened this week and still open as complete then, so the fall is visible", async () => {
    const mainTask = await makeMainTask("Went backwards", ["The work"]);
    await ageMainTask(mainTask.id);
    const subtaskId = (await subtaskIdsByTitle(mainTask.id)).get("The work") as string;
    await completeDisciplineTask(fixture.engineerActor, { id: subtaskId });
    await prisma.disciplineTask.update({
      where: { id: subtaskId },
      data: { completedAt: new Date(Date.now() - 30 * DAY_MS) },
    });
    const { reopenDisciplineTask } = await import("@/server/services/tasks");
    await reopenDisciplineTask(fixture.pmActor, { id: subtaskId, reason: "Rework needed on site" });

    const brief = await projectBrief(fixture.adminActor, fixture.projectId);

    expect(brief.progress.completed).toBe(0);
    expect(brief.progress.completedThen).toBe(1);
    expect(brief.progress.pct).toBeLessThan(brief.progress.pctThen);
  });

  it("compares against the tasks that existed then, so adding work cannot look like a fall", async () => {
    const done = await makeMainTask("Old and finished", ["Old work"]);
    const oldId = (await subtaskIdsByTitle(done.id)).get("Old work") as string;
    await completeDisciplineTask(fixture.engineerActor, { id: oldId });
    await prisma.disciplineTask.update({
      where: { id: oldId },
      data: { completedAt: new Date(Date.now() - 30 * DAY_MS) },
    });
    await ageMainTask(done.id);

    // Brand-new work, added today.
    await makeMainTask("Added today", ["New work"]);

    const brief = await projectBrief(fixture.adminActor, fixture.projectId);

    expect(brief.progress.total).toBe(2);
    expect(brief.progress.pct).toBe(50);
    // A week ago there was one task and it was done: 100%, not 50%.
    expect(brief.progress.totalThen).toBe(1);
    expect(brief.progress.completedThen).toBe(1);
    expect(brief.progress.pctThen).toBe(100);
  });

  it("assembles the blockers: blocked tasks with what they wait on, shut gates, overdue by discipline", async () => {
    const first = await createPhase(fixture.adminActor, {
      projectId: fixture.projectId,
      name: "Foundations",
    });
    const second = await createPhase(fixture.adminActor, {
      projectId: fixture.projectId,
      name: "Structure",
    });
    const early = await makeMainTask("Piling", ["Earlier work", "Blocked work"], {
      phaseId: first.id,
    });
    await makeMainTask("Steel", ["Steel work"], { phaseId: second.id });

    const ids = await subtaskIdsByTitle(early.id);
    await addDependency(fixture.adminActor, {
      predecessorId: ids.get("Earlier work") as string,
      successorId: ids.get("Blocked work") as string,
    });
    await updateDisciplineTaskStatus(fixture.engineerActor, {
      id: ids.get("Blocked work") as string,
      status: "BLOCKED",
    });
    await setDeadline(ids.get("Earlier work") as string, utcMidnight(-4));

    const brief = await projectBrief(fixture.adminActor, fixture.projectId);

    expect(brief.blockedTotal).toBe(1);
    expect(brief.blockedTasks[0].title).toBe("Blocked work");
    expect(brief.blockedTasks[0].unmetDependencies).toEqual(["Earlier work"]);
    expect(brief.blockedTasks[0].mainTaskTitle).toBe("Piling");

    expect(brief.lockedPhases.map((phase) => phase.name)).toEqual(["Structure"]);
    expect(brief.lockedPhases[0].lockedByPhaseName).toBe("Foundations");
    expect(brief.lockedPhases[0].openTaskCount).toBe(1);

    expect(brief.overdueTotal).toBe(1);
    expect(brief.overdueByDiscipline[0].count).toBe(1);
  });

  it("names the earliest phase with open work as what must happen next", async () => {
    const first = await createPhase(fixture.adminActor, {
      projectId: fixture.projectId,
      name: "Foundations",
    });
    const second = await createPhase(fixture.adminActor, {
      projectId: fixture.projectId,
      name: "Structure",
    });
    const early = await makeMainTask("Piling", ["Piling work"], { phaseId: first.id });
    await makeMainTask("Steel", ["Steel work"], { phaseId: second.id });
    await makeMainTask("Unphased survey", ["Survey work"]);

    const before = await projectBrief(fixture.adminActor, fixture.projectId);
    expect(before.nextGate?.phaseName).toBe("Foundations");
    expect(before.nextGate?.items.map((item) => item.title)).toEqual(["Piling"]);
    // Unphased work is never gated, so it stands on its own deadlines.
    expect(before.nearestDeadlines.map((item) => item.title)).toEqual(["Unphased survey"]);

    await completeDisciplineTask(fixture.engineerActor, {
      id: (await subtaskIdsByTitle(early.id)).get("Piling work") as string,
    });

    const after = await projectBrief(fixture.adminActor, fixture.projectId);
    expect(after.nextGate?.phaseName).toBe("Structure");
    expect(after.lockedPhases).toEqual([]);
  });

  it("has no next gate once every main task is complete", async () => {
    const mainTask = await makeMainTask("Only work", ["The work"]);
    await completeDisciplineTask(fixture.engineerActor, {
      id: (await subtaskIdsByTitle(mainTask.id)).get("The work") as string,
    });

    const brief = await projectBrief(fixture.adminActor, fixture.projectId);
    expect(brief.nextGate).toBeNull();
    expect(brief.nearestDeadlines).toEqual([]);
    expect(brief.progress.pct).toBe(100);
  });

  it("caps the lists it shows and still counts the rest", async () => {
    const titles = Array.from({ length: SECTION_LIMIT + 2 }, (_value, index) => `Blocked ${index}`);
    const mainTask = await makeMainTask("Design review", titles);
    const ids = await subtaskIdsByTitle(mainTask.id);
    for (const title of titles) {
      await updateDisciplineTaskStatus(fixture.engineerActor, {
        id: ids.get(title) as string,
        status: "BLOCKED",
      });
    }

    const brief = await projectBrief(fixture.adminActor, fixture.projectId);
    expect(brief.blockedTasks).toHaveLength(SECTION_LIMIT);
    expect(brief.blockedTotal).toBe(SECTION_LIMIT + 2);
  });
});

describe("the chat digest", () => {
  /** Replaces the network with a spy that always answers 200 OK, like a real webhook does. */
  function mockFetchOk() {
    return vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok", { status: 200 }));
  }

  /** A connected, switched-on channel. The digest toggle is off unless a test asks for it. */
  async function connect(kind: "SLACK" | "TEAMS", url: string, dailyBrief = false) {
    await saveIntegration(fixture.adminActor, { kind, webhookUrl: url });
    await setIntegrationEnabled(fixture.adminActor, { kind, enabled: true });
    if (dailyBrief) {
      await setEventToggles(fixture.adminActor, {
        kind,
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
    }
  }

  const connectSlack = (dailyBrief = false) => connect("SLACK", SLACK_URL, dailyBrief);

  /** A moment safely after the send line, on a day the tests choose. */
  const morning = (): Date => {
    const now = new Date();
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), DIGEST_HOUR_UTC + 1),
    );
  };

  it("starts switched off: a connected channel gets nothing until somebody asks for it", async () => {
    await connectSlack(false);
    await makeMainTask("Design review", ["Some work"]);
    const fetchSpy = mockFetchOk();

    const run = await postDailyDigests(morning());

    expect(run.orgs).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends once a day and not again on the next run", async () => {
    await connectSlack(true);
    await makeMainTask("Design review", ["Some work"]);
    const fetchSpy = mockFetchOk();

    const first = await postDailyDigests(morning());
    expect(first.channels).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // An hour later, the same day: the stamp on the row is what stops a second one.
    const second = await postDailyDigests(new Date(morning().getTime() + 60 * 60 * 1000));
    expect(second.orgs).toBe(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // The next morning it goes again.
    const nextDay = await postDailyDigests(new Date(morning().getTime() + DAY_MS));
    expect(nextDay.channels).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("waits for early morning UTC before the first send of the day", async () => {
    const beforeLine = new Date(
      Date.UTC(2026, 7, 31, DIGEST_HOUR_UTC - 1, 30),
    );
    expect(digestBoundary(beforeLine)).toBeNull();
    expect(digestBoundary(new Date(Date.UTC(2026, 7, 31, DIGEST_HOUR_UTC)))?.toISOString()).toBe(
      new Date(Date.UTC(2026, 7, 31, DIGEST_HOUR_UTC)).toISOString(),
    );

    await connectSlack(true);
    await makeMainTask("Design review", ["Some work"]);
    const fetchSpy = mockFetchOk();

    expect((await postDailyDigests(beforeLine)).orgs).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("says nothing at all when the company has no active project", async () => {
    await connectSlack(true);
    await prisma.project.update({
      where: { id: fixture.projectId },
      data: { status: "ARCHIVED" },
    });
    const fetchSpy = mockFetchOk();

    const run = await postDailyDigests(morning());

    expect(run.channels).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await orgDigest(fixture.orgId)).toBeNull();
  });

  it("respects the delivery budget, and finishes the companies it did reach", async () => {
    await connectSlack(true);
    await makeMainTask("Design review", ["Some work"]);
    const fetchSpy = mockFetchOk();

    // A budget of zero still lets the first message through — the deadline is checked after a send,
    // exactly as the sweep's reminders are.
    const run = await postDailyDigests(morning(), 0);

    expect(run.orgs).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does not post to a channel again when a SECOND channel is switched on later the same day", async () => {
    await connectSlack(true);
    await makeMainTask("Design review", ["Some work"]);
    const fetchSpy = mockFetchOk();

    // Nine o'clock: Slack is due and gets today's digest.
    await postDailyDigests(morning());
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toBe(SLACK_URL);

    // The administrator connects Teams an hour later and switches the digest on for it.
    await connect("TEAMS", TEAMS_URL, true);

    const second = await postDailyDigests(new Date(morning().getTime() + 60 * 60 * 1000));

    // Teams gets today's digest; Slack, which already had it, is left alone.
    expect(second.channels).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[1][0])).toBe(TEAMS_URL);
    expect(fetchSpy.mock.calls.filter((call) => String(call[0]) === SLACK_URL)).toHaveLength(1);
  });

  it("serves the longest-waiting company first, so a short run does not starve the same one", async () => {
    // Two companies, both due, both wanting a digest — and only enough budget for one of them.
    await connectSlack(true);
    await makeMainTask("Design review", ["Some work"]);

    const otherOrg = await makeOrg("Second Company");
    const other = await makeProjectFixture(otherOrg.id);
    const OTHER_URL = "https://hooks.slack.com/services/TOTHER/BOTHER/OtherSecretTokenValue";
    await saveIntegration(other.adminActor, { kind: "SLACK", webhookUrl: OTHER_URL });
    await setIntegrationEnabled(other.adminActor, { kind: "SLACK", enabled: true });
    await setEventToggles(other.adminActor, {
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
    await createMainTask(other.adminActor, {
      projectId: other.projectId,
      title: "Their work",
      description: "So the second company has an active project with work in it.",
      priority: "MEDIUM",
      deadline: inThirtyDays(),
      disciplineTasks: [],
    });

    // The first company was served this morning-but-one; the second, two days before that.
    await prisma.orgIntegration.updateMany({
      where: { orgId: fixture.orgId },
      data: { dailyBriefSentAt: new Date(morning().getTime() - 1 * DAY_MS) },
    });
    await prisma.orgIntegration.updateMany({
      where: { orgId: otherOrg.id },
      data: { dailyBriefSentAt: new Date(morning().getTime() - 3 * DAY_MS) },
    });

    const fetchSpy = mockFetchOk();
    // A budget of zero stops after the first company, which is exactly the situation the ordering
    // exists for: the one that has waited longest must be the one that gets served.
    const run = await postDailyDigests(morning(), 0);

    expect(run.orgs).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toBe(OTHER_URL);
  });

  it("counts every project's late and blocked work, not just what one capped scan happened to see", async () => {
    // Fifteen main tasks, all late, all with blocked work: more than any per-read cap would keep.
    for (let index = 0; index < 15; index += 1) {
      const task = await makeMainTask(`Late main task ${index}`, [`Blocked work ${index}`]);
      await updateDisciplineTaskStatus(fixture.engineerActor, {
        id: (await subtaskIdsByTitle(task.id)).get(`Blocked work ${index}`) as string,
        status: "BLOCKED",
      });
      await prisma.mainTask.update({ where: { id: task.id }, data: { deadline: utcMidnight(-4) } });
    }

    const digest = await orgDigest(fixture.orgId);

    expect(digest?.lines[0].lateMain).toBe(15);
    expect(digest?.lines[0].blocked).toBe(15);
  });

  it("says one line per project: progress, overdue, blocked and the next gate", async () => {
    const phase = await createPhase(fixture.adminActor, {
      projectId: fixture.projectId,
      name: "Foundations",
    });
    const mainTask = await makeMainTask("Piling", ["Late work", "Blocked work"], {
      phaseId: phase.id,
    });
    const ids = await subtaskIdsByTitle(mainTask.id);
    await updateDisciplineTaskStatus(fixture.engineerActor, {
      id: ids.get("Blocked work") as string,
      status: "BLOCKED",
    });
    await prisma.mainTask.update({
      where: { id: mainTask.id },
      data: { deadline: utcMidnight(-4) },
    });

    const digest = await orgDigest(fixture.orgId);

    expect(digest?.lines).toHaveLength(1);
    expect(digest?.lines[0].lateMain).toBe(1);
    expect(digest?.lines[0].blocked).toBe(1);
    expect(digest?.lines[0].pct).toBe(0);
    expect(digest?.lines[0].nextGate).toBe("Foundations");

    // And the card carries all of it, with no address and no personal data in it.
    await connectSlack(true);
    const fetchSpy = mockFetchOk();
    await postDailyDigests(morning());

    const body = String((fetchSpy.mock.calls[0][1] as RequestInit).body);
    expect(body).toContain("1 main task and 0 discipline tasks overdue");
    expect(body).toContain("1 blocked");
    expect(body).toContain("Foundations");
    expect(body).not.toContain(SLACK_URL);
  });
});

describe("the locked-phase sentence quotes the phase it names", () => {
  it("shows the BLOCKING phase's open count, not the locked phase's own (the 0-vs-9 case)", async () => {
    const feed = await createPhase(fixture.adminActor, { projectId: fixture.projectId, name: "FEED" });
    await createPhase(fixture.adminActor, { projectId: fixture.projectId, name: "Construction" });
    const commissioning = await createPhase(fixture.adminActor, {
      projectId: fixture.projectId,
      name: "Commissioning",
    });
    for (const title of ["F1", "F2", "F3", "F4", "F5"]) {
      await makeMainTask(title, [`${title} work`], { phaseId: feed.id });
    }
    // Construction has NO open work of its own; Commissioning has two.
    await makeMainTask("C1", ["C1 work"], { phaseId: commissioning.id });
    await makeMainTask("C2", ["C2 work"], { phaseId: commissioning.id });

    const brief = await projectBrief(fixture.adminActor, fixture.projectId);
    const byName = new Map(brief.lockedPhases.map((phase) => [phase.name, phase]));
    expect(byName.get("Construction")).toMatchObject({ lockedByPhaseName: "FEED", openTaskCount: 5 });
    expect(byName.get("Commissioning")).toMatchObject({ lockedByPhaseName: "FEED", openTaskCount: 5 });
    // Nothing in this brief quotes the locked phase's own count (0 and 2) against FEED's name.
    expect(brief.lockedPhases.every((phase) => phase.openTaskCount === 5)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* The weekly brief's numbers                                          */
/* ------------------------------------------------------------------ */

describe("the weekly brief's numbers agree with the screens", () => {
  it("has a progress line equal to the project Brief's, with a reopened task and a task created this week", async () => {
    const { reopenDisciplineTask } = await import("@/server/services/tasks");

    // Finished long ago.
    const old = await makeMainTask("Finished long ago", ["Old work"]);
    await ageMainTask(old.id);
    const oldId = (await subtaskIdsByTitle(old.id)).get("Old work") as string;
    await completeDisciplineTask(fixture.engineerActor, { id: oldId });
    await prisma.disciplineTask.update({
      where: { id: oldId },
      data: { completedAt: new Date(Date.now() - 30 * DAY_MS) },
    });

    // Finished this week.
    const fresh = await makeMainTask("Finished this week", ["New work"]);
    await ageMainTask(fresh.id);
    await completeDisciplineTask(fixture.engineerActor, {
      id: (await subtaskIdsByTitle(fresh.id)).get("New work") as string,
    });

    // Finished long ago, reopened and finished again inside the window: not fresh progress.
    const again = await makeMainTask("Reopened", ["Redone work"]);
    await ageMainTask(again.id);
    const againId = (await subtaskIdsByTitle(again.id)).get("Redone work") as string;
    await completeDisciplineTask(fixture.engineerActor, { id: againId });
    await prisma.disciplineTask.update({
      where: { id: againId },
      data: { completedAt: new Date(Date.now() - 30 * DAY_MS) },
    });
    await reopenDisciplineTask(fixture.pmActor, { id: againId, reason: "Second look" });
    await completeDisciplineTask(fixture.engineerActor, { id: againId });

    // Still going, and one created inside the window (left out of "a week ago").
    const going = await makeMainTask("Still going", ["Open work"]);
    await ageMainTask(going.id);
    await makeMainTask("Created this week", ["Brand new work"]);

    const now = new Date();
    const brief = await projectBrief(fixture.adminActor, fixture.projectId, now);
    const weekly = await orgWeeklyBrief(fixture.orgId, now);

    expect(weekly?.lines).toHaveLength(1);
    expect(weekly?.lines[0].pct).toBe(brief.progress.pct);
    expect(weekly?.lines[0].pctThen).toBe(brief.progress.pctThen);
    // A sanity check that the fixture exercised something: three of five are done, two of four were.
    expect(brief.progress.total).toBe(5);
    expect(brief.progress.completed).toBe(3);
    expect(brief.progress.totalThen).toBe(4);
    expect(brief.progress.completedThen).toBe(2);
    expect(weeklyLineText(weekly?.lines[0] as WeeklyLine)).toContain(
      `${brief.progress.pct}% (${brief.progress.pctThen}% a week ago)`,
    );
  });

  it("says 'unchanged' for a quiet project rather than leaving it out", async () => {
    const quiet = await makeMainTask("Nothing moved", ["Waiting work"]);
    await ageMainTask(quiet.id);

    const weekly = await orgWeeklyBrief(fixture.orgId, new Date());

    expect(weekly?.lines).toHaveLength(1);
    expect(weeklyLineText(weekly?.lines[0] as WeeklyLine)).toContain("0%, unchanged");
  });

  it("counts as 'new this week' only open work whose deadline day ended in the last seven days", async () => {
    // Monday 5 Oct 2026, 06:00 UTC: the deadline day of 4 Oct is over from 4 Oct 06:00 onwards.
    const now = new Date(Date.UTC(2026, 9, 5, 6));
    const day = (month: number, date: number) => new Date(Date.UTC(2026, month, date));
    const deadlines: [string, Date][] = [
      ["Ended yesterday", day(9, 4)],
      ["Ended three days ago", day(9, 2)],
      ["Ended a week and a bit ago", day(8, 28)],
      ["Ended long ago", day(8, 27)], // late, but already late a week ago
      ["Due today", day(9, 5)], // not late yet
    ];
    for (const [title, deadline] of deadlines) {
      const task = await makeMainTask(title, [`${title} work`], { deadline });
      await prisma.mainTask.update({ where: { id: task.id }, data: { deadline } });
      await prisma.disciplineTask.updateMany({ where: { mainTaskId: task.id }, data: { deadline } });
    }
    // Late and finished since: neither late nor new.
    const done = await makeMainTask("Finished since", ["Finished since work"], { deadline: day(9, 3) });
    await prisma.mainTask.update({ where: { id: done.id }, data: { deadline: day(9, 3) } });
    await prisma.disciplineTask.updateMany({
      where: { mainTaskId: done.id },
      data: { deadline: day(9, 3) },
    });
    await completeDisciplineTask(fixture.engineerActor, {
      id: (await subtaskIdsByTitle(done.id)).get("Finished since work") as string,
    });

    const weekly = await orgWeeklyBrief(fixture.orgId, now);
    const line = weekly?.lines[0] as WeeklyLine;

    // Late: yesterday, three days ago, a week and a bit ago, long ago — four of each kind.
    expect(line.lateMain).toBe(4);
    expect(line.lateDiscipline).toBe(4);
    // New this week: the first three of those, for both kinds.
    expect(line.newlyLate).toBe(6);
    // The same late figure the shared helper gives everybody else.
    const shared = (await lateCountsByProject(fixture.orgId, [fixture.projectId], now)).get(
      fixture.projectId,
    );
    expect(shared).toEqual({ lateMain: line.lateMain, lateDiscipline: line.lateDiscipline });
    expect(weeklyLineText(line)).toContain("4 main tasks and 4 discipline tasks late (6 new this week)");
  });

  it("lists a gate opened inside the window, and not one that opened earlier", async () => {
    const first = await createPhase(fixture.adminActor, { projectId: fixture.projectId, name: "Foundations" });
    await createPhase(fixture.adminActor, { projectId: fixture.projectId, name: "Structure" });
    const early = await makeMainTask("Piling", ["Piling work"], { phaseId: first.id });
    const earlyId = (await subtaskIdsByTitle(early.id)).get("Piling work") as string;
    let now = new Date();

    // The gate is still shut: nothing to report.
    expect((await orgWeeklyBrief(fixture.orgId, now))?.gates).toEqual([]);

    await completeDisciplineTask(fixture.engineerActor, { id: earlyId });
    now = new Date();
    const project = await prisma.project.findUniqueOrThrow({ where: { id: fixture.projectId } });
    const opened = (await orgWeeklyBrief(fixture.orgId, now)) as WeeklyBrief;
    expect(opened.gates).toEqual([{ code: project.code, phase: "Structure" }]);
    expect(weeklyBriefMessage(opened).body).toContain(`Gates opened this week: ${project.code} — Structure`);

    // Exactly a week ago still counts; a moment before that does not.
    await prisma.disciplineTask.update({
      where: { id: earlyId },
      data: { completedAt: new Date(now.getTime() - 7 * DAY_MS) },
    });
    expect(((await orgWeeklyBrief(fixture.orgId, now)) as WeeklyBrief).gates).toHaveLength(1);
    await prisma.disciplineTask.update({
      where: { id: earlyId },
      data: { completedAt: new Date(now.getTime() - 7 * DAY_MS - 1) },
    });
    const older = (await orgWeeklyBrief(fixture.orgId, now)) as WeeklyBrief;
    expect(older.gates).toEqual([]);
    expect(weeklyBriefMessage(older).body).not.toContain("Gates opened this week");
  });
});

/* ------------------------------------------------------------------ */
/* The reopen scan is per project                                      */
/* ------------------------------------------------------------------ */

describe("progress a week ago does not depend on a busier project", () => {
  it("keeps one project's figure the same however many reopens another has, and the weekly line equals its Brief", async () => {
    const { REOPEN_SCAN_LIMIT, progressSince } = await import("@/server/services/briefs");

    // Project B, beside the fixture's project A, with the same people on it.
    const projectB = await prisma.project.create({
      data: {
        orgId: fixture.orgId,
        name: "Second project",
        code: `SEC-${Math.floor(Math.random() * 1_000_000)}`,
        description: "The quieter project.",
        createdById: fixture.adminActor.userId,
        disciplines: { create: [{ disciplineId: fixture.disciplineId }] },
        members: {
          create: [
            { userId: fixture.adminActor.userId, projectRole: "ADMIN" },
            { userId: fixture.pmActor.userId, projectRole: "PROJECT_MANAGER" },
            {
              userId: fixture.engineerActor.userId,
              projectRole: "ENGINEER",
              disciplineId: fixture.disciplineId,
            },
          ],
        },
      },
    });
    const deadline = inThirtyDays();
    const main = await createMainTask(fixture.adminActor, {
      projectId: projectB.id,
      phaseId: null,
      title: "Redone in B",
      description: "Finished, reopened and finished again.",
      priority: "MEDIUM",
      deadline,
      ownerId: fixture.pmActor.userId,
      disciplineTasks: [
        {
          disciplineId: fixture.disciplineId,
          title: "Redone work",
          assigneeId: fixture.engineerActor.userId,
          deadline,
          isMandatory: true,
          requiredDocuments: [],
        },
      ],
    });
    await ageMainTask(main.id);
    const subId = (await subtaskIdsByTitle(main.id)).get("Redone work") as string;
    await completeDisciplineTask(await actorForUser(fixture.engineerActor.userId), { id: subId });

    // B's one reopen row, an hour old.
    const now = new Date();
    await prisma.activityLog.create({
      data: {
        projectId: projectB.id,
        actorId: fixture.pmActor.userId,
        entityType: "DisciplineTask",
        entityId: subId,
        action: "REOPENED",
        summary: "Reopened",
        createdAt: new Date(now.getTime() - 60 * 60 * 1000),
      },
    });

    const since = new Date(now.getTime() - 7 * DAY_MS);
    const alone = (await progressSince(fixture.orgId, [projectB.id], since)).get(projectB.id);
    // It was complete before the reopen, so a week ago it counts as done.
    expect(alone?.completedThen).toBe(1);
    expect(alone?.totalThen).toBe(1);

    // Project A now has far more reopen rows than the scan limit, all NEWER than B's. Under a
    // shared limit these would use up the whole scan and B's row would never be read.
    await prisma.activityLog.createMany({
      data: Array.from({ length: REOPEN_SCAN_LIMIT * 2 + 100 }, (_, index) => ({
        projectId: fixture.projectId,
        actorId: fixture.pmActor.userId,
        entityType: "DisciplineTask",
        entityId: `busy-project-task-${index}`,
        action: "REOPENED",
        summary: "Reopened",
        createdAt: new Date(now.getTime() - 1000),
      })),
    });

    const together = await progressSince(fixture.orgId, [fixture.projectId, projectB.id], since);
    expect(together.get(projectB.id)).toEqual(alone);

    // And the weekly line for B says exactly what B's own Brief says.
    const brief = await projectBrief(fixture.adminActor, projectB.id, now);
    const weekly = await orgWeeklyBrief(fixture.orgId, now);
    const line = weekly?.lines.find((entry) => entry.projectId === projectB.id) as WeeklyLine;
    expect(line.pct).toBe(brief.progress.pct);
    expect(line.pctThen).toBe(brief.progress.pctThen);
    expect(brief.progress.pctThen).toBe(100);
  });
});
