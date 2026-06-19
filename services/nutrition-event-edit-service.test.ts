import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase-admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock("@/services/nutrition-event-service", () => ({
  regenerateFutureNutritionEvents: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/utils/nutrition-helpers", () => ({
  calculateDailyMacros: vi.fn().mockReturnValue({ proteinG: 150, carbsG: 200, fatG: 60 }),
}));

import { supabaseAdmin } from "./supabase-admin";
import { regenerateFutureNutritionEvents } from "@/services/nutrition-event-service";
import {
  materializeNutritionEventRange,
  resetNutritionEvent,
} from "./nutrition-event-edit-service";

type Row = {
  id: string;
  baseline_calories: number;
  protein_g: number;
  training_burn_calories: number;
  calorie_surplus_percentage: number | null;
  diet_type: string;
};

const updateEqSpy = vi.fn();
const updateSpy = vi.fn();
const gteSpy = vi.fn();

/** from() returns a node that serves both the ranged select and per-row updates. */
function mockEvents(rows: Row[]): void {
  // Update chain is thenable so both `.update().eq(...)` (materialize: 1 eq)
  // and `.update().eq().eq().eq()` (reset: 3 eqs) await to { error: null }.
  const updateChain: Record<string, unknown> = {
    then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
  };
  updateChain.eq = updateEqSpy.mockReturnValue(updateChain);
  updateSpy.mockReturnValue(updateChain);

  const selectChain: Record<string, unknown> = {};
  selectChain.eq = vi.fn().mockReturnValue(selectChain);
  selectChain.gte = gteSpy.mockReturnValue(selectChain);
  selectChain.lte = vi.fn().mockResolvedValue({ data: rows, error: null });

  vi.mocked(supabaseAdmin.from).mockReturnValue({
    select: vi.fn().mockReturnValue(selectChain),
    update: updateSpy,
  } as never);
}

const clientId = "client-1";

describe("nutrition-event-edit-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("materializeNutritionEventRange", () => {
    it("absolute: materializes calories + macros, freezes surplus/burn, flags modified", async () => {
      mockEvents([
        {
          id: "e1",
          baseline_calories: 2000,
          protein_g: 150,
          training_burn_calories: 0,
          calorie_surplus_percentage: null,
          diet_type: "balanced",
        },
      ]);

      const { updated } = await materializeNutritionEventRange(
        clientId,
        "2026-02-01",
        "2026-02-07",
        { mode: "absolute", calories: 1800 },
        "2026-01-15"
      );

      expect(updated).toBe(1);
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          baseline_calories: 1800,
          protein_g: 150,
          carb_g: 200,
          fat_g: 60,
          calorie_surplus_percentage: null,
          training_burn_calories: 0,
          is_modified: true,
        })
      );
      expect(updateEqSpy).toHaveBeenCalledWith("id", "e1");
    });

    it("delta: scales the surplus-stacked displayed calories", async () => {
      mockEvents([
        {
          id: "e1",
          baseline_calories: 2000,
          protein_g: 150,
          training_burn_calories: 0,
          calorie_surplus_percentage: 10, // displayed = round(2000 * 1.1) = 2200
          diet_type: "balanced",
        },
      ]);

      await materializeNutritionEventRange(
        clientId,
        "2026-02-01",
        "2026-02-07",
        { mode: "delta", percent: -50 },
        "2026-01-15"
      );

      // 2200 * 0.5 = 1100
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ baseline_calories: 1100, calorie_surplus_percentage: null })
      );
    });

    it("floors the window at clientToday when the range starts in the past", async () => {
      mockEvents([]);

      await materializeNutritionEventRange(
        clientId,
        "2026-01-01",
        "2026-02-07",
        { mode: "absolute", calories: 1800 },
        "2026-01-15"
      );

      // The select is floored to clientToday, never the past startDate.
      expect(gteSpy).toHaveBeenCalledWith("date", "2026-01-15");
    });

    it("no-ops when the whole range is in the past", async () => {
      const { updated } = await materializeNutritionEventRange(
        clientId,
        "2026-01-01",
        "2026-01-10",
        { mode: "absolute", calories: 1800 },
        "2026-01-15"
      );
      expect(updated).toBe(0);
      expect(supabaseAdmin.from).not.toHaveBeenCalled();
    });
  });

  describe("resetNutritionEvent", () => {
    it("clears is_modified BEFORE regenerating that date from the plan", async () => {
      mockEvents([]);

      await resetNutritionEvent(clientId, "2026-02-01", "plan-1");

      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ is_modified: false })
      );
      expect(regenerateFutureNutritionEvents).toHaveBeenCalledWith(
        clientId,
        "plan-1",
        "2026-02-01"
      );
      // Order: the flag flip must resolve before the regen is invoked.
      expect(updateSpy.mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(regenerateFutureNutritionEvents).mock.invocationCallOrder[0]
      );
    });
  });
});
