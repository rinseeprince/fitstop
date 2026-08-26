import { describe, it, expect } from "vitest";

import { buildDailyTargetsFromPlan } from "./build-daily-targets";
import type { TrainingEvent } from "@/types/training";

/**
 * Pins that a day's training-session list comes from the EVENTS, never from a
 * plan's weekday sessions. (A `trainingPlan` input used to sit beside
 * `trainingEvents`; every read of it was in the `else` of a
 * `trainingEvents ? … : …` guard that the sole caller — which always passes an
 * array, and `[]` is truthy — could never reach. It was removed in the 2026-08
 * dead-code sweep, B4.)
 */

const plan = {
  baseline_calories: 2000,
  protein_target_g: 150,
  carb_target_g: 200,
  fat_target_g: 60,
};

const storedTargets = [
  {
    day_of_week: "monday",
    calories: 2000,
    protein_g: 150,
    carb_g: 200,
    fat_g: 60,
    is_training_day: false,
  },
];

// 2026-08-03 is a Monday, so this event lands on the same weekday as the stored
// target above.
const mondayEvent: TrainingEvent = {
  id: "evt-1",
  clientId: "client-1",
  trainingPlanId: "plan-1",
  trainingSessionId: "sess-1",
  date: "2026-08-03",
  sessionName: "Upper Body (from event)",
  sessionFocus: null,
  estimatedCalories: 400,
  status: "scheduled",
  sessionLogId: null,
  isModified: false,
  calorieSurplusPercentage: 15,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const build = (trainingEvents?: TrainingEvent[]) =>
  buildDailyTargetsFromPlan({
    plan,
    dailyTargetRows: storedTargets,
    includeActivityBurn: true,
    dietType: "balanced",
    surplusAsCarbs: false,
    trainingEvents,
    nutritionEvents: undefined,
    // effectiveFrom null = the template gate stays out of this suite's frame.
    weekWindow: { weekStart: "2026-08-03", effectiveFrom: null, effectiveUntil: null },
  });

describe("buildDailyTargetsFromPlan — training sessions come from the events", () => {
  it("drives Monday's session list from the event", () => {
    const monday = build([mondayEvent]).find((d) => d.day === "monday");

    expect(monday?.trainingSessions).toEqual([
      { name: "Upper Body (from event)", calories: 400 },
    ]);
    expect(monday?.isTrainingDay).toBe(true);
    expect(monday?.calorieSurplusPercentage).toBe(15);
  });

  it("lists no sessions when no events are passed", () => {
    const monday = build(undefined).find((d) => d.day === "monday");

    expect(monday?.trainingSessions).toEqual([]);
    expect(monday?.isTrainingDay).toBe(false);
  });
});
