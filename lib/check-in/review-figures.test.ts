import { describe, it, expect } from "vitest";
import {
  buildGoalRows,
  describeGoalDeadline,
  metricComparison,
  resolveGoalFooter,
  resolveGoalRowState,
  type GoalRow,
} from "./review-figures";
import type { GoalPosition } from "@/types/check-in";

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

  it("and is on track with no pace to judge — body fat, or a goal with no deadline", () => {
    expect(resolveGoalRowState(position({}), "1.9%", false)).toEqual({ text: "On track · 1.9% to go", tone: "good" });
  });
});

describe("buildGoalRows", () => {
  const kg = (value: number) => `${value} kg`;

  it("draws one row per goal set, judged only when a reading existed then", () => {
    // Each row carries the client's baseline and the goal's start; the track
    // runs from the goal's start.
    const rows = buildGoalRows(
      {
        weight: { goal: 78, startingWeight: 91, goalStartWeight: 86, position: position({ current: 82.4, remaining: 4.4, percentComplete: 45 }) },
        bodyFat: { goal: 15, startingBodyFat: 26, goalStartBodyFat: 22, position: null },
      },
      kg
    );
    expect(rows).toEqual([
      { name: "Weight", percentComplete: 45, start: "86 kg", goal: "78 kg", state: { text: "On track · 4.4 kg to go", tone: "good" }, judged: true },
      { name: "Body fat", percentComplete: 0, start: "22 %", goal: "15 %", state: { text: "No reading yet", tone: "neutral" }, judged: false },
    ]);
  });

  it("judges body fat by direction alone, and both rows against the goal's one deadline", () => {
    const rows = (deadline: { date: string; daysRemaining: number; isPastDeadline: boolean }) =>
      buildGoalRows(
        {
          weight: { goal: 71.3, goalStartWeight: 79.6, position: position({ current: 74.8, remaining: -3.5, percentComplete: 57.8, paceStatus: "on_track" }) },
          bodyFat: { goal: 16.4, goalStartBodyFat: 23.9, position: position({ current: 21.1, remaining: -4.7, percentComplete: 37.3, trend: "away" }) },
          deadline,
        },
        kg
      ).map((row) => row.state.text);

    expect(rows({ date: "2026-12-11", daysRemaining: 77, isPastDeadline: false })).toEqual([
      "On track · 3.5 kg to go",
      "Moving away · 4.7% to go",
    ]);
    expect(rows({ date: "2026-09-08", daysRemaining: -17, isPastDeadline: true })).toEqual([
      "Deadline passed · 3.5 kg to go",
      "Deadline passed · 4.7% to go",
    ]);
  });

  it("draws nothing when no goal is set", () => {
    expect(buildGoalRows({}, kg)).toEqual([]);
  });
});

describe("describeGoalDeadline", () => {
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
