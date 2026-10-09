// The database half of the one shared "late" rule (see src/lib/late.ts): per-project counts of late
// main tasks and late discipline tasks, for any set of projects, in one query per kind.
//
// Scoped to the organisation: a project id from another company simply counts nothing.

import { notDeleted, prisma } from "@/lib/db";
import { dayWindow, type LateCounts } from "@/lib/late";

/**
 * Late main tasks and late discipline tasks per project. Every requested project gets an entry
 * (zeros when nothing is late). Late means: live row, deadline day over (`overdueCutoff`), and not
 * complete by the EFFECTIVE status — a main task's override wins; a discipline task's own status
 * is the truth. A discipline task under a deleted main task does not count.
 */
export async function lateCountsByProject(
  orgId: string,
  projectIds: string[],
  now: Date = new Date(),
): Promise<Map<string, LateCounts>> {
  const result = new Map<string, LateCounts>();
  const ids = [...new Set(projectIds)];
  for (const id of ids) result.set(id, { lateMain: 0, lateDiscipline: 0 });
  if (ids.length === 0) return result;

  const { overdueCutoff } = dayWindow(now);
  const scope = { projectId: { in: ids }, project: { orgId, ...notDeleted }, ...notDeleted };

  const [mainRows, disciplineRows] = await Promise.all([
    prisma.mainTask.groupBy({
      by: ["projectId"],
      where: {
        ...scope,
        deadline: { lte: overdueCutoff },
        // Effective status is not COMPLETED: an override decides when there is one.
        OR: [
          { statusOverride: null, status: { not: "COMPLETED" } },
          { statusOverride: { not: null }, NOT: { statusOverride: "COMPLETED" } },
        ],
      },
      _count: { _all: true },
    }),
    prisma.disciplineTask.findMany({
      where: {
        ...notDeleted,
        status: { not: "COMPLETED" },
        deadline: { lte: overdueCutoff },
        mainTask: scope,
      },
      select: { mainTask: { select: { projectId: true } } },
    }),
  ]);

  for (const row of mainRows) {
    const entry = result.get(row.projectId);
    if (entry) entry.lateMain = row._count._all;
  }
  for (const row of disciplineRows) {
    const entry = result.get(row.mainTask.projectId);
    if (entry) entry.lateDiscipline += 1;
  }
  return result;
}
