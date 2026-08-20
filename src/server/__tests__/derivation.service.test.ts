// The golden rule proved end to end, through the services, not through the pure function.
//
// src/lib/__tests__/progress.test.ts proves deriveMainTask() in isolation. This file proves the
// same rules survive the round trip: a real transaction writes the cached MainTask.status and
// progressPct, a real DTO is built from the row, and the only thing that ever moves those two
// fields is a discipline task changing (or an authorised override sitting on top of them).

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ServiceError } from "@/server/errors";
import {
  clearOverride,
  completeDisciplineTask,
  createMainTask,
  getMainTaskForActor,
  listMainTasksForProject,
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

const DAY_MS = 24 * 60 * 60 * 1000;

type SubtaskSpec = { title: string; isMandatory?: boolean };

/** A main task with exactly the discipline tasks described, all assigned to the engineer. */
async function makeWork(subtasks: SubtaskSpec[], deadline: Date = inThirtyDays()) {
  const mainTask = await createMainTask(fixture.adminActor, {
    projectId: fixture.projectId,
    title: "Complete design review",
    description: "The test main task.",
    priority: "MEDIUM",
    deadline,
    disciplineTasks: subtasks.map((subtask) => ({
      disciplineId: fixture.disciplineId,
      title: subtask.title,
      assigneeId: fixture.engineerActor.userId,
      deadline,
      isMandatory: subtask.isMandatory ?? true,
      requiredDocuments: [],
    })),
  });
  return { mainTask, ids: await subtaskIdsByTitle(mainTask.id) };
}

/** The cached row, which is the value the whole app reads. */
async function cached(mainTaskId: string) {
  const row = await prisma.mainTask.findUniqueOrThrow({ where: { id: mainTaskId } });
  return { status: row.status, progressPct: row.progressPct, statusOverride: row.statusOverride };
}

const FIVE: SubtaskSpec[] = [1, 2, 3, 4, 5].map((n) => ({ title: `Task ${n}` }));

describe("progress is the truth of the discipline tasks", () => {
  it("shows three of five finished as 60 per cent and in progress", async () => {
    const { mainTask, ids } = await makeWork(FIVE);

    for (const title of ["Task 1", "Task 2", "Task 3"]) {
      await completeDisciplineTask(fixture.engineerActor, { id: ids.get(title) as string });
    }

    expect(await cached(mainTask.id)).toMatchObject({ progressPct: 60, status: "IN_PROGRESS" });

    const dto = await getMainTaskForActor(fixture.engineerActor, mainTask.id);
    expect(dto.progressPct).toBe(60);
    expect(dto.effectiveStatus).toBe("IN_PROGRESS");
    expect(dto.counts).toMatchObject({ disciplineTasks: 5, completed: 3 });
  });

  it("will not reach COMPLETED while a mandatory discipline task is still open", async () => {
    const { mainTask, ids } = await makeWork([
      { title: "Optional walkdown", isMandatory: false },
      { title: "Optional photographs", isMandatory: false },
      { title: "Mandatory load check", isMandatory: true },
    ]);

    await completeDisciplineTask(fixture.engineerActor, { id: ids.get("Optional walkdown") as string });
    await completeDisciplineTask(fixture.engineerActor, {
      id: ids.get("Optional photographs") as string,
    });

    const after = await cached(mainTask.id);
    expect(after.status).not.toBe("COMPLETED");
    expect(after.status).toBe("IN_PROGRESS");
    expect(after.progressPct).toBe(66);
  });

  it("waits for review when every mandatory task is done and only optional work is open", async () => {
    const { mainTask, ids } = await makeWork([
      { title: "Mandatory load check", isMandatory: true },
      { title: "Mandatory sign-off", isMandatory: true },
      { title: "Optional photographs", isMandatory: false },
    ]);

    await completeDisciplineTask(fixture.engineerActor, { id: ids.get("Mandatory load check") as string });
    await completeDisciplineTask(fixture.engineerActor, { id: ids.get("Mandatory sign-off") as string });

    expect(await cached(mainTask.id)).toMatchObject({ status: "AWAITING_REVIEW", progressPct: 66 });
  });

  it("goes BLOCKED as soon as one discipline task is blocked, and recovers when it moves again", async () => {
    const { mainTask, ids } = await makeWork([{ title: "Task 1" }, { title: "Task 2" }]);
    const blocked = ids.get("Task 2") as string;

    await completeDisciplineTask(fixture.engineerActor, { id: ids.get("Task 1") as string });
    await updateDisciplineTaskStatus(fixture.engineerActor, { id: blocked, status: "BLOCKED" });

    expect(await cached(mainTask.id)).toMatchObject({ status: "BLOCKED", progressPct: 50 });

    await updateDisciplineTaskStatus(fixture.engineerActor, { id: blocked, status: "IN_PROGRESS" });
    expect(await cached(mainTask.id)).toMatchObject({ status: "IN_PROGRESS", progressPct: 50 });
  });

  it("treats a main task with no discipline tasks as not started at zero", async () => {
    const { mainTask } = await makeWork([]);

    expect(await cached(mainTask.id)).toMatchObject({ status: "NOT_STARTED", progressPct: 0 });

    const dto = await getMainTaskForActor(fixture.adminActor, mainTask.id);
    expect(dto.progressPct).toBe(0);
    expect(dto.counts.disciplineTasks).toBe(0);
    expect(dto.disciplineSummary).toEqual([]);
  });

  it("leaves soft-deleted discipline tasks out of the sum entirely", async () => {
    const { mainTask, ids } = await makeWork([
      { title: "Task 1" },
      { title: "Task 2" },
      { title: "Task 3" },
      { title: "Task 4" },
    ]);

    // Two of the four are withdrawn; the next recalculation must count two, not four.
    await prisma.disciplineTask.updateMany({
      where: { id: { in: [ids.get("Task 3") as string, ids.get("Task 4") as string] } },
      data: { deletedAt: new Date() },
    });

    await completeDisciplineTask(fixture.engineerActor, { id: ids.get("Task 1") as string });
    expect(await cached(mainTask.id)).toMatchObject({ progressPct: 50, status: "IN_PROGRESS" });

    await completeDisciplineTask(fixture.engineerActor, { id: ids.get("Task 2") as string });
    expect(await cached(mainTask.id)).toMatchObject({ progressPct: 100, status: "COMPLETED" });

    const dto = await getMainTaskForActor(fixture.adminActor, mainTask.id);
    expect(dto.counts.disciplineTasks).toBe(2);
    expect(dto.disciplineSummary).toHaveLength(2);
  });
});

describe("an override sits on top of the derived value and never replaces it", () => {
  const REASON = "Remaining action transferred to operations MOC-1182";

  it("keeps deriving underneath, and clearing it puts the truth back on show", async () => {
    const { mainTask, ids } = await makeWork([{ title: "Task 1" }, { title: "Task 2" }]);

    await overrideMainTaskStatus(fixture.pmActor, {
      id: mainTask.id,
      status: "COMPLETED",
      reason: REASON,
    });

    // Work carries on underneath the override: the derived value moves, the shown value does not.
    await completeDisciplineTask(fixture.engineerActor, { id: ids.get("Task 1") as string });

    const overridden = await getMainTaskForActor(fixture.engineerActor, mainTask.id);
    expect(overridden.effectiveStatus).toBe("COMPLETED");
    expect(overridden.status).toBe("IN_PROGRESS");
    expect(overridden.progressPct).toBe(50);
    expect(overridden.overrideReason).toBe(REASON);

    const cleared = await clearOverride(fixture.pmActor, { id: mainTask.id });
    expect(cleared.statusOverride).toBeNull();
    expect(cleared.overrideReason).toBeNull();
    expect(cleared.overriddenByName).toBeNull();
    expect(cleared.overriddenAt).toBeNull();
    // Back to exactly what the discipline tasks say.
    expect(cleared.effectiveStatus).toBe("IN_PROGRESS");
    expect(cleared.status).toBe("IN_PROGRESS");
    expect(cleared.progressPct).toBe(50);

    const audit = await prisma.activityLog.findMany({
      where: { entityId: mainTask.id, action: "OVERRIDE_CLEARED" },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0].actorId).toBe(fixture.pmActor.userId);
  });

  it("re-derives on clearing even when the work finished while the override was on", async () => {
    const { mainTask, ids } = await makeWork([{ title: "Task 1" }, { title: "Task 2" }]);

    await overrideMainTaskStatus(fixture.pmActor, {
      id: mainTask.id,
      status: "BLOCKED",
      reason: "Waiting on the vendor's stamped drawings",
    });
    for (const id of ids.values()) {
      await completeDisciplineTask(fixture.engineerActor, { id });
    }
    expect((await getMainTaskForActor(fixture.pmActor, mainTask.id)).effectiveStatus).toBe("BLOCKED");

    const cleared = await clearOverride(fixture.pmActor, { id: mainTask.id });
    expect(cleared.effectiveStatus).toBe("COMPLETED");
    expect(cleared.progressPct).toBe(100);
  });

  it("refuses to clear an override that is not there, and writes nothing", async () => {
    const { mainTask } = await makeWork([{ title: "Task 1" }]);

    await expect(clearOverride(fixture.pmActor, { id: mainTask.id })).rejects.toBeInstanceOf(ServiceError);
    expect(
      await prisma.activityLog.count({ where: { entityId: mainTask.id, action: "OVERRIDE_CLEARED" } }),
    ).toBe(0);
  });
});

describe("overdue is derived at read time, never stored", () => {
  it("flags a late task in the DTOs and clears the flag the moment it completes", async () => {
    const yesterday = new Date(Date.now() - DAY_MS);
    const { mainTask, ids } = await makeWork([{ title: "Task 1" }], yesterday);

    const late = await getMainTaskForActor(fixture.engineerActor, mainTask.id);
    expect(late.isOverdue).toBe(true);
    expect(late.disciplineSummary[0].isOverdue).toBe(true);

    const listed = await listMainTasksForProject(fixture.engineerActor, fixture.projectId);
    expect(listed[0].isOverdue).toBe(true);

    await completeDisciplineTask(fixture.engineerActor, { id: ids.get("Task 1") as string });

    // Finished late is not overdue — the work is done, however late it was.
    const done = await getMainTaskForActor(fixture.engineerActor, mainTask.id);
    expect(done.isOverdue).toBe(false);
    expect(done.disciplineSummary[0].isOverdue).toBe(false);
    expect((await listMainTasksForProject(fixture.engineerActor, fixture.projectId))[0].isOverdue).toBe(
      false,
    );

    // And nothing about "overdue" was ever written to the row.
    const row = await prisma.mainTask.findUniqueOrThrow({ where: { id: mainTask.id } });
    expect(Object.keys(row)).not.toContain("isOverdue");
  });

  it("does not flag a task due later today", async () => {
    const laterToday = new Date(Date.now() + 60 * 60 * 1000);
    const { mainTask } = await makeWork([{ title: "Task 1" }], laterToday);

    const dto = await getMainTaskForActor(fixture.engineerActor, mainTask.id);
    expect(dto.isOverdue).toBe(false);
    expect(dto.disciplineSummary[0].isOverdue).toBe(false);
  });

  it("keeps showing an overdue task as overdue while an override says it is blocked", async () => {
    const { mainTask } = await makeWork([{ title: "Task 1" }], new Date(Date.now() - DAY_MS));
    await overrideMainTaskStatus(fixture.pmActor, {
      id: mainTask.id,
      status: "BLOCKED",
      reason: "Waiting on the vendor's stamped drawings",
    });

    expect((await getMainTaskForActor(fixture.pmActor, mainTask.id)).isOverdue).toBe(true);
  });
});
