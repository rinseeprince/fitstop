import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ClientStatusCard } from "./client-status-card";
import type { EffectiveGoal } from "@/lib/goals/resolve-effective-goal";
import type { Client } from "@/types/check-in";
import type { OverviewPlanSummary } from "@/types/coach-overview";

// The cards are presentational: editing state is owned by the section rail
// above them. A not-editing stub is all these render tests need.
const editStub = {
  isEditing: false,
  isSaving: false,
  start: vi.fn(),
  cancel: vi.fn(),
  save: vi.fn(),
  form: { watch: vi.fn(), setValue: vi.fn() },
  height: { system: "metric", fields: { cm: "", feet: "", inches: "" }, hasParseError: false },
  autoEnergy: null,
  customTdee: "",
  setCustomTdee: vi.fn(),
  isCustomTdee: false,
  setIsCustomTdee: vi.fn(),
  customTdeeBelowBmr: false,
  showBirthDateNudge: false,
} as never;


// Required, not optional: units-context imports auth-context, which constructs
// the browser Supabase client at module load and throws without env vars.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric", isLoading: false, error: null }),
}));


const BASE: Client = {
  id: "client-1",
  coachId: "coach-1",
  name: "Alex Kim",
  email: "alex@example.com",
  active: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  includeActivityBurn: false,
  surplusAsCarbs: false,
  timezone: "Australia/Sydney",
};

const TRAINING: NonNullable<OverviewPlanSummary["training"]> = {
  planId: "plan-1",
  planName: "Hypertrophy Block A",
  splitType: "upper_lower",
  frequencyPerWeek: 4,
  programDurationWeeks: 8,
  currentWeek: 3,
  thisWeek: { completed: 2, planned: 4, missed: 1 },
  nextSession: null,
  progressionPct: null,
};

const UPCOMING: NonNullable<OverviewPlanSummary["upcomingTraining"]> = {
  planId: "plan-2",
  planName: "Strength Block B",
  startsOn: "2026-07-27",
  splitType: "upper_lower",
  frequencyPerWeek: 4,
  programDurationWeeks: 6,
};

// Both targets arrive resolved from `client_goals` (Task 0b.1). The card is
// presentational about them: the tab runs resolveEffectiveGoal and hands the
// result down, so these fixtures are what the resolver produced, not the mirror.
const NO_GOAL: EffectiveGoal = {
  goalWeightKg: null,
  goalBodyFatPercentage: null,
  deadline: null,
  startDate: "2026-08-12",
};

const goalOf = (overrides: Partial<EffectiveGoal>): EffectiveGoal => ({
  ...NO_GOAL,
  ...overrides,
});

const PROPS = {
  upcomingTraining: null,
  onOpenMetrics: vi.fn(),
  goal: NO_GOAL,
  goalStartDate: null,
  edit: editStub,
};

beforeEach(() => cleanup());

describe("ClientStatusCard — goal chips", () => {
  it("gap: reports the distance still to travel, in the warning tone", () => {
    render(
      <ClientStatusCard
        client={{ ...BASE, startingWeight: 90, currentWeight: 86 }}
        training={null}
        {...PROPS}
        goal={goalOf({ goalWeightKg: 82 })}
      />
    );

    expect(screen.getByText("4.0 kg to go")).toBeInTheDocument();
  });

  it("reached: says so once the client lands on the goal", () => {
    render(
      <ClientStatusCard
        client={{ ...BASE, startingWeight: 90, currentWeight: 82 }}
        training={null}
        {...PROPS}
        goal={goalOf({ goalWeightKg: 82 })}
      />
    );

    expect(screen.getByText("Goal reached")).toBeInTheDocument();
  });

  it("beyond a loss goal: reads 'under goal'", () => {
    render(
      <ClientStatusCard
        client={{ ...BASE, startingWeight: 90, currentWeight: 80 }}
        training={null}
        {...PROPS}
        goal={goalOf({ goalWeightKg: 82 })}
      />
    );

    expect(screen.getByText("2.0 kg under goal")).toBeInTheDocument();
  });

  it("beyond a gain goal: reads 'over goal'", () => {
    render(
      <ClientStatusCard
        client={{ ...BASE, startingWeight: 70, currentWeight: 78 }}
        training={null}
        {...PROPS}
        goal={goalOf({ goalWeightKg: 76 })}
      />
    );

    expect(screen.getByText("2.0 kg over goal")).toBeInTheDocument();
  });

  it("no goal: no chip at all", () => {
    render(
      <ClientStatusCard
        client={{ ...BASE, startingWeight: 90, currentWeight: 86 }}
        training={null}
        {...PROPS}
      />
    );

    expect(screen.queryByText(/to go|goal reached|under goal|over goal/i)).not.toBeInTheDocument();
  });

  it("body fat uses percent rather than the weight unit", () => {
    render(
      <ClientStatusCard
        client={{
          ...BASE,
          startingBodyFatPercentage: 24,
          currentBodyFatPercentage: 20,
        }}
        training={null}
        {...PROPS}
        goal={goalOf({ goalBodyFatPercentage: 18 })}
      />
    );

    expect(screen.getByText("2.0% to go")).toBeInTheDocument();
  });
});

// The regression these exist for: this card used to read `clients.goal_weight` /
// `clients.goal_body_fat_percentage` directly — the denormalized mirror — and was
// the last coach surface resolving a goal nobody had resolved (invariant 16).
// The composition half (live goal wins, mirror backstops a pre-`client_goals`
// client) is pinned on `toClientGoalInput`; these pin that the CARD cannot reach
// the mirror at all any more.
describe("ClientStatusCard — targets come from client_goals, not the mirror", () => {
  it("renders a goal the clients mirror has no copy of", () => {
    render(
      <ClientStatusCard
        client={{ ...BASE, startingWeight: 90, currentWeight: 86 }}
        training={null}
        {...PROPS}
        goal={goalOf({ goalWeightKg: 82, goalBodyFatPercentage: 18 })}
      />
    );

    expect(screen.getByText("82.0")).toBeInTheDocument();
    expect(screen.getByText("18.0")).toBeInTheDocument();
    expect(screen.getByText("4.0 kg to go")).toBeInTheDocument();
  });

  it("a diverged mirror cannot win: the resolved goal is what renders", () => {
    render(
      <ClientStatusCard
        client={{
          ...BASE,
          startingWeight: 90,
          currentWeight: 86,
          // What a stale/failed dual-write leaves behind. Nothing may read it.
          goalWeight: 99,
          goalBodyFatPercentage: 30,
        }}
        training={null}
        {...PROPS}
        goal={goalOf({ goalWeightKg: 82, goalBodyFatPercentage: 18 })}
      />
    );

    expect(screen.getByText("82.0")).toBeInTheDocument();
    expect(screen.getByText("18.0")).toBeInTheDocument();
    expect(screen.queryByText("99.0")).not.toBeInTheDocument();
    expect(screen.queryByText("30.0")).not.toBeInTheDocument();
  });

  it("maintenance (no weight target) reads as unrecorded, whatever the mirror holds", () => {
    render(
      <ClientStatusCard
        client={{ ...BASE, startingWeight: 90, currentWeight: 86, goalWeight: 99 }}
        training={null}
        {...PROPS}
      />
    );

    expect(screen.queryByText("99.0")).not.toBeInTheDocument();
    expect(screen.queryByText(/to go|goal reached/i)).not.toBeInTheDocument();
  });
});

describe("ClientStatusCard — training block chips", () => {
  it("shows the plan name, the week, and Active", () => {
    render(<ClientStatusCard client={BASE} training={TRAINING} {...PROPS} />);

    expect(screen.getByText("Hypertrophy Block A")).toBeInTheDocument();
    expect(screen.getByText("Week 3 of 8")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("reads Ended, and drops the week chip, once the window is past", () => {
    render(
      <ClientStatusCard client={BASE} training={{ ...TRAINING, currentWeek: null }} {...PROPS} />
    );

    expect(screen.getByText("Ended")).toBeInTheDocument();
    expect(screen.queryByText(/Week \d+ of/)).not.toBeInTheDocument();
  });

  it("says No plan when nothing is placed", () => {
    render(<ClientStatusCard client={BASE} training={null} {...PROPS} />);

    expect(screen.getByText("No plan")).toBeInTheDocument();
  });

  it("reads as queued, not No plan, when a program is placed to start later", () => {
    render(
      <ClientStatusCard
        client={BASE}
        training={null}
        {...PROPS}
        upcomingTraining={UPCOMING}
      />
    );

    expect(screen.getByText("Strength Block B")).toBeInTheDocument();
    // en-AU does not abbreviate July, so match the prefix rather than pinning
    // a locale-dependent month spelling.
    expect(screen.getByText(/^Starts 27 Jul/)).toBeInTheDocument();
    expect(screen.queryByText("No plan")).not.toBeInTheDocument();
  });

  it("a running program wins over a queued one", () => {
    render(
      <ClientStatusCard
        client={BASE}
        training={TRAINING}
        {...PROPS}
        upcomingTraining={UPCOMING}
      />
    );

    expect(screen.getByText("Hypertrophy Block A")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.queryByText("Strength Block B")).not.toBeInTheDocument();
  });
});

describe("ClientStatusCard — actions", () => {
  it("links to the Metrics tab", async () => {
    const user = userEvent.setup();
    const onOpenMetrics = vi.fn();
    render(
      <ClientStatusCard
        client={BASE}
        goal={NO_GOAL}
        goalStartDate={null}
        training={null}
        upcomingTraining={null}
        onOpenMetrics={onOpenMetrics}
        edit={editStub}
      />
    );

    await user.click(screen.getByRole("button", { name: "Open Metrics" }));
    expect(onOpenMetrics).toHaveBeenCalledTimes(1);
  });

  it("names unrecorded metrics rather than showing a zero", () => {
    render(<ClientStatusCard client={BASE} training={null} {...PROPS} />);

    expect(screen.getAllByText("Not recorded").length).toBeGreaterThan(0);
  });
});
