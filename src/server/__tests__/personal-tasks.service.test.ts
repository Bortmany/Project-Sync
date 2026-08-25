// Service-level tests for the sidebar's private to-do list, run against DATABASE_URL_TEST.
//
// The rules being proved: a line needs a real title, ticking one off stamps the time and un-ticking
// clears it, open work sits above finished work, and one person's list is completely invisible to
// everybody else — reading, ticking and deleting alike.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { CreatePersonalTaskInput } from "@/lib/zod-schemas";
import {
  createPersonalTask,
  deletePersonalTask,
  listPersonalTasks,
  togglePersonalTask,
} from "@/server/services/personal-tasks";
import { makeProjectFixture, resetDatabase, type Fixture } from "@/server/__tests__/harness";

process.env.SWEEP_DISABLED = "1";

let fixture: Fixture;

beforeEach(async () => {
  await resetDatabase();
  fixture = await makeProjectFixture();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("adding a line", () => {
  it("saves the title and starts it open", async () => {
    const item = await createPersonalTask(fixture.engineerActor, { title: "Call the vendor" });

    expect(item.title).toBe("Call the vendor");
    expect(item.done).toBe(false);
    expect(item.completedAt).toBeNull();
  });

  it("insists on a real title", () => {
    expect(CreatePersonalTaskInput.safeParse({ title: "   " }).success).toBe(false);
    expect(CreatePersonalTaskInput.safeParse({ title: "" }).success).toBe(false);
    expect(CreatePersonalTaskInput.safeParse({ title: "x".repeat(201) }).success).toBe(false);
    expect(CreatePersonalTaskInput.safeParse({ title: "x".repeat(200) }).success).toBe(true);
  });

  it("trims the title before it is stored", () => {
    const parsed = CreatePersonalTaskInput.parse({ title: "  Call the vendor  " });
    expect(parsed.title).toBe("Call the vendor");
  });

  it("writes no audit row — a private list is not project work", async () => {
    const before = await prisma.activityLog.count();
    await createPersonalTask(fixture.engineerActor, { title: "Not project work" });
    expect(await prisma.activityLog.count()).toBe(before);
  });
});

describe("ticking a line off", () => {
  it("stamps the time, and clears it again when un-ticked", async () => {
    const item = await createPersonalTask(fixture.engineerActor, { title: "Chase the drawings" });

    const ticked = await togglePersonalTask(fixture.engineerActor, { id: item.id });
    expect(ticked.done).toBe(true);
    expect(ticked.completedAt).toBeInstanceOf(Date);

    const untimed = await togglePersonalTask(fixture.engineerActor, { id: item.id });
    expect(untimed.done).toBe(false);
    expect(untimed.completedAt).toBeNull();
  });
});

describe("the list itself", () => {
  it("puts open items above finished ones", async () => {
    const first = await createPersonalTask(fixture.engineerActor, { title: "First" });
    const second = await createPersonalTask(fixture.engineerActor, { title: "Second" });
    const third = await createPersonalTask(fixture.engineerActor, { title: "Third" });

    // The list order comes from sortOrder, but the ages are still set by hand so the tie-break key
    // cannot quietly decide the answer if three presses land in the same millisecond.
    const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000);
    await prisma.personalTask.update({ where: { id: first.id }, data: { createdAt: hoursAgo(3) } });
    await prisma.personalTask.update({ where: { id: second.id }, data: { createdAt: hoursAgo(2) } });
    await prisma.personalTask.update({ where: { id: third.id }, data: { createdAt: hoursAgo(1) } });

    await togglePersonalTask(fixture.engineerActor, { id: first.id });

    const list = await listPersonalTasks(fixture.engineerActor);
    expect(list.map((row) => row.title)).toEqual(["Third", "Second", "First"]);
    expect(list.map((row) => row.done)).toEqual([false, false, true]);
  });

  it("keeps a newly added line at the top, by the position it was given", async () => {
    await createPersonalTask(fixture.engineerActor, { title: "First" });
    await createPersonalTask(fixture.engineerActor, { title: "Second" });
    await createPersonalTask(fixture.engineerActor, { title: "Third" });

    // Every line gets the same timestamp, so only sortOrder can decide the order — this is what
    // proves the position each line is given is really the one it is listed in.
    await prisma.personalTask.updateMany({
      where: { userId: fixture.engineerActor.userId },
      data: { createdAt: new Date(Date.now() - 60 * 60 * 1000) },
    });

    const list = await listPersonalTasks(fixture.engineerActor);
    expect(list.map((row) => row.title)).toEqual(["Third", "Second", "First"]);

    const sortOrders = await prisma.personalTask.findMany({
      where: { userId: fixture.engineerActor.userId },
      orderBy: { sortOrder: "asc" },
      select: { sortOrder: true },
    });
    expect(sortOrders.map((row) => row.sortOrder)).toEqual([-3, -2, -1]);
  });

  it("shows nothing but this person's own lines", async () => {
    await createPersonalTask(fixture.engineerActor, { title: "Mine" });
    await createPersonalTask(fixture.pmActor, { title: "Someone else's" });

    expect((await listPersonalTasks(fixture.engineerActor)).map((row) => row.title)).toEqual(["Mine"]);
    expect((await listPersonalTasks(fixture.pmActor)).map((row) => row.title)).toEqual([
      "Someone else's",
    ]);
  });
});

describe("someone else's list", () => {
  it("cannot be ticked off", async () => {
    const mine = await createPersonalTask(fixture.engineerActor, { title: "Mine" });

    await expect(togglePersonalTask(fixture.pmActor, { id: mine.id })).rejects.toThrow(
      /could not find/i,
    );

    const untouched = await prisma.personalTask.findUniqueOrThrow({ where: { id: mine.id } });
    expect(untouched.done).toBe(false);
  });

  it("cannot be deleted", async () => {
    const mine = await createPersonalTask(fixture.engineerActor, { title: "Mine" });

    await expect(deletePersonalTask(fixture.pmActor, { id: mine.id })).rejects.toThrow(
      /could not find/i,
    );
    expect(await prisma.personalTask.count({ where: { id: mine.id } })).toBe(1);
  });

  it("is gone for good when its owner deletes it", async () => {
    const mine = await createPersonalTask(fixture.engineerActor, { title: "Mine" });

    expect(await deletePersonalTask(fixture.engineerActor, { id: mine.id })).toEqual({ removed: true });
    expect(await listPersonalTasks(fixture.engineerActor)).toEqual([]);
  });
});
