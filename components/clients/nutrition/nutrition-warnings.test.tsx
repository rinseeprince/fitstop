import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NutritionWarnings } from "./nutrition-warnings";
import type { NutritionWarning } from "@/types/check-in";

// Mutable holder (hoisted so the mock factory can read it).
const state = vi.hoisted(() => ({ preference: "metric" as "metric" | "imperial" }));

vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: state.preference, isLoading: false, error: null }),
}));

// services/nutrition-service.ts is pure and runs in both the browser and the
// server, so it cannot resolve a viewer preference — it emits codes carrying raw
// KILOGRAMS. This component is the first layer that can, which is the whole
// point of the split: the same warning must read differently for two viewers.
describe("NutritionWarnings", () => {
  beforeEach(() => {
    cleanup();
    state.preference = "metric";
  });

  const capped: NutritionWarning[] = [
    { code: "deficit_capped", maxWeeklyChangeKg: 0.75 },
  ];

  it("renders a metric viewer's cap in kilograms", () => {
    render(<NutritionWarnings warnings={capped} />);
    expect(screen.getByText(/0\.75 kg\/week/)).toBeInTheDocument();
  });

  it("renders the SAME warning in pounds for an imperial viewer", () => {
    state.preference = "imperial";
    render(<NutritionWarnings warnings={capped} />);

    // 0.75 kg -> 1.65 lbs. The old baked string said "0.75kg/week" to everyone.
    expect(screen.getByText(/1\.65 lbs\/week/)).toBeInTheDocument();
    expect(screen.queryByText(/kg\/week/)).toBeNull();
  });

  it("converts a surplus cap too", () => {
    state.preference = "imperial";
    render(
      <NutritionWarnings warnings={[{ code: "surplus_capped", maxWeeklyChangeKg: 0.5 }]} />
    );
    expect(screen.getByText(/1\.1 lbs\/week/)).toBeInTheDocument();
  });

  it("leaves non-weight warnings identical across viewers", () => {
    const warnings: NutritionWarning[] = [
      { code: "protein_below_minimum" },
      { code: "calories_raised_to_minimum", minimumCalories: 1500 },
      { code: "fat_increased_for_minimum", gender: "female" },
    ];

    render(<NutritionWarnings warnings={warnings} />);
    const metricText = screen.getByRole("list").textContent;

    cleanup();
    state.preference = "imperial";
    render(<NutritionWarnings warnings={warnings} />);

    expect(screen.getByRole("list").textContent).toBe(metricText);
    expect(metricText).toContain("1.6g/kg");
    expect(metricText).toContain("1500 cal/day");
    expect(metricText).toContain("25%");
  });

  it("renders nothing when there are no warnings", () => {
    const { container } = render(<NutritionWarnings warnings={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
