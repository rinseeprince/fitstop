import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// The real units context pulls in the Supabase browser client, which throws on
// import without env vars. The strip only reads the preference.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric" }),
}));

import { CheckInGoalStrip } from "./check-in-goal-strip";
import type { CheckInComparison, GoalProgress } from "@/types/check-in";

afterEach(cleanup);

// The live case: start 88, goal 77, now 72 — five kilos PAST a weight-loss goal.
// calculateGoalProgress reports isOnTrack:false (correct, they are moving away
// from 77) but computeGoalPace used to Math.abs the remainder into a safe-looking
// 0.6 kg/week, and the card let that override the trend.
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

const NO_CLIENT = {} as CheckInComparison["client"];

function renderStrip(goalProgress: GoalProgress, client = NO_CLIENT) {
  return render(
    <CheckInGoalStrip goalProgress={goalProgress} clientName="Sam" clientData={client} />,
  );
}

describe("a goal that has been overshot", () => {
  it("says Reached and names the distance PAST the target", () => {
    // `remaining` is signed; its magnitude past the goal is the distance BACK
    // to it. Rendered as "to go" it read "5 kg to go" at a client 5 kg beyond.
    renderStrip({ weight: weightGoal() });

    expect(screen.getByText(/Reached/)).toBeInTheDocument();
    expect(screen.getByText(/5 kg past target/)).toBeInTheDocument();
    expect(screen.queryByText(/to go/)).not.toBeInTheDocument();
  });

  it("body fat reaches the SAME verdict as weight for the same situation", () => {
    // Both rows resolve through one function. Body fat has no pace check, so
    // when the two were resolved separately weight read "On track" beside body
    // fat reading "Needs attention" about one client.
    renderStrip({ weight: weightGoal(), bodyFat: bodyFatGoal() });

    expect(screen.getAllByText(/Reached/)).toHaveLength(2);
    expect(screen.queryByText(/Needs attention/)).not.toBeInTheDocument();
  });

  it("renders no pace check and no projected date", () => {
    renderStrip({ weight: weightGoal({ paceStatus: "on_track", requiredRate: 0.6, safeCeiling: 0.72 }) });

    expect(screen.queryByText(/Pace check/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Safe ceiling/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Projected/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Estimated Time/i)).not.toBeInTheDocument();
  });

  it("offers the new-target note once every goal is met", () => {
    renderStrip({ weight: weightGoal(), bodyFat: bodyFatGoal() });

    expect(screen.getByText(/consider setting a new target/i)).toBeInTheDocument();
  });
});

describe("the state column's precedence", () => {
  // status > paceStatus > isOnTrack. Recorded in ARCHITECTURE; each row here is
  // one branch of it.
  const approaching = { status: "approaching" as const, percentComplete: 40, remaining: 5 };

  it("prefers status over an otherwise-safe pace", () => {
    renderStrip({ weight: weightGoal({ paceStatus: "on_track" }) });

    expect(screen.getByText(/Reached/)).toBeInTheDocument();
    expect(screen.queryByText(/On track/)).not.toBeInTheDocument();
  });

  it("prefers paceStatus over the trend while approaching", () => {
    // isOnTrack true, but the rate required to hit the deadline is not safe.
    renderStrip({ weight: weightGoal({ ...approaching, isOnTrack: true, paceStatus: "behind_pace" }) });

    expect(screen.getByText(/Behind pace/)).toBeInTheDocument();
    expect(screen.queryByText(/On track/)).not.toBeInTheDocument();
  });

  it("says the deadline is unrealistic when the required rate is far past safe", () => {
    renderStrip({ weight: weightGoal({ ...approaching, paceStatus: "unrealistic" }) });

    expect(screen.getByText(/Deadline unrealistic/)).toBeInTheDocument();
  });

  it("falls through to the trend when there is no pace check", () => {
    renderStrip({ weight: weightGoal({ ...approaching, isOnTrack: true }) });

    expect(screen.getByText(/On track/)).toBeInTheDocument();
  });

  it("says a client moving away from the goal needs attention", () => {
    renderStrip({ weight: weightGoal({ ...approaching, isOnTrack: false }) });

    expect(screen.getByText(/Needs attention/)).toBeInTheDocument();
  });

  it("shows the distance LEFT while a goal is being approached", () => {
    renderStrip({ weight: weightGoal({ ...approaching, isOnTrack: true }) });

    expect(screen.getByText(/5 kg to go/)).toBeInTheDocument();
    expect(screen.queryByText(/past target/)).not.toBeInTheDocument();
  });

  it("withholds the new-target note while a goal is still being worked towards", () => {
    renderStrip({ weight: weightGoal(), bodyFat: bodyFatGoal({ status: "approaching", isOnTrack: true }) });

    expect(screen.queryByText(/consider setting a new target/i)).not.toBeInTheDocument();
  });
});

describe("the rail", () => {
  it("carries the deadline and the days left", () => {
    renderStrip({
      weight: weightGoal(),
      deadline: { date: "2026-10-31", daysRemaining: 61, isPastDeadline: false },
    });

    expect(screen.getByText(/deadline 31 Oct · 61 days/)).toBeInTheDocument();
  });

  it("says how far past a deadline that has gone", () => {
    renderStrip({
      weight: weightGoal(),
      deadline: { date: "2026-06-30", daysRemaining: -12, isPastDeadline: true },
    });

    expect(screen.getByText(/Overdue by 12 days/)).toBeInTheDocument();
  });
});

describe("without goals", () => {
  it("names what is missing and where to set it", () => {
    renderStrip({});

    expect(screen.getByText(/No goals have been set for Sam yet/)).toBeInTheDocument();
    expect(screen.getByText(/Set goals in the client profile/)).toBeInTheDocument();
  });

  it("renders one row when only one goal is set", () => {
    renderStrip({ weight: weightGoal() });

    expect(screen.getByText("Weight")).toBeInTheDocument();
    expect(screen.queryByText("Body fat")).not.toBeInTheDocument();
  });
});
