import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// The real units context pulls in the Supabase browser client, which throws on
// import without env vars. These cards only read the preference.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric" }),
}));

import { WeightGoalCard } from "./weight-goal-card";
import { BodyFatGoalCard } from "./body-fat-goal-card";
import type { GoalProgress } from "@/types/check-in";

afterEach(cleanup);

// The live case: start 88, goal 77, now 72 — five kilos PAST a weight-loss goal.
// calculateGoalProgress reports isOnTrack:false (correct, they are moving away
// from 77) but computeGoalPace used to Math.abs the remainder into a safe-looking
// 0.6 kg/week and the card let that override the trend.
function weightGoal(
  o: Partial<NonNullable<GoalProgress["weight"]>> = {},
): NonNullable<GoalProgress["weight"]> {
  return {
    current: 72, goal: 77, startingWeight: 88,
    status: "overshot", remaining: 5, percentComplete: 100,
    isOnTrack: false, avgWeeklyChange: -0.4,
    ...o,
  } as NonNullable<GoalProgress["weight"]>;
}

function bodyFatGoal(
  o: Partial<NonNullable<GoalProgress["bodyFat"]>> = {},
): NonNullable<GoalProgress["bodyFat"]> {
  return {
    current: 12, goal: 15, startingBodyFat: 20,
    status: "overshot", remaining: 3, percentComplete: 100,
    isOnTrack: false, avgChange: -0.5,
    ...o,
  } as NonNullable<GoalProgress["bodyFat"]>;
}

describe("a goal that has been overshot", () => {
  it("says Goal met, not On track, and prints no remaining distance", () => {
    render(<WeightGoalCard weightGoal={weightGoal()} />);

    // Twice, by design: the badge and the Remaining cell. getAllByText rather
    // than getByText so the assertion is about the verdict, not the count.
    expect(screen.getAllByText("Goal met").length).toBeGreaterThan(0);
    expect(screen.queryByText("On track")).not.toBeInTheDocument();
    // "Remaining 5kg" on a client five kilos BEYOND their goal.
    expect(screen.queryByText("5kg")).not.toBeInTheDocument();
    expect(screen.getByText("Goal met - consider setting a new target.")).toBeInTheDocument();
  });

  it("hides the pace check and the projected date, which measure a journey that is over", () => {
    render(
      <WeightGoalCard
        weightGoal={weightGoal({
          // What the old code produced for this client, and what the card must
          // now refuse to render even if handed it.
          paceStatus: "on_track", requiredRate: 0.56, safeCeiling: 0.72,
          weeksToGoal: 12.5, projectedCompletionDate: "2026-11-18T00:00:00Z",
        })}
      />,
    );

    expect(screen.queryByText("Pace check")).not.toBeInTheDocument();
    expect(screen.queryByText(/within a safe range/)).not.toBeInTheDocument();
    expect(screen.queryByText("Estimated Time")).not.toBeInTheDocument();
  });

  it("keeps 100% Complete, which is true once the goal is met", () => {
    render(<WeightGoalCard weightGoal={weightGoal()} />);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("body fat reaches the same verdict as weight for the same situation", () => {
    // These two cards disagreed — weight said "On track" (pace override), body
    // fat said "Needs attention" (no pace check) — about one client.
    render(<BodyFatGoalCard bodyFatGoal={bodyFatGoal()} />);

    expect(screen.getAllByText("Goal met").length).toBeGreaterThan(0);
    expect(screen.queryByText("Needs attention")).not.toBeInTheDocument();
    expect(screen.queryByText("3%")).not.toBeInTheDocument();
  });
});

describe("a goal still being approached", () => {
  const approaching = weightGoal({
    current: 82, status: "approaching", remaining: -5,
    percentComplete: 54.5, isOnTrack: true,
    paceStatus: "on_track", requiredRate: 0.56, safeCeiling: 0.72,
  });

  it("still shows the distance left, as a magnitude", () => {
    render(<WeightGoalCard weightGoal={approaching} />);

    expect(screen.getByText("5kg")).toBeInTheDocument();
    expect(screen.getByText("On track")).toBeInTheDocument();
    expect(screen.queryByText("Goal met")).not.toBeInTheDocument();
  });

  it("says what the pace check measures — the REQUIRED rate, not the current one", () => {
    render(<WeightGoalCard weightGoal={approaching} />);

    // It read "Current pace will reach the goal by the deadline", which is why
    // it could sit above a projection landing after that deadline: the two
    // sentences measure different things and this one was mislabelled.
    expect(
      screen.getByText("The rate needed to reach the goal by the deadline is within a safe range."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Current pace will reach/)).not.toBeInTheDocument();
  });
});
