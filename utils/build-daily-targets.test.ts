import { describe, it, expect } from "vitest";

import { buildDailyTargetsFromPlan } from "./build-daily-targets";
import type { TrainingEvent, TrainingPlan } from "@/types/training";

/**
 * These tests pin the guard that lets GET /api/clients/[id]/nutrition pass
 * `null` for `trainingPlan`.
 *
 * Inside buildDailyTargetsFromPlan every read of `trainingPlan` sits in the
 * `else` of a `trainingEvents ? … : …` ternary. The coach nutrition route always
 * passes `trainingEvents` (getEventsForDateRange returns `(data ?? []).map(…)`,
 * so it is an array or it throws — and `[]` is truthy), which makes the plan
 * branch unreachable there. The route therefore stopped hydrating a whole
 * multi-week program it could never read.
 *
 * The plan branch is still LIVE for the client-portal caller, which passes no
 * events — so the last test guards it against being deleted as "dead code".
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
// target above — the one day where a plan-vs-events divergence could show up.
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

// A plan whose Monday session differs from the event above in BOTH name and
// calories. If the plan branch were ever reachable, the output would change.
const conflictingPlan = {
  sessions: [
    {
      name: "Leg Day (from plan)",
      dayOfWeek: "monday",
      estimatedCalories: 999,
    },
  ],
} as unknown as TrainingPlan;

const build = (
  trainingPlan: TrainingPlan | null,
  trainingEvents?: TrainingEvent[],
) =>
  buildDailyTargetsFromPlan(
    plan,
    storedTargets,
    trainingPlan,
    true,
    "balanced",
    false,
    trainingEvents,
    undefined,
    // effectiveFrom null = the template gate stays out of this suite's frame.
    { weekStart: "2026-08-03", effectiveFrom: null, effectiveUntil: null },
  );

describe("buildDailyTargetsFromPlan — trainingPlan is inert when events are supplied", () => {
  it("returns identical output for a full plan and for null when events are passed", () => {
    expect(build(conflictingPlan, [mondayEvent])).toEqual(build(null, [mondayEvent]));
  });

  it("is still inert when the events array is EMPTY — [] is truthy, so the plan branch stays closed", () => {
    expect(build(conflictingPlan, [])).toEqual(build(null, []));
  });

  it("drives Monday's session list from the event, never from the plan", () => {
    const monday = build(conflictingPlan, [mondayEvent]).find((d) => d.day === "monday");

    expect(monday?.trainingSessions).toEqual([
      { name: "Upper Body (from event)", calories: 400 },
    ]);
    expect(monday?.isTrainingDay).toBe(true);
    expect(monday?.calorieSurplusPercentage).toBe(15);
  });

  it("KEEPS the plan branch reachable when no events are passed (the client-portal caller)", () => {
    const monday = build(conflictingPlan, undefined).find((d) => d.day === "monday");

    // Proves the branch is genuinely live, so it must not be deleted from the
    // util just because the coach route no longer reaches it.
    expect(monday?.trainingSessions).toEqual([
      { name: "Leg Day (from plan)", calories: 999 },
    ]);
    expect(build(conflictingPlan, undefined)).not.toEqual(build(null, undefined));
  });
});
