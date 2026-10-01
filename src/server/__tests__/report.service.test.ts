// The one-click status report, proved against DATABASE_URL_TEST.
//
// The rules being proved:
//  - every number in the report data is the number the screens show: progress and blockers from the
//    project Brief, the headline percentage and late counts from the project header, the timeline
//    from the Gantt, the required-document counts from the same function the timeline uses;
//  - the locked-phase sentence quotes the BLOCKING phase's open count;
//  - late items are newest slip first, and never split a main task across pages;
//  - `REPORT_EXPORTED` is written once per successful export and never for a refused or failed one;
//  - the route: right content types and bytes, a plain 400 for a bad format, 429 + Retry-After on the
//    11th export in a minute, and "not found" (never "forbidden") for contractors and other companies.
//
// No test here touches the network.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.SWEEP_DISABLED = "1";

const session = vi.hoisted(() => ({ actor: null as unknown }));
vi.mock("@/server/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/session")>()),
  currentActor: async () => session.actor,
}));

import { GET } from "@/app/api/projects/[id]/report/route";
import { prisma } from "@/lib/db";
import { lateCountsByProject } from "@/server/services/late";
import { actorForUser, type ActorContext } from "@/server/actor";
import { NotFoundError } from "@/server/errors";
import { ACTIVITY } from "@/server/services/activity";
import { projectBrief } from "@/server/services/briefs";
import { createPhase } from "@/server/services/phases";
import { getProjectForActor } from "@/server/services/projects";
import {
  REPORT_MISSING_DOCS_CAP,
  REPORT_TIMELINE_MAIN_TASK_CAP,
  buildReportData,
  buildStatusReport,
  exportStatusReport,
  reportFilename,
} from "@/server/services/report";
import {
  addDependency,
  completeDisciplineTask,
  createMainTask,
  ganttForProject,
  requiredDocCountsFor,
  updateDisciplineTaskStatus,
} from "@/server/services/tasks";
import { planReport, lockedSentence, paginateTimeline } from "@/server/report/layout";
import { renderPdf } from "@/server/report/pdf";
import { renderPptx } from "@/server/report/pptx";
import {
  inThirtyDays,
  makeOrg,
  makeProjectFixture,
  makeUser,
  resetDatabase,
  subtaskIdsByTitle,
  type Fixture,
} from "@/server/__tests__/harness";

const DAY_MS = 24 * 60 * 60 * 1000;

let fixture: Fixture;

beforeEach(async () => {
  await resetDatabase();
  fixture = await makeProjectFixture();
  session.actor = fixture.adminActor;
});

afterAll(async () => {
  await prisma.$disconnect();
});

function utcMidnight(offsetDays = 0): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + offsetDays * DAY_MS);
}

async function makeMainTask(
  title: string,
  subtasks: { title: string; docs?: string[] }[],
  options: { phaseId?: string | null; deadline?: Date } = {},
) {
  const deadline = options.deadline ?? inThirtyDays();
  return createMainTask(fixture.adminActor, {
    projectId: fixture.projectId,
    phaseId: options.phaseId ?? null,
    title,
    description: "Work for the report tests.",
    priority: "MEDIUM",
    deadline,
    ownerId: fixture.pmActor.userId,
    disciplineTasks: subtasks.map((sub) => ({
      disciplineId: fixture.disciplineId,
      title: sub.title,
      assigneeId: fixture.engineerActor.userId,
      deadline,
      isMandatory: true,
      requiredDocuments: (sub.docs ?? []).map((name) => ({ name, isMandatory: true })),
    })),
  });
}

/** A project that has a bit of everything: phases, a shut gate, late work, a blocker, missing documents. */
async function makeRichProject() {
  const feed = await createPhase(fixture.adminActor, { projectId: fixture.projectId, name: "FEED" });
  const construction = await createPhase(fixture.adminActor, { projectId: fixture.projectId, name: "Construction" });

  const layout = await makeMainTask(
    "Pump skid layout",
    [
      { title: "Layout drawing", docs: ["Layout PDF", "Calc sheet"] },
      { title: "Blocked piping", docs: ["Line list"] },
      { title: "Finished survey" },
    ],
    { phaseId: feed.id },
  );
  await makeMainTask("Process design", [{ title: "Heat balance" }], { phaseId: feed.id });
  await makeMainTask("Civil works", [{ title: "Piling" }, { title: "Slab" }], { phaseId: construction.id });
  const slipped = await makeMainTask("Loose ends", [{ title: "Late chore" }], { deadline: utcMidnight(-2) });

  const ids = await subtaskIdsByTitle(layout.id);
  await addDependency(fixture.adminActor, {
    predecessorId: ids.get("Layout drawing") as string,
    successorId: ids.get("Blocked piping") as string,
  });
  await updateDisciplineTaskStatus(fixture.engineerActor, { id: ids.get("Blocked piping") as string, status: "BLOCKED" });
  await completeDisciplineTask(fixture.engineerActor, { id: ids.get("Finished survey") as string });
  // Late: one discipline task 5 days, another 1 day, and the "Loose ends" main task 2 days.
  await prisma.disciplineTask.update({ where: { id: ids.get("Layout drawing") as string }, data: { deadline: utcMidnight(-5) } });
  const loose = await subtaskIdsByTitle(slipped.id);
  await prisma.disciplineTask.update({ where: { id: loose.get("Late chore") as string }, data: { deadline: utcMidnight(-1) } });
  return { feed, construction, layout, ids };
}

describe("every number equals the screens", () => {
  it("matches the project Brief, the project header, the Gantt and the document counts", async () => {
    await makeRichProject();
    const now = new Date();

    const data = await buildReportData(fixture.adminActor, fixture.projectId, now);
    const brief = await projectBrief(fixture.adminActor, fixture.projectId, now);
    const header = await getProjectForActor(fixture.adminActor, fixture.projectId);
    const gantt = await ganttForProject(fixture.adminActor, fixture.projectId);
    const late = (await lateCountsByProject(fixture.orgId, [fixture.projectId], now)).get(fixture.projectId);

    // Progress and blockers: the Brief. The headline percentage: the header's own.
    expect(data.progress.completed).toBe(brief.progress.completed);
    expect(data.progress.total).toBe(brief.progress.total);
    expect(data.progress.pct).toBe(header.progressPct);
    expect(data.blocked).toBe(brief.blockedTotal);
    // The blocked discipline task and the main task it blocks, counted once each (one shared rule).
    expect(data.blocked).toBe(2);
    expect(data.blockedTasks.map((task) => task.title)).toEqual(brief.blockedTasks.map((task) => task.title));
    const piping = data.blockedTasks.find((task) => task.title === "Blocked piping");
    expect(piping?.blockedBy).toEqual([{ title: "Layout drawing", assigneeName: "John Carter" }]);
    expect(brief.blockedTasks.find((task) => task.title === "Blocked piping")?.blockedBy).toEqual(piping?.blockedBy);
    expect(piping?.assigneeName).toBe("John Carter");

    // Late: the header's two counts, and the list is exactly those rows.
    expect(data.late).toEqual({ main: late?.lateMain, discipline: late?.lateDiscipline });
    expect(data.late).toEqual({ main: header.counts.lateMain, discipline: header.counts.lateDiscipline });
    expect(data.late).toEqual({ main: 1, discipline: 2 });
    expect(data.lateItems).toHaveLength(data.late.main + data.late.discipline);
    expect(data.lateItems.filter((item) => item.kind === "Main")).toHaveLength(data.late.main);
    expect(data.lateItems.filter((item) => item.kind === "Discipline")).toHaveLength(data.late.discipline);
    // Newest slip first: the fewest days late at the top.
    expect(data.lateItems.map((item) => item.daysLate)).toEqual([1, 2, 5]);
    expect(data.lateItems[2].title).toBe("Layout drawing");
    expect(data.lateItems[2].assigneeName).toBe("John Carter");
    expect(data.lateItems[1].assigneeName).toBe("Layla al-Riyami"); // the main task's owner

    // Timeline: the Gantt's rows, none lost, and all discipline tasks carried.
    expect(data.timeline.mainTasks).toHaveLength(gantt.mainTasks.length);
    expect(data.timeline.moreMainTasks).toBe(0);
    const drawnSubs = data.timeline.mainTasks.reduce((sum, task) => sum + task.disciplineTasks.length, 0);
    expect(drawnSubs).toBe(gantt.mainTasks.reduce((sum, task) => sum + task.disciplineTasks.length, 0));

    // Documents: the timeline's own function, on the tasks still open.
    const open = gantt.mainTasks.flatMap((task) => task.disciplineTasks).filter((sub) => sub.status !== "COMPLETED");
    const counts = await requiredDocCountsFor(open.map((sub) => sub.id));
    const required = [...counts.values()].reduce((sum, row) => sum + row.total, 0);
    const satisfied = [...counts.values()].reduce((sum, row) => sum + row.satisfied, 0);
    expect(data.documents.required).toBe(required);
    expect(data.documents.required).toBe(3);
    expect(data.documents.inPlace).toBe(satisfied);
    expect(data.documents.missing).toBe(required - satisfied);
    expect(data.documents.missingList.map((doc) => doc.name).sort()).toEqual(["Calc sheet", "Layout PDF", "Line list"]);
    expect(data.documents.missingList[0].assigneeName).toBe("John Carter");
    expect(data.documents.byDiscipline).toEqual([{ disciplineCode: "MECH", required: 3, inPlace: 0 }]);
  });

  it("the late headline, the late list and the shared late count are one number", async () => {
    await makeRichProject();
    const now = new Date();
    const data = await buildReportData(fixture.adminActor, fixture.projectId, now);
    const shared = (await lateCountsByProject(fixture.orgId, [fixture.projectId], now)).get(fixture.projectId);
    const headline = data.late.main + data.late.discipline;
    const plans = planReport(data, { pageW: 842, pageH: 595, margin: 36, bodyFont: 12 });
    const drawn = plans.flatMap((plan) => (plan.kind === "late" ? plan.rows : []));

    expect(headline).toBeGreaterThan(0);
    expect(data.lateItems).toHaveLength(headline);
    expect(drawn).toHaveLength(headline);
    expect(headline).toBe((shared?.lateMain ?? 0) + (shared?.lateDiscipline ?? 0));
  });

  it("quotes the BLOCKING phase's open count in the locked-phase sentence", async () => {
    await makeRichProject();
    const data = await buildReportData(fixture.adminActor, fixture.projectId);
    const phases = await prisma.projectPhase.findMany({ where: { projectId: fixture.projectId } });
    const feed = phases.find((phase) => phase.name === "FEED");
    expect(feed).toBeTruthy();
    // FEED has two main tasks, neither complete; Construction has one. The sentence must say 2.
    expect(data.lockedPhases).toEqual([{ name: "Construction", waitingOn: "FEED", openTaskCount: 2 }]);
    expect(lockedSentence(data.lockedPhases[0])).toBe(
      "Construction is locked, waiting on FEED, which still has 2 main tasks open.",
    );
  });

  it("reports an empty project without inventing anything", async () => {
    const data = await buildReportData(fixture.adminActor, fixture.projectId);
    expect(data.progress).toEqual({ pct: 0, completed: 0, total: 0 });
    expect(data.lateItems).toEqual([]);
    expect(data.timeline.mainTasks).toEqual([]);
    expect(data.timeline.rangeStart).toBeNull();
    expect(data.documents.missing).toBe(0);
    const plans = planReport(data, { pageW: 842, pageH: 595, margin: 36, bodyFont: 12 });
    expect(plans.map((plan) => plan.kind)).toEqual(["cover", "timeline", "late", "flow", "flow"]);
    const timeline = plans[1];
    expect(timeline.kind === "timeline" && timeline.empty).toBe(true);
    // Both formats still build.
    expect((await renderPdf(data)).subarray(0, 4).toString()).toBe("%PDF");
    expect((await renderPptx(data)).subarray(0, 2).toString()).toBe("PK");
  });
});

describe("caps and pages", () => {
  it("caps the timeline at 40 main tasks, counts them all, and never splits a main task across pages", async () => {
    const total = REPORT_TIMELINE_MAIN_TASK_CAP + 3;
    for (let i = 0; i < total; i += 1) {
      await makeMainTask(`Main ${String(i).padStart(2, "0")}`, [{ title: `Sub ${i}` }]);
    }
    const data = await buildReportData(fixture.adminActor, fixture.projectId);
    expect(data.timeline.mainTasks).toHaveLength(REPORT_TIMELINE_MAIN_TASK_CAP);
    expect(data.timeline.moreMainTasks).toBe(3);
    expect(data.progress.total).toBe(total); // the numbers still count all of them

    const plans = planReport(data, { pageW: 842, pageH: 595, margin: 36, bodyFont: 12 });
    const timelinePages = plans.filter((plan) => plan.kind === "timeline");
    expect(timelinePages.length).toBeGreaterThan(1);
    const drawn = timelinePages.flatMap((plan) => (plan.kind === "timeline" ? plan.blocks.map((block) => block.task.id) : []));
    expect(drawn).toHaveLength(REPORT_TIMELINE_MAIN_TASK_CAP);
    expect(new Set(drawn).size).toBe(REPORT_TIMELINE_MAIN_TASK_CAP);
    // "and 3 more main tasks" appears once, on the last page only.
    const notes = timelinePages.map((plan) => (plan.kind === "timeline" ? plan.moreNote : null)).filter(Boolean);
    expect(notes).toEqual(["and 3 more main tasks (all are counted in the numbers)"]);
    expect(timelinePages[0].kind === "timeline" && timelinePages[0].title).toMatch(/\(1 of \d+\)/);
  });

  it("shows at most six discipline bars under a main task and says how many more", async () => {
    await makeMainTask("Big one", Array.from({ length: 9 }, (_, i) => ({ title: `Part ${i + 1}` })));
    const data = await buildReportData(fixture.adminActor, fixture.projectId);
    const plans = planReport(data, { pageW: 842, pageH: 595, margin: 36, bodyFont: 12 });
    const timeline = plans.find((plan) => plan.kind === "timeline");
    expect(timeline?.kind === "timeline" && timeline.blocks[0].shown.length).toBe(6);
    expect(timeline?.kind === "timeline" && timeline.blocks[0].moreDisciplines).toBe(3);
  });

  it("keeps a band's name on the first row of each page", () => {
    const task = (n: number, band: number) => ({
      task: { id: `t${n}` } as never,
      shown: [],
      moreDisciplines: 0,
      band,
      bandName: band === 0 ? "FEED" : "Construction",
      bandLabel: null,
      h: 30,
    });
    const pages = paginateTimeline([task(1, 0), task(2, 0), task(3, 0), task(4, 1)], 100);
    expect(pages.map((page) => page.map((block) => block.task))).toHaveLength(2);
    expect(pages[0][0].bandLabel).toBe("FEED");
    expect(pages[1][0].bandLabel).toBe("FEED"); // the band carries on, so its name is repeated
    expect(pages[1][1].bandLabel).toBe("Construction");
  });

  it("caps the missing-document list at 25 and counts the rest", async () => {
    const docs = Array.from({ length: REPORT_MISSING_DOCS_CAP + 4 }, (_, i) => `Document ${String(i).padStart(2, "0")}`);
    await makeMainTask("Paperwork", [{ title: "Lots of documents", docs }]);
    const data = await buildReportData(fixture.adminActor, fixture.projectId);
    expect(data.documents.missing).toBe(REPORT_MISSING_DOCS_CAP + 4);
    expect(data.documents.missingList).toHaveLength(REPORT_MISSING_DOCS_CAP);
    expect(data.documents.missingMore).toBe(4);
  });
});

describe("the files", () => {
  it("builds a real PDF and a real PowerPoint for the rich fixture, in a few seconds", async () => {
    await makeRichProject();
    const started = Date.now();
    const pdf = await buildStatusReport(fixture.adminActor, fixture.projectId, "pdf");
    const pdfMs = Date.now() - started;
    const pptxStart = Date.now();
    const pptx = await buildStatusReport(fixture.adminActor, fixture.projectId, "pptx");
    const pptxMs = Date.now() - pptxStart;

    expect(pdf.contentType).toBe("application/pdf");
    expect(pdf.body.length).toBeGreaterThan(2000);
    expect(pdf.body.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pptx.contentType).toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation");
    expect(pptx.body.length).toBeGreaterThan(2000);
    expect(pptx.body.subarray(0, 2).toString()).toBe("PK");
    expect(pdfMs).toBeLessThan(5000);
    expect(pptxMs).toBeLessThan(5000);
  });

  it("draws text in other scripts without failing (the PDF shows '?' for them, the PowerPoint keeps them)", async () => {
    await makeMainTask("مشروع الضخ 泵", [{ title: "مهمة" }]);
    const pdf = await buildStatusReport(fixture.adminActor, fixture.projectId, "pdf");
    expect(pdf.body.subarray(0, 4).toString()).toBe("%PDF");
    const pptx = await buildStatusReport(fixture.adminActor, fixture.projectId, "pptx");
    expect(pptx.body.subarray(0, 2).toString()).toBe("PK");
  });

  it("makes the file name safe", () => {
    const date = new Date(Date.UTC(2026, 8, 30, 12));
    expect(reportFilename("PRJ-101", date, "pdf")).toBe("PRJ-101-status-2026-09-30.pdf");
    expect(reportFilename('A/B "C"\r\n;..', date, "pptx")).toBe("A-B-C-..-status-2026-09-30.pptx");
    expect(reportFilename("///", date, "pdf")).toBe("project-status-2026-09-30.pdf");
  });
});

describe("the audit row", () => {
  const exported = () => prisma.activityLog.findMany({ where: { action: ACTIVITY.REPORT_EXPORTED } });

  it("writes exactly one REPORT_EXPORTED per successful export, with the format and no contents", async () => {
    const project = await prisma.project.findUniqueOrThrow({ where: { id: fixture.projectId } });
    await exportStatusReport(fixture.pmActor, fixture.projectId, "pdf");
    let rows = await exported();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: fixture.pmActor.userId,
      entityType: "Project",
      entityId: fixture.projectId,
      projectId: fixture.projectId,
      metadata: { format: "pdf" },
    });
    expect(rows[0].summary).toBe(`Layla al-Riyami exported a status report for ${project.code} as PDF`);

    await exportStatusReport(fixture.pmActor, fixture.projectId, "pptx");
    rows = await exported();
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => (row.metadata as { format: string }).format).sort()).toEqual(["pdf", "pptx"]);
  });

  it("writes nothing for a refused or failed request", async () => {
    // A project that does not exist, one in another company, and a person who is not on the project.
    await expect(exportStatusReport(fixture.adminActor, "no-such-project", "pdf")).rejects.toBeInstanceOf(NotFoundError);
    const otherOrg = await makeOrg("Other Co");
    const other = await makeProjectFixture(otherOrg.id);
    await expect(exportStatusReport(fixture.adminActor, other.projectId, "pdf")).rejects.toBeInstanceOf(NotFoundError);
    await expect(exportStatusReport(fixture.outsiderActor, fixture.projectId, "pdf")).rejects.toBeInstanceOf(NotFoundError);
    expect(await exported()).toHaveLength(0);
  });
});

describe("the route", () => {
  const call = (projectId: string, query = "?format=pdf") =>
    GET(new Request(`http://localhost/api/projects/${projectId}/report${query}`), {
      params: Promise.resolve({ id: projectId }),
    });

  it("returns the right headers and bytes for both formats", async () => {
    await makeRichProject();
    const pdf = await call(fixture.projectId, "?format=pdf");
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("Content-Type")).toBe("application/pdf");
    expect(pdf.headers.get("Cache-Control")).toBe("private, no-store");
    expect(pdf.headers.get("Content-Disposition")).toMatch(/^attachment; filename="TEST-\d+-status-\d{4}-\d{2}-\d{2}\.pdf"$/);
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString()).toBe("%PDF");

    const pptx = await call(fixture.projectId, "?format=pptx");
    expect(pptx.status).toBe(200);
    expect(pptx.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
    expect(pptx.headers.get("Content-Disposition")).toMatch(/\.pptx"$/);
    expect(Buffer.from(await pptx.arrayBuffer()).subarray(0, 2).toString()).toBe("PK");
    expect(await prisma.activityLog.count({ where: { action: ACTIVITY.REPORT_EXPORTED } })).toBe(2);
  });

  it("answers a missing or unknown format with a plain 400 and writes nothing", async () => {
    for (const query of ["", "?format=", "?format=docx", "?format=PDF"]) {
      const response = await call(fixture.projectId, query);
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toBe("Choose PDF or PowerPoint for the report.");
    }
    expect(await prisma.activityLog.count({ where: { action: ACTIVITY.REPORT_EXPORTED } })).toBe(0);
  });

  it("is signed-out safe: no session is a 401", async () => {
    session.actor = null;
    expect((await call(fixture.projectId)).status).toBe(401);
  });

  it("refuses the 11th export in a minute with a plain 429 and Retry-After, and records only the ten", async () => {
    for (let i = 0; i < 10; i += 1) {
      const response = await call(fixture.projectId);
      expect(response.status).toBe(200);
    }
    const refused = await call(fixture.projectId);
    expect(refused.status).toBe(429);
    const retry = Number(refused.headers.get("Retry-After"));
    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(60);
    expect(((await refused.json()) as { error: string }).error).toBe(
      "You have exported a lot of reports just now. Please wait a minute.",
    );
    expect(await prisma.activityLog.count({ where: { action: ACTIVITY.REPORT_EXPORTED } })).toBe(10);
  }, 60_000);

  it("answers a contractor and another company's administrator with 404, before the format is even read", async () => {
    await makeRichProject();
    const contractorUser = await makeUser({ name: "Kofi Mensah", role: "EXTERNAL", orgId: fixture.orgId });
    const theirs = await prisma.disciplineTask.findFirstOrThrow({ where: { title: "Late chore" } });
    await prisma.disciplineTask.update({ where: { id: theirs.id }, data: { assigneeId: contractorUser.id } });
    session.actor = await actorForUser(contractorUser.id);
    // Even with no format at all the answer is "not found", not "bad request": nothing is weighed first.
    for (const query of ["?format=pdf", ""]) {
      const response = await call(fixture.projectId, query);
      expect(response.status).toBe(404);
      expect(((await response.json()) as { error: string }).error).toBe("We could not find that project.");
    }

    const otherOrg = await makeOrg("Other Co");
    const other = await makeProjectFixture(otherOrg.id);
    session.actor = other.adminActor;
    const foreign = await call(fixture.projectId);
    expect(foreign.status).toBe(404);
    expect(await prisma.activityLog.count({ where: { action: ACTIVITY.REPORT_EXPORTED } })).toBe(0);
  });

  it("never reports a project the person is not on: not found, not forbidden", async () => {
    session.actor = fixture.outsiderActor;
    const response = await call(fixture.projectId);
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: string }).error).toBe("We could not find that project.");
    expect(await prisma.activityLog.count({ where: { action: ACTIVITY.REPORT_EXPORTED } })).toBe(0);
  });
});

describe("the project header's late figure", () => {
  it("names both kinds, and a contractor's figure covers only their own work", async () => {
    await makeRichProject();
    const admin = await getProjectForActor(fixture.adminActor, fixture.projectId);
    expect(admin.counts.lateMain).toBe(1);
    expect(admin.counts.lateDiscipline).toBe(2);

    const contractorUser = await makeUser({ name: "Kofi Mensah", role: "EXTERNAL", orgId: fixture.orgId });
    const late = await prisma.disciplineTask.findFirstOrThrow({ where: { title: "Late chore" } });
    await prisma.disciplineTask.update({ where: { id: late.id }, data: { assigneeId: contractorUser.id } });
    await prisma.projectMember.create({
      data: { projectId: fixture.projectId, userId: contractorUser.id, projectRole: "EXTERNAL" },
    });
    const contractor: ActorContext = await actorForUser(contractorUser.id);
    const theirs = await getProjectForActor(contractor, fixture.projectId);
    expect(theirs.counts.lateDiscipline).toBe(1);
    expect(theirs.counts.lateMain).toBe(theirs.counts.overdue);
  });
});

describe("the report is dated the day the app showed the person", () => {
  // 01:58 on 2 Oct in Muscat (UTC+4) is still 1 Oct in UTC: the exact case the tester hit.
  const LATE_EVENING_UTC = new Date("2026-10-01T21:58:00Z");

  it("names the viewer's own day, in the house form, and the same day in the file name", async () => {
    const { reportDate, reportFileDate, reportTimeZone } = await import("@/server/services/report");
    expect(reportDate(LATE_EVENING_UTC, "Asia/Muscat")).toBe("2 Oct 2026");
    expect(reportFileDate(LATE_EVENING_UTC, "Asia/Muscat")).toBe("2026-10-02");
    // Deadlines are UTC days: with no zone the same instant still reads as 1 Oct.
    expect(reportDate(LATE_EVENING_UTC)).toBe("1 Oct 2026");
    expect(reportFileDate(LATE_EVENING_UTC)).toBe("2026-10-01");
    // West of Greenwich the day can be earlier than UTC's, and September keeps its house spelling.
    expect(reportDate(new Date("2026-10-01T03:00:00Z"), "America/Los_Angeles")).toBe("30 Sep 2026");

    expect(reportTimeZone("Asia/Muscat")).toBe("Asia/Muscat");
    expect(reportTimeZone("Not/AZone")).toBe("UTC");
    expect(reportTimeZone("")).toBe("UTC");
    expect(reportTimeZone(null)).toBe("UTC");
  });

  it("puts that day on the cover, the footer and the file name of both exports", async () => {
    const { FOOTER_TEXT } = await import("@/server/report/layout");
    const built = await buildStatusReport(fixture.adminActor, fixture.projectId, "pdf", LATE_EVENING_UTC, "Asia/Muscat");
    expect(built.filename).toMatch(/-status-2026-10-02\.pdf$/);
    expect(built.data.timeZone).toBe("Asia/Muscat");
    expect(FOOTER_TEXT(built.data)).toContain("2 Oct 2026");

    const pptx = await buildStatusReport(fixture.adminActor, fixture.projectId, "pptx", LATE_EVENING_UTC, "Asia/Muscat");
    expect(pptx.filename).toMatch(/-status-2026-10-02\.pptx$/);

    // No zone given: the old UTC reading, so nothing breaks for a caller that does not send one.
    const plain = await buildStatusReport(fixture.adminActor, fixture.projectId, "pdf", LATE_EVENING_UTC);
    expect(plain.filename).toMatch(/-status-2026-10-01\.pdf$/);
    expect(FOOTER_TEXT(plain.data)).toContain("1 Oct 2026");
  });

  it("takes the zone from the download address, and a bad zone cannot break the download", async () => {
    const good = await GET(new Request("http://localhost/api/projects/x/report?format=pdf&tz=Asia%2FMuscat"), {
      params: Promise.resolve({ id: fixture.projectId }),
    });
    expect(good.status).toBe(200);
    const bad = await GET(new Request("http://localhost/api/projects/x/report?format=pdf&tz=Nope%2FNowhere"), {
      params: Promise.resolve({ id: fixture.projectId }),
    });
    expect(bad.status).toBe(200);
  });
});
