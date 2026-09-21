import { afterEach, describe, expect, it } from "vitest";
import { daysAgoText } from "./exercise-marker-kpis";

// How long since a best was set counts the viewer's calendar days from the day
// the session's stamp names (a UTC-midnight day stamp), so it agrees with the
// date the Sessions table and the PR cards print beside it.
describe("daysAgoText", () => {
  const original = process.env.TZ;
  afterEach(() => {
    process.env.TZ = original;
  });

  it("reads Today through the viewer's own evening west of Greenwich", () => {
    process.env.TZ = "America/Los_Angeles";
    const stamp = "2026-09-17T00:00:00+00:00";
    // 8pm on the 17th in Los Angeles is already 03:00 on the 18th in UTC
    expect(daysAgoText(stamp, new Date(2026, 8, 17, 20, 0).getTime())).toBe("Today");
    expect(daysAgoText(stamp, new Date(2026, 8, 18, 9, 0).getTime())).toBe("1 day ago");
  });

  it("counts calendar days, not 24-hour spans", () => {
    process.env.TZ = "Europe/London";
    const stamp = "2026-09-17T00:00:00+00:00";
    expect(daysAgoText(stamp, new Date(2026, 8, 18, 0, 30).getTime())).toBe("1 day ago");
    expect(daysAgoText(stamp, new Date(2026, 8, 29, 12, 0).getTime())).toBe("12 days ago");
  });
});
