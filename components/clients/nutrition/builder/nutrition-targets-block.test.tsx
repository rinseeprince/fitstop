import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NutritionTargetsBlock } from "./nutrition-targets-block";
import type { NutritionPlan } from "@/services/nutrition-service";

// Required, not optional: units-context imports auth-context, which constructs
// the browser Supabase client at module load and throws without env vars.
const units = vi.hoisted(() => ({ preference: "metric" as "metric" | "imperial" }));
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: units.preference, isLoading: false, error: null }),
}));

const autoPlan = (weeklyWeightChangeKg: number): NutritionPlan => ({
  baselineCalories: 2200,
  tdee: 2600,
  calorieTarget: 2200,
  proteinTargetG: 180,
  carbTargetG: 200,
  fatTargetG: 70,
  adjustedTdee: 2600,
  weeklyWeightChangeKg,
  requiredDailyDeficit: 400,
  warnings: [],
});

function renderBlock(weeklyWeightChangeKg: number) {
  return render(
    <NutritionTargetsBlock
      draft={{ calories: 2200, proteinG: 180, carbG: 200, fatG: 70 }}
      autoPlan={autoPlan(weeklyWeightChangeKg)}
      autoTargets={{ calories: 2200, proteinG: 180, carbG: 200, fatG: 70 }}
      manualEnabled={false}
      onEnableManual={vi.fn()}
      onRevertToAuto={vi.fn()}
      onFieldChange={vi.fn()}
      macroTotal={2200}
      caloriesMismatch={false}
      onMatchMacros={vi.fn()}
      missing={[]}
    />,
  );
}

// THE originally reported bug (the bug that started units canonicalization):
// this block appended the literal {" kg/week"} while its sibling banner fourteen
// lines earlier did receive a unit. It was structurally unable to react.
describe("NutritionTargetsBlock — weekly rate unit", () => {
  beforeEach(() => {
    cleanup();
    units.preference = "metric";
  });

  it("labels the weekly rate in kilograms for a metric coach", () => {
    renderBlock(-0.5);
    expect(screen.getByText(/kg\/week/)).toBeInTheDocument();
  });

  it("labels the SAME rate in pounds for an imperial coach", () => {
    units.preference = "imperial";
    renderBlock(-0.5);

    // 0.5 kg/week is 1.10 lbs/week. formatWeight, not formatLoad: a rate of
    // body-weight change is not something you load on a bar, so snapping it to
    // the nearest 5 lb would render 0.5 kg/week as 0.
    expect(screen.getByText(/lbs\/week/)).toBeInTheDocument();
    expect(screen.queryByText(/kg\/week/)).toBeNull();
    // The numeral shares its span with the sign, so match within it.
    expect(screen.getByText(/1\.10/)).toBeInTheDocument();
  });

  it("omits the rate entirely when the plan is maintenance", () => {
    renderBlock(0);
    expect(screen.queryByText(/\/week/)).toBeNull();
  });
});
