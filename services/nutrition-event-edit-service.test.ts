import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NutritionEvent } from "@/types/check-in";

vi.mock("./nutrition-days-service", () => ({
  getNutritionEventsForDateRange: vi.fn(),
}));

vi.mock("./nutrition-day-edits-service", () => ({
  upsertNutritionDayEdits: vi.fn().mockResolvedValue(undefined),
  deleteNutritionDayEdits: vi.fn(),
}));

vi.mock("@/utils/nutrition-helpers", () => ({
  calculateDailyMacros: vi.fn().mockReturnValue({ proteinG: 150, carbsG: 200, fatG: 60 }),
}));

import { getNutritionEventsForDateRange } from "./nutrition-days-service";
import {
  deleteNutritionDayEdits,
  upsertNutritionDayEdits,
} from "./nutrition-day-edits-service";
import { calculateDailyMacros } from "@/utils/nutrition-helpers";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  materializeNutritionEventDays,
  resetNutritionEventDays,
} from "./nutrition-event-edit-service";

const clientId = "client-1";
const coachId = "coach-7";
const TODAY = "2026-01-15";

/** One computed day, the plan's own numbers unless overridden. */
function day(overrides: Partial<NutritionEvent> = {}): NutritionEvent {
  return {
    id: "2026-02-01",
    clientId,
    nutritionPlanId: "v-1",
    date: "2026-02-01",
    dayOfWeek: "sunday",
    baselineCalories: 2000,
    trainingBurnCalories: 0,
    proteinG: 150,
    carbG: 200,
    fatG: 60,
    dietType: "balanced",
    isTrainingDay: false,
    calorieSurplusPercentage: null,
    includeActivityBurn: true,
    surplusAsCarbs: false,
    isModified: false,
    note: null,
    coachNote: null,
    status: "scheduled",
    ...overrides,
  };
}

const writtenRows = () =>
  vi.mocked(upsertNutritionDayEdits).mock.calls[0][2];

describe("nutrition-event-edit-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getNutritionEventsForDateRange).mockResolvedValue([day()]);
    vi.mocked(deleteNutritionDayEdits).mockResolvedValue(0);
  });

  describe("materializeNutritionEventDays", () => {
    it("a calories-only payload: holds the day's protein and rebalances the rest, as the coach's edit row", async () => {
      const { updated } = await materializeNutritionEventDays({
        clientId,
        coachId,
        dates: ["2026-02-01"],
        edit: { calories: 1800 },
        clientToday: TODAY,
      });

      expect(updated).toBe(1);
      expect(upsertNutritionDayEdits).toHaveBeenCalledTimes(1);
      expect(upsertNutritionDayEdits).toHaveBeenCalledWith(clientId, coachId, [
        { date: "2026-02-01", calories: 1800, proteinG: 150, carbG: 200, fatG: 60, note: null },
      ]);
      // Protein held at the day's own grams, carbs/fat rebalanced to the total.
      expect(calculateDailyMacros).toHaveBeenCalledWith(1800, 150, false, "balanced");
    });

    it("reads the computed days ONCE over the selection's span and writes ONLY the selected dates", async () => {
      // Mon + Wed + Sat with Tue/Thu/Fri gaps: the span is read whole, the
      // gaps are never written.
      vi.mocked(getNutritionEventsForDateRange).mockResolvedValue(
        ["2026-02-02", "2026-02-03", "2026-02-04", "2026-02-05", "2026-02-06", "2026-02-07"].map(
          (date) => day({ id: date, date })
        )
      );

      const { updated } = await materializeNutritionEventDays({
        clientId,
        coachId,
        dates: ["2026-02-07", "2026-02-02", "2026-02-04"],
        edit: { calories: 1800 },
        clientToday: TODAY,
      });

      expect(getNutritionEventsForDateRange).toHaveBeenCalledTimes(1);
      expect(getNutritionEventsForDateRange).toHaveBeenCalledWith(clientId, "2026-02-02", "2026-02-07");
      expect(writtenRows().map((row) => row.date)).toEqual(["2026-02-02", "2026-02-04", "2026-02-07"]);
      expect(updated).toBe(3);
    });

    it("absolute with explicit macros: writes them verbatim", async () => {
      await materializeNutritionEventDays({
        clientId,
        coachId,
        dates: ["2026-02-01"],
        edit: { calories: 1900, proteinG: 170, carbG: 190, fatG: 55 },
        clientToday: TODAY,
      });

      expect(writtenRows()[0]).toMatchObject({ calories: 1900, proteinG: 170, carbG: 190, fatG: 55 });
      expect(calculateDailyMacros).not.toHaveBeenCalled();
    });

    it("absolute with protein only: holds THAT protein and rebalances the rest", async () => {
      await materializeNutritionEventDays({
        clientId,
        coachId,
        dates: ["2026-02-01"],
        edit: { calories: 1900, proteinG: 170 },
        clientToday: TODAY,
      });

      expect(calculateDailyMacros).toHaveBeenCalledWith(1900, 170, false, "balanced");
    });

    it("partial-past: drops past dates and reads only the future span", async () => {
      await materializeNutritionEventDays({
        clientId,
        coachId,
        dates: ["2026-01-01", "2026-02-01"],
        edit: { calories: 1800 },
        clientToday: TODAY,
      });

      expect(getNutritionEventsForDateRange).toHaveBeenCalledWith(clientId, "2026-02-01", "2026-02-01");
      expect(writtenRows().map((row) => row.date)).toEqual(["2026-02-01"]);
    });

    it("no-ops when every selected day is in the past", async () => {
      const { updated } = await materializeNutritionEventDays({
        clientId,
        coachId,
        dates: ["2026-01-01", "2026-01-10"],
        edit: { calories: 1800 },
        clientToday: TODAY,
      });

      expect(updated).toBe(0);
      expect(getNutritionEventsForDateRange).not.toHaveBeenCalled();
      expect(upsertNutritionDayEdits).not.toHaveBeenCalled();
    });

    it("skips a selected day no version covers — there is no target to edit", async () => {
      vi.mocked(getNutritionEventsForDateRange).mockResolvedValue([]);

      const { updated } = await materializeNutritionEventDays({
        clientId,
        coachId,
        dates: ["2026-02-01"],
        edit: { calories: 1800 },
        clientToday: TODAY,
      });

      expect(updated).toBe(0);
      expect(upsertNutritionDayEdits).not.toHaveBeenCalled();
    });

    // D-B: undefined = preserve the day's standing note; "" = clear; text = set.
    it("note set: writes the trimmed note text", async () => {
      await materializeNutritionEventDays({
        clientId,
        coachId,
        dates: ["2026-02-01"],
        edit: { calories: 1800, note: "  Deload week  " },
        clientToday: TODAY,
      });
      expect(writtenRows()[0]).toMatchObject({ note: "Deload week" });
    });

    it("note empty string: clears the note", async () => {
      vi.mocked(getNutritionEventsForDateRange).mockResolvedValue([
        day({ isModified: true, note: "Old note" }),
      ]);
      await materializeNutritionEventDays({
        clientId,
        coachId,
        dates: ["2026-02-01"],
        edit: { calories: 1800, note: "" },
        clientToday: TODAY,
      });
      expect(writtenRows()[0]).toMatchObject({ note: null });
    });

    it("note undefined: the day's standing note survives the edit", async () => {
      vi.mocked(getNutritionEventsForDateRange).mockResolvedValue([
        day({ isModified: true, note: "Old note" }),
      ]);
      await materializeNutritionEventDays({
        clientId,
        coachId,
        dates: ["2026-02-01"],
        edit: { calories: 1800 },
        clientToday: TODAY,
      });
      expect(writtenRows()[0]).toMatchObject({ note: "Old note" });
    });
  });

  // An edit or reset of a today the client has already logged reaches every
  // reader of that log at once: the food log stores no target, so nothing
  // here writes to it (owner, 2026-09-11).
  describe("a logged today", () => {
    it("an edit that includes today writes the edit row and nothing else", async () => {
      vi.mocked(getNutritionEventsForDateRange).mockResolvedValue([day({ id: TODAY, date: TODAY })]);

      await materializeNutritionEventDays({
        clientId,
        coachId,
        dates: [TODAY],
        edit: { calories: 1800 },
        clientToday: TODAY,
      });

      expect(upsertNutritionDayEdits).toHaveBeenCalledTimes(1);
      expect(writtenRows().map((row) => row.date)).toEqual([TODAY]);
    });

    it("a reset that includes today deletes the edit row and nothing else", async () => {
      vi.mocked(deleteNutritionDayEdits).mockResolvedValue(1);

      await resetNutritionEventDays({ clientId, dates: [TODAY], clientToday: TODAY });

      expect(deleteNutritionDayEdits).toHaveBeenCalledTimes(1);
      expect(deleteNutritionDayEdits).toHaveBeenCalledWith(clientId, [TODAY]);
    });

    it("the module touches no food-log writer", () => {
      const source = readFileSync(resolve(__dirname, "nutrition-event-edit-service.ts"), "utf8");
      expect(source).not.toMatch(/daily-log-card-service|nutrition_logs/);
    });
  });

  describe("resetNutritionEventDays", () => {
    it("removes the edits on the future days in one call and reports how many held one", async () => {
      vi.mocked(deleteNutritionDayEdits).mockResolvedValue(2);

      const { reset } = await resetNutritionEventDays({
        clientId,
        dates: ["2026-02-10", "2026-02-01", "2026-02-05"],
        clientToday: TODAY,
      });

      expect(reset).toBe(2);
      expect(deleteNutritionDayEdits).toHaveBeenCalledTimes(1);
      expect(deleteNutritionDayEdits).toHaveBeenCalledWith(clientId, [
        "2026-02-10",
        "2026-02-01",
        "2026-02-05",
      ]);
    });

    it("partial-past: resets only the future days", async () => {
      vi.mocked(deleteNutritionDayEdits).mockResolvedValue(1);

      const { reset } = await resetNutritionEventDays({
        clientId,
        dates: ["2026-01-01", "2026-02-01"],
        clientToday: TODAY,
      });

      expect(reset).toBe(1);
      expect(deleteNutritionDayEdits).toHaveBeenCalledWith(clientId, ["2026-02-01"]);
    });

    it("no-ops when every selected day is in the past", async () => {
      const { reset } = await resetNutritionEventDays({
        clientId,
        dates: ["2026-01-01"],
        clientToday: TODAY,
      });

      expect(reset).toBe(0);
      expect(deleteNutritionDayEdits).not.toHaveBeenCalled();
    });
  });
});
