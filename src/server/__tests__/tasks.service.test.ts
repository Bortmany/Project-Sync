// Service-level tests for the golden rule, run against DATABASE_URL_TEST with a clean database each time.
//
// A main task's status and progress are always the truth of its discipline tasks; completion can never
// bypass a mandatory document or an open dependency; the only bypass is a recorded, authorised override;
// and nobody sees a project they are not on.

import { beforeEach, afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/permissions";
import { ServiceError } from "@/server/errors";
import { getProjectForActor } from "@/server/services/projects";
import {
  addDependency,
  buildMainTaskDTO,
  completeDisciplineTask,
  createMainTask,
  overrideMainTaskStatus,
  reopenDisciplineTask,
  updateDisciplineTaskStatus,
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

/** A main task with `count` discipline tasks, all assigned to the engineer. */
async function makeMainTask(count: number, titles?: string[]) {
  return createMainTask(fixture.adminActor, {
    projectId: fixture.projectId,
    title: "Complete design review",
    description: "The test main task.",
    priority: "MEDIUM",
    deadline: inThirtyDays(),
    disciplineTasks: Array.from({ length: count }, (_, index) => ({
      disciplineId: fixture.disciplineId,
      title: titles?.[index] ?? `Discipline task ${index + 1}`,
      assigneeId: fixture.engineerActor.userId,
      deadline: inThirtyDays(),
      isMandatory: true,
      requiredDocuments: [],
    })),
  });
}

describe("the main task always tells the truth of its discipline tasks", () => {
  it("recalculates progress and status when a discipline task is completed", async () => {
    const mainTask = await makeMainTask(4);
    expect(mainTask.progressPct).toBe(0);
    expect(mainTask.status).toBe("NOT_STARTED");

    const subtasks = await subtaskIdsByTitle(mainTask.id);
    await completeDisciplineTask(fixture.engineerActor, {
      id: subtasks.get("Discipline task 1") as string,
    });

    const after = await prisma.mainTask.findUniqueOrThrow({ where: { id: mainTask.id } });
    expect(after.progressPct).toBe(25);
    expect(after.status).toBe("IN_PROGRESS");
  });

  it("reaches 100% and COMPLETED only when every discipline task is done", async () => {
    const mainTask = await makeMainTask(2);
    const subtasks = await subtaskIdsByTitle(mainTask.id);

    for (const id of subtasks.values()) {
      await completeDisciplineTask(fixture.engineerActor, { id });
    }

    const after = await prisma.mainTask.findUniqueOrThrow({ where: { id: mainTask.id } });
    expect(after.progressPct).toBe(100);
    expect(after.status).toBe("COMPLETED");
  });
});

describe("the completion gate", () => {
  it("refuses a completion while a mandatory required document is missing", async () => {
    const mainTask = await makeMainTask(2);
    const subtasks = await subtaskIdsByTitle(mainTask.id);
    const taskId = subtasks.get("Discipline task 1") as string;

    await prisma.requiredDocument.create({
      data: { disciplineTaskId: taskId, name: "Foundation load calculation report", isMandatory: true },
    });

    await expect(completeDisciplineTask(fixture.engineerActor, { id: taskId })).rejects.toBeInstanceOf(
      ServiceError,
    );
    await expect(completeDisciplineTask(fixture.engineerActor, { id: taskId })).rejects.toThrow(
      /required document/i,
    );

    const task = await prisma.disciplineTask.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.status).toBe("NOT_STARTED");
    expect(task.completedAt).toBeNull();

    const parent = await prisma.mainTask.findUniqueOrThrow({ where: { id: mainTask.id } });
    expect(parent.progressPct).toBe(0);
  });

  it("allows a completion when the outstanding document is optional", async () => {
    const mainTask = await makeMainTask(2);
    const subtasks = await subtaskIdsByTitle(mainTask.id);
    const taskId = subtasks.get("Discipline task 1") as string;

    await prisma.requiredDocument.create({
      data: { disciplineTaskId: taskId, name: "Site photographs", isMandatory: false },
    });

    const completed = await completeDisciplineTask(fixture.engineerActor, { id: taskId });
    expect(completed.status).toBe("COMPLETED");
    expect(completed.completedAt).not.toBeNull();
  });

  it("refuses a completion while an earlier task is still open, and says which one", async () => {
    const mainTask = await makeMainTask(2, ["Process walkdown", "Mechanical walkdown"]);
    const subtasks = await subtaskIdsByTitle(mainTask.id);
    const first = subtasks.get("Process walkdown") as string;
    const second = subtasks.get("Mechanical walkdown") as string;

    await addDependency(fixture.adminActor, { predecessorId: first, successorId: second });

    await expect(completeDisciplineTask(fixture.engineerActor, { id: second })).rejects.toThrow(
      /Process walkdown/,
    );
  });
});

describe("the dependency rule", () => {
  it("will not let a task start while the work it waits on is open", async () => {
    const mainTask = await makeMainTask(2, ["Process walkdown", "Mechanical walkdown"]);
    const subtasks = await subtaskIdsByTitle(mainTask.id);
    const first = subtasks.get("Process walkdown") as string;
    const second = subtasks.get("Mechanical walkdown") as string;

    await addDependency(fixture.adminActor, { predecessorId: first, successorId: second });

    await expect(
      updateDisciplineTaskStatus(fixture.engineerActor, { id: second, status: "IN_PROGRESS" }),
    ).rejects.toThrow(/waiting on earlier work/i);

    // Once the earlier task is complete, the later one moves freely.
    await completeDisciplineTask(fixture.engineerActor, { id: first });
    const moved = await updateDisciplineTaskStatus(fixture.engineerActor, {
      id: second,
      status: "IN_PROGRESS",
    });
    expect(moved.status).toBe("IN_PROGRESS");
  });

  it("refuses a dependency that would make two tasks wait on each other", async () => {
    const mainTask = await makeMainTask(2, ["First", "Second"]);
    const subtasks = await subtaskIdsByTitle(mainTask.id);
    const first = subtasks.get("First") as string;
    const second = subtasks.get("Second") as string;

    await addDependency(fixture.adminActor, { predecessorId: first, successorId: second });
    await expect(
      addDependency(fixture.adminActor, { predecessorId: second, successorId: first }),
    ).rejects.toThrow(/wait on each other/i);
  });

  it("refuses a loop that closes several steps later, and adds no edge", async () => {
    const mainTask = await makeMainTask(4, ["A", "B", "C", "D"]);
    const subtasks = await subtaskIdsByTitle(mainTask.id);
    const id = (title: string) => subtasks.get(title) as string;

    // A → B → C → D, then D → A would close the ring.
    await addDependency(fixture.adminActor, { predecessorId: id("A"), successorId: id("B") });
    await addDependency(fixture.adminActor, { predecessorId: id("B"), successorId: id("C") });
    await addDependency(fixture.adminActor, { predecessorId: id("C"), successorId: id("D") });

    await expect(
      addDependency(fixture.adminActor, { predecessorId: id("D"), successorId: id("A") }),
    ).rejects.toThrow(/wait on each other/i);

    expect(await prisma.taskDependency.count()).toBe(3);
    expect(
      await prisma.activityLog.count({
        where: { entityId: id("A"), action: "DEPENDENCY_ADDED" },
      }),
    ).toBe(0);

    // A branch that joins the chain without closing it is still fine.
    const extra = await addDependency(fixture.adminActor, {
      predecessorId: id("A"),
      successorId: id("D"),
    });
    expect(extra.dependencies.map((dependency) => dependency.title).sort()).toEqual(["A", "C"]);
  });

  it("refuses a task that waits on itself", async () => {
    const mainTask = await makeMainTask(1, ["Only task"]);
    const only = (await subtaskIdsByTitle(mainTask.id)).get("Only task") as string;

    await expect(
      addDependency(fixture.adminActor, { predecessorId: only, successorId: only }),
    ).rejects.toThrow(/wait on itself/i);
    expect(await prisma.taskDependency.count()).toBe(0);
  });
});

describe("the override — the only legal bypass", () => {
  it("is refused for an engineer", async () => {
    const mainTask = await makeMainTask(2);

    await expect(
      overrideMainTaskStatus(fixture.engineerActor, {
        id: mainTask.id,
        status: "COMPLETED",
        reason: "Remaining action transferred to operations MOC-1182",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const untouched = await prisma.mainTask.findUniqueOrThrow({ where: { id: mainTask.id } });
    expect(untouched.statusOverride).toBeNull();
  });

  it("records who, why and when for a project manager, and writes an audit row", async () => {
    const mainTask = await makeMainTask(2);
    const reason = "Remaining action transferred to operations MOC-1182";

    const overridden = await overrideMainTaskStatus(fixture.pmActor, {
      id: mainTask.id,
      status: "COMPLETED",
      reason,
    });

    expect(overridden.effectiveStatus).toBe("COMPLETED");
    // The derived status underneath is untouched — the override sits on top of it.
    expect(overridden.status).toBe("NOT_STARTED");
    expect(overridden.overrideReason).toBe(reason);
    expect(overridden.overriddenByName).toBe("Layla al-Riyami");
    expect(overridden.overriddenAt).not.toBeNull();

    const audit = await prisma.activityLog.findMany({
      where: { entityId: mainTask.id, action: "OVERRIDE_APPLIED" },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0].summary).toContain(reason);
    expect(audit[0].actorId).toBe(fixture.pmActor.userId);
  });

  it("refuses an override without a real reason", async () => {
    const mainTask = await makeMainTask(1);
    await expect(
      overrideMainTaskStatus(fixture.pmActor, { id: mainTask.id, status: "COMPLETED", reason: "ok" }),
    ).rejects.toBeInstanceOf(ServiceError);
  });
});

describe("project scoping", () => {
  it("does not let someone who is not on a project read it", async () => {
    await expect(getProjectForActor(fixture.outsiderActor, fixture.projectId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("lets a member and an administrator read it", async () => {
    const asEngineer = await getProjectForActor(fixture.engineerActor, fixture.projectId);
    const asAdmin = await getProjectForActor(fixture.adminActor, fixture.projectId);
    expect(asEngineer.id).toBe(fixture.projectId);
    expect(asAdmin.members).toHaveLength(3);
  });
});

describe("the audit trail", () => {
  it("writes a row for every step of a task's life", async () => {
    const mainTask = await makeMainTask(2);
    const subtasks = await subtaskIdsByTitle(mainTask.id);
    const taskId = subtasks.get("Discipline task 1") as string;

    await updateDisciplineTaskStatus(fixture.engineerActor, { id: taskId, status: "IN_PROGRESS" });
    await completeDisciplineTask(fixture.engineerActor, { id: taskId });

    const rows = await prisma.activityLog.findMany({
      where: { projectId: fixture.projectId },
      orderBy: { createdAt: "asc" },
    });
    const actions = rows.map((row) => row.action);

    expect(actions).toContain("MAIN_TASK_CREATED");
    expect(actions).toContain("TASK_CREATED");
    expect(actions).toContain("STATUS_CHANGED");
    expect(actions).toContain("COMPLETED");
    expect(rows.some((row) => row.summary.includes("John Carter"))).toBe(true);
  });

  it("appends exactly one row for each core mutation — never two, never none", async () => {
    const mainTask = await makeMainTask(2, ["First", "Second"]);
    const subtasks = await subtaskIdsByTitle(mainTask.id);
    const first = subtasks.get("First") as string;

    const rowsFor = (entityId: string, action: string) =>
      prisma.activityLog.count({ where: { entityId, action } });

    expect(await rowsFor(mainTask.id, "MAIN_TASK_CREATED")).toBe(1);
    expect(await rowsFor(first, "TASK_CREATED")).toBe(1);

    await updateDisciplineTaskStatus(fixture.engineerActor, { id: first, status: "IN_PROGRESS" });
    expect(await rowsFor(first, "STATUS_CHANGED")).toBe(1);

    await completeDisciplineTask(fixture.engineerActor, { id: first });
    expect(await rowsFor(first, "COMPLETED")).toBe(1);

    await overrideMainTaskStatus(fixture.pmActor, {
      id: mainTask.id,
      status: "COMPLETED",
      reason: "Remaining action transferred to operations MOC-1182",
    });
    expect(await rowsFor(mainTask.id, "OVERRIDE_APPLIED")).toBe(1);

    // The main task's own derivation rows are separate entries on the parent: one per real change,
    // and none at all when a change leaves the derived values where they were.
    const derived = await prisma.activityLog.findMany({
      where: { entityId: mainTask.id, action: "STATUS_CHANGED" },
      orderBy: { createdAt: "asc" },
    });
    expect(derived).toHaveLength(2);
    expect(derived.map((row) => (row.metadata as { after: { progressPct: number } }).after.progressPct)).toEqual([
      0, 50,
    ]);
    expect(derived.every((row) => (row.metadata as { derived?: boolean }).derived === true)).toBe(true);
  });

  it("keeps every audit row exactly as written — a later change never edits an earlier row", async () => {
    const mainTask = await makeMainTask(2, ["First", "Second"]);
    const subtasks = await subtaskIdsByTitle(mainTask.id);

    const before = await prisma.activityLog.findMany({ orderBy: { createdAt: "asc" } });
    expect(before.length).toBeGreaterThan(0);

    for (const id of subtasks.values()) {
      await completeDisciplineTask(fixture.engineerActor, { id });
    }
    await reopenDisciplineTask(fixture.adminActor, {
      id: subtasks.get("First") as string,
      reason: "The load calculation was superseded.",
    });

    const after = await prisma.activityLog.findMany({
      where: { id: { in: before.map((row) => row.id) } },
      orderBy: { createdAt: "asc" },
    });

    // Same rows, same contents, nothing removed.
    expect(after).toEqual(before);
  });
});

describe("the discipline rows count the documents the completion gate waits for", () => {
  /** A real document on this discipline task, then attached to the requirement it satisfies. */
  async function satisfy(requirementId: string, disciplineTaskId: string) {
    const document = await prisma.document.create({
      data: {
        projectId: fixture.projectId,
        disciplineTaskId,
        title: "Foundation load calculation report",
        uploadedById: fixture.engineerActor.userId,
      },
    });
    await prisma.requiredDocument.update({
      where: { id: requirementId },
      data: { documentId: document.id, satisfiedAt: new Date() },
    });
  }

  it("counts mandatory documents only, satisfied against total", async () => {
    const mainTask = await makeMainTask(2, ["With documents", "Without documents"]);
    const subtasks = await subtaskIdsByTitle(mainTask.id);
    const withDocs = subtasks.get("With documents") as string;

    const first = await prisma.requiredDocument.create({
      data: { disciplineTaskId: withDocs, name: "Load calculation", isMandatory: true },
    });
    await prisma.requiredDocument.create({
      data: { disciplineTaskId: withDocs, name: "Stress report", isMandatory: true },
    });
    // Optional documents are never part of the count: the gate never waits for them.
    await prisma.requiredDocument.create({
      data: { disciplineTaskId: withDocs, name: "Site photographs", isMandatory: false },
    });
    await satisfy(first.id, withDocs);

    const dto = await buildMainTaskDTO(mainTask.id);
    const counted = dto.disciplineSummary.find((item) => item.disciplineTaskId === withDocs);
    expect(counted?.requiredDocsSatisfied).toBe(1);
    expect(counted?.requiredDocsTotal).toBe(2);

    // A task with no required documents at all reads as zero, not as missing.
    const none = dto.disciplineSummary.find(
      (item) => item.disciplineTaskId === subtasks.get("Without documents"),
    );
    expect(none?.requiredDocsSatisfied).toBe(0);
    expect(none?.requiredDocsTotal).toBe(0);
  });

  it("never counts an optional document, even when it is satisfied", async () => {
    const mainTask = await makeMainTask(1, ["Optional only"]);
    const subtasks = await subtaskIdsByTitle(mainTask.id);
    const taskId = subtasks.get("Optional only") as string;

    const optional = await prisma.requiredDocument.create({
      data: { disciplineTaskId: taskId, name: "Site photographs", isMandatory: false },
    });
    await satisfy(optional.id, taskId);

    const dto = await buildMainTaskDTO(mainTask.id);
    const counted = dto.disciplineSummary[0];
    expect(counted.requiredDocsTotal).toBe(0);
    expect(counted.requiredDocsSatisfied).toBe(0);

    // And the count agrees with the gate: nothing mandatory is missing, so this can be completed.
    const completed = await completeDisciplineTask(fixture.engineerActor, { id: taskId });
    expect(completed.status).toBe("COMPLETED");
  });
});
