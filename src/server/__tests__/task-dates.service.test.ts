// Dragging a bar on the Gantt chart: updateTaskDates.
//
// It is the one mutation whose whole job is to move dates, so the things worth proving are that it
// moves only dates (never status or progress — those stay derived), that every move leaves exactly
// one audit row carrying the before and after, that a refused move leaves nothing behind at all,
// and that only the people allowed to edit a task may drag it.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/permissions";
import { actorForUser } from "@/server/actor";
import { ServiceError } from "@/server/errors";
import { createMainTask, updateTaskDates } from "@/server/services/tasks";
import type { MainTaskDTO, DisciplineTaskDTO } from "@/lib/zod-schemas";
import {
  makeProjectFixture,
  makeUser,
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
// One fixed clock for the whole file, so days(2) is the same instant every time it is asked for.
// It sits at UTC midnight because that is how the app stores every task date.
const NOW = new Date();
const BASE = Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate());
const days = (n: number): Date => new Date(BASE + n * DAY_MS);

const START = days(1);
const DEADLINE = days(10);
const SUBTASK = "Mechanical walkdown";

/** A main task starting in a day and due in ten, with one discipline task on the same dates. */
async function makeWork() {
  const mainTask = await createMainTask(fixture.adminActor, {
    projectId: fixture.projectId,
    title: "Complete design review",
    description: "The test main task.",
    priority: "MEDIUM",
    startDate: START,
    deadline: DEADLINE,
    disciplineTasks: [
      {
        disciplineId: fixture.disciplineId,
        title: SUBTASK,
        assigneeId: fixture.engineerActor.userId,
        deadline: DEADLINE,
        isMandatory: true,
        requiredDocuments: [],
      },
    ],
  });
  const disciplineTaskId = (await subtaskIdsByTitle(mainTask.id)).get(SUBTASK) as string;
  await prisma.disciplineTask.update({ where: { id: disciplineTaskId }, data: { startDate: START } });
  return { mainTaskId: mainTask.id, disciplineTaskId };
}

/** The DATES_UPDATED rows for one task. */
function dateRows(entityId: string) {
  return prisma.activityLog.findMany({ where: { entityId, action: "DATES_UPDATED" } });
}

describe("moving a main task's bar", () => {
  it("shifts both dates and leaves exactly one audit row with the before and after", async () => {
    const work = await makeWork();
    const newStart = days(3);
    const newDeadline = days(12);

    const moved = (await updateTaskDates(fixture.pmActor, {
      id: work.mainTaskId,
      kind: "MAIN",
      startDate: newStart,
      deadline: newDeadline,
    })) as MainTaskDTO;

    expect(moved.startDate?.toISOString()).toBe(newStart.toISOString());
    expect(moved.deadline.toISOString()).toBe(newDeadline.toISOString());

    const rows = await dateRows(work.mainTaskId);
    expect(rows).toHaveLength(1);
    expect(rows[0].actorId).toBe(fixture.pmActor.userId);
    expect(rows[0].projectId).toBe(fixture.projectId);
    expect(rows[0].summary).toContain("Complete design review");

    const metadata = rows[0].metadata as {
      before: { startDate: string; deadline: string };
      after: { startDate: string; deadline: string };
    };
    expect(new Date(metadata.before.startDate).toISOString()).toBe(START.toISOString());
    expect(new Date(metadata.before.deadline).toISOString()).toBe(DEADLINE.toISOString());
    expect(new Date(metadata.after.startDate).toISOString()).toBe(newStart.toISOString());
    expect(new Date(metadata.after.deadline).toISOString()).toBe(newDeadline.toISOString());
  });

  it("writes one row per move, never one row rewritten", async () => {
    const work = await makeWork();

    await updateTaskDates(fixture.adminActor, {
      id: work.mainTaskId,
      kind: "MAIN",
      startDate: days(2),
      deadline: days(11),
    });
    await updateTaskDates(fixture.adminActor, {
      id: work.mainTaskId,
      kind: "MAIN",
      startDate: days(4),
      deadline: days(13),
    });

    expect(await dateRows(work.mainTaskId)).toHaveLength(2);
  });

  it("does not touch the status or the progress — those stay the truth of the subtasks", async () => {
    const work = await makeWork();
    const before = await prisma.mainTask.findUniqueOrThrow({ where: { id: work.mainTaskId } });

    await updateTaskDates(fixture.pmActor, {
      id: work.mainTaskId,
      kind: "MAIN",
      startDate: days(5),
      deadline: days(20),
    });

    const after = await prisma.mainTask.findUniqueOrThrow({ where: { id: work.mainTaskId } });
    expect(after.status).toBe(before.status);
    expect(after.progressPct).toBe(before.progressPct);
    expect(after.statusOverride).toBeNull();
  });

  it("records the unchanged start date in the audit row when only the deadline moves", async () => {
    const work = await makeWork();
    const before = await prisma.mainTask.findUniqueOrThrow({ where: { id: work.mainTaskId } });
    const newDeadline = days(25);

    await updateTaskDates(fixture.pmActor, {
      id: work.mainTaskId,
      kind: "MAIN",
      deadline: newDeadline,
    });

    const rows = await dateRows(work.mainTaskId);
    expect(rows).toHaveLength(1);
    const metadata = rows[0].metadata as {
      before: { startDate: string | null; deadline: string };
      after: { startDate: string | null; deadline: string };
    };
    // The start date did not move, so the audit row must say it stayed — never that it was cleared.
    expect(metadata.after.startDate).not.toBeNull();
    expect(new Date(metadata.after.startDate as string).toISOString()).toBe(
      (before.startDate as Date).toISOString(),
    );
    expect(new Date(metadata.after.deadline).toISOString()).toBe(newDeadline.toISOString());
  });
});

describe("moving a discipline task's bar", () => {
  it("shifts the dates and records the move accurately", async () => {
    const work = await makeWork();
    const newDeadline = days(15);

    const moved = (await updateTaskDates(fixture.pmActor, {
      id: work.disciplineTaskId,
      kind: "DISCIPLINE",
      deadline: newDeadline,
    })) as DisciplineTaskDTO;

    expect(moved.deadline.toISOString()).toBe(newDeadline.toISOString());
    // No startDate was sent, so the one already there is kept.
    expect(moved.startDate?.toISOString()).toBe(START.toISOString());

    const rows = await dateRows(work.disciplineTaskId);
    expect(rows).toHaveLength(1);
    const metadata = rows[0].metadata as {
      before: { startDate: string; deadline: string };
      after: { startDate: string; deadline: string };
    };
    expect(new Date(metadata.before.deadline).toISOString()).toBe(DEADLINE.toISOString());
    expect(new Date(metadata.after.deadline).toISOString()).toBe(newDeadline.toISOString());
    expect(new Date(metadata.after.startDate).toISOString()).toBe(START.toISOString());
  });

  it("lets an administrator drag it too", async () => {
    const work = await makeWork();
    const moved = (await updateTaskDates(fixture.adminActor, {
      id: work.disciplineTaskId,
      kind: "DISCIPLINE",
      startDate: days(2),
      deadline: days(9),
    })) as DisciplineTaskDTO;
    expect(moved.startDate?.toISOString()).toBe(days(2).toISOString());
  });
});

describe("who may drag a bar", () => {
  it("refuses an engineer who is not the assignee, and changes nothing", async () => {
    const work = await makeWork();
    const other = await makeUser({ name: "Sara Al Hinai", role: "ENGINEER" });
    await prisma.projectMember.create({
      data: {
        projectId: fixture.projectId,
        userId: other.id,
        projectRole: "ENGINEER",
        disciplineId: fixture.disciplineId,
      },
    });
    const otherActor = await actorForUser(other.id);

    await expect(
      updateTaskDates(otherActor, {
        id: work.disciplineTaskId,
        kind: "DISCIPLINE",
        deadline: days(40),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const untouched = await prisma.disciplineTask.findUniqueOrThrow({
      where: { id: work.disciplineTaskId },
    });
    expect(untouched.deadline.toISOString()).toBe(DEADLINE.toISOString());
    expect(await dateRows(work.disciplineTaskId)).toHaveLength(0);
  });

  it("refuses the assignee as well — moving a deadline is editing the task, not doing it", async () => {
    // Deliberate: dragging a bar is EDIT_DISCIPLINE_TASK, which an engineer never has. An engineer
    // may finish their own work, not decide when it is due. If that rule is ever relaxed, this test
    // is the one that should be changed on purpose.
    const work = await makeWork();

    await expect(
      updateTaskDates(fixture.engineerActor, {
        id: work.disciplineTaskId,
        kind: "DISCIPLINE",
        deadline: days(40),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses somebody who is not on the project at all", async () => {
    const work = await makeWork();

    await expect(
      updateTaskDates(fixture.outsiderActor, {
        id: work.mainTaskId,
        kind: "MAIN",
        deadline: days(40),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await dateRows(work.mainTaskId)).toHaveLength(0);
  });
});

describe("dates that make no sense", () => {
  it("refuses a deadline before the start date, on a main task, and writes nothing", async () => {
    const work = await makeWork();

    await expect(
      updateTaskDates(fixture.pmActor, {
        id: work.mainTaskId,
        kind: "MAIN",
        startDate: days(10),
        deadline: days(4),
      }),
    ).rejects.toThrow(/cannot end before it starts/i);

    const untouched = await prisma.mainTask.findUniqueOrThrow({ where: { id: work.mainTaskId } });
    expect(untouched.deadline.toISOString()).toBe(DEADLINE.toISOString());
    expect(await dateRows(work.mainTaskId)).toHaveLength(0);
  });

  it("refuses a deadline dragged back before the start date already on the task", async () => {
    const work = await makeWork();

    // No startDate sent: the existing one still has to be respected.
    await expect(
      updateTaskDates(fixture.pmActor, {
        id: work.disciplineTaskId,
        kind: "DISCIPLINE",
        deadline: new Date(START.getTime() - DAY_MS),
      }),
    ).rejects.toBeInstanceOf(ServiceError);

    expect(await dateRows(work.disciplineTaskId)).toHaveLength(0);
  });

  it("allows a start date to be cleared, which cannot then be out of order", async () => {
    const work = await makeWork();

    const moved = (await updateTaskDates(fixture.pmActor, {
      id: work.disciplineTaskId,
      kind: "DISCIPLINE",
      startDate: null,
      deadline: days(2),
    })) as DisciplineTaskDTO;

    expect(moved.startDate).toBeNull();
    expect(moved.deadline.toISOString()).toBe(days(2).toISOString());
  });
});

describe("dates arriving with a time of day", () => {
  // A dragged bar and a typed date used to land on different instants — local midnight against UTC
  // midnight — so the same day could read as overdue one way and not the other. Every stored task
  // date is truncated to UTC midnight, whatever time came with it.
  const withTime = (base: Date, hours: number, minutes: number): Date =>
    new Date(base.getTime() + hours * 60 * 60 * 1000 + minutes * 60 * 1000);

  it("stores a main task's dates at UTC midnight, whatever time was sent", async () => {
    const work = await makeWork();

    const moved = (await updateTaskDates(fixture.pmActor, {
      id: work.mainTaskId,
      kind: "MAIN",
      startDate: withTime(days(3), 21, 30),
      deadline: withTime(days(12), 13, 45),
    })) as MainTaskDTO;

    expect(moved.startDate?.toISOString()).toBe(days(3).toISOString());
    expect(moved.deadline.toISOString()).toBe(days(12).toISOString());

    const stored = await prisma.mainTask.findUniqueOrThrow({ where: { id: work.mainTaskId } });
    expect(stored.deadline.toISOString()).toBe(days(12).toISOString());
    expect(stored.deadline.getUTCHours()).toBe(0);
    expect(stored.deadline.getUTCMinutes()).toBe(0);
    expect((stored.startDate as Date).getUTCHours()).toBe(0);
  });

  it("stores a discipline task's dates at UTC midnight too", async () => {
    const work = await makeWork();

    const moved = (await updateTaskDates(fixture.adminActor, {
      id: work.disciplineTaskId,
      kind: "DISCIPLINE",
      startDate: withTime(days(2), 8, 15),
      deadline: withTime(days(9), 23, 59),
    })) as DisciplineTaskDTO;

    expect(moved.startDate?.toISOString()).toBe(days(2).toISOString());
    expect(moved.deadline.toISOString()).toBe(days(9).toISOString());

    const stored = await prisma.disciplineTask.findUniqueOrThrow({
      where: { id: work.disciplineTaskId },
    });
    expect(stored.deadline.getUTCHours()).toBe(0);
    expect((stored.startDate as Date).getUTCHours()).toBe(0);
  });

  it("puts a deadline typed at one time and dragged to another on the same instant", async () => {
    const work = await makeWork();

    await updateTaskDates(fixture.pmActor, {
      id: work.mainTaskId,
      kind: "MAIN",
      deadline: withTime(days(14), 4, 0),
    });
    const typed = await prisma.mainTask.findUniqueOrThrow({ where: { id: work.mainTaskId } });

    await updateTaskDates(fixture.pmActor, {
      id: work.mainTaskId,
      kind: "MAIN",
      deadline: withTime(days(14), 19, 20),
    });
    const dragged = await prisma.mainTask.findUniqueOrThrow({ where: { id: work.mainTaskId } });

    expect(dragged.deadline.toISOString()).toBe(typed.deadline.toISOString());
  });

  it("also truncates the dates a task is created with", async () => {
    const created = await createMainTask(fixture.adminActor, {
      projectId: fixture.projectId,
      title: "Late-night planning",
      description: "Created with a time of day attached.",
      priority: "LOW",
      startDate: withTime(days(1), 22, 10),
      deadline: withTime(days(20), 22, 10),
      disciplineTasks: [
        {
          disciplineId: fixture.disciplineId,
          title: "Civil survey",
          deadline: withTime(days(18), 16, 5),
          isMandatory: true,
          requiredDocuments: [],
        },
      ],
    });

    expect(created.startDate?.toISOString()).toBe(days(1).toISOString());
    expect(created.deadline.toISOString()).toBe(days(20).toISOString());

    const subtaskId = (await subtaskIdsByTitle(created.id)).get("Civil survey") as string;
    const subtask = await prisma.disciplineTask.findUniqueOrThrow({ where: { id: subtaskId } });
    expect(subtask.deadline.toISOString()).toBe(days(18).toISOString());
  });
});
