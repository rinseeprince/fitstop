import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NutritionTargetsBlock } from "./nutrition-targets-block";
import { gramsToSplit } from "@/lib/nutrition/macro-balance";
import type { NutritionPlan } from "@/services/nutrition-service";

// Required, not optional: units-context imports auth-context, which constructs
// the browser Supabase client at module load and throws without env vars.
const units = vi.hoisted(() => ({ preference: "metric" as "metric" | "imperial" }));
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: units.preference, isLoading: false, error: null }),
}));

// jsdom doesn't implement the APIs the balancer's Radix Slider needs to render.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub;

const AUTO = { calories: 2200, proteinG: 180, carbG: 200, fatG: 70 };

const autoPlan = (
  weeklyWeightChangeKg: number,
  requiredDailyDeficit = 400,
): NutritionPlan => ({
  baselineCalories: 2200,
  tdee: 2600,
  calorieTarget: 2200,
  proteinTargetG: 180,
  carbTargetG: 200,
  fatTargetG: 70,
  adjustedTdee: 2600,
  weeklyWeightChangeKg,
  requiredDailyDeficit,
  warnings: [],
});

function renderBlock(
  weeklyWeightChangeKg: number,
  opts: { requiredDailyDeficit?: number; hasGoalTarget?: boolean; manualEnabled?: boolean } = {},
) {
  return render(
    <NutritionTargetsBlock
      autoPlan={autoPlan(weeklyWeightChangeKg, opts.requiredDailyDeficit)}
      autoTargets={AUTO}
      manualEnabled={opts.manualEnabled ?? false}
      onEnableManual={vi.fn()}
      onRevertToAuto={vi.fn()}
      balance={{ calories: AUTO.calories, split: gramsToSplit(AUTO) }}
      onBalanceChange={vi.fn()}
      missing={[]}
      hasGoalTarget={opts.hasGoalTarget ?? true}
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

// Task 0b.5. Both explanatory spans are suppressed at exactly zero, so a client
// with no goal used to leave a bare "TDEE 2,600" and nothing saying why — and
// the only thing on this surface that mentioned a missing goal was the goal
// editor, which moved to the Overview in this same session.
describe("NutritionTargetsBlock — the maintenance state is explained, not silent", () => {
  beforeEach(() => {
    cleanup();
    units.preference = "metric";
  });

  it("names the missing goal when there is no target to solve against", () => {
    renderBlock(0, { requiredDailyDeficit: 0, hasGoalTarget: false });

    expect(screen.getByText(/no goal weight and deadline are set/i)).toBeInTheDocument();
    expect(screen.getByText(/client's Overview/i)).toBeInTheDocument();
  });

  // A goal IS set and the client is already on it. Telling this coach to go set
  // a goal would be wrong, so the two cases get different sentences.
  it("says the client is already on their goal when one is set", () => {
    renderBlock(0, { requiredDailyDeficit: 0, hasGoalTarget: true });

    expect(screen.getByText(/matches the client's current weight/i)).toBeInTheDocument();
    expect(screen.queryByText(/no goal weight and deadline/i)).toBeNull();
  });

  it("stays quiet when the plan is actually working to a deficit", () => {
    renderBlock(-0.5, { requiredDailyDeficit: 400 });

    expect(screen.queryByText(/maintenance/i)).toBeNull();
  });
});

// N4: "Edit manually" IS the macro balancer. The grams derive from the split,
// so there is no macro total to reconcile and no button to reconcile it with.
describe("NutritionTargetsBlock — the manual entry is the balancer", () => {
  beforeEach(() => {
    cleanup();
    units.preference = "metric";
  });

  it("auto mode shows the calculated four numbers read-only, and no slider", () => {
    const { container } = renderBlock(-0.5);
    const fields = Array.from(container.querySelectorAll<HTMLInputElement>("input[readonly]"));
    expect(fields.map((f) => f.value)).toEqual(["2200", "180", "200", "70"]);
    expect(screen.queryByRole("slider")).toBeNull();
  });

  it("manual mode mounts the balancer over the coach's target and split, with the revert line", () => {
    renderBlock(-0.5, { manualEnabled: true });

    expect(screen.getByRole("slider", { name: "Carbs and fat boundary" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Fat and protein boundary" })).toBeInTheDocument();
    expect(screen.getByLabelText<HTMLInputElement>("Calories").value).toBe("2200");
    expect(screen.getByRole("button", { name: /Revert to auto/ })).toBeInTheDocument();
    expect(screen.getByText(/Auto suggests/)).toBeInTheDocument();
  });

  it("has no match button and no macro total to reconcile, in either mode", () => {
    renderBlock(-0.5, { manualEnabled: true });
    expect(screen.queryByText(/Match macros/i)).toBeNull();
    expect(screen.queryByText(/Macros total/i)).toBeNull();
    cleanup();
    renderBlock(-0.5);
    expect(screen.queryByText(/Match macros/i)).toBeNull();
  });
});
