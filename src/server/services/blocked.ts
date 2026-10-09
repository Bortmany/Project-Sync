// ONE definition of "blocked", shared by the dashboard tile, the project Brief, the daily and weekly
// briefs and the exported report — the twin of the shared "late" rule (src/lib/late.ts and
// ./late.ts).
//
// A task is blocked when its EFFECTIVE status is BLOCKED (a main task's authorised override wins
// over the derived status; a discipline task's own status is the truth). Both kinds count — the
// dashboard's existing rule — and live rows only. A discipline task under a deleted main task does
// not count. Nothing is stored: this is the database half, and the dashboard's `matchesTile()` is
// the same condition judged in memory.

import { notDeleted, prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

/** A main task whose effective status is BLOCKED: no override and derived BLOCKED, or override BLOCKED. */
export const mainBlockedWhere: Prisma.MainTaskWhereInput = {
  OR: [
    { statusOverride: null, status: "BLOCKED" },
    { statusOverride: "BLOCKED" },
  ],
};

/** A discipline task whose own status is BLOCKED. */
export const disciplineBlockedWhere: Prisma.DisciplineTaskWhereInput = { status: "BLOCKED" };

export type BlockedCounts = { blockedMain: number; blockedDiscipline: number };

/** The one number every screen prints: main and discipline tasks together. */
export function blockedTotal(counts: BlockedCounts): number {
  return counts.blockedMain + counts.blockedDiscipline;
}

/**
 * Blocked main tasks and blocked discipline tasks per project. Every requested project gets an
 * entry (zeros when nothing is blocked). Scoped to the organisation: a project id from another
 * company simply counts nothing.
 */
export async function blockedCountsByProject(
  orgId: string,
  projectIds: string[],
): Promise<Map<string, BlockedCounts>> {
  const result = new Map<string, BlockedCounts>();
  const ids = [...new Set(projectIds)];
  for (const id of ids) result.set(id, { blockedMain: 0, blockedDiscipline: 0 });
  if (ids.length === 0) return result;

  const scope = { projectId: { in: ids }, project: { orgId, ...notDeleted }, ...notDeleted };

  const [mainRows, disciplineRows] = await Promise.all([
    prisma.mainTask.groupBy({
      by: ["projectId"],
      where: { ...scope, AND: [mainBlockedWhere] },
      _count: { _all: true },
    }),
    prisma.disciplineTask.findMany({
      where: { ...notDeleted, ...disciplineBlockedWhere, mainTask: scope },
      select: { mainTask: { select: { projectId: true } } },
    }),
  ]);

  for (const row of mainRows) {
    const entry = result.get(row.projectId);
    if (entry) entry.blockedMain = row._count._all;
  }
  for (const row of disciplineRows) {
    const entry = result.get(row.mainTask.projectId);
    if (entry) entry.blockedDiscipline += 1;
  }
  return result;
}
