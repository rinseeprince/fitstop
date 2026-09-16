import { describe, it, expect } from "vitest";
import { monthOf, monthPage, shiftMonth } from "./month-grid";

describe("monthOf", () => {
  it("is the first of the date's month", () => {
    expect(monthOf("2026-09-23")).toBe("2026-09-01");
    expect(monthOf("2026-09-01")).toBe("2026-09-01");
    expect(monthOf("2026-12-31")).toBe("2026-12-01");
  });
});

describe("shiftMonth", () => {
  it("steps forward and back within a year", () => {
    expect(shiftMonth("2026-09-01", 1)).toBe("2026-10-01");
    expect(shiftMonth("2026-09-01", -1)).toBe("2026-08-01");
  });

  it("crosses the year in both directions", () => {
    expect(shiftMonth("2026-12-01", 1)).toBe("2027-01-01");
    expect(shiftMonth("2027-01-01", -1)).toBe("2026-12-01");
    expect(shiftMonth("2026-09-01", 16)).toBe("2028-01-01");
    expect(shiftMonth("2026-09-01", -21)).toBe("2024-12-01");
  });
});

describe("monthPage", () => {
  it("is six weeks of seven days", () => {
    expect(monthPage("2026-09-01")).toHaveLength(42);
    expect(monthPage("2027-02-01")).toHaveLength(42);
  });

  it("starts on Monday: September 2026 begins on a Tuesday, in the second cell", () => {
    const page = monthPage("2026-09-01");
    expect(page[0]).toBeNull();
    expect(page[1]).toBe("2026-09-01");
    // Wednesday 16 September sits under Wednesday, the third column.
    expect(page.indexOf("2026-09-16") % 7).toBe(2);
  });

  it("holds every day of the month once, in order, and nothing outside it", () => {
    const days = monthPage("2026-09-01").filter((cell): cell is string => cell !== null);
    expect(days).toHaveLength(30);
    expect(days[0]).toBe("2026-09-01");
    expect(days[29]).toBe("2026-09-30");
    expect(days.every((day, i) => i === 0 || day > days[i - 1])).toBe(true);
    expect(days.every((day) => day.startsWith("2026-09-"))).toBe(true);
  });

  it("a month that begins on a Monday fills the first cell; a leap February has 29 days", () => {
    expect(monthPage("2027-02-01")[0]).toBe("2027-02-01");
    expect(monthPage("2028-02-01").filter(Boolean)).toHaveLength(29);
  });

  it("a month that begins on a Sunday starts in the last column", () => {
    // 1 November 2026 is a Sunday.
    const page = monthPage("2026-11-01");
    expect(page.indexOf("2026-11-01")).toBe(6);
    expect(page.slice(0, 6).every((cell) => cell === null)).toBe(true);
  });
});
