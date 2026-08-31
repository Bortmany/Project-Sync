// Proves the seeded demo data still obeys the golden rule: derived progress, derived overdue,
// a recorded override, and an audit trail that was actually written. Run after `npm run seed`.

import "dotenv/config";
import { prisma } from "@/lib/db";
import { phaseLockedFor } from "@/lib/phase-lock";
import { effectiveStatus, isOverdue } from "@/lib/progress";
import { actorForUser } from "@/server/actor";
import { projectBrief } from "@/server/services/briefs";

const PROJECT_CODE = "SUR-EXP";
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
  const brief = await projectBrief(await actorForUser(admin.id), project.id);
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
