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
  completeDisciplineTask,
  createMainTask,
  overrideMainTaskStatus,
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
});
