// THE STAGE GATE, proved at the service level against DATABASE_URL_TEST.
//
// A phase is locked while any phase before it still has open work; a locked phase refuses
// completion-type transitions and nothing else; the only way through is a recorded, authorised
// override; and none of it ever writes a status by hand — the derivation stays the only writer.

import { beforeEach, afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/permissions";
import { NotFoundError, ServiceError } from "@/server/errors";
import {
  createPhase,
  deletePhase,
  listPhasesForProject,
  overridePhaseLock,
  renamePhase,
  reorderPhases,
} from "@/server/services/phases";
import { createProject } from "@/server/services/projects";
import {
  completeDisciplineTask,
  createDisciplineTask,
  createMainTask,
  getMainTaskForActor,
  overrideMainTaskStatus,
  reopenDisciplineTask,
  setMainTaskPhase,
  updateDisciplineTaskStatus,
  updateMainTask,
} from "@/server/services/tasks";
import { createComment } from "@/server/services/comments";
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

/** Three phases in gate order on the fixture's project. */
async function makePhases(names = ["Foundations", "Structure", "Fit-out"]) {
  const phases = [];
  for (const name of names) {
    phases.push(await createPhase(fixture.adminActor, { projectId: fixture.projectId, name }));
  }
  return phases;
}

/** One main task in a phase (or in none), with one mandatory discipline task assigned to the engineer. */
async function makeTask(phaseId: string | null, title: string) {
  const mainTask = await createMainTask(fixture.adminActor, {
    projectId: fixture.projectId,
    phaseId,
    title,
    description: "Work for the gate tests.",
    priority: "MEDIUM",
    deadline: inThirtyDays(),
    disciplineTasks: [
      {
        disciplineId: fixture.disciplineId,
        title: `${title} — mechanical`,
        assigneeId: fixture.engineerActor.userId,
        deadline: inThirtyDays(),
        isMandatory: true,
        requiredDocuments: [],
      },
    ],
  });
  const subtaskId = (await subtaskIdsByTitle(mainTask.id)).get(`${title} — mechanical`) as string;
  return { mainTask, subtaskId };
}

const phaseById = async (id: string) => prisma.projectPhase.findUniqueOrThrow({ where: { id } });

describe("which phases are locked", () => {
  it("leaves the first phase open and shuts the ones behind it", async () => {
    const [first, second, third] = await makePhases();
    await makeTask(first.id, "Piling");

    const phases = await listPhasesForProject(fixture.adminActor, fixture.projectId);
    const byId = new Map(phases.map((phase) => [phase.id, phase]));

    expect(byId.get(first.id)?.locked).toBe(false);
    expect(byId.get(second.id)?.locked).toBe(true);
    expect(byId.get(third.id)?.locked).toBe(true);
    expect(byId.get(second.id)?.lockedByPhaseName).toBe("Foundations");
  });

  it("opens the next gate once the phase before it is complete", async () => {
    const [first, second] = await makePhases();
    const { subtaskId } = await makeTask(first.id, "Piling");
    await makeTask(second.id, "Steel erection");

    await completeDisciplineTask(fixture.engineerActor, { id: subtaskId });

    const phases = await listPhasesForProject(fixture.adminActor, fixture.projectId);
    expect(phases.find((phase) => phase.id === second.id)?.locked).toBe(false);
  });

  it("counts a main task completed by an authorised override as complete", async () => {
    const [first, second] = await makePhases();
    const { mainTask } = await makeTask(first.id, "Piling");

    await overrideMainTaskStatus(fixture.pmActor, {
      id: mainTask.id,
      status: "COMPLETED",
      reason: "Piling closed under site instruction 44",
    });

    const phases = await listPhasesForProject(fixture.adminActor, fixture.projectId);
    expect(phases.find((phase) => phase.id === second.id)?.locked).toBe(false);
  });

  it("reports each phase's own progress", async () => {
    const [first] = await makePhases();
    const one = await makeTask(first.id, "Piling");
    await makeTask(first.id, "Blinding");

    await completeDisciplineTask(fixture.engineerActor, { id: one.subtaskId });

    const phases = await listPhasesForProject(fixture.adminActor, fixture.projectId);
    const feed = phases.find((phase) => phase.id === first.id);
    expect(feed?.taskCount).toBe(2);
    expect(feed?.completedCount).toBe(1);
  });
});

describe("what a locked phase refuses", () => {
  it("refuses a discipline-task status change, in the phase's own words", async () => {
    const [first, second] = await makePhases(["Foundations", "Construction"]);
    await makeTask(first.id, "Piling");
    const later = await makeTask(second.id, "Pipe rack erection");

    await expect(
      updateDisciplineTaskStatus(fixture.engineerActor, {
        id: later.subtaskId,
        status: "IN_PROGRESS",
      }),
    ).rejects.toThrow(
      "This task is in the 'Construction' phase, which is locked until 'Foundations' is complete. " +
        "An administrator or project manager can override the gate.",
    );

    const untouched = await prisma.disciplineTask.findUniqueOrThrow({ where: { id: later.subtaskId } });
    expect(untouched.status).toBe("NOT_STARTED");
  });

  it("refuses a completion and a reopen under the gate", async () => {
    const [first, second] = await makePhases();
    await makeTask(first.id, "Piling");
    const later = await makeTask(second.id, "Steel erection");

    await expect(
      completeDisciplineTask(fixture.engineerActor, { id: later.subtaskId }),
    ).rejects.toBeInstanceOf(ServiceError);

    // Reopening is a transition too. Put the task in COMPLETED behind the service's back so the
    // refusal is the phase's, not "that task is not complete".
    await prisma.disciplineTask.update({
      where: { id: later.subtaskId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    await expect(
      reopenDisciplineTask(fixture.pmActor, { id: later.subtaskId, reason: "Wrong sign-off" }),
    ).rejects.toBeInstanceOf(ServiceError);
  });

  it("refuses a main-task status override inside a locked phase", async () => {
    const [first, second] = await makePhases();
    await makeTask(first.id, "Piling");
    const later = await makeTask(second.id, "Steel erection");

    await expect(
      overrideMainTaskStatus(fixture.pmActor, {
        id: later.mainTask.id,
        status: "COMPLETED",
        reason: "Trying to step around the gate",
      }),
    ).rejects.toBeInstanceOf(ServiceError);

    const untouched = await prisma.mainTask.findUniqueOrThrow({ where: { id: later.mainTask.id } });
    expect(untouched.statusOverride).toBeNull();
  });

  it("still allows the work to be prepared: editing, adding, assigning, commenting", async () => {
    const [first, second] = await makePhases();
    await makeTask(first.id, "Piling");
    const later = await makeTask(second.id, "Steel erection");

    const edited = await updateMainTask(fixture.pmActor, {
      id: later.mainTask.id,
      title: "Steel erection — package B",
    });
    expect(edited.title).toBe("Steel erection — package B");

    const added = await createDisciplineTask(fixture.pmActor, {
      mainTaskId: later.mainTask.id,
      disciplineId: fixture.disciplineId,
      title: "Bolt torque records",
      assigneeId: fixture.engineerActor.userId,
      deadline: inThirtyDays(),
      priority: "MEDIUM",
      isMandatory: true,
      requiredDocuments: [],
    });
    expect(added.assigneeName).toBe("John Carter");

    const comment = await createComment(fixture.engineerActor, {
      mainTaskId: later.mainTask.id,
      body: "Ready to start as soon as the gate opens.",
      mentions: [],
    });
    expect(comment.id).toBeTruthy();
  });

  it("never gates an unphased task, even while every phase is shut", async () => {
    const [first] = await makePhases();
    await makeTask(first.id, "Piling");
    const loose = await makeTask(null, "Site survey");

    const moved = await updateDisciplineTaskStatus(fixture.engineerActor, {
      id: loose.subtaskId,
      status: "IN_PROGRESS",
    });
    expect(moved.status).toBe("IN_PROGRESS");
  });

  it("gates nothing at all on a project with no phases", async () => {
    const { subtaskId } = await makeTask(null, "Site survey");
    const done = await completeDisciplineTask(fixture.engineerActor, { id: subtaskId });
    expect(done.status).toBe("COMPLETED");
  });
});

describe("the recorded override — the only way through a shut gate", () => {
  it("opens the phase, records who, why and when, and writes the audit row", async () => {
    const [first, second] = await makePhases();
    await makeTask(first.id, "Piling");
    const later = await makeTask(second.id, "Steel erection");

    const opened = await overridePhaseLock(fixture.pmActor, {
      id: second.id,
      reason: "Client instruction to start steel early",
    });

    expect(opened.locked).toBe(false);
    expect(opened.overridden).toBe(true);
    expect(opened.overriddenByName).toBe("Layla al-Riyami");

    const row = await phaseById(second.id);
    expect(row.overriddenById).toBe(fixture.pmActor.userId);
    expect(row.overrideReason).toBe("Client instruction to start steel early");
    expect(row.overriddenAt).toBeInstanceOf(Date);

    const audit = await prisma.activityLog.count({
      where: { entityId: second.id, action: "PHASE_OVERRIDE_APPLIED" },
    });
    expect(audit).toBe(1);

    // And the work under it moves again, through the ordinary derivation.
    const moved = await completeDisciplineTask(fixture.engineerActor, { id: later.subtaskId });
    expect(moved.status).toBe("COMPLETED");
    const parent = await prisma.mainTask.findUniqueOrThrow({ where: { id: later.mainTask.id } });
    expect(parent.status).toBe("COMPLETED");
    expect(parent.progressPct).toBe(100);
  });

  it("tells the rest of the project that a gate was opened", async () => {
    const [first, second] = await makePhases();
    await makeTask(first.id, "Piling");
    await makeTask(second.id, "Steel erection");

    await overridePhaseLock(fixture.pmActor, {
      id: second.id,
      reason: "Client instruction to start steel early",
    });

    // Same shape as a main-task status override: OVERRIDE_APPLIED, to everyone on the project
    // except the person who did it, written after the transaction committed.
    const notifications = await prisma.notification.findMany({
      where: { type: "OVERRIDE_APPLIED" },
      select: { userId: true, title: true, body: true, linkUrl: true },
    });

    expect(notifications.length).toBeGreaterThan(0);
    expect(notifications.map((row) => row.userId)).not.toContain(fixture.pmActor.userId);
    expect(notifications.map((row) => row.userId).sort()).toEqual(
      [fixture.adminActor.userId, fixture.engineerActor.userId].sort(),
    );
    expect(notifications[0].title).toBe("A locked phase was opened");
    expect(notifications[0].body).toContain("Structure");
    expect(notifications[0].body).toContain("Client instruction to start steel early");
    expect(notifications[0].linkUrl).toBe(`/projects/${fixture.projectId}`);
  });

  it("insists on a reason of at least five characters", async () => {
    const [, second] = await makePhases();

    await expect(
      overridePhaseLock(fixture.adminActor, { id: second.id, reason: "why" }),
    ).rejects.toBeInstanceOf(ServiceError);

    const row = await phaseById(second.id);
    expect(row.overriddenById).toBeNull();
  });

  it("is refused to an engineer and to a discipline lead", async () => {
    const [, second] = await makePhases();

    await expect(
      overridePhaseLock(fixture.engineerActor, {
        id: second.id,
        reason: "I would like to get on with it",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const row = await phaseById(second.id);
    expect(row.overriddenById).toBeNull();
  });

  it("refuses a second override on a phase that is already open", async () => {
    const [, second] = await makePhases();
    await overridePhaseLock(fixture.pmActor, { id: second.id, reason: "Client instruction" });

    await expect(
      overridePhaseLock(fixture.pmActor, { id: second.id, reason: "Client instruction again" }),
    ).rejects.toBeInstanceOf(ServiceError);
  });
});

describe("managing the phases themselves", () => {
  it("gives a brand-new project the phases of its company's industry template", async () => {
    const project = await createProject(fixture.adminActor, {
      name: "Second train",
      code: "T2",
      description: "A new project, gated from the start.",
      disciplineIds: [],
      members: [],
    });

    const phases = await listPhasesForProject(fixture.adminActor, project.id);
    expect(phases.map((phase) => phase.name)).toEqual([
      "FEED",
      "Detail design",
      "Procurement",
      "Construction",
      "Commissioning",
    ]);
    // Nothing is in them yet, so nothing is locked.
    expect(phases.every((phase) => !phase.locked)).toBe(true);
  });

  it("leaves a project made before phases existed with none, and gates nothing", async () => {
    expect(await listPhasesForProject(fixture.adminActor, fixture.projectId)).toEqual([]);
  });

  it("refuses two phases with the same name on one project", async () => {
    await createPhase(fixture.adminActor, { projectId: fixture.projectId, name: "Foundations" });
    await expect(
      createPhase(fixture.adminActor, { projectId: fixture.projectId, name: "Foundations" }),
    ).rejects.toBeInstanceOf(ServiceError);
  });

  it("renames a phase and keeps the gate where it was", async () => {
    const [first, second] = await makePhases();
    await makeTask(first.id, "Piling");

    const renamed = await renamePhase(fixture.pmActor, { id: second.id, name: "Steelwork" });
    expect(renamed.name).toBe("Steelwork");
    expect(renamed.locked).toBe(true);
  });

  it("reorders the phases, and the gates follow the new order", async () => {
    const [first, second, third] = await makePhases();
    await makeTask(second.id, "Steel erection");

    // Structure moves to the front: it is now the first gate, so nothing locks it.
    await reorderPhases(fixture.pmActor, {
      projectId: fixture.projectId,
      phaseIds: [second.id, first.id, third.id],
    });

    const phases = await listPhasesForProject(fixture.adminActor, fixture.projectId);
    expect(phases.map((phase) => phase.name)).toEqual(["Structure", "Foundations", "Fit-out"]);
    expect(phases[0].locked).toBe(false);
    expect(phases[1].locked).toBe(true);
  });

  it("records in the audit trail which gates a reorder moved", async () => {
    const [first, second, third] = await makePhases();
    await makeTask(second.id, "Steel erection");

    // Foundations was empty and gated nothing, so Structure was already open. Moving Structure —
    // which has open work — in front of Foundations shuts the gate on Foundations instead.
    await reorderPhases(fixture.pmActor, {
      projectId: fixture.projectId,
      phaseIds: [second.id, first.id, third.id],
    });

    const row = await prisma.activityLog.findFirstOrThrow({
      where: { projectId: fixture.projectId, action: "PHASES_REORDERED" },
      orderBy: { createdAt: "desc" },
    });
    expect(row.summary).toContain("Structure → Foundations → Fit-out");
    expect(row.summary).toContain("this closed the 'Foundations' gate");
    expect(JSON.stringify(row.metadata)).toContain('"to":"locked"');

    const phases = await listPhasesForProject(fixture.adminActor, fixture.projectId);
    expect(phases.find((phase) => phase.name === "Foundations")?.locked).toBe(true);
  });

  it("refuses a partial or invented order", async () => {
    const [first, second, third] = await makePhases();

    await expect(
      reorderPhases(fixture.pmActor, { projectId: fixture.projectId, phaseIds: [first.id, second.id] }),
    ).rejects.toBeInstanceOf(ServiceError);
    await expect(
      reorderPhases(fixture.pmActor, {
        projectId: fixture.projectId,
        phaseIds: [first.id, second.id, third.id, third.id],
      }),
    ).rejects.toBeInstanceOf(ServiceError);

    const unchanged = await listPhasesForProject(fixture.adminActor, fixture.projectId);
    expect(unchanged.map((phase) => phase.name)).toEqual(["Foundations", "Structure", "Fit-out"]);
  });

  it("deletes a phase only while it is empty, and says so in plain English", async () => {
    const [first, second] = await makePhases();
    const { mainTask } = await makeTask(second.id, "Steel erection");

    await expect(deletePhase(fixture.pmActor, { id: second.id })).rejects.toThrow(
      /still holds 1 main task/,
    );

    // Move the work out and the phase goes.
    await setMainTaskPhase(fixture.pmActor, { id: mainTask.id, phaseId: null });
    expect(await deletePhase(fixture.pmActor, { id: second.id })).toEqual({ removed: true });
    expect(await prisma.projectPhase.count({ where: { projectId: fixture.projectId } })).toBe(2);
    expect(first.id).toBeTruthy();
  });

  it("lets an engineer look at the phases but not change them", async () => {
    const [first] = await makePhases();

    expect((await listPhasesForProject(fixture.engineerActor, fixture.projectId)).length).toBe(3);
    await expect(
      createPhase(fixture.engineerActor, { projectId: fixture.projectId, name: "Extra" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      renamePhase(fixture.engineerActor, { id: first.id, name: "Mine now" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("moving work between phases", () => {
  it("moves a main task into a LOCKED phase — planning ahead is allowed", async () => {
    const [first, second] = await makePhases();
    await makeTask(first.id, "Piling");
    const loose = await makeTask(null, "Cladding");

    const moved = await setMainTaskPhase(fixture.pmActor, {
      id: loose.mainTask.id,
      phaseId: second.id,
    });
    expect(moved.phaseId).toBe(second.id);
    expect(moved.phaseName).toBe("Structure");

    // But completing it there is still refused.
    await expect(
      completeDisciplineTask(fixture.engineerActor, { id: loose.subtaskId }),
    ).rejects.toBeInstanceOf(ServiceError);
  });

  it("writes an audit row for the move, and takes a task back out of every phase", async () => {
    const [first] = await makePhases();
    const { mainTask } = await makeTask(first.id, "Piling");

    const out = await setMainTaskPhase(fixture.pmActor, { id: mainTask.id, phaseId: null });
    expect(out.phaseId).toBeNull();

    const audit = await prisma.activityLog.count({
      where: { entityId: mainTask.id, action: "MAIN_TASK_PHASE_CHANGED" },
    });
    expect(audit).toBe(1);

    const shown = await getMainTaskForActor(fixture.adminActor, mainTask.id);
    expect(shown.phaseName).toBeNull();
  });

  it("records in the audit trail which gates a move opened or shut", async () => {
    const [first, second] = await makePhases();
    const piling = await makeTask(first.id, "Piling");
    await makeTask(second.id, "Steel erection");

    // Taking the only unfinished task out of Foundations opens the gate on Structure for everybody.
    await setMainTaskPhase(fixture.pmActor, { id: piling.mainTask.id, phaseId: null });
    const out = await prisma.activityLog.findFirstOrThrow({
      where: { entityId: piling.mainTask.id, action: "MAIN_TASK_PHASE_CHANGED" },
      orderBy: { createdAt: "desc" },
    });
    expect(out.summary).toContain("this opened the 'Structure' gate");
    expect(JSON.stringify(out.metadata)).toContain('"to":"open"');

    // Finish it outside the gates, then put it back: nothing is open in Foundations any more, so
    // the move back changes no gate and the summary says nothing it cannot prove.
    await completeDisciplineTask(fixture.engineerActor, { id: piling.subtaskId });
    await setMainTaskPhase(fixture.pmActor, { id: piling.mainTask.id, phaseId: first.id });
    const back = await prisma.activityLog.findFirstOrThrow({
      where: { entityId: piling.mainTask.id, action: "MAIN_TASK_PHASE_CHANGED" },
      orderBy: { createdAt: "desc" },
    });
    expect(back.summary).toContain('into the phase "Foundations"');
    expect(back.summary).not.toContain("gate");

    const phases = await listPhasesForProject(fixture.adminActor, fixture.projectId);
    expect(phases.find((phase) => phase.id === second.id)?.locked).toBe(false);
  });

  it("records the gate that shuts when unfinished work moves into an earlier phase", async () => {
    const [first, second] = await makePhases();
    const loose = await makeTask(null, "Cladding");
    await makeTask(second.id, "Steel erection");

    // Foundations was empty and gated nothing; open work arriving in it shuts Structure.
    await setMainTaskPhase(fixture.pmActor, { id: loose.mainTask.id, phaseId: first.id });

    const row = await prisma.activityLog.findFirstOrThrow({
      where: { entityId: loose.mainTask.id, action: "MAIN_TASK_PHASE_CHANGED" },
      orderBy: { createdAt: "desc" },
    });
    expect(row.summary).toContain("this closed the 'Structure' gate");
  });

  it("refuses a phase that belongs to another project", async () => {
    const other = await createProject(fixture.adminActor, {
      name: "Another project",
      code: "OTHER-1",
      description: "A second project in the same company.",
      disciplineIds: [],
      members: [],
    });
    const theirs = await createPhase(fixture.adminActor, {
      projectId: other.id,
      name: "Their phase",
    });
    const { mainTask } = await makeTask(null, "Cladding");

    await expect(
      setMainTaskPhase(fixture.pmActor, { id: mainTask.id, phaseId: theirs.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
