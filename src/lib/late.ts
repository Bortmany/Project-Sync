// ONE definition of "late", shared by every screen, brief and report.
//
// A task is late when its whole deadline day has passed and it is not complete — by its EFFECTIVE
// status (an authorised override wins over the derived one). Live rows only. Nothing is stored:
// the database line (`dayWindow().overdueCutoff`) and the in-memory test (`isLate()`) are the same
// rule drawn twice, and both are `isOverdue()` underneath.

import { effectiveStatus, isOverdue, type TaskStatusValue } from "@/lib/progress";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The moment a deadline stops being "today". Deadlines are saved at UTC midnight and mean "by the
 * end of that day" (`isOverdue`), so the day window is worked out in UTC too — the same clock the
 * deadlines themselves were written on.
 */
export function dayWindow(now: Date): { startOfDay: Date; endOfDay: Date; overdueCutoff: Date } {
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return {
    startOfDay,
    endOfDay: new Date(startOfDay.getTime() + DAY_MS),
    // isOverdue() is `deadline + one day <= now`, so this is the same line drawn in the database.
    overdueCutoff: new Date(now.getTime() - DAY_MS),
  };
}

/** The in-memory row shape the pure test needs. Discipline tasks carry no override: leave it out. */
export type LateCheckRow = {
  deadline: Date;
  status: TaskStatusValue;
  statusOverride?: TaskStatusValue | null;
  deletedAt?: Date | null;
};

/** Is this row late right now? Deleted rows are never late. */
export function isLate(row: LateCheckRow, now: Date = new Date()): boolean {
  if (row.deletedAt) return false;
  return isOverdue(row.deadline, effectiveStatus(row.status, row.statusOverride), now);
}

/** Whole days past the deadline day: 1 the morning after, never 0. THE days-late figure everywhere. */
export function daysLate(deadline: Date, now: Date = new Date()): number {
  return Math.max(1, Math.floor((now.getTime() - deadline.getTime()) / DAY_MS));
}

export type LateCounts = { lateMain: number; lateDiscipline: number };
