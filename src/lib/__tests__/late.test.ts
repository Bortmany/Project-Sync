import { describe, expect, it } from "vitest";
import { dayWindow, daysLate, isLate } from "@/lib/late";

const DAY_MS = 24 * 60 * 60 * 1000;
const now = new Date("2026-10-10T09:00:00Z");
const today = new Date("2026-10-10T00:00:00Z");
const yesterday = new Date(today.getTime() - DAY_MS);

describe("one definition of late", () => {
  it("is not late on the deadline day, and late once the whole day has passed", () => {
    expect(isLate({ deadline: today, status: "IN_PROGRESS" }, now)).toBe(false);
    const lateEvening = new Date("2026-10-10T23:59:00Z");
    expect(isLate({ deadline: today, status: "IN_PROGRESS" }, lateEvening)).toBe(false);
    expect(isLate({ deadline: yesterday, status: "IN_PROGRESS" }, now)).toBe(true);
    expect(isLate({ deadline: new Date(today.getTime() - 2 * DAY_MS), status: "NOT_STARTED" }, now)).toBe(true);
  });

  it("never calls complete work late, and lets an authorised override decide", () => {
    const past = new Date(today.getTime() - 5 * DAY_MS);
    expect(isLate({ deadline: past, status: "COMPLETED" }, now)).toBe(false);
    expect(isLate({ deadline: past, status: "IN_PROGRESS", statusOverride: "COMPLETED" }, now)).toBe(false);
    expect(isLate({ deadline: past, status: "COMPLETED", statusOverride: "IN_PROGRESS" }, now)).toBe(true);
  });

  it("never calls a deleted row late", () => {
    const past = new Date(today.getTime() - 5 * DAY_MS);
    expect(isLate({ deadline: past, status: "IN_PROGRESS", deletedAt: now }, now)).toBe(false);
  });

  it("draws the same line in memory and for the database", () => {
    const { overdueCutoff } = dayWindow(now);
    for (const hours of [-49, -25, -24, -23, 0, 5]) {
      const deadline = new Date(now.getTime() + hours * 3600_000);
      expect(isLate({ deadline, status: "IN_PROGRESS" }, now)).toBe(deadline <= overdueCutoff);
    }
  });
});

describe("days late", () => {
  it("is 1 the morning after the deadline day, never 0, and grows a day at a time", () => {
    expect(daysLate(today, new Date("2026-10-11T00:00:00Z"))).toBe(1);
    expect(daysLate(yesterday, now)).toBe(1);
    expect(daysLate(new Date(today.getTime() - 4 * DAY_MS), now)).toBe(4);
    expect(daysLate(today, now)).toBe(1);
  });
});
