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
  materializeNutritionEventDays,
  resetNutritionEventDays,
} from "./nutrition-event-edit-service";

type Row = {
  id: string;
  baseline_calories: number;
  protein_g: number;
  carb_g: number;
  fat_g: number;
  training_burn_calories: number;
  calorie_surplus_percentage: number | null;
  diet_type: string;
};

const updateEqSpy = vi.fn();
const updateInSpy = vi.fn();
const updateSpy = vi.fn();
const selectInSpy = vi.fn();

/** from() returns a node serving both the IN-list select and the updates. */
function mockEvents(rows: Row[]): void {
  // Update chain is thenable so `.update().eq(...)` (materialize: 1 eq),
  // `.update().eq().eq().eq()` (single reset: 3 eqs), and
  // `.update().eq().eq().in()` (multi reset: 2 eqs + in) all await { error: null }.
  const updateChain: Record<string, unknown> = {
    then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
  };
  updateChain.eq = updateEqSpy.mockReturnValue(updateChain);
  updateChain.in = updateInSpy.mockReturnValue(updateChain);
  updateSpy.mockReturnValue(updateChain);

  const selectChain: Record<string, unknown> = {};
  selectChain.eq = vi.fn().mockReturnValue(selectChain);
  selectChain.in = selectInSpy.mockResolvedValue({ data: rows, error: null });

  vi.mocked(supabaseAdmin.from).mockReturnValue({
    select: vi.fn().mockReturnValue(selectChain),
    update: updateSpy,
  } as never);
}

const clientId = "client-1";

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: "e1",
    baseline_calories: 2000,
    protein_g: 150,
    carb_g: 200,
    fat_g: 60,
    training_burn_calories: 0,
    calorie_surplus_percentage: null,
    diet_type: "balanced",
    ...overrides,
  };
}

describe("nutrition-event-edit-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("materializeNutritionEventDays", () => {
    it("absolute: materializes calories + macros, freezes surplus/burn, flags modified", async () => {
      mockEvents([row()]);

      const { updated } = await materializeNutritionEventDays(
        clientId,
        ["2026-02-01"],
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
      // displayed = round(2000 * 1.1) = 2200; * 0.5 = 1100
      mockEvents([row({ calorie_surplus_percentage: 10 })]);

      await materializeNutritionEventDays(
        clientId,
        ["2026-02-01"],
        { mode: "delta", percent: -50 },
        "2026-01-15"
      );

      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ baseline_calories: 1100, calorie_surplus_percentage: null })
      );
    });

    it("delta: floors the resolved calories at zero for oversized negative deltas", async () => {
      mockEvents([row()]);

      await materializeNutritionEventDays(
        clientId,
        ["2026-02-01"],
        { mode: "delta", calorieDelta: -5000 },
        "2026-01-15"
      );

      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ baseline_calories: 0 })
      );
    });

    it("delta holdProtein=false: scales the day's stored macro split onto the new total", async () => {
      // Surplus day: base = round(2000 * 1.1) = 2200; -50% -> 1100 kcal.
      // Stored split kcal: p 150*4=600, c 200*4=800, f 60*9=540 (sum 1940).
      // Shares of 1100: p round(1100*600/1940/4)=85, c round(...800.../4)=113,
      // f round(...540.../9)=34 -> sums to 1098 ~ 1100.
      mockEvents([row({ calorie_surplus_percentage: 10 })]);

      await materializeNutritionEventDays(
        clientId,
        ["2026-02-01"],
        { mode: "delta", percent: -50, holdProtein: false },
        "2026-01-15"
      );

      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          baseline_calories: 1100,
          protein_g: 85,
          carb_g: 113,
          fat_g: 34,
        })
      );
    });

    it("delta holdProtein=false with zero stored macros: falls back to the diet rebalance", async () => {
      mockEvents([row({ protein_g: 0, carb_g: 0, fat_g: 0 })]);

      await materializeNutritionEventDays(
        clientId,
        ["2026-02-01"],
        { mode: "delta", calorieDelta: -200, holdProtein: false },
        "2026-01-15"
      );

      // calculateDailyMacros is mocked to { 150, 200, 60 }.
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ protein_g: 150, carb_g: 200, fat_g: 60 })
      );
    });

    it("delta: holdProtein absent and holdProtein=true produce the identical legacy update (regression pin)", async () => {
      mockEvents([row({ calorie_surplus_percentage: 10 })]);
      await materializeNutritionEventDays(
        clientId,
        ["2026-02-01"],
        { mode: "delta", percent: -50 },
        "2026-01-15"
      );
      const absentPayload = updateSpy.mock.calls[0][0] as Record<string, unknown>;

      vi.clearAllMocks();
      mockEvents([row({ calorie_surplus_percentage: 10 })]);
      await materializeNutritionEventDays(
        clientId,
        ["2026-02-01"],
        { mode: "delta", percent: -50, holdProtein: true },
        "2026-01-15"
      );
      const truePayload = updateSpy.mock.calls[0][0] as Record<string, unknown>;

      // Both hit the hold-protein rebalance branch (mock: 150/200/60).
      const { updated_at: _a, ...absentRest } = absentPayload;
      const { updated_at: _b, ...trueRest } = truePayload;
      expect(absentRest).toEqual(trueRest);
      expect(absentRest).toMatchObject({ protein_g: 150, carb_g: 200, fat_g: 60 });
    });

    it("scattered: queries EXACTLY the selected days (gaps are never touched)", async () => {
      mockEvents([row()]);

      // Mon + Wed + Sat with Tue/Thu/Fri gaps — the gaps are not in the IN-list.
      await materializeNutritionEventDays(
        clientId,
        ["2026-02-02", "2026-02-04", "2026-02-07"],
        { mode: "absolute", calories: 1800 },
        "2026-01-15"
      );

      expect(selectInSpy).toHaveBeenCalledWith("date", [
        "2026-02-02",
        "2026-02-04",
        "2026-02-07",
      ]);
    });

    it("partial-past: drops past dates, keeps the future ones in the IN-list", async () => {
      mockEvents([row()]);

      await materializeNutritionEventDays(
        clientId,
        ["2026-01-01", "2026-02-01"],
        { mode: "absolute", calories: 1800 },
        "2026-01-15"
      );

      expect(selectInSpy).toHaveBeenCalledWith("date", ["2026-02-01"]);
    });

    it("no-ops when every selected day is in the past", async () => {
      const { updated } = await materializeNutritionEventDays(
        clientId,
        ["2026-01-01", "2026-01-10"],
        { mode: "absolute", calories: 1800 },
        "2026-01-15"
      );
      expect(updated).toBe(0);
      expect(supabaseAdmin.from).not.toHaveBeenCalled();
    });

    // D-B: undefined = preserve (omit the column); "" = clear (null); text = set.
    it("note set: writes the trimmed note text", async () => {
      mockEvents([row()]);
      await materializeNutritionEventDays(
        clientId,
        ["2026-02-01"],
        { mode: "absolute", calories: 1800, note: "  Deload week  " },
        "2026-01-15"
      );
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ note: "Deload week" })
      );
    });

    it("note empty string: clears the note (null)", async () => {
      mockEvents([row()]);
      await materializeNutritionEventDays(
        clientId,
        ["2026-02-01"],
        { mode: "absolute", calories: 1800, note: "" },
        "2026-01-15"
      );
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ note: null })
      );
    });

    it("note undefined: preserves any existing note (column omitted from the update)", async () => {
      mockEvents([row()]);
      await materializeNutritionEventDays(
        clientId,
        ["2026-02-01"],
        { mode: "absolute", calories: 1800 },
        "2026-01-15"
      );
      const payload = updateSpy.mock.calls[0][0] as Record<string, unknown>;
      expect(payload).not.toHaveProperty("note");
    });
  });

  describe("resetNutritionEventDays (multi)", () => {
    it("clears the date list then regenerates exactly those days", async () => {
      mockEvents([]);

      const { reset } = await resetNutritionEventDays(
        clientId,
        ["2026-02-10", "2026-02-01", "2026-02-05"],
        "plan-1",
        "2026-01-15"
      );

      expect(reset).toBe(3);
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ is_modified: false, note: null })
      );
      expect(updateInSpy).toHaveBeenCalledWith("date", [
        "2026-02-10",
        "2026-02-01",
        "2026-02-05",
      ]);
      // Regen covers exactly the reset days — a scattered selection no longer
      // collapses to the earliest date and rewrites everything after it.
      expect(regenerateFutureNutritionEvents).toHaveBeenCalledWith(
        clientId,
        "plan-1",
        { kind: "dates", dates: ["2026-02-10", "2026-02-01", "2026-02-05"] }
      );
      expect(updateSpy.mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(regenerateFutureNutritionEvents).mock.invocationCallOrder[0]
      );
    });

    it("partial-past: resets only the future days", async () => {
      mockEvents([]);

      const { reset } = await resetNutritionEventDays(
        clientId,
        ["2026-01-01", "2026-02-01"],
        "plan-1",
        "2026-01-15"
      );

      expect(reset).toBe(1);
      expect(updateInSpy).toHaveBeenCalledWith("date", ["2026-02-01"]);
      expect(regenerateFutureNutritionEvents).toHaveBeenCalledWith(
        clientId,
        "plan-1",
        { kind: "dates", dates: ["2026-02-01"] }
      );
    });

    it("no-ops when every selected day is in the past", async () => {
      const { reset } = await resetNutritionEventDays(
        clientId,
        ["2026-01-01"],
        "plan-1",
        "2026-01-15"
      );
      expect(reset).toBe(0);
      expect(supabaseAdmin.from).not.toHaveBeenCalled();
      expect(regenerateFutureNutritionEvents).not.toHaveBeenCalled();
    });
  });
});
