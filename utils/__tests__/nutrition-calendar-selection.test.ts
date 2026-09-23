import { describe, it, expect } from "vitest";
import type { NutritionEvent } from "@/types/check-in";
import {
  isDateEligible,
  eligibleDatesIn,
  monthDatesWhere,
  weekContaining,
} from "../nutrition-calendar-selection";

// A computed day: it exists exactly when a version covers the date, and its
// status is always "scheduled" (a computed day has no lifecycle).
function ev(date: string, isTrainingDay = false): NutritionEvent {
  return {
    id: date,
    clientId: "c1",
    nutritionPlanId: "np-1",
    date,
    dayOfWeek: "monday",
    baselineCalories: 2000,
    trainingBurnCalories: 0,
    proteinG: 150,
    carbG: 200,
    fatG: 60,
    dietType: "balanced",
    isTrainingDay,
    calorieSurplusPercentage: null,
    includeActivityBurn: true,
    surplusAsCarbs: false,
    isModified: false,
    note: null,
    coachNote: null,
    status: "scheduled",
  };
}

function mapOf(events: NutritionEvent[]): Map<string, NutritionEvent> {
  return new Map(events.map((e) => [e.date, e]));
}

const clientToday = "2026-06-15";

describe("nutrition-calendar-selection", () => {
  describe("isDateEligible", () => {
    it("rejects past dates even with a scheduled event", () => {
      expect(isDateEligible("2026-06-14", mapOf([ev("2026-06-14")]), clientToday)).toBe(false);
    });
    it("accepts today and future days that exist", () => {
      const map = mapOf([ev("2026-06-15"), ev("2026-06-20")]);
      expect(isDateEligible("2026-06-15", map, clientToday)).toBe(true);
      expect(isDateEligible("2026-06-20", map, clientToday)).toBe(true);
    });
    it("rejects a future date with no day — no version covers it, so there is nothing to edit", () => {
      const map = mapOf([ev("2026-06-20")]);
      expect(isDateEligible("2026-06-20", map, clientToday)).toBe(true);
      expect(isDateEligible("2026-06-21", map, clientToday)).toBe(false);
      expect(isDateEligible("2026-06-20", mapOf([]), clientToday)).toBe(false);
    });
  });

  describe("eligibleDatesIn", () => {
    it("keeps only eligible days and preserves order", () => {
      // 06-14 is past; 06-18 has no day (a gap between versions).
      const map = mapOf([ev("2026-06-16"), ev("2026-06-20")]);
      expect(
        eligibleDatesIn(["2026-06-14", "2026-06-16", "2026-06-18", "2026-06-20"], map, clientToday)
      ).toEqual(["2026-06-16", "2026-06-20"]);
    });
  });

  describe("monthDatesWhere", () => {
    const weeks = [["2026-05-31", "2026-06-01", "2026-06-02", "2026-06-03"]];
    const map = mapOf([
      ev("2026-05-31", true), // outside month -> excluded even as train day
      ev("2026-06-01", true),
      ev("2026-06-02", false),
      // 2026-06-03 has no day (no version covers it) -> excluded
    ]);

    it("filters eligible in-month days by the predicate (train days)", () => {
      expect(
        monthDatesWhere(weeks, 5, 2026, map, "2026-06-01", (e) => e.isTrainingDay)
      ).toEqual(["2026-06-01"]);
    });

    it("filters eligible in-month days by the predicate (rest days)", () => {
      expect(
        monthDatesWhere(weeks, 5, 2026, map, "2026-06-01", (e) => !e.isTrainingDay)
      ).toEqual(["2026-06-02"]);
    });
  });

  describe("weekContaining", () => {
    it("returns the week row holding clientToday, else null", () => {
      const weeks = [
        ["2026-06-08", "2026-06-15"],
        ["2026-06-22", "2026-06-29"],
      ];
      expect(weekContaining(weeks, "2026-06-15")).toEqual(["2026-06-08", "2026-06-15"]);
      expect(weekContaining(weeks, "2026-07-01")).toBeNull();
    });
  });
});
