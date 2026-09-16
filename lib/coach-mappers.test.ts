import { describe, it, expect } from "vitest";
import { mapSavedPlanRow, mapSavedSessionTree } from "./coach-mappers";
import type {
  CoachSavedExerciseGroupRow,
  CoachSavedExerciseRow,
  CoachSavedPlanRow,
  CoachSavedSessionRow,
} from "./database-helpers";

function makeRow(overrides: Partial<CoachSavedPlanRow> = {}): CoachSavedPlanRow {
  return {
    id: "plan-1",
    coach_id: "coach-1",
    name: "P",
    description: null,
    split_type: null,
    frequency_per_week: null,
    status: "saved",
    default_surplus_percentage: null,
    source: "manual",
    coach_prompt: null,
    program_duration_weeks: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } as CoachSavedPlanRow;
}

describe("mapSavedPlanRow default_surplus_percentage", () => {
  it("preserves an explicit 0 (falsy-check regression: 0 must not read as null)", () => {
    const plan = mapSavedPlanRow(makeRow({ default_surplus_percentage: 0 }));
    expect(plan.defaultSurplusPercentage).toBe(0);
  });

  it("coerces numeric strings and passes null through", () => {
    expect(
      mapSavedPlanRow(makeRow({ default_surplus_percentage: "12.5" as unknown as number }))
        .defaultSurplusPercentage,
    ).toBe(12.5);
    expect(mapSavedPlanRow(makeRow()).defaultSurplusPercentage).toBeNull();
  });
});

describe("mapSavedSessionTree", () => {
  const exerciseRow = (id: string, groupId: string, order_index: number) =>
    ({
      id,
      saved_session_id: "s-1",
      group_id: groupId,
      exercise_id: null,
      name: id,
      order_index,
      sets: 3,
      reps_min: 8,
      reps_max: 12,
      reps_target: null,
      rpe_target: null,
      percentage_1rm: null,
      tempo: null,
      rest_seconds: null,
      is_warmup: false,
      notes: null,
      set_specs: null,
      video_url: null,
      prescribed_fields: ["reps", "rest"],
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    }) as CoachSavedExerciseRow;

  const groupRow = (id: string, order_index: number, overrides: Partial<CoachSavedExerciseGroupRow> = {}) =>
    ({
      id,
      saved_session_id: "s-1",
      order_index,
      format: "straight_sets",
      rounds: null,
      time_cap_seconds: null,
      interval_seconds: null,
      rest_between_exercises_seconds: null,
      rest_between_rounds_seconds: null,
      notes: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      ...overrides,
    }) as CoachSavedExerciseGroupRow;

  const sessionRow = {
    id: "s-1",
    coach_id: "coach-1",
    saved_plan_id: "plan-1",
    name: "Hybrid",
    focus: null,
    order_index: 0,
    week_index: 0,
    is_rest: false,
    estimated_duration_minutes: null,
    calorie_surplus_percentage: null,
    notes: null,
    session_type: "training",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  } as CoachSavedSessionRow;

  it("orders groups by their place in the session and exercises by their place in the group, with every setting", () => {
    const session = mapSavedSessionTree({
      ...sessionRow,
      coach_saved_exercise_groups: [
        { ...groupRow("g-lone", 1), coach_saved_exercises: [exerciseRow("C", "g-lone", 0)] },
        {
          ...groupRow("g-circuit", 0, {
            format: "circuit",
            rounds: 3,
            time_cap_seconds: 600,
            interval_seconds: 60,
            rest_between_exercises_seconds: 15,
            rest_between_rounds_seconds: 90,
            notes: "A",
          }),
          coach_saved_exercises: [exerciseRow("B", "g-circuit", 1), exerciseRow("A", "g-circuit", 0)],
        },
      ],
    });
    expect(session.groups.map((g) => [g.id, g.exercises.map((e) => e.name)])).toEqual([
      ["g-circuit", ["A", "B"]],
      ["g-lone", ["C"]],
    ]);
    expect(session.groups[0]).toMatchObject({
      savedSessionId: "s-1",
      orderIndex: 0,
      format: "circuit",
      rounds: 3,
      timeCapSeconds: 600,
      intervalSeconds: 60,
      restBetweenExercisesSeconds: 15,
      restBetweenRoundsSeconds: 90,
      notes: "A",
    });
    expect(session.groups[0].exercises[1]).toMatchObject({
      groupId: "g-circuit",
      orderIndex: 1,
      prescribedFields: ["reps", "rest"],
    });
  });

  it("drops a group row that holds no exercise", () => {
    const session = mapSavedSessionTree({
      ...sessionRow,
      coach_saved_exercise_groups: [
        { ...groupRow("g-empty", 0), coach_saved_exercises: [] },
        { ...groupRow("g-lone", 1), coach_saved_exercises: [exerciseRow("C", "g-lone", 0)] },
      ],
    });
    expect(session.groups.map((g) => g.id)).toEqual(["g-lone"]);
  });

  it("reads a session with no groups as holding none", () => {
    expect(mapSavedSessionTree({ ...sessionRow }).groups).toEqual([]);
  });
});
