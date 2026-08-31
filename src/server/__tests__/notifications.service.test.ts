// Service-level tests for notifications, run against DATABASE_URL_TEST with a clean database each time.
//
// The rules being proved: nobody is told about their own action, a deactivated person is told
// nothing, finishing a discipline task tells the people who care, a notification can only be read or
// cleared by the person it belongs to, and the hourly sweep nudges each late or nearly-late task
// exactly once — and steps aside entirely when another copy of the app already holds the lock.

import { Client } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/server/errors";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  unreadCount,
} from "@/server/services/notifications";
import { notify } from "@/server/services/notify";
import { SWEEP_LOCK_KEY, runSweepOnce } from "@/server/sweep";
import { completeDisciplineTask, createMainTask } from "@/server/services/tasks";
import {
  inThirtyDays,
  makeProjectFixture,
  makeUser,
  resetDatabase,
  subtaskIdsByTitle,
  type Fixture,
} from "@/server/__tests__/harness";

// The scheduler must never start inside a test run — the tests call the sweep themselves.
process.env.SWEEP_DISABLED = "1";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

let fixture: Fixture;

beforeEach(async () => {
  await resetDatabase();
  fixture = await makeProjectFixture();
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** A main task owned by the project manager, with one discipline task assigned to the engineer. */
async function makeMainTask(deadline: Date = inThirtyDays()) {
  return createMainTask(fixture.adminActor, {
    projectId: fixture.projectId,
    title: "Vendor drawing review",
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

function countOfType(type: "OVERDUE" | "DEADLINE_APPROACHING" | "STATUS_CHANGED" | "ASSIGNED") {
  return prisma.notification.count({ where: { type } });
}

describe("notify", () => {
  it("writes one row per recipient and never tells the actor about their own action", async () => {
    const other = await makeUser({ name: "Sara al-Hinai", role: "ENGINEER" });

    await notify(
      fixture.pmActor,
      [fixture.engineerActor.userId, other.id, other.id, fixture.pmActor.userId],
      "ASSIGNED",
      {
        title: "New work assigned to you",
        body: "You were added to a task.",
        linkUrl: "/tasks/abc",
      },
    );

    const rows = await prisma.notification.findMany({ select: { userId: true } });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.userId).sort()).toEqual(
      [fixture.engineerActor.userId, other.id].sort(),
    );
  });

  it("says nothing to someone who has been deactivated", async () => {
    const leaver = await makeUser({ name: "Omar al-Saidi", role: "ENGINEER" });
    await prisma.user.update({ where: { id: leaver.id }, data: { isActive: false } });

    await notify(fixture.adminActor, [leaver.id], "STATUS_CHANGED", {
      title: "A task changed",
      body: "Something moved.",
      linkUrl: "/tasks/abc",
    });

    expect(await prisma.notification.count()).toBe(0);
  });
});

describe("the service seams", () => {
  it("tells the assignee and the task owner when a discipline task is completed", async () => {
    const mainTask = await makeMainTask();
    const subtasks = await subtaskIdsByTitle(mainTask.id);
    await prisma.notification.deleteMany({}); // ignore the "assigned" notifications from setup

    await completeDisciplineTask(fixture.adminActor, {
      id: subtasks.get("Mechanical check") as string,
    });

    const rows = await prisma.notification.findMany({
      where: { type: "STATUS_CHANGED" },
      select: { userId: true, linkUrl: true },
    });

    expect(rows.map((row) => row.userId).sort()).toEqual(
      [fixture.engineerActor.userId, fixture.pmActor.userId].sort(),
    );
    expect(rows.every((row) => row.linkUrl.startsWith("/discipline-tasks/"))).toBe(true);
  });
});

describe("reading and clearing", () => {
  it("says someone else's notification does not exist, rather than that it is theirs", async () => {
    await notify(fixture.adminActor, [fixture.engineerActor.userId], "ASSIGNED", {
      title: "New work assigned to you",
      body: "You were added to a task.",
      linkUrl: "/tasks/abc",
    });
    const mine = await prisma.notification.findFirstOrThrow();

    // Not "forbidden": that would confirm the id is real to anyone who guessed it.
    await expect(markNotificationRead(fixture.pmActor, { id: mine.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(await prisma.notification.findUniqueOrThrow({ where: { id: mine.id } })).toMatchObject({
      readAt: null,
    });

    const read = await markNotificationRead(fixture.engineerActor, { id: mine.id });
    expect(read.readAt).not.toBeNull();
  });

  it("clears everything unread for one person only, and lists only their own", async () => {
    await notify(fixture.adminActor, [fixture.engineerActor.userId, fixture.pmActor.userId], "COMMENT_ADDED", {
      title: "New comment",
      body: "Someone commented.",
      linkUrl: "/tasks/abc",
    });

    expect(await unreadCount(fixture.engineerActor)).toBe(1);

    const cleared = await markAllNotificationsRead(fixture.engineerActor);
    expect(cleared.count).toBe(1);
    expect(await unreadCount(fixture.engineerActor)).toBe(0);
    expect(await unreadCount(fixture.pmActor)).toBe(1);

    const mine = await listNotifications(fixture.engineerActor);
    expect(mine).toHaveLength(1);
    expect(mine[0].readAt).not.toBeNull();
  });
});

describe("the deadline sweep", () => {
  it("sends exactly one overdue notification per task, however often it runs", async () => {
    const deadline = inThirtyDays();
    await makeMainTask(deadline);
    const past = new Date(deadline.getTime() + DAY_MS);

    const first = await runSweepOnce(past);
    expect(first.ran).toBe(true);
    expect(first.ran && first.counts.overdue).toBe(2); // the assignee and the task owner

    const second = await runSweepOnce(new Date(past.getTime() + HOUR_MS));
    expect(second.ran && second.counts.overdue).toBe(0);

    expect(await countOfType("OVERDUE")).toBe(2);

    const rows = await prisma.notification.findMany({
      where: { type: "OVERDUE" },
      select: { userId: true, actorId: true, linkUrl: true },
    });
    expect(rows.map((row) => row.userId).sort()).toEqual(
      [fixture.engineerActor.userId, fixture.pmActor.userId].sort(),
    );
    expect(rows.every((row) => row.actorId === null)).toBe(true);
  });

  it("warns once about a deadline that is inside the next 48 hours", async () => {
    const deadline = inThirtyDays();
    await makeMainTask(deadline);
    const dayBefore = new Date(deadline.getTime() - DAY_MS);

    const first = await runSweepOnce(dayBefore);
    expect(first.ran && first.counts.approaching).toBe(2);
    expect(first.ran && first.counts.overdue).toBe(0);

    const second = await runSweepOnce(new Date(dayBefore.getTime() + HOUR_MS));
    expect(second.ran && second.counts.approaching).toBe(0);

    expect(await countOfType("DEADLINE_APPROACHING")).toBe(2);
  });

  it("leaves completed work alone", async () => {
    const deadline = inThirtyDays();
    const mainTask = await makeMainTask(deadline);
    const subtasks = await subtaskIdsByTitle(mainTask.id);
    await completeDisciplineTask(fixture.adminActor, {
      id: subtasks.get("Mechanical check") as string,
    });

    await runSweepOnce(new Date(deadline.getTime() + DAY_MS));

    expect(await countOfType("OVERDUE")).toBe(0);
  });

  it("stands aside when another copy of the app holds the lock", async () => {
    const deadline = inThirtyDays();
    await makeMainTask(deadline);

    const holder = new Client({ connectionString: process.env.DATABASE_URL });
    await holder.connect();
    await holder.query("SELECT pg_advisory_lock($1::bigint)", [SWEEP_LOCK_KEY]);

    try {
      const result = await runSweepOnce(new Date(deadline.getTime() + DAY_MS));
      expect(result.ran).toBe(false);
      expect(await countOfType("OVERDUE")).toBe(0);
    } finally {
      await holder.query("SELECT pg_advisory_unlock($1::bigint)", [SWEEP_LOCK_KEY]);
      await holder.end();
    }

    // With the lock free again the same run does its work.
    const afterUnlock = await runSweepOnce(new Date(deadline.getTime() + DAY_MS));
    expect(afterUnlock.ran).toBe(true);
    expect(await countOfType("OVERDUE")).toBe(2);
  });
});
