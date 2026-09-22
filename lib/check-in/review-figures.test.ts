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
  isOnTrack: false,
  ...overrides,
});

describe("resolveGoalRowState — status, then pace, then trend", () => {
  it("reads the position first: reached and overshot never say on track", () => {
    expect(resolveGoalRowState(position({ status: "achieved", paceStatus: "on_track" }), "0 kg")).toEqual({ text: "Reached", tone: "good" });
    expect(resolveGoalRowState(position({ status: "overshot", isOnTrack: false }), "1.2 kg")).toEqual({ text: "Reached · 1.2 kg past target", tone: "good" });
  });

  it("then the pace against the deadline", () => {
    expect(resolveGoalRowState(position({ paceStatus: "on_track" }), "4 kg").text).toBe("On track · 4 kg to go");
    expect(resolveGoalRowState(position({ paceStatus: "behind_pace" }), "4 kg")).toEqual({ text: "Behind pace · 4 kg to go", tone: "attention" });
    expect(resolveGoalRowState(position({ paceStatus: "unrealistic" }), "4 kg")).toEqual({ text: "Deadline unrealistic · 4 kg to go", tone: "attention" });
  });

  it("then the trend, for a goal with no pace to judge", () => {
    expect(resolveGoalRowState(position({ isOnTrack: true }), "4 kg")).toEqual({ text: "On track · 4 kg to go", tone: "good" });
    expect(resolveGoalRowState(position({ isOnTrack: false }), "4 kg")).toEqual({ text: "Needs attention · 4 kg to go", tone: "attention" });
  });
});

describe("buildGoalRows", () => {
  const kg = (value: number) => `${value} kg`;

  it("draws one row per goal set, judged only when a reading existed then", () => {
    // Each row carries the client's baseline and the goal's start; the track
    // runs from the goal's start.
    const rows = buildGoalRows(
      {
        weight: { goal: 78, startingWeight: 91, goalStartWeight: 86, position: position({ current: 82.4, remaining: 4.4, percentComplete: 45, isOnTrack: true }) },
        bodyFat: { goal: 15, startingBodyFat: 26, goalStartBodyFat: 22, position: null },
        goalIsCurrent: true,
      },
      kg
    );
    expect(rows).toEqual([
      { name: "Weight", percentComplete: 45, start: "86 kg", goal: "78 kg", state: { text: "On track · 4.4 kg to go", tone: "good" }, judged: true },
      { name: "Body fat", percentComplete: 0, start: "22 %", goal: "15 %", state: { text: "No reading yet", tone: "neutral" }, judged: false },
    ]);
  });

  it("draws nothing when no goal is set", () => {
    expect(buildGoalRows({ goalIsCurrent: false }, kg)).toEqual([]);
  });
});

describe("describeGoalDeadline", () => {
  it("names the deadline and the days to it, or how far past it is", () => {
    expect(describeGoalDeadline({ date: "2026-11-30", daysRemaining: 74, isPastDeadline: false })).toBe("deadline 30 Nov · 74 days");
    expect(describeGoalDeadline({ date: "2026-09-01", daysRemaining: -3, isPastDeadline: true })).toBe("Overdue by 3 days");
    expect(describeGoalDeadline(undefined)).toBeUndefined();
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
