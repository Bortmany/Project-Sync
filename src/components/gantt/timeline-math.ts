// The arithmetic behind the timeline: which day sits at which pixel, and what the column headers say.
// Everything is whole days — bars snap to a day, never to an hour.
//
// Every date this file produces is a UTC midnight, because that is how task dates are stored. A bar
// dragged by three days therefore lands on exactly the same instant a date typed into the editor
// would, so "overdue" cannot depend on how the date was entered.

import { formatShortDate } from "@/components/format";
import type { GanttDTO } from "@/lib/zod-schemas";

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Row height in the tree and on the chart — the two panes must always line up. */
export const ROW_HEIGHT = 32;
export const HEADER_HEIGHT = 28;

export type Zoom = "weeks" | "months";

/** Pixels per day at each zoom level. */
export const DAY_WIDTH: Record<Zoom, number> = { weeks: 22, months: 6 };

/** Days of padding around the work, so a bar never touches the edge of the chart. */
const PAD_BEFORE = 4;
const PAD_AFTER = 10;

const MONTH_YEAR = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" });

/** The UTC midnight of the day a stored date belongs to. */
export function startOfDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

/** Today as the chart counts it: the viewer's own calendar day, held as a UTC midnight. */
export function todayUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

export function addDays(value: Date, days: number): Date {
  return new Date(startOfDay(value).getTime() + days * DAY_MS);
}

/** Whole days from one midnight to another — UTC midnights, so no daylight saving to trip over. */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY_MS);
}

/** The Sunday that starts this date's week — the working week in Oman runs Sunday to Thursday. */
function startOfWeek(value: Date): Date {
  return addDays(value, -startOfDay(value).getUTCDay());
}

/** Friday and Saturday are the weekend here, and are shaded on the chart. */
export function isWeekend(value: Date): boolean {
  const day = value.getUTCDay();
  return day === 5 || day === 6;
}

export type TimeRange = { start: Date; end: Date; days: number };

/** The span the chart covers: every date in the data, today, and a little breathing room. */
export function rangeFor(gantt: GanttDTO, zoom: Zoom, now: Date = new Date()): TimeRange {
  const dates: Date[] = [todayUtc(now)];
  for (const task of gantt.mainTasks) {
    if (task.startDate) dates.push(task.startDate);
    dates.push(task.deadline);
    for (const subtask of task.disciplineTasks) {
      if (subtask.startDate) dates.push(subtask.startDate);
      dates.push(subtask.deadline);
    }
  }

  const earliest = dates.reduce((min, date) => (date < min ? date : min), dates[0]);
  const latest = dates.reduce((max, date) => (date > max ? date : max), dates[0]);

  const paddedStart = addDays(earliest, -PAD_BEFORE);
  const paddedEnd = addDays(latest, PAD_AFTER);

  const start =
    zoom === "weeks"
      ? startOfWeek(paddedStart)
      : new Date(Date.UTC(paddedStart.getUTCFullYear(), paddedStart.getUTCMonth(), 1));
  const end =
    zoom === "weeks"
      ? addDays(startOfWeek(paddedEnd), 6)
      : new Date(Date.UTC(paddedEnd.getUTCFullYear(), paddedEnd.getUTCMonth() + 1, 0));

  return { start, end, days: daysBetween(start, end) + 1 };
}

/** Where a date sits, in pixels from the left edge of the chart. */
export function xFor(date: Date, range: TimeRange, zoom: Zoom): number {
  return daysBetween(range.start, date) * DAY_WIDTH[zoom];
}

export type Column = { key: string; x: number; width: number; label: string };

/** The header columns: one per week ("18–24 Aug") or one per month ("Aug 2026"). */
export function columnsFor(range: TimeRange, zoom: Zoom): Column[] {
  const columns: Column[] = [];
  const width = DAY_WIDTH[zoom];

  if (zoom === "weeks") {
    for (let cursor = new Date(range.start); cursor <= range.end; cursor = addDays(cursor, 7)) {
      const last = addDays(cursor, 6);
      columns.push({
        key: cursor.toISOString(),
        x: daysBetween(range.start, cursor) * width,
        width: 7 * width,
        label: `${cursor.getUTCDate()}–${formatShortDate(last)}`,
      });
    }
    return columns;
  }

  let cursor = new Date(Date.UTC(range.start.getUTCFullYear(), range.start.getUTCMonth(), 1));
  while (cursor <= range.end) {
    const next = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    const days = daysBetween(cursor, next);
    columns.push({
      key: cursor.toISOString(),
      x: daysBetween(range.start, cursor) * width,
      width: days * width,
      label: MONTH_YEAR.format(cursor),
    });
    cursor = next;
  }
  return columns;
}

/** The weekend days inside the range — drawn as light shading behind the bars. */
export function weekendDays(range: TimeRange): number[] {
  const days: number[] = [];
  for (let index = 0; index < range.days; index += 1) {
    if (isWeekend(addDays(range.start, index))) days.push(index);
  }
  return days;
}
