import { describe, it, expect } from "vitest";
import { parseHabitAmount } from "./habit-amount";
import { HABIT_AMOUNT_MAX } from "@/lib/constants";

describe("parseHabitAmount — a habit number typed into a box", () => {
  it("reads zero or more, to two decimals at most, as typed", () => {
    expect(parseHabitAmount("3")).toEqual({ value: 3 });
    expect(parseHabitAmount(" 2.5 ")).toEqual({ value: 2.5 });
    expect(parseHabitAmount("0")).toEqual({ value: 0 });
    expect(parseHabitAmount("10000.25")).toEqual({ value: 10000.25 });
  });

  it("refuses what is not a number the routes accept, in plain words", () => {
    expect(parseHabitAmount("")).toEqual({ error: "Enter a number" });
    expect(parseHabitAmount("   ")).toEqual({ error: "Enter a number" });
    for (const text of ["3.125", "-1", "3L", "1e3", ".5", "3.", "1,000"]) {
      expect(parseHabitAmount(text)).toEqual({ error: "Enter a number, to two decimals at most" });
    }
  });

  it("refuses a number over the largest the routes store", () => {
    expect(parseHabitAmount(String(HABIT_AMOUNT_MAX))).toEqual({ value: HABIT_AMOUNT_MAX });
    expect(parseHabitAmount(String(HABIT_AMOUNT_MAX + 1))).toEqual({
      error: `Enter at most ${HABIT_AMOUNT_MAX.toLocaleString("en-GB")}`,
    });
  });
});
