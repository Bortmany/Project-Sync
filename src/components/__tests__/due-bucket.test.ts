// The date groups on the dashboard and My tasks. Pins the September finding: a task completed weeks
// after its deadline was filed under "TODAY" and answered the "Due today" filter.

import { describe, expect, it } from "vitest";
import { dueBucket } from "@/components/format";

// Midday local time on 8 Sep 2026, so the local calendar day is the 8th in every time zone.
const NOW = new Date(2026, 8, 8, 12, 0, 0);
const utcDay = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe("dueBucket", () => {
  it("files completed work under no date bucket at all, however old its deadline", () => {
    expect(dueBucket(utcDay(2026, 8, 20), false, NOW, "COMPLETED")).toBeNull();
    expect(dueBucket(utcDay(2026, 9, 8), false, NOW, "COMPLETED")).toBeNull();
    expect(dueBucket(utcDay(2026, 9, 10), false, NOW, "COMPLETED")).toBeNull();
  });

  it("still groups open work by its deadline", () => {
    expect(dueBucket(utcDay(2026, 9, 1), true, NOW, "IN_PROGRESS")).toBe("overdue");
    expect(dueBucket(utcDay(2026, 9, 8), false, NOW, "IN_PROGRESS")).toBe("today");
    expect(dueBucket(utcDay(2026, 9, 9), false, NOW, "NOT_STARTED")).toBe("week");
    expect(dueBucket(utcDay(2026, 9, 15), false, NOW, "BLOCKED")).toBe("week");
    expect(dueBucket(utcDay(2026, 9, 16), false, NOW, "BLOCKED")).toBe("later");
  });

  it("puts work due this week under 'This week', not an empty group", () => {
    const due = [9, 11, 14].map((day) => dueBucket(utcDay(2026, 9, day), false, NOW, "IN_PROGRESS"));
    expect(due).toEqual(["week", "week", "week"]);
  });
});
