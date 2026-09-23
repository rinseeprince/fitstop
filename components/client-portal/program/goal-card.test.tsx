import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// Required, not optional: units-context imports auth-context, which constructs
// the browser Supabase client at module load and throws without env vars.
const useUnitsMock = vi.fn();
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => useUnitsMock(),
}));

import { GoalCard } from "./goal-card";
import type { ClientJourney, ClientJourneyGoalReadings } from "@/types/client-journey";

type Goal = ClientJourney["goal"];

const READINGS: ClientJourneyGoalReadings = {
  weightKg: 83.4,
  bodyFatPercentage: 24.6,
  startWeightKg: 88.1,
  startBodyFatPercentage: 27.3,
};

const goal = (overrides: Partial<Goal> = {}): Goal => ({
  weightKg: 79.5,
  deadline: "2026-12-11",
  name: "Lean out",
  type: "lose_weight",
  bodyFatPercentage: null,
  description: null,
  readings: READINGS,
  ...overrides,
});

beforeEach(() => {
  cleanup();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-23T09:00:00Z"));
  useUnitsMock.mockReturnValue({ preference: "metric", isLoading: false, error: null });
});
afterEach(() => vi.useRealTimers());

// Every client with a goal sees it at the top of their Program tab, block or
// no block (docs/MEASUREMENT-LOG-PLAN.md §6 commit 8d2).
describe("GoalCard", () => {
  it("shows the goal's name, its type beside a name of the coach's own, the target with how far to go, and the deadline", () => {
    render(<GoalCard goal={goal()} />);

    expect(screen.getByText("Your goal")).toBeInTheDocument();
    expect(screen.getByText("Lean out")).toBeInTheDocument();
    expect(screen.getByText("Lose weight")).toBeInTheDocument();
    // 83.4 now against 79.5: 3.9 to go, counted down as the type says.
    expect(screen.getByText("79.5 kg · 3.9 kg to go")).toBeInTheDocument();
    expect(screen.getByText("By 11 Dec")).toBeInTheDocument();
  });

  it("says the type once when the name is the type's own", () => {
    render(<GoalCard goal={goal({ name: "Lose weight" })} />);

    expect(screen.getAllByText("Lose weight")).toHaveLength(1);
  });

  it("speaks the coach's goal card's words: under goal once past a loss target, reached within the tolerance", () => {
    const { rerender } = render(
      <GoalCard goal={goal({ readings: { ...READINGS, weightKg: 78.2 } })} />
    );
    expect(screen.getByText("79.5 kg · 1.3 kg under goal")).toBeInTheDocument();

    rerender(<GoalCard goal={goal({ readings: { ...READINGS, weightKg: 79.53 } })} />);
    expect(screen.getByText("79.5 kg · Goal reached")).toBeInTheDocument();
  });

  it("shows a body-fat target with its own distance, beside the weight", () => {
    render(<GoalCard goal={goal({ bodyFatPercentage: 21.8 })} />);

    expect(screen.getByText("79.5 kg · 3.9 kg to go")).toBeInTheDocument();
    expect(screen.getByText("21.8% · 2.8% to go")).toBeInTheDocument();
  });

  // Losing weight sets no direction for body fat: the side of the goal's start
  // reading the target sits on decides it, so past the target reads "under".
  it("judges a body-fat target from the reading on the goal's start day", () => {
    render(
      <GoalCard
        goal={goal({ bodyFatPercentage: 21.8, readings: { ...READINGS, bodyFatPercentage: 20.9 } })}
      />
    );

    expect(screen.getByText("21.8% · 0.9% under goal")).toBeInTheDocument();
  });

  it("gives the target alone when there is no reading to measure from", () => {
    render(<GoalCard goal={goal({ readings: null })} />);

    expect(screen.getByText("79.5 kg")).toBeInTheDocument();
    expect(screen.queryByText(/to go|goal reached/i)).not.toBeInTheDocument();
  });

  it("shows a goal with no target and no deadline as its name alone, and an event day by that name", () => {
    const { rerender } = render(
      <GoalCard goal={goal({ name: "Stay steady", type: "maintain", weightKg: null, deadline: null })} />
    );
    expect(screen.getByText("Stay steady")).toBeInTheDocument();
    expect(screen.getByText("Maintain")).toBeInTheDocument();
    expect(screen.queryByText(/kg|By /)).not.toBeInTheDocument();

    rerender(
      <GoalCard goal={goal({ name: "Race day", type: "event_prep", weightKg: null, deadline: "2026-11-14" })} />
    );
    expect(screen.getByText("Event day 14 Nov")).toBeInTheDocument();
  });

  it("carries the goal's own words — the client's, for the goal their questionnaire set", () => {
    render(<GoalCard goal={goal({ description: "Feel strong on the ski trip" })} />);

    expect(screen.getByText("Feel strong on the ski trip")).toBeInTheDocument();
  });

  it("renders in the client's own unit", () => {
    useUnitsMock.mockReturnValue({ preference: "imperial", isLoading: false, error: null });
    render(<GoalCard goal={goal()} />);

    // 79.5 kg → 175.3 lbs; 83.4 kg → 183.9 lbs: 8.6 lbs to go.
    expect(screen.getByText("175.3 lbs · 8.6 lbs to go")).toBeInTheDocument();
  });

  it("renders nothing with no goal in force", () => {
    const { container } = render(
      <GoalCard
        goal={{
          weightKg: null,
          deadline: null,
          name: null,
          type: null,
          bodyFatPercentage: null,
          description: null,
          readings: null,
        }}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });
});
