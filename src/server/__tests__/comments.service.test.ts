// Service-level tests for comments, run against DATABASE_URL_TEST with a clean database each time.
//
// The rules being proved: only people on the project may comment, nobody can be mentioned into a
// project they are not on, a comment is only edited by its author (or an administrator), a removed
// comment leaves a tombstone rather than disappearing, and every comment, edit and removal writes
// exactly one row to the append-only audit trail.

import { beforeEach, afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/permissions";
import { ServiceError } from "@/server/errors";
import { actorForUser } from "@/server/actor";
import {
  createComment,
  deleteComment,
  editComment,
  listActivity,
  listComments,
} from "@/server/services/comments";
import { createMainTask } from "@/server/services/tasks";
import {
  inThirtyDays,
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

/** A main task with two discipline tasks, both assigned to the engineer on the project. */
async function makeMainTask() {
  return createMainTask(fixture.adminActor, {
    projectId: fixture.projectId,
    title: "Civil design review",
    description: "The test main task.",
    priority: "MEDIUM",
    deadline: inThirtyDays(),
    disciplineTasks: [1, 2].map((index) => ({
      disciplineId: fixture.disciplineId,
      title: `Discipline task ${index}`,
      assigneeId: fixture.engineerActor.userId,
      deadline: inThirtyDays(),
      isMandatory: true,
      requiredDocuments: [],
    })),
  });
}

/** How many audit rows exist for one entity, whatever the action. */
async function activityCount(entityId: string, action?: string): Promise<number> {
  return prisma.activityLog.count({ where: { entityId, ...(action ? { action } : {}) } });
}

describe("who may comment", () => {
  it("lets a member of the project comment on a task", async () => {
    const mainTask = await makeMainTask();

    const comment = await createComment(fixture.engineerActor, {
      body: "Load calculations are done.",
      mainTaskId: mainTask.id,
      mentions: [],
    });

    expect(comment.body).toBe("Load calculations are done.");
    expect(comment.authorName).toBe(fixture.engineerActor.name);
  });

  it("refuses someone who is not on the project", async () => {
    const mainTask = await makeMainTask();

    await expect(
      createComment(fixture.outsiderActor, {
        body: "Can I have a look at this?",
        mainTaskId: mainTask.id,
        mentions: [],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(await prisma.comment.count()).toBe(0);
  });

  it("refuses to read a thread on a project the person is not on", async () => {
    const mainTask = await makeMainTask();

    await expect(
      listComments(fixture.outsiderActor, { mainTaskId: mainTask.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("mentions", () => {
  it("stores a mention of someone on the project and notifies without failing", async () => {
    const mainTask = await makeMainTask();

    const comment = await createComment(fixture.pmActor, {
      body: `@${fixture.engineerActor.name} can you confirm the settlement figures?`,
      mainTaskId: mainTask.id,
      mentions: [fixture.engineerActor.userId],
    });

    expect(comment.mentions).toEqual([fixture.engineerActor.userId]);
  });

  it("refuses a mention of someone who is not on the project", async () => {
    const mainTask = await makeMainTask();

    await expect(
      createComment(fixture.pmActor, {
        body: `@${fixture.outsiderActor.name} please take a look.`,
        mainTaskId: mainTask.id,
        mentions: [fixture.outsiderActor.userId],
      }),
    ).rejects.toBeInstanceOf(ServiceError);

    expect(await prisma.comment.count()).toBe(0);
  });

  it("refuses a mention of someone who was deactivated", async () => {
    const mainTask = await makeMainTask();
    const leaver = await makeUser({ name: "Former Colleague", role: "ENGINEER" });
    await prisma.projectMember.create({
      data: { projectId: fixture.projectId, userId: leaver.id, projectRole: "ENGINEER" },
    });
    await prisma.user.update({ where: { id: leaver.id }, data: { isActive: false } });

    await expect(
      createComment(fixture.pmActor, {
        body: `@${leaver.name} are you still on this?`,
        mainTaskId: mainTask.id,
        mentions: [leaver.id],
      }),
    ).rejects.toBeInstanceOf(ServiceError);
  });
});

describe("editing and removing", () => {
  it("lets the author edit their own comment and records when", async () => {
    const mainTask = await makeMainTask();
    const comment = await createComment(fixture.engineerActor, {
      body: "Reviewed 6 of 9 data sheets.",
      mainTaskId: mainTask.id,
      mentions: [],
    });

    const edited = await editComment(fixture.engineerActor, {
      id: comment.id,
      body: "Reviewed 7 of 9 data sheets.",
    });

    expect(edited.body).toBe("Reviewed 7 of 9 data sheets.");
    expect(edited.editedAt).not.toBeNull();
  });

  it("refuses an edit of someone else's comment", async () => {
    const mainTask = await makeMainTask();
    const other = await makeUser({ name: "Second Engineer", role: "ENGINEER" });
    await prisma.projectMember.create({
      data: { projectId: fixture.projectId, userId: other.id, projectRole: "ENGINEER" },
    });
    const otherActor = await actorForUser(other.id);

    const comment = await createComment(fixture.engineerActor, {
      body: "Mine, not yours.",
      mainTaskId: mainTask.id,
      mentions: [],
    });

    await expect(
      editComment(otherActor, { id: comment.id, body: "Rewritten by somebody else." }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const unchanged = await prisma.comment.findUniqueOrThrow({ where: { id: comment.id } });
    expect(unchanged.body).toBe("Mine, not yours.");
  });

  it("keeps the row and shows a tombstone when the author removes a comment", async () => {
    const mainTask = await makeMainTask();
    const comment = await createComment(fixture.engineerActor, {
      body: "Wrong thread, sorry.",
      mainTaskId: mainTask.id,
      mentions: [],
    });

    await deleteComment(fixture.engineerActor, { id: comment.id });

    const row = await prisma.comment.findUniqueOrThrow({ where: { id: comment.id } });
    expect(row.deletedAt).not.toBeNull();

    const thread = await listComments(fixture.engineerActor, { mainTaskId: mainTask.id });
    expect(thread).toHaveLength(1);
    expect(thread[0].isDeleted).toBe(true);
    expect(thread[0].body).toBe("Comment removed");
  });

  it("lets an administrator remove someone else's comment", async () => {
    const mainTask = await makeMainTask();
    const comment = await createComment(fixture.engineerActor, {
      body: "Something an administrator has to take down.",
      mainTaskId: mainTask.id,
      mentions: [],
    });

    await deleteComment(fixture.adminActor, { id: comment.id });

    const thread = await listComments(fixture.adminActor, { mainTaskId: mainTask.id });
    expect(thread[0].isDeleted).toBe(true);
  });

  it("refuses a removal by another engineer", async () => {
    const mainTask = await makeMainTask();
    const other = await makeUser({ name: "Third Engineer", role: "ENGINEER" });
    await prisma.projectMember.create({
      data: { projectId: fixture.projectId, userId: other.id, projectRole: "ENGINEER" },
    });
    const otherActor = await actorForUser(other.id);

    const comment = await createComment(fixture.engineerActor, {
      body: "Not yours to remove.",
      mainTaskId: mainTask.id,
      mentions: [],
    });

    await expect(deleteComment(otherActor, { id: comment.id })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("the audit trail", () => {
  it("writes exactly one row for each comment, edit and removal", async () => {
    const mainTask = await makeMainTask();
    const before = await activityCount(mainTask.id);

    const comment = await createComment(fixture.engineerActor, {
      body: "First note on this task.",
      mainTaskId: mainTask.id,
      mentions: [],
    });
    expect(await activityCount(mainTask.id, "COMMENT_ADDED")).toBe(1);

    await editComment(fixture.engineerActor, { id: comment.id, body: "First note, corrected." });
    expect(await activityCount(mainTask.id, "COMMENT_EDITED")).toBe(1);

    await deleteComment(fixture.engineerActor, { id: comment.id });
    expect(await activityCount(mainTask.id, "COMMENT_DELETED")).toBe(1);

    expect(await activityCount(mainTask.id)).toBe(before + 3);
  });

  it("writes no audit row when a comment is refused", async () => {
    const mainTask = await makeMainTask();
    const before = await activityCount(mainTask.id);

    await expect(
      createComment(fixture.pmActor, {
        body: `@${fixture.outsiderActor.name} take a look.`,
        mainTaskId: mainTask.id,
        mentions: [fixture.outsiderActor.userId],
      }),
    ).rejects.toBeInstanceOf(ServiceError);

    expect(await activityCount(mainTask.id)).toBe(before);
  });

  it("rolls the discipline tasks' entries up into the main task's feed", async () => {
    const mainTask = await makeMainTask();
    const subtasks = await subtaskIdsByTitle(mainTask.id);
    const subtaskId = subtasks.get("Discipline task 1") as string;

    await createComment(fixture.engineerActor, {
      body: "A note on the subtask.",
      disciplineTaskId: subtaskId,
      mentions: [],
    });

    const feed = await listActivity(fixture.engineerActor, { mainTaskId: mainTask.id });
    const entities = new Set(feed.map((item) => item.entityId));

    expect(entities.has(mainTask.id)).toBe(true);
    expect(entities.has(subtaskId)).toBe(true);
    expect(feed.some((item) => item.action === "COMMENT_ADDED")).toBe(true);

    // Newest first.
    const times = feed.map((item) => item.createdAt.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("keeps a project's feed away from people who are not on it", async () => {
    await makeMainTask();

    await expect(
      listActivity(fixture.outsiderActor, { projectId: fixture.projectId }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
