import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DrawerFormBody } from "./drawer-form-body";
import type { GoalOnDay } from "@/types/client-goals";
import type { NutritionOutOfDate } from "@/lib/nutrition/nutrition-out-of-date";

// docs/MEASUREMENT-LOG-PLAN.md commit 8d1: the drawer's Goal line is the goal in
// force on its Starts on day — the goal the preview and the save price — and the
// one place that says why calories hold at maintenance. The drawer also shows
// the out-of-date notice, whose only act here is to move Starts on.

const units = vi.hoisted(() => ({ preference: "metric" as "metric" | "imperial" }));
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: units.preference, isLoading: false, error: null }),
}));

// The children are under their own tests; here they are what they are handed.
const targetsProps = vi.hoisted(() => ({ last: null as Record<string, unknown> | null }));
vi.mock("./nutrition-settings-form", () => ({ NutritionSettingsForm: () => null }));
vi.mock("./nutrition-surplus-settings", () => ({ NutritionSurplusSettings: () => null }));
vi.mock("./nutrition-targets-block", () => ({
  NutritionTargetsBlock: (props: Record<string, unknown>) => {
    targetsProps.last = props;
    return null;
  },
}));

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
const retryDay = vi.fn();
const builder = {
  client: { id: "client-2", name: "Robin Vale", tdee: 2450 },
  settings: { proteinTargetGPerKg: 2, dietType: "balanced" },
  effectiveFrom: "2026-09-23" as string | null,
  clientToday: "2026-09-23",
  nutritionData: null,
  dayGoal: null as GoalOnDay | null,
  isDayPending: false,
  isDayError: false,
  retryDay,
  setStartsOn,
  autoPlan: null,
  autoTargets: null,
  manualEnabled: false,
  calcInputs: null,
  coachNotes: "",
  setCoachNotes: vi.fn(),
  hasPlan: true,
};
vi.mock("@/contexts/nutrition-builder-context", () => ({
  useNutritionBuilderContext: () => builder,
}));

function goal(overrides: Partial<GoalOnDay>): GoalOnDay {
  return {
    id: "g-1",
    clientId: "client-2",
    name: "Lean out",
    type: "lose_weight",
    targetWeight: 81.5,
    targetBodyFatPercentage: null,
    description: null,
    startsOn: "2026-08-03",
    source: "coach",
    setBy: null,
    createdAt: "2026-08-03T08:00:00Z",
    updatedAt: "2026-08-03T08:00:00Z",
    deadline: "2026-11-09",
    ...overrides,
  };
}

beforeEach(() => {
  cleanup();
  units.preference = "metric";
  builder.dayGoal = null;
  builder.isDayPending = false;
  builder.isDayError = false;
  builder.effectiveFrom = "2026-09-23";
  outOfDateState.outOfDate = null;
  setStartsOn.mockReset();
  targetsProps.last = null;
});

describe("DrawerFormBody — the Goal line is the Starts on day's goal", () => {
  it("a goal with a weight target and a deadline reads them", () => {
    builder.dayGoal = goal({});
    render(<DrawerFormBody />);
    expect(screen.getByText("81.5 kg by 9 Nov")).toBeInTheDocument();
    expect(targetsProps.last?.hasGoalTarget).toBe(true);
  });

  it("no goal that day: No goal set, so calories are at maintenance", () => {
    render(<DrawerFormBody />);
    expect(screen.getByText("No goal set, so calories are at maintenance.")).toBeInTheDocument();
    expect(targetsProps.last?.hasGoalTarget).toBe(false);
  });

  it("a goal with no weight target: No weight target, so calories are at maintenance", () => {
    builder.dayGoal = goal({ type: "recomposition", targetWeight: null, targetBodyFatPercentage: 18.6 });
    render(<DrawerFormBody />);
    expect(
      screen.getByText("No weight target, so calories are at maintenance.")
    ).toBeInTheDocument();
  });

  it("a goal with neither a weight target nor a deadline names the target — without one, a deadline changes nothing", () => {
    builder.dayGoal = goal({ type: "maintain", targetWeight: null, deadline: null });
    render(<DrawerFormBody />);
    expect(
      screen.getByText("No weight target, so calories are at maintenance.")
    ).toBeInTheDocument();
  });

  it("a goal with no deadline: No deadline, so calories are at maintenance", () => {
    builder.dayGoal = goal({ deadline: null });
    render(<DrawerFormBody />);
    expect(screen.getByText("No deadline, so calories are at maintenance.")).toBeInTheDocument();
    expect(targetsProps.last?.hasGoalTarget).toBe(false);
  });

  it("while the day loads the line is pending — no claim — and so are the numbers", () => {
    builder.isDayPending = true;
    const { container } = render(<DrawerFormBody />);
    expect(screen.queryByText(/calories are at maintenance/)).not.toBeInTheDocument();
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(targetsProps.last?.pending).toBe(true);
  });

  it("a failed day read says so, and hands the targets their retry", () => {
    builder.isDayError = true;
    render(<DrawerFormBody />);
    expect(screen.getByText("Couldn't load the goal for this day.")).toBeInTheDocument();
    expect(targetsProps.last?.failed).toBe(true);
    expect(targetsProps.last?.onRetry).toBe(retryDay);
  });
});

describe("DrawerFormBody — the out-of-date notice moves Starts on", () => {
  const later: NutritionOutOfDate = {
    versionId: "v-run",
    fromDay: "2026-10-19",
    built: { goalWeightKg: 81.5, deadline: "2026-11-09" },
    goal: { goalWeightKg: 84.2, deadline: "2027-01-15" },
  };

  it("offers Set nutrition from that day, which moves Starts on to it", () => {
    outOfDateState.outOfDate = later;
    render(<DrawerFormBody />);

    screen.getByRole("button", { name: "Set nutrition from 19 Oct" }).click();
    expect(setStartsOn).toHaveBeenCalledWith("2026-10-19");
  });

  it("has nothing to offer once Starts on is that day, and never a Regenerate of its own", () => {
    outOfDateState.outOfDate = later;
    builder.effectiveFrom = "2026-10-19";
    render(<DrawerFormBody />);

    expect(screen.getByText("The targets from 19 Oct weren't built for that day's goal.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Set nutrition from/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Regenerate" })).not.toBeInTheDocument();
  });

  it("says nothing while every version fits its goal", () => {
    render(<DrawerFormBody />);
    expect(screen.queryByText(/Goal changed/)).not.toBeInTheDocument();
    expect(screen.queryByText(/weren't built/)).not.toBeInTheDocument();
  });
});
