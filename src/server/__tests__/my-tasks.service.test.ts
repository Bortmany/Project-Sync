// Service-level tests for "My tasks", run against DATABASE_URL_TEST.
//
// The rules being proved: the full list keeps completed work (unlike the dashboard's short queue),
// the per-status counts are counted in the database rather than off the returned rows, nothing from
// a project the person is not on ever appears, and the personal timeline shows only their own tasks
// grouped under the main tasks those belong to.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ganttForMyTasks, listMyTasks } from "@/server/services/my-tasks";
import { createMainTask, updateDisciplineTaskStatus } from "@/server/services/tasks";
import {
  inThirtyDays,
  makeProjectFixture,
  makeUser,
  resetDatabase,
  subtaskIdsByTitle,
  type Fixture,
} from "@/server/__tests__/harness";
import { actorForUser } from "@/server/actor";

process.env.SWEEP_DISABLED = "1";

let fixture: Fixture;

beforeEach(async () => {
  await resetDatabase();
  fixture = await makeProjectFixture();
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** A main task whose discipline tasks are all assigned to the engineer, one per title given. */
async function makeMainTaskWith(title: string, subtaskTitles: string[], deadline = inThirtyDays()) {
  return createMainTask(fixture.adminActor, {
    projectId: fixture.projectId,
    title,
    description: "A test main task.",
    priority: "MEDIUM",
    deadline,
    ownerId: fixture.pmActor.userId,
    disciplineTasks: subtaskTitles.map((subtaskTitle) => ({
      disciplineId: fixture.disciplineId,
      title: subtaskTitle,
      assigneeId: fixture.engineerActor.userId,
      deadline,
      isMandatory: false,
      requiredDocuments: [],
    })),
  });
}

describe("the list", () => {
  it("keeps completed work, which the dashboard's short queue leaves out", async () => {
    const mainTask = await makeMainTaskWith("Design review", ["Open one", "Finished one"]);
    const ids = await subtaskIdsByTitle(mainTask.id);
    await updateDisciplineTaskStatus(fixture.engineerActor, {
      id: ids.get("Finished one") as string,
      status: "COMPLETED",
    });

    const mine = await listMyTasks(fixture.engineerActor);

    expect(mine.tasks.map((task) => task.title).sort()).toEqual(["Finished one", "Open one"]);
    expect(mine.tasks.some((task) => task.status === "COMPLETED")).toBe(true);
  });

  it("carries the start date and the project code the screen shows", async () => {
    const mainTask = await makeMainTaskWith("Design review", ["Only one"]);
    const id = (await subtaskIdsByTitle(mainTask.id)).get("Only one") as string;
    const startDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await prisma.disciplineTask.update({ where: { id }, data: { startDate } });

    const [task] = (await listMyTasks(fixture.engineerActor)).tasks;
    const project = await prisma.project.findUniqueOrThrow({ where: { id: fixture.projectId } });

    expect(task.startDate?.getTime()).toBe(startDate.getTime());
    expect(task.projectCode).toBe(project.code);
    expect(task.mainTaskId).toBe(mainTask.id);
  });

  it("counts every status in the database, not off the rows it returned", async () => {
    const mainTask = await makeMainTaskWith("Design review", ["One", "Two", "Three"]);
    const ids = await subtaskIdsByTitle(mainTask.id);
    await updateDisciplineTaskStatus(fixture.engineerActor, {
      id: ids.get("One") as string,
      status: "IN_PROGRESS",
    });
    await updateDisciplineTaskStatus(fixture.engineerActor, {
      id: ids.get("Two") as string,
      status: "COMPLETED",
    });

    const mine = await listMyTasks(fixture.engineerActor);

    expect(mine.totals).toEqual({
      NOT_STARTED: 1,
      IN_PROGRESS: 1,
      BLOCKED: 0,
      AWAITING_REVIEW: 0,
      COMPLETED: 1,
    });
    // Three tasks is well inside the cap, so nothing was cut short.
    expect(mine.truncated).toBe(false);
    const counted = Object.values(mine.totals).reduce((sum, value) => sum + value, 0);
    expect(counted).toBe(mine.tasks.length);
  });

  it("counts a soft-deleted task in neither the list nor the totals", async () => {
    const mainTask = await makeMainTaskWith("Design review", ["Kept", "Removed"]);
    const ids = await subtaskIdsByTitle(mainTask.id);
    await prisma.disciplineTask.update({
      where: { id: ids.get("Removed") as string },
      data: { deletedAt: new Date() },
    });

    const mine = await listMyTasks(fixture.engineerActor);

    expect(mine.tasks.map((task) => task.title)).toEqual(["Kept"]);
    expect(mine.totals.NOT_STARTED).toBe(1);
  });

  it("shows nothing from a project the person is not on", async () => {
    await makeMainTaskWith("Design review", ["Not theirs"]);

    const outsider = await listMyTasks(fixture.outsiderActor);

    expect(outsider.tasks).toEqual([]);
    expect(outsider.totals.NOT_STARTED).toBe(0);
    expect(outsider.truncated).toBe(false);
  });

  it("drops work in a project the person has since left", async () => {
    const mainTask = await makeMainTaskWith("Design review", ["Still assigned"]);
    expect((await listMyTasks(fixture.engineerActor)).tasks).toHaveLength(1);

    await prisma.projectMember.deleteMany({
      where: { projectId: fixture.projectId, userId: fixture.engineerActor.userId },
    });
    const afterLeaving = await actorForUser(fixture.engineerActor.userId);

    const mine = await listMyTasks(afterLeaving);
    expect(mine.tasks).toEqual([]);
    // The task itself is untouched — only this person's view of it changed.
    expect(await prisma.disciplineTask.count({ where: { mainTaskId: mainTask.id } })).toBe(1);
  });

  it("shows only the signed-in person's own work", async () => {
    const other = await makeUser({ name: "Sara al-Hinai", role: "ENGINEER" });
    await prisma.projectMember.create({
      data: { projectId: fixture.projectId, userId: other.id, projectRole: "ENGINEER" },
    });
    const mainTask = await makeMainTaskWith("Design review", ["Engineer's"]);
    await prisma.disciplineTask.create({
      data: {
        mainTaskId: mainTask.id,
        disciplineId: fixture.disciplineId,
        title: "Sara's",
        assigneeId: other.id,
        deadline: inThirtyDays(),
        isMandatory: false,
      },
    });

    const mine = await listMyTasks(fixture.engineerActor);
    const theirs = await listMyTasks(await actorForUser(other.id));

    expect(mine.tasks.map((task) => task.title)).toEqual(["Engineer's"]);
    expect(theirs.tasks.map((task) => task.title)).toEqual(["Sara's"]);
  });
});

describe("the personal timeline", () => {
  it("groups my tasks under the main tasks they belong to", async () => {
    const first = await makeMainTaskWith("Design review", ["Mine A", "Mine B"]);
    const second = await makeMainTaskWith("Site survey", ["Mine C"], new Date(Date.now() + 60 * 24 * 60 * 60 * 1000));

    const gantt = await ganttForMyTasks(fixture.engineerActor);

    expect(gantt.mainTasks.map((task) => task.id)).toEqual([first.id, second.id]);
    expect(gantt.mainTasks[0].disciplineTasks.map((task) => task.title)).toEqual(["Mine A", "Mine B"]);
    expect(gantt.mainTasks[1].disciplineTasks.map((task) => task.title)).toEqual(["Mine C"]);
    expect(gantt.mainTasks[0].disciplineTasks[0].assigneeName).toBe(fixture.engineerActor.name);
  });

  it("leaves out main tasks with none of my work, and other people's tasks under mine", async () => {
    const other = await makeUser({ name: "Sara al-Hinai", role: "ENGINEER" });
    await prisma.projectMember.create({
      data: { projectId: fixture.projectId, userId: other.id, projectRole: "ENGINEER" },
    });

    const mine = await makeMainTaskWith("Design review", ["Mine"]);
    const theirs = await makeMainTaskWith("Someone else's job", ["Not mine"]);
    // Hand the second main task's only subtask to Sara, and add one of hers under mine too.
    const theirIds = await subtaskIdsByTitle(theirs.id);
    await prisma.disciplineTask.update({
      where: { id: theirIds.get("Not mine") as string },
      data: { assigneeId: other.id },
    });
    await prisma.disciplineTask.create({
      data: {
        mainTaskId: mine.id,
        disciplineId: fixture.disciplineId,
        title: "Sara's, under my main task",
        assigneeId: other.id,
        deadline: inThirtyDays(),
        isMandatory: false,
      },
    });

    const gantt = await ganttForMyTasks(fixture.engineerActor);

    expect(gantt.mainTasks.map((task) => task.id)).toEqual([mine.id]);
    expect(gantt.mainTasks[0].disciplineTasks.map((task) => task.title)).toEqual(["Mine"]);
  });

  it("is empty for someone with no work at all", async () => {
    await makeMainTaskWith("Design review", ["Not theirs"]);
    expect(await ganttForMyTasks(fixture.outsiderActor)).toEqual({ mainTasks: [] });
  });
});
