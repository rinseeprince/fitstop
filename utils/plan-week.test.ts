import { describe, it, expect } from "vitest";
import { planWeek } from "./plan-week";

describe("planWeek", () => {
  it("returns null before the plan starts", () => {
    expect(planWeek("2026-01-05", "2026-01-04", 4)).toBeNull();
  });

  it("returns week 1 on the start date", () => {
    expect(planWeek("2026-01-05", "2026-01-05", 4)).toBe(1);
  });

  it("returns week 1 through day 6 and week 2 from day 7", () => {
    expect(planWeek("2026-01-05", "2026-01-11", 4)).toBe(1);
    expect(planWeek("2026-01-05", "2026-01-12", 4)).toBe(2);
  });

  it("returns the final week on its last day", () => {
    // 4-week plan starting Jan 5 → day 27 (Feb 1) is the last day of week 4
    expect(planWeek("2026-01-05", "2026-02-01", 4)).toBe(4);
  });

  it("returns null once the window has ended", () => {
    // day 28 → week 5 > durationWeeks 4
    expect(planWeek("2026-01-05", "2026-02-02", 4)).toBeNull();
  });

  it("is uncapped when the plan has no duration", () => {
    expect(planWeek("2026-01-05", "2026-04-06", null)).toBe(14);
    expect(planWeek("2026-01-05", "2026-04-06", undefined)).toBe(14);
  });

  it("is stable across a DST boundary (UTC-part day math)", () => {
    // US DST spring-forward 2026-03-08 sits inside this span
    expect(planWeek("2026-03-02", "2026-03-09", 8)).toBe(2);
  });
});
