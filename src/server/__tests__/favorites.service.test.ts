// Service-level tests for the sidebar's starred shortcuts, run against DATABASE_URL_TEST.
//
// The rules being proved: one button both stars and un-stars, you cannot star work in a project you
// are not on, one person's shortcuts are invisible to everybody else, a deleted target quietly
// disappears from the list instead of dangling, leaving a project takes its stars out of the
// sidebar with it — and the database itself refuses a favorite that points at two things at once.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { actorForUser } from "@/server/actor";
import { listFavorites, toggleFavorite } from "@/server/services/favorites";
import { createMainTask } from "@/server/services/tasks";
import {
  inThirtyDays,
  makeProjectFixture,
  resetDatabase,
  subtaskIdsByTitle,
  type Fixture,
} from "@/server/__tests__/harness";

process.env.SWEEP_DISABLED = "1";

let fixture: Fixture;

beforeEach(async () => {
  await resetDatabase();
  fixture = await makeProjectFixture();
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** A main task owned by the project manager, with one discipline task for the engineer. */
async function makeMainTask(title = "Vendor drawing review") {
  const deadline = inThirtyDays();
  return createMainTask(fixture.adminActor, {
    projectId: fixture.projectId,
    title,
    description: "The test main task.",
    priority: "MEDIUM",
    deadline,
    ownerId: fixture.pmActor.userId,
    disciplineTasks: [
      {
        disciplineId: fixture.disciplineId,
        title: "Mechanical check",
        assigneeId: fixture.engineerActor.userId,
        deadline,
        isMandatory: true,
        requiredDocuments: [],
      },
    ],
  });
}

describe("toggling a favorite", () => {
  it("stars a project on the first press and leaves a row behind", async () => {
    const result = await toggleFavorite(fixture.engineerActor, {
      targetType: "PROJECT",
      targetId: fixture.projectId,
    });

    expect(result).toEqual({ favorited: true });
    const rows = await prisma.favorite.findMany({ where: { userId: fixture.engineerActor.userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].projectId).toBe(fixture.projectId);
    expect(rows[0].mainTaskId).toBeNull();
    expect(rows[0].disciplineTaskId).toBeNull();
  });

  it("un-stars on the second press and removes the row", async () => {
    const target = { targetType: "PROJECT" as const, targetId: fixture.projectId };
    await toggleFavorite(fixture.engineerActor, target);

    const second = await toggleFavorite(fixture.engineerActor, target);

    expect(second).toEqual({ favorited: false });
    expect(await prisma.favorite.count({ where: { userId: fixture.engineerActor.userId } })).toBe(0);
  });

  it("stars a main task and a discipline task too", async () => {
    const mainTask = await makeMainTask();
    const subtaskId = (await subtaskIdsByTitle(mainTask.id)).get("Mechanical check") as string;

    await toggleFavorite(fixture.engineerActor, { targetType: "MAIN_TASK", targetId: mainTask.id });
    await toggleFavorite(fixture.engineerActor, {
      targetType: "DISCIPLINE_TASK",
      targetId: subtaskId,
    });

    const kinds = (await listFavorites(fixture.engineerActor)).map((row) => row.targetType).sort();
    expect(kinds).toEqual(["DISCIPLINE_TASK", "MAIN_TASK"]);
  });

  it("refuses work in a project the person is not on", async () => {
    const mainTask = await makeMainTask();

    await expect(
      toggleFavorite(fixture.outsiderActor, { targetType: "MAIN_TASK", targetId: mainTask.id }),
    ).rejects.toThrow();
    expect(await prisma.favorite.count({ where: { userId: fixture.outsiderActor.userId } })).toBe(0);
  });

  it("refuses a project the person is not on", async () => {
    await expect(
      toggleFavorite(fixture.outsiderActor, { targetType: "PROJECT", targetId: fixture.projectId }),
    ).rejects.toThrow();
  });

  it("treats a soft-deleted target as gone", async () => {
    const mainTask = await makeMainTask();
    await prisma.mainTask.update({ where: { id: mainTask.id }, data: { deletedAt: new Date() } });

    await expect(
      toggleFavorite(fixture.engineerActor, { targetType: "MAIN_TASK", targetId: mainTask.id }),
    ).rejects.toThrow(/could not find/i);
  });

  it("refuses something that never existed", async () => {
    await expect(
      toggleFavorite(fixture.engineerActor, { targetType: "PROJECT", targetId: "not-a-real-id" }),
    ).rejects.toThrow(/could not find/i);
  });
});

describe("listing favorites", () => {
  it("joins the titles and the project code the sidebar shows, newest first", async () => {
    const mainTask = await makeMainTask("Pipe rack erection");
    await toggleFavorite(fixture.pmActor, { targetType: "PROJECT", targetId: fixture.projectId });
    await toggleFavorite(fixture.pmActor, { targetType: "MAIN_TASK", targetId: mainTask.id });
    // Two presses can land in the same millisecond, so the older one is aged by hand rather than
    // trusting the clock to separate them.
    await prisma.favorite.updateMany({
      where: { userId: fixture.pmActor.userId, projectId: fixture.projectId },
      data: { createdAt: new Date(Date.now() - 60 * 60 * 1000) },
    });

    const list = await listFavorites(fixture.pmActor);
    const project = await prisma.project.findUniqueOrThrow({ where: { id: fixture.projectId } });

    expect(list).toHaveLength(2);
    // Newest first: the main task was starred second.
    expect(list[0].targetType).toBe("MAIN_TASK");
    expect(list[0].title).toBe("Pipe rack erection");
    expect(list[0].targetId).toBe(mainTask.id);
    expect(list[0].mainTaskId).toBe(mainTask.id);
    expect(list[0].projectCode).toBe(project.code);
    expect(list[1].title).toBe(project.name);
    expect(list[1].targetId).toBe(fixture.projectId);
    expect(list[1].mainTaskId).toBeNull();
  });

  it("carries the parent main task of a discipline task so the link needs no second query", async () => {
    const mainTask = await makeMainTask();
    const subtaskId = (await subtaskIdsByTitle(mainTask.id)).get("Mechanical check") as string;
    await toggleFavorite(fixture.engineerActor, {
      targetType: "DISCIPLINE_TASK",
      targetId: subtaskId,
    });

    const [row] = await listFavorites(fixture.engineerActor);

    expect(row.targetId).toBe(subtaskId);
    expect(row.mainTaskId).toBe(mainTask.id);
    expect(row.projectId).toBe(fixture.projectId);
  });

  it("quietly skips a target that has since been deleted", async () => {
    const kept = await makeMainTask("Still here");
    const removed = await makeMainTask("Deleted later");
    await toggleFavorite(fixture.pmActor, { targetType: "MAIN_TASK", targetId: kept.id });
    await toggleFavorite(fixture.pmActor, { targetType: "MAIN_TASK", targetId: removed.id });

    await prisma.mainTask.update({ where: { id: removed.id }, data: { deletedAt: new Date() } });

    const list = await listFavorites(fixture.pmActor);
    expect(list.map((row) => row.title)).toEqual(["Still here"]);
    // The row itself is untouched — only the reading of it skips over.
    expect(await prisma.favorite.count({ where: { userId: fixture.pmActor.userId } })).toBe(2);
  });

  it("drops shortcuts to a project the person has since left — all three kinds", async () => {
    const mainTask = await makeMainTask("Vendor drawing review");
    const subtaskId = (await subtaskIdsByTitle(mainTask.id)).get("Mechanical check") as string;
    await toggleFavorite(fixture.engineerActor, {
      targetType: "PROJECT",
      targetId: fixture.projectId,
    });
    await toggleFavorite(fixture.engineerActor, { targetType: "MAIN_TASK", targetId: mainTask.id });
    await toggleFavorite(fixture.engineerActor, {
      targetType: "DISCIPLINE_TASK",
      targetId: subtaskId,
    });
    expect(await listFavorites(fixture.engineerActor)).toHaveLength(3);

    await prisma.projectMember.deleteMany({
      where: { projectId: fixture.projectId, userId: fixture.engineerActor.userId },
    });
    const afterLeaving = await actorForUser(fixture.engineerActor.userId);

    expect(await listFavorites(afterLeaving)).toEqual([]);
    // The stars themselves are untouched — only this person's view of them changed.
    expect(await prisma.favorite.count({ where: { userId: fixture.engineerActor.userId } })).toBe(3);
  });

  it("still shows an administrator every starred project, member or not", async () => {
    await toggleFavorite(fixture.adminActor, { targetType: "PROJECT", targetId: fixture.projectId });
    await prisma.projectMember.deleteMany({
      where: { projectId: fixture.projectId, userId: fixture.adminActor.userId },
    });

    const admin = await actorForUser(fixture.adminActor.userId);
    expect((await listFavorites(admin)).map((row) => row.targetType)).toEqual(["PROJECT"]);
  });

  it("keeps one person's shortcuts out of another person's list", async () => {
    const mainTask = await makeMainTask();
    await toggleFavorite(fixture.pmActor, { targetType: "MAIN_TASK", targetId: mainTask.id });

    expect(await listFavorites(fixture.pmActor)).toHaveLength(1);
    expect(await listFavorites(fixture.engineerActor)).toEqual([]);
  });

  it("does not let one person un-star another person's shortcut", async () => {
    const mainTask = await makeMainTask();
    await toggleFavorite(fixture.pmActor, { targetType: "MAIN_TASK", targetId: mainTask.id });

    // The engineer pressing the same star creates their own row; the manager's survives.
    const result = await toggleFavorite(fixture.engineerActor, {
      targetType: "MAIN_TASK",
      targetId: mainTask.id,
    });

    expect(result).toEqual({ favorited: true });
    expect(await listFavorites(fixture.pmActor)).toHaveLength(1);
    expect(await listFavorites(fixture.engineerActor)).toHaveLength(1);
  });

  it("writes no audit row — a favorite is a personal preference, not project work", async () => {
    const before = await prisma.activityLog.count();
    await toggleFavorite(fixture.pmActor, { targetType: "PROJECT", targetId: fixture.projectId });
    await toggleFavorite(fixture.pmActor, { targetType: "PROJECT", targetId: fixture.projectId });

    expect(await prisma.activityLog.count()).toBe(before);
  });
});

describe("the database's own guard", () => {
  it("refuses a favorite that points at two things at once", async () => {
    const mainTask = await makeMainTask();

    await expect(
      prisma.favorite.create({
        data: {
          userId: fixture.pmActor.userId,
          projectId: fixture.projectId,
          mainTaskId: mainTask.id,
        },
      }),
    ).rejects.toThrow(/favorite_one_target/i);
  });

  it("refuses a favorite that points at nothing at all", async () => {
    await expect(
      prisma.favorite.create({ data: { userId: fixture.pmActor.userId } }),
    ).rejects.toThrow(/favorite_one_target/i);
  });
});
