import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { PlanNutritionCard } from "./plan-nutrition-card";
import type { OverviewPlanSummary } from "@/types/coach-overview";

// units-context imports auth-context, which constructs the browser Supabase
// client at module load and throws without env vars.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric", isLoading: false, error: null }),
}));

const RUNNING: NonNullable<OverviewPlanSummary["nutrition"]> = {
  dietType: "balanced",
  customMacros: false,
  proteinGPerKg: 2,
  restDayCalories: 1828,
  trainDayCalories: 2194,
  surplusPct: 20,
  restDaysThisWeek: 2,
  today: { targetCalories: 1874, loggedCalories: 1210 },
  proteinTargetG: 138,
};

const QUEUED: NonNullable<OverviewPlanSummary["upcomingNutrition"]> = {
  startsOn: "2026-10-07",
  dietType: "balanced",
  customMacros: false,
  proteinGPerKg: 2,
  restDayCalories: 1732,
};

beforeEach(() => cleanup());

describe("PlanNutritionCard — targets saved to start later", () => {
  it("shows the daily target and its start date instead of claiming none exists", () => {
    render(
      <PlanNutritionCard nutrition={null} upcomingNutrition={QUEUED} onOpenNutrition={vi.fn()} />
    );

    expect(screen.getByText("Nutrition targets")).toBeInTheDocument();
    expect(screen.getByText("Daily target")).toBeInTheDocument();
    expect(screen.getByText("1732")).toBeInTheDocument();
    // The cell carries the number alone — no sub-line under it (owner).
    expect(screen.queryByText(/Rest day/)).not.toBeInTheDocument();
    expect(screen.getByText(/Starts/)).toBeInTheDocument();
    expect(screen.getByText(/Wed, 7 Oct/)).toBeInTheDocument();
    expect(screen.queryByText(/No nutrition plan/i)).not.toBeInTheDocument();
  });

  it("keeps the diet / method / protein chips", () => {
    render(
      <PlanNutritionCard nutrition={null} upcomingNutrition={QUEUED} onOpenNutrition={vi.fn()} />
    );

    expect(screen.getByText("Balanced")).toBeInTheDocument();
    expect(screen.getByText("Calculated")).toBeInTheDocument();
    expect(screen.getByText("2 g/kg")).toBeInTheDocument();
  });

  it("shows no this-week or today figures — none exist before day one", () => {
    render(
      <PlanNutritionCard nutrition={null} upcomingNutrition={QUEUED} onOpenNutrition={vi.fn()} />
    );

    expect(screen.queryByText(/Train day/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Today's target/)).not.toBeInTheDocument();
  });
});

describe("PlanNutritionCard — a running prescription", () => {
  it("wins over a queued one", () => {
    render(
      <PlanNutritionCard nutrition={RUNNING} upcomingNutrition={QUEUED} onOpenNutrition={vi.fn()} />
    );

    expect(screen.getByText("1828")).toBeInTheDocument();
    expect(screen.queryByText(/Starts/)).not.toBeInTheDocument();
  });
});

describe("PlanNutritionCard — nothing set", () => {
  it("invites the coach to build one", () => {
    render(
      <PlanNutritionCard nutrition={null} upcomingNutrition={null} onOpenNutrition={vi.fn()} />
    );

    expect(screen.getByText("No nutrition plan yet")).toBeInTheDocument();
  });
});
