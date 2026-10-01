// The one shared "blocked" count. The dashboard tile, the project Brief, the exported report and the
// chat digest must print the same number for the same project on the same day — the regression test
// for "the tile said 2 while the PDF said 1".
//
// Rules proved: blocked means a live task whose EFFECTIVE status is BLOCKED (a main task's override
// wins), both kinds count, deleted rows do not, and another company's project counts nothing.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { blockedCountsByProject, blockedTotal } from "@/server/services/blocked";
import { orgDigest, projectBrief } from "@/server/services/briefs";
import { getDashboardForActor, listTileWork } from "@/server/services/dashboard";
import { buildReportData } from "@/server/services/report";
import { createMainTask, updateDisciplineTaskStatus } from "@/server/services/tasks";
import {
  inThirtyDays,
  makeOrg,
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

async function makeMain(title: string, subs: string[]) {
  const deadline = inThirtyDays();
  return createMainTask(fixture.adminActor, {
    projectId: fixture.projectId,
    phaseId: null,
    title,
    description: "Blocked tests.",
    priority: "MEDIUM",
    deadline,
    ownerId: fixture.pmActor.userId,
    disciplineTasks: subs.map((title) => ({
      disciplineId: fixture.disciplineId,
      title,
      assigneeId: fixture.engineerActor.userId,
      deadline,
      isMandatory: true,
      requiredDocuments: [],
    })),
  });
}

/**
 * The SUR-EXP shape: "Package A" has one blocked discipline task (so the main task derives BLOCKED
 * too), "Package B" is blocked only by an authorised override, "Package C" is fine.
 */
async function makeScenario() {
  const a = await makeMain("Package A", ["A1", "A2"]);
  const b = await makeMain("Package B", ["B1"]);
  await makeMain("Package C", ["C1"]);
  const idsA = await subtaskIdsByTitle(a.id);
  await updateDisciplineTaskStatus(fixture.engineerActor, { id: idsA.get("A1") as string, status: "BLOCKED" });
  await prisma.mainTask.update({
    where: { id: b.id },
    data: { statusOverride: "BLOCKED", overriddenAt: new Date() },
  });
  return { a, b, idsA };
}

describe("blockedCountsByProject", () => {
  it("counts blocked main tasks (derived or overridden) and blocked discipline tasks", async () => {
    await makeScenario();
    const counts = await blockedCountsByProject(fixture.orgId, [fixture.projectId, fixture.projectId]);
    expect(counts.get(fixture.projectId)).toEqual({ blockedMain: 2, blockedDiscipline: 1 });
    expect(blockedTotal(counts.get(fixture.projectId)!)).toBe(3);
  });

  it("lets an override away from BLOCKED win over the derived status", async () => {
    const { a } = await makeScenario();
    await prisma.mainTask.update({
      where: { id: a.id },
      data: { statusOverride: "IN_PROGRESS", overriddenAt: new Date() },
    });
    const counts = await blockedCountsByProject(fixture.orgId, [fixture.projectId]);
    // Package A no longer counts as a blocked MAIN task; its blocked discipline task still does.
    expect(counts.get(fixture.projectId)).toEqual({ blockedMain: 1, blockedDiscipline: 1 });
  });

  it("ignores deleted rows, and another company's project counts nothing", async () => {
    const { a, idsA } = await makeScenario();
    await prisma.disciplineTask.update({ where: { id: idsA.get("A1") as string }, data: { deletedAt: new Date() } });
    await prisma.mainTask.update({ where: { id: a.id }, data: { deletedAt: new Date() } });
    const counts = await blockedCountsByProject(fixture.orgId, [fixture.projectId]);
    expect(counts.get(fixture.projectId)).toEqual({ blockedMain: 1, blockedDiscipline: 0 });

    const other = await makeOrg("Other Co");
    const foreign = await blockedCountsByProject(other.id, [fixture.projectId]);
    expect(foreign.get(fixture.projectId)).toEqual({ blockedMain: 0, blockedDiscipline: 0 });
  });
});

describe("the dashboard, the Brief, the report and the digest all say the same number", () => {
  it("agrees on one project", async () => {
    await makeScenario();
    const expected = 3;

    const dashboard = await getDashboardForActor(fixture.adminActor);
    expect(dashboard.counts.blocked).toBe(expected);
    // The list the tile opens holds exactly the rows the tile counts.
    const list = await listTileWork(fixture.adminActor, "blocked");
    expect(list.total).toBe(expected);
    expect(list.items).toHaveLength(expected);

    const brief = await projectBrief(fixture.adminActor, fixture.projectId);
    expect(brief.blockedTotal).toBe(expected);
    expect(brief.blockedTasks).toHaveLength(expected);
    // The ids the Brief names are the very rows the tile list holds.
    expect(brief.blockedTasks.map((task) => task.id).sort()).toEqual(list.items.map((item) => item.id).sort());

    const report = await buildReportData(fixture.adminActor, fixture.projectId);
    expect(report.blocked).toBe(expected);
    expect(report.blockedTasks).toHaveLength(expected);
    expect(report.blockedMore).toBe(0);

    const digest = await orgDigest(fixture.orgId);
    expect(digest?.lines[0].blocked).toBe(expected);
  });
});
