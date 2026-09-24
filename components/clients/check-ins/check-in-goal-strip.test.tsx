import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// The real units context pulls in the Supabase browser client, which throws on
// import without env vars. The strip only reads the preference.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric" }),
}));

import { CheckInGoalStrip } from "./check-in-goal-strip";
import { MONO } from "@/components/clients/training/program-builder/builder-tokens";
import type {
  CheckInComparison,
  GoalPosition,
  GoalProgress,
  GoalProgressRows,
  JudgedGoal,
} from "@/types/check-in";

afterEach(cleanup);

type WeightRow = NonNullable<GoalProgressRows["weight"]>;
type BodyFatRow = NonNullable<GoalProgressRows["bodyFat"]>;

// The live case: start 88, goal 77, then 72 — five kilos PAST a weight-loss goal.
// The trend reads away (correct, they are moving away from 77) but
// computeGoalPace used to Math.abs the remainder into a safe-looking
// 0.6 kg/week, and the card let that override the trend.
function weightGoal(position: Partial<GoalPosition> = {}): WeightRow {
  return {
    goal: 77,
    startingWeight: 88,
    position: {
      current: 72, status: "overshot", remaining: 5, percentComplete: 100,
      trend: "away",
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
      trend: "away",
      ...position,
    },
  };
}

/** A goal that is set, with no reading as of the check-in's day behind it. */
const UNREAD_WEIGHT: WeightRow = { goal: 66, startingWeight: 91, goalStartWeight: 91, position: null };
const UNREAD_BODY_FAT: BodyFatRow = { goal: 14, startingBodyFat: 23, position: null };

/** The goal the check-in judged, unless a case says otherwise. */
const CUT: JudgedGoal = { name: "Cut to 77", type: "lose_weight", startsOn: "2026-06-08" };

const NO_CLIENT = {} as CheckInComparison["client"];

/** Matches the element whose whole text is `text` — the arrow is a span of its own. */
const wholeText = (text: string) => (_: string, element: Element | null) => element?.textContent === text;

/** 79 kg then against targets built at 75 — four kilos of drift, past the 3 kg threshold. */
const DRIFTED = {
  currentWeight: 79,
  nutritionPlanBaseWeightKg: 75,
  nutritionPlanEffectiveDate: "2026-08-27",
} as CheckInComparison["client"];

/** The rows against the goal that is still live unless a case says otherwise. */
function progress(rows: GoalProgressRows, goalIsCurrent = true, goal: JudgedGoal | null = CUT): GoalProgress {
  return { ...rows, goal, goalIsCurrent };
}

function renderStrip(
  rows: GoalProgressRows,
  client = NO_CLIENT,
  goalIsCurrent = true,
  goal: JudgedGoal | null = CUT,
) {
  return render(
    <CheckInGoalStrip
      goalProgress={progress(rows, goalIsCurrent, goal)}
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

  it("body fat past its target reads Reached too", () => {
    renderStrip({ weight: weightGoal(), bodyFat: bodyFatGoal() });

    expect(screen.getAllByText(/Reached/)).toHaveLength(2);
    expect(screen.getByText(/3% past target/)).toBeInTheDocument();
    expect(screen.queryByText(/Moving away/)).not.toBeInTheDocument();
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

describe("the state column — direction before speed (commit 8d4)", () => {
  // Reached, then Deadline passed, then which way the client is moving, and
  // the pace only for a client moving towards the target. Recorded in
  // ARCHITECTURE; each case here is one branch of it.
  const approaching = { status: "approaching" as const, percentComplete: 40, remaining: 5 };

  it("prefers status over an otherwise-safe pace", () => {
    renderStrip({ weight: weightGoal({ paceStatus: "on_track" }) });

    expect(screen.getByText(/Reached/)).toBeInTheDocument();
    expect(screen.queryByText(/On track/)).not.toBeInTheDocument();
  });

  it("says a client moving away is moving away, however safe the pace", () => {
    // The rate required to reach 77 in time is safe; the client is going the
    // other way. Read pace-first, this said "On track".
    renderStrip({ weight: weightGoal({ ...approaching, remaining: 3.6, trend: "away", paceStatus: "on_track" }) });

    expect(screen.getByText("Moving away")).toBeInTheDocument();
    expect(screen.getByText(/3.6 kg to go/)).toBeInTheDocument();
    expect(screen.queryByText(/On track/)).not.toBeInTheDocument();
    expect(screen.getByText("Moving away").parentElement).toHaveClass("text-[#d97706]");
  });

  it("says a client who has not moved has not moved", () => {
    renderStrip({ weight: weightGoal({ ...approaching, remaining: 2.8, trend: "unchanged", paceStatus: "on_track" }) });

    expect(screen.getByText("No change")).toBeInTheDocument();
    expect(screen.getByText("No change").parentElement).toHaveClass("text-[#d97706]");
  });

  it("says it is too early to tell with fewer than two check-ins — neutral, never on track", () => {
    renderStrip({ weight: weightGoal({ ...approaching, remaining: 6.1, trend: null, paceStatus: "on_track" }) });

    expect(screen.getByText("Too early to tell")).toBeInTheDocument();
    expect(screen.queryByText(/On track/)).not.toBeInTheDocument();
    expect(screen.getByText("Too early to tell").parentElement).toHaveClass("text-[#93b0b4]");
  });

  it("says the deadline passed when it went by short of the target — on the weight row alone", () => {
    renderStrip({
      weight: weightGoal({ ...approaching, remaining: 4.3, trend: "towards", paceStatus: "unrealistic" }),
      bodyFat: bodyFatGoal({ ...approaching, remaining: 1.4, trend: "towards" }),
      deadline: { date: "2026-08-31", daysRemaining: -9, isPastDeadline: true },
    });

    expect(screen.getAllByText("Deadline passed")).toHaveLength(1);
    expect(screen.queryByText(/Deadline unrealistic/)).not.toBeInTheDocument();
  });

  it("gives body fat no verdict, whichever way it is moving: where the client stands and how far, muted (commit 9c)", () => {
    renderStrip({
      weight: weightGoal({ ...approaching, remaining: 3.1, trend: "towards", paceStatus: "behind_pace" }),
      bodyFat: bodyFatGoal({ ...approaching, remaining: 5.7, trend: "away" }),
      deadline: { date: "2026-10-18", daysRemaining: 27, isPastDeadline: false },
    });

    expect(screen.getByText("Behind pace")).toBeInTheDocument();
    const bodyFat = screen.getByText("5.7% to go");
    expect(bodyFat).toHaveClass(MONO);
    expect(bodyFat.parentElement).toHaveClass("text-[#93b0b4]");
    expect(screen.queryByText(/Moving away|On track/)).not.toBeInTheDocument();
  });

  it("gives a client moving towards the target the pace's words", () => {
    renderStrip({ weight: weightGoal({ ...approaching, trend: "towards", paceStatus: "behind_pace" }) });

    expect(screen.getByText(/Behind pace/)).toBeInTheDocument();
    expect(screen.queryByText(/On track/)).not.toBeInTheDocument();
  });

  it("says the deadline is unrealistic when the required rate is far past safe", () => {
    renderStrip({ weight: weightGoal({ ...approaching, trend: "towards", paceStatus: "unrealistic" }) });

    expect(screen.getByText(/Deadline unrealistic/)).toBeInTheDocument();
  });

  it("says on track for a client moving towards it with no pace to judge", () => {
    renderStrip({ weight: weightGoal({ ...approaching, trend: "towards" }) });

    expect(screen.getByText(/On track/)).toBeInTheDocument();
  });

  it("shows the distance LEFT while a goal is being approached", () => {
    renderStrip({ weight: weightGoal({ ...approaching, trend: "towards" }) });

    expect(screen.getByText(/5 kg to go/)).toBeInTheDocument();
    expect(screen.queryByText(/past target/)).not.toBeInTheDocument();
  });

  it("withholds the new-target note while a goal is still being worked towards", () => {
    renderStrip({ weight: weightGoal(), bodyFat: bodyFatGoal({ status: "approaching", trend: "towards" }) });

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
    expect(screen.queryByText(/to go|Reached|On track|Moving away/)).not.toBeInTheDocument();
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

describe("a goal with no target (commits 8d4, 9b)", () => {
  // Maintain, event prep and general fitness ask for no target, so the goal
  // has no rows. It is still the goal the check-in judged: it shows itself,
  // and counts down to its deadline when it has one.
  const HYROX: JudgedGoal = { name: "Hyrox Manchester", type: "event_prep", startsOn: "2026-08-29" };
  const EVENT_DAY = { date: "2026-10-17", daysRemaining: 23, isPastDeadline: false };

  it("shows the goal's name and its type over a countdown to its event day — not 'No target'", () => {
    const { container } = renderStrip({ deadline: EVENT_DAY }, NO_CLIENT, true, HYROX);

    expect(screen.getByText("Hyrox Manchester")).toBeInTheDocument();
    expect(screen.getByText("Event prep")).toBeInTheDocument();
    expect(screen.getByText("29 Aug → 17 Oct · 23 days to go")).toBeInTheDocument();
    expect(screen.queryByText(/event day/)).not.toBeInTheDocument();
    expect(screen.getByText("Event day")).toBeInTheDocument();
    expect(screen.getByText(wholeText("29 Aug → 17 Oct"))).toBeInTheDocument();
    expect(screen.getByText("23 days to go")).toBeInTheDocument();
    // 29 Aug to 17 Oct is 49 days; 23 left, so 26 gone — from the goal's
    // start, never from the check-in's day.
    expect(container.querySelector('[style*="width: 53.1%"]')).not.toBeNull();
    expect(screen.queryByText("No target to track progress against")).not.toBeInTheDocument();
    expect(screen.queryByText(/No goals have been set/)).not.toBeInTheDocument();
  });

  it("says the days to go muted, as a number", () => {
    renderStrip({ deadline: EVENT_DAY }, NO_CLIENT, true, HYROX);

    const days = screen.getByText("23 days to go");
    expect(days).toHaveClass(MONO);
    expect(days.parentElement).toHaveClass("text-[#93b0b4]");
  });

  it("says Today on the day, as a word, with the bar full", () => {
    const race = { name: "Race day", type: "event_prep" as const, startsOn: "2026-08-10" };
    const { container } = renderStrip({ deadline: { date: "2026-09-24", daysRemaining: 0, isPastDeadline: false } }, NO_CLIENT, true, race);

    expect(screen.getByText("Today")).not.toHaveClass(MONO);
    expect(container.querySelector('[style*="width: 100%"]')).not.toBeNull();
  });

  it("calls a goal's deadline Deadline unless the type names it", () => {
    const hold = { name: "Hold at 68", type: "maintain" as const, startsOn: "2026-09-07" };
    const { container } = renderStrip({ deadline: { date: "2026-12-04", daysRemaining: 41, isPastDeadline: false } }, NO_CLIENT, true, hold);

    expect(screen.getByText("Deadline")).toBeInTheDocument();
    expect(screen.getByText(wholeText("7 Sep → 4 Dec"))).toBeInTheDocument();
    expect(screen.getByText("41 days to go")).toBeInTheDocument();
    // 7 Sep to 4 Dec is 88 days; 47 gone.
    expect(container.querySelector('[style*="width: 53.4%"]')).not.toBeNull();
  });

  it("says there is no target only when there is no deadline to count down to", () => {
    renderStrip({}, NO_CLIENT, true, { name: "Maintain", type: "maintain", startsOn: "2026-07-20" });

    expect(screen.getByText("Maintain")).toBeInTheDocument();
    expect(screen.getAllByText(/Maintain/)).toHaveLength(1);
    expect(screen.getByText("No target to track progress against")).toBeInTheDocument();
    expect(screen.queryByText(/to go|Deadline/)).not.toBeInTheDocument();
  });

  it("still carries the drift note, which is about the targets, not the goal's target", () => {
    renderStrip({}, DRIFTED, true, HYROX);

    expect(screen.getByText(/Weight has moved 4 kg/)).toBeInTheDocument();
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

  it("shows no nutrition note beside a met goal, however far the weight drifted (commit 8d4)", () => {
    renderStrip({ weight: weightGoal(), bodyFat: bodyFatGoal() }, DRIFTED, false);

    expect(screen.getAllByText(/Reached/)).toHaveLength(2);
    expect(screen.queryByText(/nutrition plan/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/new target/i)).not.toBeInTheDocument();
  });

  it("still carries the drift note, which describes that day's targets", () => {
    const approaching = { status: "approaching" as const, percentComplete: 40, remaining: 5, trend: "towards" as const };
    renderStrip({ weight: weightGoal(approaching) }, DRIFTED, false);

    expect(screen.getByText(/Weight has moved 4 kg/)).toBeInTheDocument();
  });
});

describe("the footer — one slot, two states", () => {
  const approaching = { status: "approaching" as const, percentComplete: 40, remaining: 5, trend: "towards" as const };

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

describe("the rail — the goal's start to its deadline (commit 9c)", () => {
  it("carries the goal's start, its deadline and the days to go", () => {
    renderStrip({
      weight: weightGoal(),
      deadline: { date: "2026-10-31", daysRemaining: 61, isPastDeadline: false },
    });

    expect(screen.getByText("8 Jun → 31 Oct · 61 days to go")).toBeInTheDocument();
    expect(screen.queryByText(/deadline/)).not.toBeInTheDocument();
  });

  it("says how long since a deadline that has gone", () => {
    renderStrip({
      weight: weightGoal(),
      deadline: { date: "2026-06-30", daysRemaining: -12, isPastDeadline: true },
    });

    expect(screen.getByText("8 Jun → 30 Jun · 12 days ago")).toBeInTheDocument();
  });

  it("dates the goal's start when it has no deadline", () => {
    renderStrip({ weight: weightGoal() });

    expect(screen.getByText("8 Jun → no deadline")).toBeInTheDocument();
  });
});

describe("without a goal on the check-in's day", () => {
  it("says none was set, and its link opens the goals sheet", () => {
    const onSetNewGoals = vi.fn();
    render(
      <CheckInGoalStrip
        goalProgress={progress({}, false, null)}
        clientName="Sam"
        clientData={NO_CLIENT}
        onSetNewGoals={onSetNewGoals}
      />,
    );

    expect(screen.getByText(/No goals have been set for Sam yet/)).toBeInTheDocument();
    screen.getByRole("button", { name: "Set goals" }).click();
    expect(onSetNewGoals).toHaveBeenCalledOnce();
  });

  it("says it without a link where the page cannot route to the sheet", () => {
    renderStrip({}, NO_CLIENT, false, null);

    expect(screen.getByText(/No goals have been set for Sam yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("a goal with targets", () => {
  it("renders a row per target it sets, and nothing of the no-target box", () => {
    renderStrip({ weight: weightGoal() });

    expect(screen.getByText("Weight")).toBeInTheDocument();
    expect(screen.queryByText("Body fat")).not.toBeInTheDocument();
    expect(screen.queryByText("No target to track progress against")).not.toBeInTheDocument();
    expect(screen.queryByText("Cut to 77")).not.toBeInTheDocument();
  });
});
