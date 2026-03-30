import { describe, it, expect } from "vitest";
import { getTrainingWeekStart, getTrainingWeekEnd } from "@/lib/date-helpers";

describe("getTrainingWeekStart", () => {
  it("defaults to Monday when checkInDay is null", () => {
    // 2026-03-30 is a Monday
    expect(getTrainingWeekStart("2026-03-30", null)).toBe("2026-03-30");
    // 2026-03-31 is a Tuesday
    expect(getTrainingWeekStart("2026-03-31", null)).toBe("2026-03-30");
    // 2026-04-05 is a Sunday
    expect(getTrainingWeekStart("2026-04-05", null)).toBe("2026-03-30");
  });

  it("defaults to Monday when checkInDay is undefined", () => {
    expect(getTrainingWeekStart("2026-03-31")).toBe("2026-03-30");
  });

  it("uses day after check-in day as week start for Sunday check-in", () => {
    // Check-in on Sunday -> week starts Monday (same as default)
    // 2026-03-30 is Monday, should be start of its own week
    expect(getTrainingWeekStart("2026-03-30", "sunday")).toBe("2026-03-30");
    // 2026-04-05 is Sunday (check-in day), last day of the week
    expect(getTrainingWeekStart("2026-04-05", "sunday")).toBe("2026-03-30");
  });

  it("uses day after check-in day for Wednesday check-in", () => {
    // Check-in on Wednesday -> week starts Thursday
    // 2026-04-02 is Thursday -> start of its own week
    expect(getTrainingWeekStart("2026-04-02", "wednesday")).toBe("2026-04-02");
    // 2026-04-01 is Wednesday (check-in day) -> last day of previous week
    expect(getTrainingWeekStart("2026-04-01", "wednesday")).toBe("2026-03-26");
    // 2026-03-30 is Monday -> still in the Thu Mar 26 week
    expect(getTrainingWeekStart("2026-03-30", "wednesday")).toBe("2026-03-26");
    // 2026-04-05 is Sunday -> in the Thu Apr 2 week
    expect(getTrainingWeekStart("2026-04-05", "wednesday")).toBe("2026-04-02");
  });

  it("uses day after check-in day for Saturday check-in", () => {
    // Check-in on Saturday -> week starts Sunday
    // 2026-03-29 is Sunday -> start of its own week
    expect(getTrainingWeekStart("2026-03-29", "saturday")).toBe("2026-03-29");
    // 2026-03-28 is Saturday (check-in day) -> last day of previous week
    expect(getTrainingWeekStart("2026-03-28", "saturday")).toBe("2026-03-22");
    // 2026-04-04 is Saturday -> last day of current week
    expect(getTrainingWeekStart("2026-04-04", "saturday")).toBe("2026-03-29");
  });

  it("handles date on the week start day itself", () => {
    // Wednesday check-in -> week starts Thursday
    // 2026-04-02 is Thursday -> should be start of current week, not previous
    expect(getTrainingWeekStart("2026-04-02", "wednesday")).toBe("2026-04-02");
  });

  it("handles date on the check-in day (last day of week)", () => {
    // Wednesday check-in -> week starts Thursday, ends Wednesday
    // 2026-04-08 is Wednesday -> last day of the Apr 2 week
    expect(getTrainingWeekStart("2026-04-08", "wednesday")).toBe("2026-04-02");
  });
});

describe("getTrainingWeekEnd", () => {
  it("returns 6 days after week start", () => {
    // Monday start -> Sunday end
    expect(getTrainingWeekEnd("2026-03-30", null)).toBe("2026-04-05");
    // Thursday start (Wednesday check-in) -> Wednesday end
    expect(getTrainingWeekEnd("2026-04-02", "wednesday")).toBe("2026-04-08");
  });
});
