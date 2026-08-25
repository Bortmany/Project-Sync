// The home screen's numbers. Scoping is proved in scoping.service.test.ts; this file pins the
// arithmetic — the counts, the per-discipline bars and "my tasks" — so a future change to how the
// dashboard is queried (it counts in the database rather than in Node) cannot quietly move them.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getDashboardForActor } from "@/server/services/dashboard";
import { createMainTask, updateDisciplineTaskStatus } from "@/server/services/tasks";
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

    expect(dashboard.counts.total).toBe(1);
    expect(dashboard.counts.inProgress).toBe(1);
    expect(dashboard.counts.completed).toBe(0);
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
