import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NutritionBuilderRightPanel } from "./nutrition-builder-right-panel";
import type { NutritionOutOfDate } from "@/lib/nutrition/nutrition-out-of-date";

// docs/MEASUREMENT-LOG-PLAN.md commit 8d1: the Nutrition tab's Plans pane shows
// the one out-of-date notice under its hero, with the way to fix it.

vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric", isLoading: false, error: null }),
}));
vi.mock("../nutrition-plan-hero", () => ({ NutritionPlanHero: () => <div>hero</div> }));

const outOfDateState = vi.hoisted(() => ({ outOfDate: null as NutritionOutOfDate | null }));
vi.mock("@/hooks/use-nutrition-goal", () => ({
  useNutritionOutOfDate: () => ({
    outOfDate: outOfDateState.outOfDate,
    clientToday: "2026-09-23",
    isLoading: false,
    isError: false,
  }),
}));

const setStartsOn = vi.fn();
vi.mock("@/contexts/nutrition-builder-context", () => ({
  useNutritionBuilderContext: () => ({
    client: { id: "client-4" },
    isLoadingTrainingPlan: false,
    isLoadingNutrition: false,
    warnings: [],
    setStartsOn,
  }),
}));

beforeEach(() => {
  cleanup();
  outOfDateState.outOfDate = null;
  setStartsOn.mockReset();
});

describe("NutritionBuilderRightPanel — the out-of-date notice", () => {
  it("today's problem: Regenerate opens the drawer", () => {
    outOfDateState.outOfDate = {
      versionId: "v-run",
      fromDay: "2026-09-23",
      built: { goalWeightKg: 80.7, deadline: "2026-10-01" },
      goal: { goalWeightKg: 81.5, deadline: "2026-11-09" },
    };
    const onOpenSettings = vi.fn();
    render(<NutritionBuilderRightPanel onOpenSettings={onOpenSettings} />);

    screen.getByRole("button", { name: "Regenerate" }).click();
    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(setStartsOn).not.toHaveBeenCalled();
  });

  it("a later day's problem: Set nutrition from moves Starts on to it and opens the drawer", () => {
    outOfDateState.outOfDate = {
      versionId: "v-run",
      fromDay: "2026-10-19",
      built: { goalWeightKg: 81.5, deadline: "2026-11-09" },
      goal: { goalWeightKg: 84.2, deadline: "2027-01-15" },
    };
    const onOpenSettings = vi.fn();
    render(<NutritionBuilderRightPanel onOpenSettings={onOpenSettings} />);

    screen.getByRole("button", { name: "Set nutrition from 19 Oct" }).click();
    expect(setStartsOn).toHaveBeenCalledWith("2026-10-19");
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it("says nothing under the hero while every version fits its goal", () => {
    render(<NutritionBuilderRightPanel onOpenSettings={vi.fn()} />);
    expect(screen.getByText("hero")).toBeInTheDocument();
    expect(screen.queryByText(/Goal changed/)).not.toBeInTheDocument();
  });
});
