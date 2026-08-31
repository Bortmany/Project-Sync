// A contractor's access end date is a DAY, stored at UTC midnight, and it has to survive being
// edited without moving.
//
// The bug this pins: the edit dialog pre-filled the field with the LOCAL reading of that instant,
// which west of Greenwich is the day BEFORE. The form sent that day back, so every save walked the
// date one day earlier and locked the contractor out sooner than the administrator had said.
//
// Everything below is true in every time zone — the file deliberately does NOT move the process
// clock, because these tests share a worker with the database suites and a clock change there is
// not a local act.

import { describe, expect, it } from "vitest";
import { formatDateUtc, toDateInputValue, toUtcDateInputValue } from "@/components/format";

/** The instant "30 Sep 2026" is stored as, in the database and in the DTO. */
const STORED = new Date("2026-09-30T00:00:00.000Z");

/** What the date field sends back, exactly as the admin form does: `new Date("YYYY-MM-DD")`. */
function saved(fieldValue: string): Date {
  return new Date(fieldValue);
}

describe("an access end date put back into the edit form", () => {
  it("names the stored UTC day, not the reader's local one", () => {
    expect(toUtcDateInputValue(STORED)).toBe("2026-09-30");
  });

  it("comes back the very same instant, however many times it is saved", () => {
    let value = STORED;
    for (let save = 0; save < 3; save += 1) {
      value = saved(toUtcDateInputValue(value));
      expect(value.toISOString()).toBe(STORED.toISOString());
    }
  });

  it("is what the local reading cannot promise: that reading is only safe on a UTC clock", () => {
    // On this machine both may agree; the point is the rule, which holds anywhere: the local
    // helper's answer is a day earlier for anybody behind UTC, and saving it stores that day.
    const localReading = toDateInputValue(STORED);
    const offsetMinutes = STORED.getTimezoneOffset();

    if (offsetMinutes > 0) expect(saved(localReading).getTime()).toBeLessThan(STORED.getTime());
    else expect(saved(localReading).getTime()).toBe(STORED.getTime());
  });

  it("reads on the admin screen as the day that was stored", () => {
    // The month's short name is whatever this runtime's English data calls it ("Sep" / "Sept");
    // the day and the year are the point — formatDateUtc pins them in every time zone.
    expect(formatDateUtc(STORED)).toMatch(/^30 Sep\w* 2026$/);
  });

  it("is blank, not today, when there is no expiry", () => {
    expect(toUtcDateInputValue(null)).toBe("");
    expect(toUtcDateInputValue(undefined)).toBe("");
  });
});
