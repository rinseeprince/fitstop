import { describe, it, expect, afterEach } from "vitest";
import {
  buildDeadlineCountdown,
  buildGoalRows,
  describeGoalDeadline,
  describeGoalRail,
  metricComparison,
  resolveGoalFooter,
  resolveGoalRowState,
  type GoalRow,
} from "./review-figures";
import type { GoalPosition, GoalProgress, JudgedGoal } from "@/types/check-in";

const position = (overrides: Partial<GoalPosition>): GoalPosition => ({
  current: 82,
  remaining: 4,
  percentComplete: 50,
  status: "approaching",
  trend: "towards",
  ...overrides,
});

describe("resolveGoalRowState — direction before speed (commit 8d4)", () => {
  it("reads the position first: reached and overshot never say on track", () => {
    expect(resolveGoalRowState(position({ status: "achieved", paceStatus: "on_track" }), "0 kg", false)).toEqual({ text: "Reached", tone: "good" });
    expect(resolveGoalRowState(position({ status: "overshot", trend: "away" }), "1.2 kg", true)).toEqual({ text: "Reached · 1.2 kg past target", tone: "good" });
  });

  it("then a deadline gone by short of the target, whatever the trend and the pace", () => {
    for (const trend of ["towards", "away", "unchanged", null] as const) {
      expect(resolveGoalRowState(position({ trend, paceStatus: "unrealistic" }), "2.7 kg", true)).toEqual({
        text: "Deadline passed · 2.7 kg to go",
        tone: "attention",
      });
    }
  });

  it("then which way the client is moving: away is said however safe the pace", () => {
    // The rate REQUIRED to reach the target in time is safe; the client is
    // going the other way. Read first, the pace said "On track".
    expect(resolveGoalRowState(position({ trend: "away", paceStatus: "on_track" }), "3.4 kg", false)).toEqual({
      text: "Moving away · 3.4 kg to go",
      tone: "attention",
    });
  });

  it("a client who has not moved is said to have not moved", () => {
    expect(resolveGoalRowState(position({ trend: "unchanged", paceStatus: "on_track" }), "5.1 kg", false)).toEqual({
      text: "No change · 5.1 kg to go",
      tone: "attention",
    });
  });

  it("with no trend yet it is too early to tell — neutral, never on track", () => {
    expect(resolveGoalRowState(position({ trend: null, paceStatus: "on_track" }), "6.3 kg", false)).toEqual({
      text: "Too early to tell · 6.3 kg to go",
      tone: "neutral",
    });
  });

  it("a client moving towards the target hears the pace", () => {
    expect(resolveGoalRowState(position({ paceStatus: "on_track" }), "4.8 kg", false)).toEqual({ text: "On track · 4.8 kg to go", tone: "good" });
    expect(resolveGoalRowState(position({ paceStatus: "behind_pace" }), "7.2 kg", false)).toEqual({ text: "Behind pace · 7.2 kg to go", tone: "attention" });
    expect(resolveGoalRowState(position({ paceStatus: "unrealistic" }), "9.6 kg", false)).toEqual({ text: "Deadline unrealistic · 9.6 kg to go", tone: "attention" });
  });

});

describe("buildGoalRows", () => {
  const kg = (value: number) => `${value} kg`;

  it("draws one row per goal set, judged only when a reading existed then", () => {
    // Each row carries the client's baseline and the goal's start; the track
    // runs from the goal's start.
    const rows = buildGoalRows(
      {
        weight: { goal: 78, startingWeight: 91, goalStartWeight: 86, position: position({ current: 82.4, remaining: 4.4, percentComplete: 45, paceStatus: "on_track" }) },
        bodyFat: { goal: 15, startingBodyFat: 26, goalStartBodyFat: 22, position: null },
        deadline: { date: "2026-12-29", daysRemaining: 96, isPastDeadline: false },
      },
      kg
    );
    expect(rows).toEqual([
      { name: "Weight", percentComplete: 45, start: "86 kg", goal: "78 kg", state: { text: "On track · 4.4 kg to go", tone: "good" }, judged: true },
      { name: "Body fat", percentComplete: 0, start: "22 %", goal: "15 %", state: { text: "No reading yet", tone: "neutral" }, judged: false },
    ]);
  });

  it("gives a weight goal with no deadline no verdict — only where the client stands and how far (commit 9c)", () => {
    // With no deadline there is no pace to judge, so no word about it: never
    // On track, whichever way the client is moving.
    const weightState = (overrides: Partial<GoalPosition>) =>
      buildGoalRows({ weight: { goal: 79, goalStartWeight: 86.2, position: position({ current: 83.9, remaining: -4.9, percentComplete: 30.4, ...overrides }) } }, kg)[0]
        .state;

    for (const trend of ["towards", "away", "unchanged", null] as const) {
      expect(weightState({ trend })).toEqual({ text: "4.9 kg to go", tone: "neutral" });
    }
    expect(weightState({ status: "achieved", remaining: 0 })).toEqual({ text: "Reached", tone: "good" });
    expect(weightState({ status: "overshot", remaining: 2.3 })).toEqual({ text: "Reached · 2.3 kg past target", tone: "good" });
  });

  it("gives weight its verdict against the goal's deadline", () => {
    const weightRow = (deadline: { date: string; daysRemaining: number; isPastDeadline: boolean }) =>
      buildGoalRows(
        {
          weight: { goal: 71.3, goalStartWeight: 79.6, position: position({ current: 74.8, remaining: -3.5, percentComplete: 57.8, paceStatus: "on_track" }) },
          deadline,
        },
        kg
      )[0].state.text;

    expect(weightRow({ date: "2026-12-11", daysRemaining: 77, isPastDeadline: false })).toBe("On track · 3.5 kg to go");
    expect(weightRow({ date: "2026-09-08", daysRemaining: -17, isPastDeadline: true })).toBe("Deadline passed · 3.5 kg to go");
  });

  it("gives body fat no verdict — only where the client stands and how far (commit 9c)", () => {
    // Its readings are too noisy to judge a trend or a pace from: whichever
    // way it is moving and whether or not the deadline has gone, the row says
    // how far, muted.
    const bodyFatState = (
      overrides: Partial<GoalPosition>,
      deadline?: { date: string; daysRemaining: number; isPastDeadline: boolean }
    ) =>
      buildGoalRows(
        {
          bodyFat: { goal: 16.4, goalStartBodyFat: 23.9, position: position({ current: 21.1, remaining: -4.7, percentComplete: 37.3, ...overrides }) },
          ...(deadline && { deadline }),
        },
        kg
      )[0].state;

    const toGo = { text: "4.7% to go", tone: "neutral" };
    for (const trend of ["towards", "away", "unchanged", null] as const) {
      expect(bodyFatState({ trend })).toEqual(toGo);
    }
    expect(bodyFatState({ trend: "towards" }, { date: "2026-10-26", daysRemaining: 32, isPastDeadline: false })).toEqual(toGo);
    expect(bodyFatState({ trend: "away" }, { date: "2026-09-03", daysRemaining: -22, isPastDeadline: true })).toEqual(toGo);
    expect(bodyFatState({ status: "achieved", remaining: 0 })).toEqual({ text: "Reached", tone: "good" });
    expect(bodyFatState({ status: "overshot", remaining: 1.3 })).toEqual({ text: "Reached · 1.3% past target", tone: "good" });
  });

  it("draws nothing when no goal is set", () => {
    expect(buildGoalRows({}, kg)).toEqual([]);
  });
});

describe("describeGoalRail — the goal's start to its deadline (commit 9c)", () => {
  const cut: JudgedGoal = { name: "Summer cut", type: "lose_weight", startsOn: "2026-08-10" };
  const race: JudgedGoal = { name: "Hyrox Dublin", type: "event_prep", startsOn: "2026-07-13" };
  const deadline = (date: string, daysRemaining: number) => ({ date, daysRemaining, isPastDeadline: daysRemaining < 0 });

  it("dates the goal's start and its deadline, and counts the days to it", () => {
    expect(describeGoalRail(cut, deadline("2026-12-04", 58))).toBe("10 Aug – 4 Dec · 58 days");
    expect(describeGoalRail(cut, deadline("2026-10-07", 1))).toBe("10 Aug – 7 Oct · 1 day");
  });

  it("counts the days since the deadline once it has passed", () => {
    expect(describeGoalRail(cut, deadline("2026-09-12", -6))).toBe("10 Aug – 12 Sep · 6 days ago");
    expect(describeGoalRail(cut, deadline("2026-09-13", -1))).toBe("10 Aug – 13 Sep · 1 day ago");
  });

  it("names no deadline label — an event day is a date like any other", () => {
    expect(describeGoalRail(race, deadline("2026-11-21", 44))).toBe("13 Jul – 21 Nov · 44 days");
  });

  it("still dates the start of a goal with no deadline", () => {
    expect(describeGoalRail(cut, undefined)).toBe("10 Aug – no deadline");
  });

  it("says nothing with no goal judged", () => {
    expect(describeGoalRail(null, undefined)).toBeUndefined();
  });
});

describe("describeGoalDeadline — the AI review's deadline line", () => {
  it("names the deadline and the days to it, or since it once it has passed", () => {
    expect(describeGoalDeadline({ date: "2026-11-30", daysRemaining: 74, isPastDeadline: false }, "lose_weight")).toBe("deadline 30 Nov · 74 days");
    expect(describeGoalDeadline({ date: "2026-09-01", daysRemaining: -3, isPastDeadline: true }, "lose_weight")).toBe("deadline 1 Sep · 3 days ago");
    expect(describeGoalDeadline(undefined, "lose_weight")).toBeUndefined();
  });

  it("calls the deadline what the goal's type calls it, before and after it", () => {
    expect(describeGoalDeadline({ date: "2026-10-17", daysRemaining: 23, isPastDeadline: false }, "event_prep")).toBe("event day 17 Oct · 23 days");
    // An event day gone by is not overdue.
    expect(describeGoalDeadline({ date: "2026-09-19", daysRemaining: -5, isPastDeadline: true }, "event_prep")).toBe("event day 19 Sep · 5 days ago");
    expect(describeGoalDeadline({ date: "2026-10-29", daysRemaining: 35, isPastDeadline: false }, null)).toBe("deadline 29 Oct · 35 days");
  });

  it("says one day, not one days", () => {
    expect(describeGoalDeadline({ date: "2026-09-25", daysRemaining: 1, isPastDeadline: false }, "lose_weight")).toBe("deadline 25 Sep · 1 day");
    expect(describeGoalDeadline({ date: "2026-09-22", daysRemaining: -1, isPastDeadline: true }, "lose_weight")).toBe("deadline 22 Sep · 1 day ago");
  });
});

describe("buildDeadlineCountdown — a goal with no target counts down to its deadline (commit 9b)", () => {
  const countdown = (goal: JudgedGoal | null, deadline?: { date: string; daysRemaining: number }) =>
    buildDeadlineCountdown({
      goal,
      goalIsCurrent: true,
      ...(deadline && { deadline: { ...deadline, isPastDeadline: deadline.daysRemaining < 0 } }),
    });

  it("fills from the goal's start to its deadline as of the check-in's day, and counts the days to go", () => {
    // 2 Sep to 13 Nov is 72 days; 29 left means 43 gone.
    expect(countdown({ name: "Tough Mudder", type: "event_prep", startsOn: "2026-09-02" }, { date: "2026-11-13", daysRemaining: 29 })).toEqual({
      label: "Event day",
      percentComplete: 59.7,
      start: "2 Sep",
      end: "13 Nov",
      text: "29 days to go",
    });
  });

  it("calls the deadline what the goal's type calls it, and says one day, not one days", () => {
    // 14 Aug to 9 Oct is 56 days; one left.
    expect(countdown({ name: "Hold steady", type: "maintain", startsOn: "2026-08-14" }, { date: "2026-10-09", daysRemaining: 1 })).toMatchObject({
      label: "Deadline",
      percentComplete: 98.2,
      text: "1 day to go",
    });
  });

  it("says Today on the day, with the bar full", () => {
    expect(countdown({ name: "Half marathon", type: "event_prep", startsOn: "2026-07-06" }, { date: "2026-09-28", daysRemaining: 0 })).toMatchObject({
      percentComplete: 100,
      text: "Today",
    });
  });

  it("counts the days since, with the bar full", () => {
    const passed = { name: "Stay fit", type: "general_fitness" as const, startsOn: "2026-06-15" };
    expect(countdown(passed, { date: "2026-08-21", daysRemaining: -4 })).toMatchObject({ percentComplete: 100, text: "4 days ago" });
    expect(countdown(passed, { date: "2026-08-21", daysRemaining: -1 })).toMatchObject({ percentComplete: 100, text: "1 day ago" });
  });

  it("is full for a deadline on the goal's start day", () => {
    expect(countdown({ name: "Weigh-in day", type: "event_prep", startsOn: "2026-10-05" }, { date: "2026-10-05", daysRemaining: 0 })).toMatchObject({
      percentComplete: 100,
      start: "5 Oct",
      end: "5 Oct",
    });
  });

  it("is not there without a deadline, without a goal, or for a goal with a target", () => {
    expect(countdown({ name: "Maintain", type: "maintain", startsOn: "2026-05-18" })).toBeNull();
    expect(countdown(null, { date: "2026-12-02", daysRemaining: 69 })).toBeNull();
    const withTarget: GoalProgress = {
      goal: { name: "Cut to 73", type: "lose_weight", startsOn: "2026-08-03" },
      goalIsCurrent: true,
      weight: { goal: 73, goalStartWeight: 81.7, position: null },
      deadline: { date: "2026-12-16", daysRemaining: 83, isPastDeadline: false },
    };
    expect(buildDeadlineCountdown(withTarget)).toBeNull();
    // A recomp's one target is its body fat.
    const bodyFatOnly: GoalProgress = {
      goal: { name: "Recomp", type: "recomposition", startsOn: "2026-07-27" },
      goalIsCurrent: true,
      bodyFat: { goal: 14.2, goalStartBodyFat: 19.4, position: null },
      deadline: { date: "2026-12-09", daysRemaining: 76, isPastDeadline: false },
    };
    expect(buildDeadlineCountdown(bodyFatOnly)).toBeNull();
  });
});

describe("the deadline's day, whatever the viewer's zone (commit 9b)", () => {
  // The suite runs in UTC, where a day parsed at UTC midnight reads right. West
  // of UTC it reads the day before, and the rail would disagree with the
  // countdown under it.
  const originalTZ = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTZ;
  });

  it("names the same days on the rail and the countdown west of UTC", () => {
    process.env.TZ = "America/New_York";
    const ultra: GoalProgress = {
      goal: { name: "Ultra", type: "event_prep", startsOn: "2026-09-09" },
      goalIsCurrent: true,
      deadline: { date: "2026-11-19", daysRemaining: 64, isPastDeadline: false },
    };

    expect(describeGoalDeadline(ultra.deadline, "event_prep")).toBe("event day 19 Nov · 64 days");
    expect(describeGoalRail(ultra.goal, ultra.deadline)).toBe("9 Sep – 19 Nov · 64 days");
    expect(buildDeadlineCountdown(ultra)).toMatchObject({ start: "9 Sep", end: "19 Nov" });
  });
});

describe("resolveGoalFooter — one footer, goals outrank nutrition", () => {
  const kg = (value: number) => `${value} kg`;
  const reached: GoalRow = { name: "Weight", percentComplete: 100, goal: "78 kg", state: { text: "Reached", tone: "good" }, judged: true };
  const unjudged: GoalRow = { name: "Body fat", percentComplete: 0, goal: "15 %", state: { text: "No reading yet", tone: "neutral" }, judged: false };
  const behind: GoalRow = { name: "Weight", percentComplete: 40, goal: "78 kg", state: { text: "Behind pace · 5 kg to go", tone: "attention" }, judged: true };

  it("offers new goals only when every judged goal is met and the goal is still the live one", () => {
    expect(resolveGoalFooter({ rows: [reached, unjudged], goalIsCurrent: true, formatWeight: kg })).toEqual({
      tone: "good",
      text: "Goal met - consider setting a new target.",
      offerNewGoals: true,
    });
    expect(resolveGoalFooter({ rows: [reached], goalIsCurrent: false, formatWeight: kg })).toBeNull();
  });

  it("says nothing beside a met goal since replaced, however far the weight drifted (commit 8d4)", () => {
    // 72.6 then against targets built at 77.9: past the drift threshold, but
    // targets built for a goal already met need the goal reset first.
    expect(
      resolveGoalFooter({
        rows: [reached],
        goalIsCurrent: false,
        currentWeightKg: 72.6,
        nutritionPlanBaseWeightKg: 77.9,
        nutritionPlanEffectiveDate: "2026-08-19",
        formatWeight: kg,
      })
    ).toBeNull();
  });

  it("names the drift from the nutrition version's base weight otherwise", () => {
    expect(
      resolveGoalFooter({ rows: [behind], goalIsCurrent: true, currentWeightKg: 82.4, nutritionPlanBaseWeightKg: 86, nutritionPlanEffectiveDate: "2026-09-01", formatWeight: kg })
    ).toEqual({
      tone: "attention",
      text: "Weight has moved 3.6000000000000085 kg since these targets took effect on 1 Sep - consider reviewing their nutrition plan.".replace("3.6000000000000085", String(Math.abs(82.4 - 86))),
      offerNewGoals: false,
    });
  });

  it("says nothing when the weight has stayed near the base weight", () => {
    expect(resolveGoalFooter({ rows: [behind], goalIsCurrent: true, currentWeightKg: 85, nutritionPlanBaseWeightKg: 86, formatWeight: kg })).toBeNull();
  });
});

describe("metricComparison — vs last check-in, else vs start", () => {
  it("compares with the previous check-in when there is one", () => {
    expect(metricComparison({ current: 82.4, change: -0.6, startingValue: 86, hasPreviousCheckIn: true, invert: true })).toEqual({
      label: "vs last check-in",
      delta: { text: "-0.6", type: "positive" },
    });
  });

  it("compares with the start on a first check-in", () => {
    expect(metricComparison({ current: 82.4, startingValue: 86, hasPreviousCheckIn: false, invert: true })).toEqual({
      label: "vs start",
      delta: { text: "-3.6", type: "positive" },
    });
  });

  it("has nothing to say without either", () => {
    expect(metricComparison({ current: 82.4, hasPreviousCheckIn: false, invert: true })).toBeNull();
    expect(metricComparison({ current: 82.4, hasPreviousCheckIn: true, invert: true })).toBeNull();
  });
});
