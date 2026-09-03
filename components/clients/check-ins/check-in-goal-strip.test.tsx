import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// The real units context pulls in the Supabase browser client, which throws on
// import without env vars. The strip only reads the preference.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric" }),
}));

import { CheckInGoalStrip } from "./check-in-goal-strip";
import type {
  CheckInComparison,
  GoalPosition,
  GoalProgress,
  GoalProgressRows,
} from "@/types/check-in";

afterEach(cleanup);

type WeightRow = NonNullable<GoalProgressRows["weight"]>;
type BodyFatRow = NonNullable<GoalProgressRows["bodyFat"]>;

// The live case: start 88, goal 77, then 72 — five kilos PAST a weight-loss goal.
// calculateGoalProgress reports isOnTrack:false (correct, they are moving away
// from 77) but computeGoalPace used to Math.abs the remainder into a safe-looking
// 0.6 kg/week, and the card let that override the trend.
function weightGoal(position: Partial<GoalPosition> = {}): WeightRow {
  return {
    goal: 77,
    startingWeight: 88,
    position: {
      current: 72, status: "overshot", remaining: 5, percentComplete: 100,
      isOnTrack: false,
      ...position,
    },
  };
}

function bodyFatGoal(position: Partial<GoalPosition> = {}): BodyFatRow {
  return {
    goal: 15,
    startingBodyFat: 20,
    position: {
      current: 12, status: "overshot", remaining: 3, percentComplete: 100,
      isOnTrack: false,
      ...position,
    },
  };
}

/** A goal that is set, with no reading as of the check-in's day behind it. */
const UNREAD_WEIGHT: WeightRow = { goal: 66, startingWeight: 91, position: null };
const UNREAD_BODY_FAT: BodyFatRow = { goal: 14, startingBodyFat: 23, position: null };

const NO_CLIENT = {} as CheckInComparison["client"];

/** 79 kg then against targets built at 75 — four kilos of drift, past the 3 kg threshold. */
const DRIFTED = {
  currentWeight: 79,
  nutritionPlanBaseWeightKg: 75,
  nutritionPlanEffectiveDate: "2026-08-27",
} as CheckInComparison["client"];

/** The rows against the goal that is still live unless a case says otherwise. */
function progress(rows: GoalProgressRows, goalIsCurrent = true): GoalProgress {
  return { ...rows, goalIsCurrent };
}

function renderStrip(rows: GoalProgressRows, client = NO_CLIENT, goalIsCurrent = true) {
  return render(
    <CheckInGoalStrip
      goalProgress={progress(rows, goalIsCurrent)}
      clientName="Sam"
      clientData={client}
    />,
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
    renderStrip({ weight: weightGoal({ paceStatus: "on_track" }) });

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

describe("a goal that could not be judged as of the check-in's day", () => {
  // Position reads the reading as of the check-in's day. A goal with none is
  // still a goal: it gets its row, its start → goal, an empty track and a
  // neutral "No reading yet" — never the "No goals" empty state, which is what
  // a weightless check-in used to produce for a client whose weight was in the
  // log the whole time.
  it("renders the goal, an empty track and No reading yet", () => {
    const { container } = renderStrip({ weight: UNREAD_WEIGHT });

    expect(screen.getByText("Weight")).toBeInTheDocument();
    expect(screen.getByText(/91 kg/)).toBeInTheDocument();
    expect(screen.getByText(/66 kg/)).toBeInTheDocument();
    expect(screen.getByText("No reading yet")).toBeInTheDocument();
    expect(screen.queryByText(/to go|Reached|On track|Needs attention/)).not.toBeInTheDocument();
    expect(container.querySelector('[style*="width: 0%"]')).not.toBeNull();
  });

  it("reads as neutral, not as a warning", () => {
    renderStrip({ weight: UNREAD_WEIGHT });

    expect(screen.getByText("No reading yet").parentElement).toHaveClass("text-[#93b0b4]");
  });

  it("is a goal, so the empty state stays away", () => {
    renderStrip({ weight: UNREAD_WEIGHT, bodyFat: UNREAD_BODY_FAT });

    expect(screen.queryByText(/No goals have been set/)).not.toBeInTheDocument();
    expect(screen.getAllByText("No reading yet")).toHaveLength(2);
  });

  it("neither earns the new-target note nor blocks it", () => {
    // Weight reached, body fat unread: the note is advice about the goal that
    // CAN be judged (owner decision 2026-09-02).
    renderStrip({ weight: weightGoal(), bodyFat: UNREAD_BODY_FAT });

    expect(screen.getByText(/consider setting a new target/i)).toBeInTheDocument();
  });

  it("earns no note on its own", () => {
    // Nothing judged, nothing met — `every` over an empty list must not count.
    renderStrip({ weight: UNREAD_WEIGHT, bodyFat: UNREAD_BODY_FAT });

    expect(screen.queryByText(/new target/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/nutrition plan/i)).not.toBeInTheDocument();
  });
});

describe("a goal since replaced (commit 8b)", () => {
  // The rows judge the version in force on the check-in's day. When that
  // version is no longer the client's live goal, "Goal met" is history and the
  // page must not invite replacing a goal already replaced.
  it("renders the verdict but withholds the new-target note and its button", () => {
    const onSetNewGoals = vi.fn();
    render(
      <CheckInGoalStrip
        goalProgress={progress({ weight: weightGoal(), bodyFat: bodyFatGoal() }, false)}
        clientName="Sam"
        clientData={NO_CLIENT}
        onSetNewGoals={onSetNewGoals}
      />,
    );

    expect(screen.getAllByText(/Reached/)).toHaveLength(2);
    expect(screen.queryByText(/new target/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /set new goals/i })).not.toBeInTheDocument();
  });

  it("still carries the drift note, which describes that day's targets", () => {
    const approaching = { status: "approaching" as const, percentComplete: 40, remaining: 5, isOnTrack: true };
    renderStrip({ weight: weightGoal(approaching) }, DRIFTED, false);

    expect(screen.getByText(/Weight has moved 4 kg/)).toBeInTheDocument();
  });
});

describe("the footer — one slot, two states", () => {
  const approaching = { status: "approaching" as const, percentComplete: 40, remaining: 5, isOnTrack: true };

  it("advises a nutrition review when the weight had drifted past the threshold", () => {
    renderStrip({ weight: weightGoal(approaching) }, DRIFTED);

    expect(screen.getByText(/Weight has moved 4 kg since these targets took effect on 27 Aug/))
      .toBeInTheDocument();
    expect(screen.getByText(/consider reviewing their nutrition plan/i)).toBeInTheDocument();
  });

  it("says nothing when the weight had barely moved", () => {
    const steady = { ...DRIFTED, currentWeight: 76 } as CheckInComparison["client"];
    renderStrip({ weight: weightGoal(approaching) }, steady);

    expect(screen.queryByText(/nutrition plan/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/new target/i)).not.toBeInTheDocument();
  });

  it("fires on a GAIN as readily as a loss — either invalidates the targets", () => {
    const gained = { ...DRIFTED, currentWeight: 71 } as CheckInComparison["client"];
    renderStrip({ weight: weightGoal(approaching) }, gained);

    expect(screen.getByText(/Weight has moved 4 kg/)).toBeInTheDocument();
  });

  it("prefers the goal note when a met goal and a drift coincide", () => {
    // Targets built for a goal the client has passed need the GOAL reset
    // first, and the plan rebuilt from it — a nutrition review before that is
    // advice in the wrong order.
    renderStrip({ weight: weightGoal() }, DRIFTED);

    expect(screen.getByText(/consider setting a new target/i)).toBeInTheDocument();
    expect(screen.queryByText(/nutrition plan/i)).not.toBeInTheDocument();
  });

  it("offers Set new goals on the goal note only, never beside a drift note", () => {
    const onSetNewGoals = vi.fn();
    const { rerender } = render(
      <CheckInGoalStrip
        goalProgress={progress({ weight: weightGoal() })}
        clientName="Sam"
        clientData={NO_CLIENT}
        onSetNewGoals={onSetNewGoals}
      />,
    );
    expect(screen.getByRole("button", { name: /set new goals/i })).toBeInTheDocument();

    rerender(
      <CheckInGoalStrip
        goalProgress={progress({ weight: weightGoal(approaching) })}
        clientName="Sam"
        clientData={DRIFTED}
        onSetNewGoals={onSetNewGoals}
      />,
    );
    expect(screen.getByText(/nutrition plan/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /set new goals/i })).not.toBeInTheDocument();
  });

  it("drops the date when the targets carry no effective date", () => {
    const undated = { currentWeight: 79, nutritionPlanBaseWeightKg: 75 } as CheckInComparison["client"];
    renderStrip({ weight: weightGoal(approaching) }, undated);

    expect(screen.getByText(/Weight has moved 4 kg since these targets took effect -/))
      .toBeInTheDocument();
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
