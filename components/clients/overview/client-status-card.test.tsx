import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ClientStatusCard } from "./client-status-card";
import type { EffectiveGoal } from "@/lib/goals/resolve-effective-goal";
import type { Client } from "@/types/check-in";


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
  onOpenMetrics: vi.fn(),
  goal: NO_GOAL,
  goalStartDate: null,
};

beforeEach(() => cleanup());

describe("ClientStatusCard — goal chips", () => {
  it("gap: reports the distance still to travel, in the warning tone", () => {
    render(
      <ClientStatusCard
        client={{ ...BASE, startingWeight: 90, currentWeight: 86 }}
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
        {...PROPS}
      />
    );

    expect(screen.queryByText("99.0")).not.toBeInTheDocument();
    expect(screen.queryByText(/to go|goal reached/i)).not.toBeInTheDocument();
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
        onOpenMetrics={onOpenMetrics}
      />
    );

    await user.click(screen.getByRole("button", { name: "Open Metrics" }));
    expect(onOpenMetrics).toHaveBeenCalledTimes(1);
  });

  it("names unrecorded metrics rather than showing a zero", () => {
    render(<ClientStatusCard client={BASE} {...PROPS} />);

    expect(screen.getAllByText("Not recorded").length).toBeGreaterThan(0);
  });
});
