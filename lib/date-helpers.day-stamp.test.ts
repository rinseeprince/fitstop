import { afterEach, describe, expect, it } from "vitest";
import { format } from "date-fns";
import { dayFromUtcStamp } from "./date-helpers";

// A logged session's day is its workout's date written at UTC midnight
// (session_logs.completed_at). Read straight off the timestamp, a browser west
// of UTC shows the day before; dayFromUtcStamp reads the day the stamp names.
describe("dayFromUtcStamp", () => {
  const original = process.env.TZ;
  afterEach(() => {
    process.env.TZ = original;
  });

  it.each([
    "UTC",
    "America/Los_Angeles", // -7/-8: where the timestamp itself reads the day before
    "America/Sao_Paulo",
    "Europe/London",
    "Pacific/Auckland", // +12/+13
    "Pacific/Kiritimati", // +14
  ])("reads the stamped day under TZ=%s", (tz) => {
    process.env.TZ = tz;
    for (const stamp of ["2026-09-17T00:00:00+00:00", "2026-09-17T00:00:00Z", "2026-09-17"]) {
      expect(format(dayFromUtcStamp(stamp), "yyyy-MM-dd")).toBe("2026-09-17");
    }
  });

  it("is a local midnight, so a calendar-day difference counts the viewer's days", () => {
    process.env.TZ = "America/Los_Angeles";
    const day = dayFromUtcStamp("2026-03-15T00:00:00+00:00");
    expect(day.getHours()).toBe(0);
    expect(day.getDate()).toBe(15);
  });
});
