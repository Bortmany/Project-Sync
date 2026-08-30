// Proves the seeded demo data still obeys the golden rule: derived progress, derived overdue,
// a recorded override, and an audit trail that was actually written. Run after `npm run seed`.

import "dotenv/config";
import { prisma } from "@/lib/db";
import { effectiveStatus, isOverdue } from "@/lib/progress";

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
    where: { code: PROJECT_CODE, organization: { slug: "tielora-demo" } },
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
