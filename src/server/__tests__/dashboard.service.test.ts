// The home screen's numbers. Scoping is proved in scoping.service.test.ts; this file pins the
// arithmetic — the counts, the per-discipline bars and "my tasks" — so a future change to how the
// dashboard is queried (it counts in the database rather than in Node) cannot quietly move them.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getDashboardForActor, listTileWork, type TileKey } from "@/server/services/dashboard";
import { projectBrief } from "@/server/services/briefs";
import { lateCountsByProject } from "@/server/services/late";
import { createMainTask, updateDisciplineTaskStatus } from "@/server/services/tasks";
import { actorForUser } from "@/server/actor";
import {
  inThirtyDays,
  makeOrg,
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

/** One main task with two Mechanical subtasks and two Electrical ones, all on the engineer. */
async function makeMixedWork() {
  const deadline = inThirtyDays();
  const mainTask = await createMainTask(fixture.adminActor, {
    projectId: fixture.projectId,
    title: "Complete design review",
    description: "The test main task.",
    priority: "MEDIUM",
    deadline,
    disciplineTasks: [
      { disciplineId: fixture.disciplineId, title: "Mech A", assigneeId: fixture.engineerActor.userId, deadline, isMandatory: true, requiredDocuments: [] },
      { disciplineId: fixture.disciplineId, title: "Mech B", assigneeId: fixture.engineerActor.userId, deadline, isMandatory: true, requiredDocuments: [] },
      { disciplineId: fixture.otherDisciplineId, title: "Elec A", assigneeId: fixture.engineerActor.userId, deadline, isMandatory: false, requiredDocuments: [] },
      { disciplineId: fixture.otherDisciplineId, title: "Elec B", assigneeId: fixture.engineerActor.userId, deadline, isMandatory: false, requiredDocuments: [] },
    ],
  });
  return { mainTask, ids: await subtaskIdsByTitle(mainTask.id) };
}

describe("the dashboard's numbers", () => {
  it("counts the main tasks and shows a bar for each discipline that has work", async () => {
    const { ids } = await makeMixedWork();
    await updateDisciplineTaskStatus(fixture.adminActor, { id: ids.get("Mech A") as string, status: "COMPLETED" });

    const dashboard = await getDashboardForActor(fixture.adminActor);

    // Every main task AND discipline task counts: 1 main + 4 discipline tasks.
    expect(dashboard.counts.total).toBe(5);
    expect(dashboard.counts.inProgress).toBe(1); // the main task, now under way
    expect(dashboard.counts.completed).toBe(1); // Mech A
    expect(dashboard.scope).toBe("COMPANY");
    expect(dashboard.counts.overdue).toBe(0);

    const bars = dashboard.disciplineProgress;
    expect(bars.map((bar) => bar.code)).toEqual(["MECH", "ELEC"]); // catalogue order
    expect(bars.find((bar) => bar.code === "MECH")?.pct).toBe(50); // one of two done
    expect(bars.find((bar) => bar.code === "ELEC")?.pct).toBe(0);
  });

  it("shows a person only their own open work, soonest first", async () => {
    const { ids } = await makeMixedWork();
    await updateDisciplineTaskStatus(fixture.adminActor, { id: ids.get("Mech A") as string, status: "COMPLETED" });

    const mine = await getDashboardForActor(fixture.engineerActor);
    expect(mine.myTasks.map((task) => task.title).sort()).toEqual(["Elec A", "Elec B", "Mech B"]);

    // The administrator is assigned none of it, so their "my tasks" list is empty even though
    // they can see every project.
    const admin = await getDashboardForActor(fixture.adminActor);
    expect(admin.myTasks).toEqual([]);
  });

  it("counts nothing at all for somebody who is on no project", async () => {
    await makeMixedWork();
    const dashboard = await getDashboardForActor(fixture.outsiderActor);

    expect(dashboard.counts.total).toBe(0);
    expect(dashboard.disciplineProgress).toEqual([]);
    expect(dashboard.upcomingDeadlines).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* One set of numbers: every tile equals the list its link opens       */
/* ------------------------------------------------------------------ */

const DAY = 24 * 60 * 60 * 1000;
const TILE_FOR: Record<keyof Awaited<ReturnType<typeof getDashboardForActor>>["counts"], TileKey> = {
  total: "all",
  inProgress: "in-progress",
  completed: "completed",
  blocked: "blocked",
  overdue: "late",
  dueSoon: "upcoming",
};

/** Main tasks and discipline tasks in every state, dated around `now`. */
async function makeEveryState(f: Fixture, now: Date) {
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const at = (days: number) => new Date(startOfDay.getTime() + days * DAY);
  const make = async (
    title: string,
    mainDeadline: Date,
    subs: { title: string; deadline: Date; status?: "BLOCKED" | "IN_PROGRESS" | "COMPLETED" }[],
  ) => {
    const main = await createMainTask(f.adminActor, {
      projectId: f.projectId,
      phaseId: null,
      title,
      description: "Numbers that agree.",
      priority: "MEDIUM",
      deadline: mainDeadline,
      ownerId: f.pmActor.userId,
      disciplineTasks: subs.map((sub) => ({
        disciplineId: f.disciplineId,
        title: sub.title,
        assigneeId: f.engineerActor.userId,
        deadline: sub.deadline,
        isMandatory: true,
        requiredDocuments: [],
      })),
    });
    const ids = await subtaskIdsByTitle(main.id);
    for (const sub of subs) {
      await prisma.disciplineTask.update({
        where: { id: ids.get(sub.title) as string },
        data: {
          deadline: sub.deadline,
          ...(sub.status ? { status: sub.status } : {}),
          ...(sub.status === "COMPLETED" ? { completedAt: now } : {}),
        },
      });
    }
    await prisma.mainTask.update({ where: { id: main.id }, data: { deadline: mainDeadline } });
    return main;
  };
  await make("Late main", at(-5), [
    { title: "Late sub", deadline: at(-3) },
    { title: "Done long ago", deadline: at(-40), status: "COMPLETED" },
  ]);
  await make("Soon main", at(3), [
    { title: "Due today", deadline: startOfDay, status: "IN_PROGRESS" },
    { title: "Due in 10", deadline: at(10) },
    { title: "Due in 20", deadline: at(20) },
  ]);
  await make("Stuck main", at(30), [
    { title: "Stuck sub", deadline: at(30), status: "BLOCKED" },
  ]);
}

describe("every tile counts exactly the list its link opens", () => {
  it("agrees tile by tile for the company view, and nothing late is ever upcoming", async () => {
    const now = new Date();
    await makeEveryState(fixture, now);

    const dashboard = await getDashboardForActor(fixture.pmActor, now);
    expect(dashboard.scope).toBe("COMPANY");
    for (const [key, tile] of Object.entries(TILE_FOR)) {
      const list = await listTileWork(fixture.pmActor, tile, now);
      expect(list.items.length, tile).toBe(list.total);
      expect(dashboard.counts[key as keyof typeof dashboard.counts], tile).toBe(list.total);
    }

    // 3 main + 6 discipline tasks.
    expect(dashboard.counts.total).toBe(9);
    expect(dashboard.counts.blocked).toBe(1);
    // Late: the main task (5 days) and its late sub (3 days). The completed old sub is not late.
    expect(dashboard.counts.overdue).toBe(2);
    expect(dashboard.lateTasks.map((row) => [row.title, row.daysLate])).toEqual([
      ["Late main", 5],
      ["Late sub", 3],
    ]);

    // "Due in 14 days" is the Upcoming list: due today, the soon main task, due in 10 days.
    const upcoming = await listTileWork(fixture.pmActor, "upcoming", now);
    expect(dashboard.counts.dueSoon).toBe(upcoming.total);
    expect(dashboard.upcomingDeadlines.map((row) => row.title)).toEqual([
      "Due today",
      "Soon main",
      "Due in 10",
    ]);
    expect(dashboard.upcomingDeadlines.map((row) => row.daysUntil)).toEqual([0, 3, 10]);
    expect(dashboard.upcomingDeadlines.some((row) => row.isOverdue)).toBe(false);
    for (const row of dashboard.upcomingDeadlines) {
      expect(row.deadline.getTime()).toBeGreaterThanOrEqual(now.getTime() - DAY);
    }
    // No row is on both lists.
    const lateIds = new Set(dashboard.lateTasks.map((row) => row.id));
    expect(dashboard.upcomingDeadlines.some((row) => lateIds.has(row.id))).toBe(false);
  });

  it("gives the same late figure as the shared late helper and the project brief", async () => {
    const now = new Date();
    await makeEveryState(fixture, now);
    const late = (await lateCountsByProject(fixture.orgId, [fixture.projectId], now)).get(
      fixture.projectId,
    );
    const dashboard = await getDashboardForActor(fixture.adminActor, now);
    const brief = await projectBrief(fixture.adminActor, fixture.projectId, now);
    expect(late).toEqual({ lateMain: 1, lateDiscipline: 1 });
    expect(dashboard.counts.overdue).toBe((late?.lateMain ?? 0) + (late?.lateDiscipline ?? 0));
    expect(brief.overdueTotal).toBe(late?.lateDiscipline);
  });

  it("never counts another company's work, and keeps to the projects the person may see", async () => {
    const now = new Date();
    await makeEveryState(fixture, now);
    const before = await getDashboardForActor(fixture.adminActor, now);

    const other = await makeOrg("Numbers Other Co");
    const theirs = await makeProjectFixture(other.id);
    await makeEveryState(theirs, now);

    expect(await getDashboardForActor(fixture.adminActor, now)).toEqual(before);
    expect((await getDashboardForActor(theirs.adminActor, now)).counts.total).toBe(9);

    // A second project in our company that the engineer is not on adds nothing to their tiles.
    const hidden = await prisma.project.create({
      data: {
        orgId: fixture.orgId,
        name: "Not mine",
        code: `HID-${Math.floor(Math.random() * 1_000_000)}`,
        description: "Not a member.",
        createdById: fixture.adminActor.userId,
        disciplines: { create: [{ disciplineId: fixture.disciplineId }] },
        members: {
          create: [
            { userId: fixture.adminActor.userId, projectRole: "ADMIN" },
            { userId: fixture.pmActor.userId, projectRole: "PROJECT_MANAGER" },
          ],
        },
      },
    });
    await makeEveryState({ ...fixture, projectId: hidden.id, engineerActor: fixture.pmActor }, now);
    expect((await getDashboardForActor(fixture.engineerActor, now)).counts.total).toBe(9);
    expect((await getDashboardForActor(fixture.adminActor, now)).counts.total).toBe(18);
  });
});

describe("tiles counted in the database still equal their lists", () => {
  async function assertEveryTileEqualsItsList(actor: typeof fixture.pmActor, now: Date) {
    const dashboard = await getDashboardForActor(actor, now);
    for (const [key, tile] of Object.entries(TILE_FOR)) {
      const list = await listTileWork(actor, tile, now);
      expect(list.items.length, tile).toBe(list.total);
      expect(dashboard.counts[key as keyof typeof dashboard.counts], tile).toBe(list.total);
    }
    return dashboard;
  }

  it("lets an authorised override decide a main task's tile, and keeps every tile equal to its list", async () => {
    const now = new Date();
    await makeEveryState(fixture, now);
    const before = await getDashboardForActor(fixture.pmActor, now);

    // The late main task is closed by an override: it is no longer late and now counts as completed.
    await prisma.mainTask.updateMany({
      where: { title: "Late main" },
      data: { statusOverride: "COMPLETED", overriddenAt: now },
    });
    // The soon main task is held by an override: blocked, still upcoming.
    await prisma.mainTask.updateMany({
      where: { title: "Soon main" },
      data: { statusOverride: "BLOCKED", overriddenAt: now },
    });

    const after = await assertEveryTileEqualsItsList(fixture.pmActor, now);
    expect(after.counts.overdue).toBe(before.counts.overdue - 1);
    expect(after.counts.completed).toBe(before.counts.completed + 1);
    expect(after.counts.blocked).toBe(before.counts.blocked + 1);
    expect(after.counts.dueSoon).toBe(before.counts.dueSoon);
    expect(after.lateTasks.map((row) => row.title)).toEqual(["Late sub"]);
  });

  it("counts a contractor's own discipline tasks only, and never another company's rows", async () => {
    const now = new Date();
    await makeEveryState(fixture, now);
    const contractor = await makeUser({
      name: "Dashboard Contractor",
      role: "EXTERNAL",
      orgId: fixture.orgId,
    });
    await prisma.projectMember.create({
      data: { projectId: fixture.projectId, userId: contractor.id, projectRole: "EXTERNAL" },
    });
    await prisma.disciplineTask.updateMany({
      where: { title: { in: ["Late sub", "Due in 10"] } },
      data: { assigneeId: contractor.id },
    });

    const other = await makeOrg("Contractor Other Co");
    await makeEveryState(await makeProjectFixture(other.id), now);

    const actor = await actorForUser(contractor.id);
    const dashboard = await assertEveryTileEqualsItsList(actor, now);
    expect(dashboard.scope).toBe("OWN");
    expect(dashboard.counts.total).toBe(2);
    expect(dashboard.counts.overdue).toBe(1);
    expect(dashboard.counts.dueSoon).toBe(1);
    expect(dashboard.lateTasks.map((row) => row.title)).toEqual(["Late sub"]);
    expect(dashboard.upcomingDeadlines.map((row) => row.title)).toEqual(["Due in 10"]);
  });

  it("caps the lists but never the numbers", async () => {
    const now = new Date();
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const deadline = inThirtyDays();
    const main = await createMainTask(fixture.adminActor, {
      projectId: fixture.projectId,
      phaseId: null,
      title: "Many late",
      description: "More late work than a list shows.",
      priority: "MEDIUM",
      deadline,
      ownerId: fixture.pmActor.userId,
      disciplineTasks: Array.from({ length: 25 }, (_, index) => ({
        disciplineId: fixture.disciplineId,
        title: `Late ${String(index).padStart(2, "0")}`,
        assigneeId: fixture.engineerActor.userId,
        deadline,
        isMandatory: true,
        requiredDocuments: [],
      })),
    });
    await prisma.disciplineTask.updateMany({
      where: { mainTaskId: main.id },
      data: { deadline: new Date(startOfDay.getTime() - 4 * DAY) },
    });

    const dashboard = await getDashboardForActor(fixture.pmActor, now);
    expect(dashboard.counts.overdue).toBe(25);
    expect(dashboard.lateTasks).toHaveLength(20);
    const list = await listTileWork(fixture.pmActor, "late", now);
    expect(list.total).toBe(25);
    expect(list.items).toHaveLength(25);
  });
});
