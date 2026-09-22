import { describe, it, expect } from "vitest";
import { checkInTrend, composeGoalSection, withSentReading } from "./sent-snapshot-goal";
import type { GoalOnDay } from "@/types/client-goals";

/**
 * The goal section a sent check-in saves: the trend over the check-ins up to
 * it, the as-of rule with the reading being sent counted, and the composition
 * through the one kernel on the check-in's own day.
 */

describe("checkInTrend — the trend behind isOnTrack", () => {
  it("is the weekly weight change between the oldest and newest weighed check-ins, newest first", () => {
    const trend = checkInTrend([
      { createdAt: "2026-09-21T09:00:00+00:00", weight: 79.6, bodyFatPercentage: 24.1 },
      { createdAt: "2026-09-14T09:00:00+00:00", weight: 80.9, bodyFatPercentage: 24.9 },
      // A weightless check-in is not a point on the weight trend.
      { createdAt: "2026-09-07T09:00:00+00:00" },
      { createdAt: "2026-08-31T09:00:00+00:00", weight: 82.2, bodyFatPercentage: 25.8 },
    ]);
    // −2.6 kg over 21 days → −0.87 kg a week.
    expect(trend.avgWeeklyWeightChange).toBe(-0.87);
    // Body fat moves per reading: (24.1 − 25.8) / 3.
    expect(trend.avgBodyFatChange).toBe(-0.57);
  });

  it("has nothing to say below two readings", () => {
    const trend = checkInTrend([
      { createdAt: "2026-09-21T09:00:00+00:00", weight: 76.3 },
      { createdAt: "2026-09-14T09:00:00+00:00", bodyFatPercentage: 19.4 },
    ]);
    expect(trend.avgWeeklyWeightChange).toBeUndefined();
    expect(trend.avgBodyFatChange).toBeUndefined();
  });

  it("has no weekly rate for two readings taken at the same moment", () => {
    const trend = checkInTrend([
      { createdAt: "2026-09-21T09:00:00+00:00", weight: 75.7 },
      { createdAt: "2026-09-21T09:00:00+00:00", weight: 76.8 },
    ]);
    expect(trend.avgWeeklyWeightChange).toBeUndefined();
  });
});

describe("withSentReading — the as-of rule with the reading being sent counted", () => {
  const ANCHOR = "2026-09-10";
  const sent = (date: string) => ({ value: 76.9, date });
  const found = (date: string) => ({ value: 77.3, date });

  it("is the log's reading when nothing is being sent, and the sent one when the log has none", () => {
    expect(withSentReading(found("2026-09-08"), undefined, ANCHOR)).toEqual(found("2026-09-08"));
    expect(withSentReading(undefined, sent("2026-09-10"), ANCHOR)).toEqual(sent("2026-09-10"));
    expect(withSentReading(undefined, undefined, ANCHOR)).toBeUndefined();
  });

  it("both on or before the anchor: the newer day wins", () => {
    expect(withSentReading(found("2026-09-08"), sent("2026-09-10"), ANCHOR)).toEqual(sent("2026-09-10"));
    expect(withSentReading(found("2026-09-10"), sent("2026-09-09"), ANCHOR)).toEqual(found("2026-09-10"));
  });

  it("both on the same day: the reading being sent is written last, so it wins", () => {
    expect(withSentReading(found("2026-09-10"), sent("2026-09-10"), ANCHOR)).toEqual(sent("2026-09-10"));
  });

  it("one on or before the anchor, one after: on or before wins", () => {
    expect(withSentReading(found("2026-09-12"), sent("2026-09-09"), ANCHOR)).toEqual(sent("2026-09-09"));
    expect(withSentReading(found("2026-09-09"), sent("2026-09-12"), ANCHOR)).toEqual(found("2026-09-09"));
  });

  it("both after the anchor: the earlier day wins, a tie to the reading being sent", () => {
    expect(withSentReading(found("2026-09-12"), sent("2026-09-14"), ANCHOR)).toEqual(found("2026-09-12"));
    expect(withSentReading(found("2026-09-14"), sent("2026-09-12"), ANCHOR)).toEqual(sent("2026-09-12"));
    expect(withSentReading(found("2026-09-13"), sent("2026-09-13"), ANCHOR)).toEqual(sent("2026-09-13"));
  });
});

describe("composeGoalSection — the goal judged on the check-in's day", () => {
  // Sent at 23:30 UTC on 21 September by a client in Kiritimati (UTC+14),
  // whose calendar already reads 22 September: every day count is theirs.
  const INSTANT = new Date("2026-09-21T23:30:00Z");
  const TIMEZONE = "Pacific/Kiritimati";

  const goal: GoalOnDay = {
    id: "5a1e0c0e-3333-4000-8000-000000000033",
    clientId: "client-kiritimati",
    name: "Autumn cut",
    type: "lose_weight",
    targetWeight: 81.4,
    targetBodyFatPercentage: 18.5,
    description: "Down for the wedding",
    startsOn: "2026-09-01",
    source: "coach",
    setBy: "coach-7",
    createdAt: "2026-09-01T08:00:00+00:00",
    updatedAt: "2026-09-01T08:00:00+00:00",
    deadline: "2026-10-02",
  };

  it("with no goal in force, freezes no goal and no rows", () => {
    const section = composeGoalSection({
      goal: null,
      instant: INSTANT,
      timezone: TIMEZONE,
      standing: { weight: 83.7, bodyFat: 21.2 },
      goalStart: {},
      baseline: { weight: 88.6 },
      trend: {},
    });
    expect(section).toEqual({ goal: null, goalProgress: {} });
  });

  it("freezes the goal as it stood that day", () => {
    const section = composeGoalSection({
      goal,
      instant: INSTANT,
      timezone: TIMEZONE,
      standing: { weight: 83.7 },
      goalStart: { weight: 85.3 },
      baseline: { weight: 88.6 },
      trend: {},
    });
    expect(section.goal).toEqual({
      id: "5a1e0c0e-3333-4000-8000-000000000033",
      name: "Autumn cut",
      type: "lose_weight",
      targetWeight: 81.4,
      targetBodyFatPercentage: 18.5,
      startsOn: "2026-09-01",
      deadline: "2026-10-02",
    });
  });

  it("judges the position, the pace and the deadline from the client's own day, running from the goal's start", () => {
    const { goalProgress } = composeGoalSection({
      goal,
      instant: INSTANT,
      timezone: TIMEZONE,
      standing: { weight: 83.7, bodyFat: 21.2 },
      goalStart: { weight: 85.3, bodyFat: 22.6 },
      baseline: { weight: 88.6 },
      trend: { avgWeeklyWeightChange: -0.8, avgBodyFatChange: -0.3 },
    });

    // 22 September (the client's day, not the UTC 21st) to 2 October.
    expect(goalProgress.deadline).toEqual({
      date: "2026-10-02",
      daysRemaining: 10,
      isPastDeadline: false,
    });
    expect(goalProgress.weight).toEqual({
      goal: 81.4,
      startingWeight: 88.6,
      goalStartWeight: 85.3,
      position: {
        current: 83.7,
        remaining: -2.3,
        // (83.7 − 85.3) / (81.4 − 85.3): from the goal's start, not the baseline.
        percentComplete: 41,
        status: "approaching",
        isOnTrack: true,
        // 2.3 kg in 10/7 weeks is 1.61 kg a week against a 0.84 ceiling.
        paceStatus: "unrealistic",
      },
    });
    expect(goalProgress.bodyFat).toEqual({
      goal: 18.5,
      // No baseline body fat: the reading then stands in, as the review always has.
      startingBodyFat: 21.2,
      goalStartBodyFat: 22.6,
      position: {
        current: 21.2,
        remaining: -2.7,
        percentComplete: 34.1,
        status: "approaching",
        isOnTrack: true,
      },
    });
  });

  it("with no reading as of the day, keeps the goal as a row with no verdict", () => {
    const { goalProgress } = composeGoalSection({
      goal: { ...goal, targetBodyFatPercentage: null, deadline: null },
      instant: INSTANT,
      timezone: TIMEZONE,
      standing: {},
      goalStart: {},
      baseline: {},
      trend: {},
    });
    expect(goalProgress).toEqual({
      weight: { goal: 81.4, startingWeight: undefined, goalStartWeight: undefined, position: null },
    });
  });
});
