import { describe, expect, it } from "vitest";
import {
  EXERCISE_WITH_GROUP_COLUMNS,
  mapExerciseRowsToGroups,
  mapExerciseRowsToGroupsBySession,
  mapSessionRow,
  type TrainingExerciseWithGroupRow,
} from "./training-mappers";
import type { TrainingExerciseGroupRow, TrainingSessionRow } from "@/lib/database-helpers";

const group = (id: string, session_id: string, order_index: number, overrides: Partial<TrainingExerciseGroupRow> = {}) =>
  ({
    id,
    session_id,
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
  }) as TrainingExerciseGroupRow;

const exercise = (
  id: string,
  exercise_group: TrainingExerciseGroupRow,
  order_index: number,
): TrainingExerciseWithGroupRow =>
  ({
    id,
    session_id: exercise_group.session_id,
    group_id: exercise_group.id,
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
    notes: null,
    is_warmup: false,
    is_active: true,
    set_specs: null,
    video_url: null,
    prescribed_fields: ["load"],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    exercise_group,
  }) as TrainingExerciseWithGroupRow;

describe("EXERCISE_WITH_GROUP_COLUMNS", () => {
  it("embeds the group through its named foreign key", () => {
    // Two relationships reach a group from an exercise's neighbourhood; the
    // hint keeps PostgREST from guessing (PGRST201).
    expect(EXERCISE_WITH_GROUP_COLUMNS).toBe(
      "*, exercise_group:training_exercise_groups!training_exercises_group_fkey(*)",
    );
  });
});

describe("mapExerciseRowsToGroups", () => {
  it("nests a session's exercise rows into its groups, in order, with every setting", () => {
    const circuit = group("g-c", "s-1", 0, {
      format: "circuit",
      rounds: 3,
      time_cap_seconds: 600,
      interval_seconds: 60,
      rest_between_exercises_seconds: 15,
      rest_between_rounds_seconds: 90,
      notes: "A",
    });
    const lone = group("g-l", "s-1", 1);
    const groups = mapExerciseRowsToGroups([
      exercise("C", lone, 0),
      exercise("B", circuit, 1),
      exercise("A", circuit, 0),
    ]);
    expect(groups.map((g) => [g.id, g.exercises.map((e) => e.name)])).toEqual([
      ["g-c", ["A", "B"]],
      ["g-l", ["C"]],
    ]);
    expect(groups[0]).toMatchObject({
      sessionId: "s-1",
      orderIndex: 0,
      format: "circuit",
      rounds: 3,
      timeCapSeconds: 600,
      intervalSeconds: 60,
      restBetweenExercisesSeconds: 15,
      restBetweenRoundsSeconds: 90,
      notes: "A",
    });
    expect(groups[0].exercises[1]).toMatchObject({ groupId: "g-c", orderIndex: 1, prescribedFields: ["load"] });
  });

  it("splits rows of several sessions by session", () => {
    const a = group("g-a", "s-a", 0);
    const b = group("g-b", "s-b", 0);
    const bySession = mapExerciseRowsToGroupsBySession([exercise("x", a, 0), exercise("y", b, 0)]);
    expect([...bySession.keys()].sort()).toEqual(["s-a", "s-b"]);
    expect(bySession.get("s-b")?.[0].exercises.map((e) => e.name)).toEqual(["y"]);
  });

  it("puts the groups on the session", () => {
    const g = group("g-a", "s-a", 0);
    const session = mapSessionRow(
      { id: "s-a", plan_id: "p", name: "Day", order_index: 0 } as TrainingSessionRow,
      mapExerciseRowsToGroups([exercise("x", g, 0)]),
    );
    expect(session.groups[0].exercises[0].name).toBe("x");
  });
});
