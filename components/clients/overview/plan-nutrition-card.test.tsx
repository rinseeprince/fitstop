import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { PlanNutritionCard } from "./plan-nutrition-card";
import type { OverviewPlanSummary } from "@/types/coach-overview";
import type { NutritionOutOfDate } from "@/lib/nutrition/nutrition-out-of-date";

// units-context imports auth-context, which constructs the browser Supabase
// client at module load and throws without env vars.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric", isLoading: false, error: null }),
}));

// The out-of-date rule's answer (docs/MEASUREMENT-LOG-PLAN.md commit 8d1), held
// where the module mock can reach it; null = every version fits its goal.
const outOfDateState = vi.hoisted(() => ({
  outOfDate: null as NutritionOutOfDate | null,
  clientIds: [] as string[],
}));
vi.mock("@/hooks/use-nutrition-goal", () => ({
  useNutritionOutOfDate: (clientId: string) => {
    outOfDateState.clientIds.push(clientId);
    return {
      outOfDate: outOfDateState.outOfDate,
      clientToday: outOfDateState.outOfDate ? CLIENT_TODAY : null,
      isLoading: false,
      isError: false,
    };
  },
}));

const CLIENT_TODAY = "2026-09-23";

function renderCard(
  props: Partial<Parameters<typeof PlanNutritionCard>[0]> = {}
): { onOpenNutritionDrawer: ReturnType<typeof vi.fn> } {
  const onOpenNutritionDrawer = vi.fn();
  render(
    <PlanNutritionCard
      clientId="client-9"
      nutrition={null}
      upcomingNutrition={null}
      onOpenNutrition={vi.fn()}
      onOpenNutritionDrawer={onOpenNutritionDrawer}
      {...props}
    />
  );
  return { onOpenNutritionDrawer };
}

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
  macros: { proteinG: 139, carbG: 173, fatG: 61 },
};

beforeEach(() => {
  cleanup();
  outOfDateState.outOfDate = null;
  outOfDateState.clientIds = [];
});

describe("PlanNutritionCard — targets saved to start later", () => {
  it("shows the daily target and its start date instead of claiming none exists", () => {
    renderCard({ upcomingNutrition: QUEUED });

    expect(screen.getByText("Nutrition targets")).toBeInTheDocument();
    expect(screen.getByText("Daily target")).toBeInTheDocument();
    expect(screen.getByText("1732")).toBeInTheDocument();
    // The macros beside the calories, each a number then its unit — no sub-line.
    expect(screen.getByText("139")).toBeInTheDocument();
    expect(screen.getByText("173")).toBeInTheDocument();
    expect(screen.getByText("61")).toBeInTheDocument();
    expect(screen.getByText("p")).toBeInTheDocument();
    expect(screen.getByText("c")).toBeInTheDocument();
    expect(screen.getByText("f")).toBeInTheDocument();
    expect(screen.queryByText(/139p/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Rest day/)).not.toBeInTheDocument();
    expect(screen.getByText(/Starts/)).toBeInTheDocument();
    expect(screen.getByText(/Wed, 7 Oct/)).toBeInTheDocument();
    expect(screen.queryByText(/No nutrition plan/i)).not.toBeInTheDocument();
  });

  it("keeps the diet / method / protein chips", () => {
    renderCard({ upcomingNutrition: QUEUED });

    expect(screen.getByText("Balanced")).toBeInTheDocument();
    expect(screen.getByText("Calculated")).toBeInTheDocument();
    expect(screen.getByText("2 g/kg")).toBeInTheDocument();
  });

  it("shows no this-week or today figures — none exist before day one", () => {
    renderCard({ upcomingNutrition: QUEUED });

    expect(screen.queryByText(/Train day/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Today's target/)).not.toBeInTheDocument();
  });
});

describe("PlanNutritionCard — a running prescription", () => {
  it("wins over a queued one", () => {
    renderCard({ nutrition: RUNNING, upcomingNutrition: QUEUED });

    expect(screen.getByText("1828")).toBeInTheDocument();
    expect(screen.queryByText(/Starts/)).not.toBeInTheDocument();
  });
});

describe("PlanNutritionCard — nothing set", () => {
  it("invites the coach to build one", () => {
    renderCard();

    expect(screen.getByText("No nutrition plan yet")).toBeInTheDocument();
  });
});

// docs/MEASUREMENT-LOG-PLAN.md commit 8d1: the out-of-date line sits between the
// title and the numbers, with the way to fix it — never a regenerate of its own.
describe("PlanNutritionCard — targets that no longer fit the goal", () => {
  it("a problem from today reads 'Goal changed' and offers Regenerate, which opens the drawer from today", () => {
    outOfDateState.outOfDate = {
      versionId: "v-run",
      fromDay: CLIENT_TODAY,
      built: { goalWeightKg: 80, deadline: "2026-10-01" },
      goal: { goalWeightKg: 81.5, deadline: "2026-11-09" },
    };
    const { onOpenNutritionDrawer } = renderCard({ nutrition: RUNNING });

    expect(outOfDateState.clientIds).toContain("client-9");
    expect(screen.getByText("Goal changed since these targets were built.")).toBeInTheDocument();
    expect(screen.getByText("80.0 kg by 1 Oct → 81.5 kg by 9 Nov")).toBeInTheDocument();
    screen.getByRole("button", { name: "Regenerate" }).click();
    expect(onOpenNutritionDrawer).toHaveBeenCalledWith();
  });

  it("a later day's problem offers Set nutrition from that day, on the queued card too", () => {
    outOfDateState.outOfDate = {
      versionId: "v-queued",
      fromDay: "2026-10-19",
      built: { goalWeightKg: 81.5, deadline: "2026-11-09" },
      goal: { goalWeightKg: null, deadline: null },
    };
    const { onOpenNutritionDrawer } = renderCard({ upcomingNutrition: QUEUED });

    expect(
      screen.getByText("The targets from 19 Oct weren't built for that day's goal.")
    ).toBeInTheDocument();
    expect(screen.getByText("81.5 kg by 9 Nov → Maintenance")).toBeInTheDocument();
    screen.getByRole("button", { name: "Set nutrition from 19 Oct" }).click();
    expect(onOpenNutritionDrawer).toHaveBeenCalledWith("2026-10-19");
  });

  it("says nothing while every version fits its goal", () => {
    renderCard({ nutrition: RUNNING });
    expect(screen.queryByText(/Goal changed/)).not.toBeInTheDocument();
    expect(screen.queryByText(/weren't built/)).not.toBeInTheDocument();
  });
});
