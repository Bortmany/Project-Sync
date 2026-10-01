// The one shared "late" count and the extracted progress-since read.
// Rules proved: late means past its deadline day, not complete by the EFFECTIVE status, live rows
// only, and only inside the asked organisation; and progressSince() says exactly what the project
// brief says for the same project.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { isLate } from "@/lib/late";
import { lateCountsByProject } from "@/server/services/late";
import { PROGRESS_LOOKBACK_MS, progressSince, projectBrief } from "@/server/services/briefs";
import { completeDisciplineTask, createMainTask, reopenDisciplineTask } from "@/server/services/tasks";
import {
  inThirtyDays,
  makeOrg,
  makeProjectFixture,
  resetDatabase,
  subtaskIdsByTitle,
  type Fixture,
} from "@/server/__tests__/harness";

process.env.SWEEP_DISABLED = "1";
const DAY_MS = 24 * 60 * 60 * 1000;
let fixture: Fixture;

beforeEach(async () => {
  await resetDatabase();
  fixture = await makeProjectFixture();
});
afterAll(async () => {
  await prisma.$disconnect();
});

async function makeMain(title: string, subs: string[], f: Fixture = fixture) {
  const deadline = inThirtyDays();
  return createMainTask(f.adminActor, {
    projectId: f.projectId,
    phaseId: null,
    title,
    description: "Late tests.",
    priority: "MEDIUM",
    deadline,
    ownerId: f.pmActor.userId,
    disciplineTasks: subs.map((s) => ({
      disciplineId: f.disciplineId,
      title: s,
      assigneeId: f.engineerActor.userId,
      deadline,
      isMandatory: true,
      requiredDocuments: [],
    })),
  });
}

/** A second project in the same company, sharing the first fixture's people and discipline. */
async function makeSecondProject(): Promise<Fixture> {
  const project = await prisma.project.create({
    data: {
      orgId: fixture.orgId,
      name: "Second project",
      code: `TWO-${Math.floor(Math.random() * 1_000_000)}`,
      description: "Another project.",
      createdById: fixture.adminActor.userId,
      disciplines: { create: [{ disciplineId: fixture.disciplineId }] },
      members: {
        create: [
          { userId: fixture.adminActor.userId, projectRole: "ADMIN" },
          { userId: fixture.pmActor.userId, projectRole: "PROJECT_MANAGER" },
          { userId: fixture.engineerActor.userId, projectRole: "ENGINEER", disciplineId: fixture.disciplineId },
        ],
      },
    },
  });
  return { ...fixture, projectId: project.id };
}

const past = (days: number) => new Date(Date.now() - days * DAY_MS);

describe("lateCountsByProject", () => {
  it("counts late main and discipline tasks per project, and agrees with isLate()", async () => {
    const a = await makeMain("Late one", ["A1", "A2", "A3"]);
    await makeMain("On time", ["B1"]);
    const c = await makeMain("Forced done", ["C1"]);
    const subs = await subtaskIdsByTitle(a.id);
    await prisma.mainTask.update({ where: { id: a.id }, data: { deadline: past(3) } });
    await prisma.mainTask.update({
      where: { id: c.id },
      data: { deadline: past(3), statusOverride: "COMPLETED", overriddenAt: new Date() },
    });
    await prisma.disciplineTask.update({ where: { id: subs.get("A1") as string }, data: { deadline: past(3) } });
    await prisma.disciplineTask.update({ where: { id: subs.get("A2") as string }, data: { deadline: past(3) } });
    await prisma.disciplineTask.update({
      where: { id: subs.get("A3") as string },
      data: { deadline: past(3), status: "COMPLETED", completedAt: new Date() },
    });

    const counts = await lateCountsByProject(fixture.orgId, [fixture.projectId, fixture.projectId]);
    expect(counts.get(fixture.projectId)).toEqual({ lateMain: 1, lateDiscipline: 2 });

    // The in-memory rule says the same about the same rows.
    const mains = await prisma.mainTask.findMany({ where: { projectId: fixture.projectId } });
    const discs = await prisma.disciplineTask.findMany({
      where: { mainTask: { projectId: fixture.projectId } },
    });
    expect(mains.filter((m) => isLate(m)).length).toBe(1);
    expect(discs.filter((d) => isLate(d)).length).toBe(2);
  });

  it("ignores deleted rows, and another company's project counts nothing", async () => {
    const a = await makeMain("Late one", ["A1"]);
    const subs = await subtaskIdsByTitle(a.id);
    await prisma.mainTask.update({ where: { id: a.id }, data: { deadline: past(3) } });
    await prisma.disciplineTask.update({ where: { id: subs.get("A1") as string }, data: { deadline: past(3) } });

    const other = await makeOrg("Other Co");
    const otherCounts = await lateCountsByProject(other.id, [fixture.projectId]);
    expect(otherCounts.get(fixture.projectId)).toEqual({ lateMain: 0, lateDiscipline: 0 });

    await prisma.disciplineTask.update({
      where: { id: subs.get("A1") as string },
      data: { deletedAt: new Date() },
    });
    await prisma.mainTask.update({ where: { id: a.id }, data: { deletedAt: new Date() } });
    const counts = await lateCountsByProject(fixture.orgId, [fixture.projectId]);
    expect(counts.get(fixture.projectId)).toEqual({ lateMain: 0, lateDiscipline: 0 });
    expect((await lateCountsByProject(fixture.orgId, [])).size).toBe(0);
  });
});

describe("progressSince", () => {
  it("returns exactly what the project brief says, for several projects in one call", async () => {
    const old = await makeMain("Done long ago", ["Old"]);
    const fresh = await makeMain("Done this week", ["New"]);
    const reopened = await makeMain("Reopened", ["Again"]);
    const open = await makeMain("Open", ["Open work"]);
    for (const t of [old, fresh, reopened, open]) {
      await prisma.mainTask.update({ where: { id: t.id }, data: { createdAt: past(30) } });
    }
    const oldId = (await subtaskIdsByTitle(old.id)).get("Old") as string;
    await completeDisciplineTask(fixture.engineerActor, { id: oldId });
    await prisma.disciplineTask.update({ where: { id: oldId }, data: { completedAt: past(30) } });
    await completeDisciplineTask(fixture.engineerActor, {
      id: (await subtaskIdsByTitle(fresh.id)).get("New") as string,
    });
    const againId = (await subtaskIdsByTitle(reopened.id)).get("Again") as string;
    await completeDisciplineTask(fixture.engineerActor, { id: againId });
    await reopenDisciplineTask(fixture.adminActor, { id: againId, reason: "Needs more work" });

    const second = await makeSecondProject();
    await makeMain("Other project task", ["Z"], second);

    const now = new Date();
    const since = new Date(now.getTime() - PROGRESS_LOOKBACK_MS);
    const map = await progressSince(fixture.orgId, [fixture.projectId, second.projectId], since);
    const brief = await projectBrief(fixture.adminActor, fixture.projectId, now);

    const mine = map.get(fixture.projectId);
    expect(mine).toBeDefined();
    expect({
      completed: mine?.completed,
      total: mine?.total,
      pct: mine?.progressNow,
      completedThen: mine?.completedThen,
      totalThen: mine?.totalThen,
      pctThen: mine?.progressThen,
      since: mine?.since,
    }).toEqual(brief.progress);
    expect(brief.progress.completedThen).toBe(2); // the old one and the reopened one
    expect(map.get(second.projectId)?.total).toBe(1);
    expect(map.get(second.projectId)?.completed).toBe(0);

    // Another company asks: nothing of ours is counted.
    const other = await makeOrg("Other Co 2");
    const theirs = await progressSince(other.id, [fixture.projectId], since);
    expect(theirs.get(fixture.projectId)?.total ?? 0).toBe(0);
  });
});
