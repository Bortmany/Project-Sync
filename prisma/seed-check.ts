// Proves the seeded demo data still obeys the golden rule: derived progress, derived overdue,
// a recorded override, and an audit trail that was actually written. Run after `npm run seed`.
//
// It also proves the two rules the demo now shows off: a contractor's finished work waits for a
// sign-off instead of completing itself, and the second seeded company is genuinely invisible to
// the first.

import "dotenv/config";
import { prisma } from "@/lib/db";
import { phaseLockedFor } from "@/lib/phase-lock";
import { effectiveStatus, isOverdue } from "@/lib/progress";
import { actorForUser } from "@/server/actor";
import { projectBrief } from "@/server/services/briefs";
import { listAnnouncementsForUser } from "@/server/services/posts";
import { getProjectForActor, listProjectsForActor } from "@/server/services/projects";
import { listAwaitingMySignoff } from "@/server/services/tasks";

const PROJECT_CODE = "SUR-EXP";
const NORTHBAY_SLUG = "northbay-construction";
const NORTHBAY_PROJECT_CODE = "HT-P2";
const CONTRACTOR_EMAILS = ["rashid.albalushi@tielora.example", "elena.petrova@tielora.example"];
const SUBMITTED_TASK = "Mechanical datasheets compiled";
const out = (line: string) => process.stdout.write(`${line}\n`);

const failures: string[] = [];

function check(passed: boolean, description: string, detail = ""): void {
  if (passed) {
    out(`  ok    ${description}`);
    return;
  }
  failures.push(`${description}${detail ? ` — ${detail}` : ""}`);
  out(`  FAIL  ${description}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const project = await prisma.project.findFirst({
    where: { code: PROJECT_CODE, organization: { slug: "meridian-energy-demo" } },
  });
  if (!project) throw new Error(`The demo project ${PROJECT_CODE} is missing. Run npm run seed first.`);

  const tasks = await prisma.mainTask.findMany({ where: { projectId: project.id, deletedAt: null } });
  const byTitle = new Map(tasks.map((task) => [task.title, task]));
  const find = (title: string) => {
    const task = byTitle.get(title);
    if (!task) throw new Error(`The demo task "${title}" is missing. Run npm run seed first.`);
    return task;
  };

  out(`Checking the seeded demo project ${PROJECT_CODE}:`);

  const design = find("Complete Engineering Design Review");
  check(design.progressPct === 60, "Design review sits at 60%", `saw ${design.progressPct}%`);
  check(design.status === "IN_PROGRESS", "Design review is in progress", `saw ${design.status}`);

  const inspection = find("Equipment Inspection Close-out");
  check(inspection.progressPct === 100, "Inspection close-out sits at 100%", `saw ${inspection.progressPct}%`);
  check(inspection.status === "COMPLETED", "Inspection close-out is complete", `saw ${inspection.status}`);

  const vendor = find("Vendor Document Review — Compressor Package");
  const vendorStatus = effectiveStatus(vendor.status, vendor.statusOverride);
  check(
    isOverdue(vendor.deadline, vendorStatus, new Date()),
    "Vendor document review is overdue (derived, never stored)",
  );

  const hazop = find("HAZOP Action Close-out");
  const hazopStatus = effectiveStatus(hazop.status, hazop.statusOverride);
  check(hazopStatus === "COMPLETED", "HAZOP close-out shows as complete", `saw ${hazopStatus}`);
  check(hazop.status !== "COMPLETED", "HAZOP close-out is only complete by override, not by derivation");
  check(
    (hazop.overrideReason ?? "").length >= 5 && Boolean(hazop.overriddenById) && Boolean(hazop.overriddenAt),
    "The HAZOP override records who, why and when",
    hazop.overrideReason ?? "no reason stored",
  );

  const overrideRows = await prisma.activityLog.count({
    where: { projectId: project.id, entityId: hazop.id, action: "OVERRIDE_APPLIED" },
  });
  check(overrideRows >= 1, "The override wrote an OVERRIDE_APPLIED audit row");

  // The stage gates. Locked is derived here exactly as the app derives it — if it were ever stored,
  // this check would be reading the app's own opinion back to itself instead of testing it.
  const phases = await prisma.projectPhase.findMany({ where: { projectId: project.id } });
  const phased = await prisma.mainTask.findMany({
    where: { projectId: project.id, phaseId: { not: null }, deletedAt: null },
    select: { phaseId: true, status: true, statusOverride: true },
  });
  const gates = phaseLockedFor(
    phases.map((phase) => {
      const own = phased.filter((task) => task.phaseId === phase.id);
      return {
        id: phase.id,
        name: phase.name,
        sortOrder: phase.sortOrder,
        overridden: phase.overriddenById !== null,
        taskCount: own.length,
        completedCount: own.filter(
          (task) => effectiveStatus(task.status, task.statusOverride) === "COMPLETED",
        ).length,
      };
    }),
  );
  const gate = (name: string) => [...gates.values()].find((row) => row.name === name);

  check(phases.length === 5, "The demo project has its five oil and gas phases", `saw ${phases.length}`);
  check(gate("FEED")?.locked === false, "FEED, the first phase, is never locked");
  check(
    gate("Detail design")?.locked === true &&
      gate("Detail design")?.lockedByPhaseName === "FEED",
    "Detail design is locked until FEED is complete",
    `saw ${gate("Detail design")?.lockedByPhaseName ?? "no lock"}`,
  );
  check(
    inspection.phaseId === null,
    "The inspection close-out sits outside every phase, so it is never gated",
  );

  // The daily brief is entirely computed, so the demo data has to make it say something real: a
  // brief that comes back empty on the demo project would look like a broken feature.
  const admin = await prisma.user.findFirstOrThrow({
    where: { orgId: project.orgId, role: "ADMIN" },
    select: { id: true },
  });
  const adminActor = await actorForUser(admin.id);
  const brief = await projectBrief(adminActor, project.id);
  check(
    brief.blockedTotal + brief.lockedPhases.length + brief.overdueTotal >= 1,
    "The demo project brief names at least one blocker",
    `saw ${brief.blockedTotal} blocked, ${brief.lockedPhases.length} shut gates, ${brief.overdueTotal} overdue`,
  );
  check(
    (brief.nextGate?.items.length ?? 0) + brief.nearestDeadlines.length >= 1,
    "The demo project brief says what must happen next",
    `saw ${brief.nextGate?.items.length ?? 0} gate items and ${brief.nearestDeadlines.length} unphased deadlines`,
  );
  check(
    brief.progress.total > 0 && brief.progress.pct === Math.min(99, Math.floor((100 * brief.progress.completed) / brief.progress.total)),
    "The brief's progress is derived from the main tasks themselves",
    `saw ${brief.progress.completed}/${brief.progress.total} at ${brief.progress.pct}%`,
  );

  const activity = await prisma.activityLog.count({ where: { projectId: project.id } });
  check(activity > 30, "The demo project has a real audit trail (more than 30 entries)", `saw ${activity}`);

  /* ---------------------------------------------------------------- */
  /* The contractors                                                    */
  /* ---------------------------------------------------------------- */

  out("");
  out("Checking the contractors:");

  const contractors = await prisma.user.findMany({
    where: { email: { in: CONTRACTOR_EMAILS } },
    select: { id: true, name: true, role: true, companyName: true, orgId: true },
  });
  check(
    contractors.length === CONTRACTOR_EMAILS.length,
    "Both contractor accounts are there",
    `saw ${contractors.length}`,
  );
  check(
    contractors.every((person) => person.role === "EXTERNAL"),
    "Both contractors hold the External role",
  );
  check(
    contractors.every((person) => (person.companyName ?? "").length > 0),
    "Both contractors carry the company they work for",
    contractors.map((person) => person.companyName ?? "none").join(", "),
  );

  const seats = await prisma.projectMember.findMany({
    where: { projectId: project.id, userId: { in: contractors.map((person) => person.id) } },
    select: { userId: true, projectRole: true },
  });
  check(
    seats.length === contractors.length && seats.every((seat) => seat.projectRole === "EXTERNAL"),
    "Both contractors sit on the demo project as External members",
    `saw ${seats.length} seats: ${seats.map((seat) => seat.projectRole).join(", ")}`,
  );

  const submitted = await prisma.disciplineTask.findFirst({
    where: { title: SUBMITTED_TASK, deletedAt: null, mainTask: { projectId: project.id } },
    select: { id: true, status: true, assigneeId: true },
  });
  check(
    submitted?.status === "AWAITING_REVIEW",
    "The contractor's hand-in is waiting for a sign-off, not completed",
    `saw ${submitted?.status ?? "no task"}`,
  );
  check(
    Boolean(submitted) && contractors.some((person) => person.id === submitted?.assigneeId),
    "The work waiting for a sign-off belongs to a contractor",
  );

  // The queue the dashboard's "Needs your sign-off" counter is built from — asked for exactly as the
  // dashboard asks for it, so a demo that shows nothing there would fail here first.
  const adminQueue = await listAwaitingMySignoff(adminActor);
  check(
    adminQueue.some((item) => item.id === submitted?.id),
    "The administrator's sign-off queue names that task",
    `saw ${adminQueue.length} in the queue`,
  );

  const mechanicalLead = await prisma.user.findFirstOrThrow({
    where: { email: "khalid.alfarsi@tielora.example" },
    select: { id: true },
  });
  const leadQueue = await listAwaitingMySignoff(await actorForUser(mechanicalLead.id));
  check(
    leadQueue.length === 1 && leadQueue[0].id === submitted?.id,
    "The mechanical lead has exactly one thing to sign off",
    `saw ${leadQueue.length}`,
  );

  /* ---------------------------------------------------------------- */
  /* The noticeboard                                                    */
  /* ---------------------------------------------------------------- */

  out("");
  out("Checking the announcements:");

  // "Running" is derived, never stored, so this reads them the way the app does rather than
  // counting rows: anything expired or removed simply does not come back.
  const running = await listAnnouncementsForUser(adminActor);
  const companyWide = running.find((post) => post.audience.kind === "EVERYONE");
  const departmental = running.find((post) => post.audience.kind === "DISCIPLINE");
  check(
    Boolean(companyWide),
    "A company-wide announcement is running",
    companyWide?.title ?? "none found",
  );
  check(
    Boolean(departmental),
    "A department announcement is running",
    departmental ? `${departmental.audience.label}: ${departmental.title ?? ""}` : "none found",
  );

  const boardReplies = await prisma.post.count({
    where: { orgId: project.orgId, kind: "BOARD", parentId: { not: null }, deletedAt: null },
  });
  check(boardReplies >= 2, "The project board has a conversation on it", `saw ${boardReplies} replies`);

  /* ---------------------------------------------------------------- */
  /* The second company, and the wall between them                      */
  /* ---------------------------------------------------------------- */

  out("");
  out("Checking the second company and the wall between them:");

  const northbay = await prisma.organization.findUnique({
    where: { slug: NORTHBAY_SLUG },
    select: { id: true, industryTemplate: true },
  });
  check(Boolean(northbay), "Northbay Construction is seeded");

  const northbayProject = northbay
    ? await prisma.project.findUnique({
        where: { orgId_code: { orgId: northbay.id, code: NORTHBAY_PROJECT_CODE } },
        select: { id: true, orgId: true },
      })
    : null;
  check(Boolean(northbayProject), `Northbay has its ${NORTHBAY_PROJECT_CODE} project`);

  if (northbay && northbayProject) {
    const northbayPhases = await prisma.projectPhase.count({ where: { projectId: northbayProject.id } });
    check(
      northbay.industryTemplate === "CONSTRUCTION" && northbayPhases === 6,
      "Northbay runs the construction template, with its six phases",
      `saw ${northbay.industryTemplate} and ${northbayPhases} phases`,
    );

    const northbayTasks = await prisma.disciplineTask.count({
      where: { deletedAt: null, mainTask: { projectId: northbayProject.id, deletedAt: null } },
    });
    check(northbayTasks >= 8, "Northbay's project has its discipline tasks", `saw ${northbayTasks}`);

    // THE TENANT RULE, the same shape org-isolation.service.test.ts proves it in: a Meridian person
    // resolves none of Northbay's work, and the miss is "not found", never "forbidden".
    const visible = await listProjectsForActor(adminActor);
    check(
      visible.every((seen) => seen.id !== northbayProject.id),
      "A Meridian administrator lists none of Northbay's projects",
      `saw ${visible.length} projects`,
    );

    let refused = false;
    try {
      await getProjectForActor(adminActor, northbayProject.id);
    } catch (error) {
      refused = error instanceof Error && error.name === "NotFoundError";
    }
    check(refused, "Northbay's project is NOT FOUND for a Meridian administrator");

    const northbayAdmin = await prisma.user.findFirstOrThrow({
      where: { orgId: northbay.id, role: "ADMIN" },
      select: { id: true },
    });
    const theirs = await listProjectsForActor(await actorForUser(northbayAdmin.id));
    check(
      theirs.length === 1 && theirs[0].id === northbayProject.id,
      "Northbay's administrator sees their own project and nothing else",
      `saw ${theirs.length} projects`,
    );
  }

  out("");
  if (failures.length > 0) {
    out(`Seed check failed: ${failures.length} problem${failures.length === 1 ? "" : "s"}.`);
    process.exitCode = 1;
    return;
  }
  out("Seed check passed.");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    process.stderr.write(`Seed check failed: ${error instanceof Error ? error.message : String(error)}\n`);
    await prisma.$disconnect();
    process.exit(1);
  });
