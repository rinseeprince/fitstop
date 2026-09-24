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

const outOfDateState = vi.hoisted(() => ({
  outOfDate: null as NutritionOutOfDate | null,
  close: vi.fn(),
}));
vi.mock("@/hooks/use-nutrition-goal", () => ({
  useNutritionOutOfDate: () => ({
    outOfDate: outOfDateState.outOfDate,
    clientToday: "2026-09-23",
    isLoading: false,
    isError: false,
  }),
  useCloseNutritionOutOfDate: () => outOfDateState.close,
}));

const setStartsOn = vi.fn();
vi.mock("@/contexts/nutrition-builder-context", () => ({
  useNutritionBuilderContext: () => ({
    client: { id: "client-4" },
    isLoadingTrainingPlan: false,
    isLoadingNutrition: false,
    setStartsOn,
    // A save's calculator warnings — never shown on the pane (commit 9c).
    warnings: [{ code: "deadline_passed" }, { code: "calories_raised_to_minimum", minimumCalories: 1420 }],
  }),
}));

beforeEach(() => {
  cleanup();
  outOfDateState.outOfDate = null;
  setStartsOn.mockReset();
});

describe("NutritionBuilderRightPanel — the out-of-date notice", () => {
  it("today's problem: Regenerate puts Starts on back to today and opens the drawer", () => {
    outOfDateState.outOfDate = {
      versionId: "v-run",
      fromDay: "2026-09-23",
      built: { goalWeightKg: 80.7, deadline: "2026-10-01" },
      goal: { goalWeightKg: 81.5, deadline: "2026-11-09" },
      goalName: "Lean out",
      goalChangedOn: "2026-09-23",
      setByHand: false,
    };
    const onOpenSettings = vi.fn();
    render(<NutritionBuilderRightPanel onOpenSettings={onOpenSettings} />);

    screen.getByRole("button", { name: "Regenerate" }).click();
    // Never a day an earlier, unsaved pick left in the drawer.
    expect(setStartsOn).toHaveBeenCalledWith("2026-09-23");
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it("the × closes this client's notice", () => {
    const notice: NutritionOutOfDate = {
      versionId: "v-run",
      fromDay: "2026-10-19",
      built: { goalWeightKg: 80.6, deadline: "2026-10-18" },
      goal: { goalWeightKg: 85.1, deadline: "2027-01-22" },
      goalName: "Build",
      goalChangedOn: "2026-10-19",
      setByHand: false,
    };
    outOfDateState.outOfDate = notice;
    render(<NutritionBuilderRightPanel onOpenSettings={vi.fn()} />);

    screen.getByRole("button", { name: "Close" }).click();
    expect(outOfDateState.close).toHaveBeenCalledWith("client-4", notice);
  });

  it("a later day's problem: Set nutrition from moves Starts on to it and opens the drawer", () => {
    outOfDateState.outOfDate = {
      versionId: "v-run",
      fromDay: "2026-10-19",
      built: { goalWeightKg: 81.5, deadline: "2026-11-09" },
      goal: { goalWeightKg: 84.2, deadline: "2027-01-15" },
      goalName: "Build",
      goalChangedOn: "2026-10-19",
      setByHand: false,
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

describe("NutritionBuilderRightPanel — a save's warnings", () => {
  it("are the save's toast, never a box on the pane (commit 9c)", () => {
    render(<NutritionBuilderRightPanel onOpenSettings={vi.fn()} />);

    expect(screen.getByText("hero")).toBeInTheDocument();
    expect(screen.queryByText(/deadline|minimum safe level|Warnings/i)).not.toBeInTheDocument();
  });
});
