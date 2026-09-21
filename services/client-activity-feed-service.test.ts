import { describe, it, expect, vi } from "vitest";

vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("./exercise-analytics-service", () => ({ getExercisePRs: vi.fn() }));

import {
  buildMeasurementItems,
  collectNewExerciseBests,
  mergeAndCapActivity,
  predecessorKey,
  prItemsFor,
  ACTIVITY_FEED_CAP,
  type MetricEntryFeedRow,
  type PrCandidate,
} from "./client-activity-feed-service";
import type { ActivityItem } from "@/types/coach-brief";
import type { ExerciseBest, ExercisePR } from "@/types/training";

const entry = (
  metricKey: string,
  value: number,
  entryDate: string,
  createdAt: string
): MetricEntryFeedRow => ({
  metric_key: metricKey,
  value,
  entry_date: entryDate,
  created_at: createdAt,
});

describe("buildMeasurementItems", () => {
  it("attaches the resolved predecessor value and the canonical stored value", () => {
    const newRow = entry("weight", 80.2, "2026-06-15", "2026-06-15T08:00:00Z");
    const predecessors = new Map([[predecessorKey("weight", "2026-06-15"), 81]]);
    const items = buildMeasurementItems([newRow], predecessors);
    expect(items).toEqual([
      {
        type: "measurement",
        at: "2026-06-15T08:00:00Z",
        metricKey: "weight",
        value: 80.2,
        previousValue: 81,
      },
    ]);
  });

  it("returns null previousValue with no predecessor, and leaves the value canonical", () => {
    const newRow = entry("hips", 100, "2026-06-15", "2026-06-15T08:00:00Z");
    const items = buildMeasurementItems([newRow], new Map());
    expect(items[0].type).toBe("measurement");
    if (items[0].type === "measurement") {
      expect(items[0].previousValue).toBeNull();
      // No `unit` on the payload any more: it resolved server-side to "in" over
      // a centimetre value. The render boundary owns the label now.
      expect(items[0].value).toBe(newRow.value);
    }
  });

  it("keys predecessors per (metric, date) so sibling metrics don't cross over", () => {
    const weightRow = entry("weight", 80, "2026-06-15", "2026-06-15T08:00:00Z");
    const waistRow = entry("waist", 89, "2026-06-15", "2026-06-15T08:05:00Z");
    const predecessors = new Map([[predecessorKey("waist", "2026-06-15"), 90]]);
    const items = buildMeasurementItems([weightRow, waistRow], predecessors);
    const byKey = new Map(
      items.map((i) => [i.type === "measurement" ? i.metricKey : "", i])
    );
    const weightItem = byKey.get("weight");
    const waistItem = byKey.get("waist");
    if (weightItem?.type === "measurement") expect(weightItem.previousValue).toBeNull();
    if (waistItem?.type === "measurement") expect(waistItem.previousValue).toBe(90);
  });
});

const logged = (
  overrides: Partial<{
    weight: number | null;
    reps: number | null;
    distance_meters: number | null;
    duration_seconds: number | null;
    set_type: string;
  }> = {}
) => ({
  weight: null,
  reps: null,
  distance_meters: null,
  duration_seconds: null,
  set_type: "working",
  ...overrides,
});

describe("collectNewExerciseBests", () => {
  const sessionAt = new Map([
    ["log-1", "2026-06-14T18:00:00Z"],
    ["log-2", "2026-06-16T18:00:00Z"],
  ]);

  it("takes the heaviest non-warmup load, keyed on catalog id, across sessions", () => {
    const bests = collectNewExerciseBests(
      [
        {
          session_log_id: "log-1",
          exercise_id: "ex-1",
          performed_name: "Bench Press",
          prescribed_exercise_snapshot: null,
          training_exercises: null,
          set_logs: [
            logged({ weight: 120, reps: 5, set_type: "warmup" }),
            logged({ weight: 100, reps: 5 }),
          ],
        },
        {
          session_log_id: "log-2",
          exercise_id: null,
          performed_name: "Bench Press",
          prescribed_exercise_snapshot: null,
          training_exercises: { exercise_id: "ex-1" },
          set_logs: [logged({ weight: 102.5, reps: 3, set_type: "failure" })],
        },
      ],
      sessionAt
    );

    expect(bests).toEqual([
      {
        exerciseId: "ex-1",
        exerciseName: "Bench Press",
        candidates: [{ kind: "load", weight: 102.5, at: "2026-06-16T18:00:00Z" }],
      },
    ]);
  });

  it("falls back to a name identity and skips exercises whose sets recorded nothing a best reads", () => {
    const bests = collectNewExerciseBests(
      [
        {
          session_log_id: "log-1",
          exercise_id: null,
          performed_name: "Sled Push",
          prescribed_exercise_snapshot: null,
          training_exercises: null,
          set_logs: [logged({ weight: 60 })],
        },
        {
          session_log_id: "log-1",
          exercise_id: null,
          performed_name: "Plank",
          prescribed_exercise_snapshot: null,
          training_exercises: null,
          set_logs: [logged({ weight: null })],
        },
      ],
      sessionAt
    );

    expect(bests).toEqual([
      {
        exerciseId: null,
        exerciseName: "Sled Push",
        candidates: [{ kind: "load", weight: 60, at: "2026-06-14T18:00:00Z" }],
      },
    ]);
  });

  it("reads every kind off the logged columns: reps with no load, a time at a distance, a carry, a hold", () => {
    const bests = collectNewExerciseBests(
      [
        {
          session_log_id: "log-1",
          exercise_id: "pull-up",
          performed_name: "Pull Up",
          prescribed_exercise_snapshot: null,
          training_exercises: null,
          set_logs: [logged({ reps: 12 }), logged({ reps: 15, weight: 0 }), logged({ reps: 6, weight: 10 })],
        },
        {
          session_log_id: "log-1",
          exercise_id: "row",
          performed_name: "Rowing",
          prescribed_exercise_snapshot: null,
          training_exercises: null,
          set_logs: [
            logged({ distance_meters: 1000, duration_seconds: 230 }),
            logged({ distance_meters: 1000, duration_seconds: 222.1 }),
            logged({ distance_meters: 500, duration_seconds: 105 }),
          ],
        },
        {
          session_log_id: "log-2",
          exercise_id: "carry",
          performed_name: "Farmers Carry",
          prescribed_exercise_snapshot: null,
          training_exercises: null,
          set_logs: [logged({ weight: 60, distance_meters: 40, duration_seconds: 38 }), logged({ weight: 64, distance_meters: 40, duration_seconds: 35 })],
        },
        {
          session_log_id: "log-2",
          exercise_id: "plank",
          performed_name: "Plank",
          prescribed_exercise_snapshot: null,
          training_exercises: null,
          set_logs: [logged({ duration_seconds: 90 }), logged({ duration_seconds: 120 })],
        },
      ],
      sessionAt
    );

    expect(bests).toEqual([
      {
        exerciseId: "pull-up",
        exerciseName: "Pull Up",
        candidates: [
          { kind: "reps", reps: 15, at: "2026-06-14T18:00:00Z" },
          { kind: "load", weight: 10, at: "2026-06-14T18:00:00Z" },
        ],
      },
      {
        exerciseId: "row",
        exerciseName: "Rowing",
        candidates: [
          { kind: "time", distanceMeters: 1000, durationSeconds: 222.1, at: "2026-06-14T18:00:00Z" },
          { kind: "time", distanceMeters: 500, durationSeconds: 105, at: "2026-06-14T18:00:00Z" },
        ],
      },
      {
        exerciseId: "carry",
        exerciseName: "Farmers Carry",
        candidates: [
          { kind: "carry", distanceMeters: 40, weight: 64, at: "2026-06-16T18:00:00Z" },
          { kind: "time", distanceMeters: 40, durationSeconds: 35, at: "2026-06-16T18:00:00Z" },
        ],
      },
      {
        exerciseId: "plank",
        exerciseName: "Plank",
        candidates: [{ kind: "hold", durationSeconds: 120, at: "2026-06-16T18:00:00Z" }],
      },
    ]);
  });
});

describe("collectNewExerciseBests — repeats (owner, 2026-09-21)", () => {
  const sessionAt = new Map([["log-1", "2026-06-14T18:00:00Z"]]);
  const AT = "2026-06-14T18:00:00Z";
  const only = (performedName: string, sets: ReturnType<typeof logged>[]) =>
    collectNewExerciseBests(
      [
        {
          session_log_id: "log-1",
          exercise_id: null,
          performed_name: performedName,
          prescribed_exercise_snapshot: null,
          training_exercises: null,
          set_logs: sets,
        },
      ],
      sessionAt
    ).flatMap((best) => best.candidates);

  it("offers no reps from repeats of a distance: the run's 3 × 1 km is a distance, never 3 reps", () => {
    expect(
      only("Running", [logged({ reps: 3, distance_meters: 1000 }), logged({ reps: 3, distance_meters: 800 })])
    ).toEqual([]);
  });

  it("offers a carry's load as a carry, never as a lift, whatever its reps", () => {
    expect(only("Farmer Carry", [logged({ weight: 64, reps: 3, distance_meters: 40 })])).toEqual([
      { kind: "carry", distanceMeters: 40, weight: 64, at: AT },
    ]);
  });

  it("offers a load held for a time as a hold, never as a lift, and timed repeats no reps", () => {
    expect(only("Farmer Hold", [logged({ weight: 64, reps: 3, duration_seconds: 30 })])).toEqual([
      { kind: "hold", durationSeconds: 30, at: AT },
    ]);
    expect(only("Plank", [logged({ reps: 3, duration_seconds: 30 })])).toEqual([
      { kind: "hold", durationSeconds: 30, at: AT },
    ]);
  });

  it("leaves pull-ups and lifts as they were", () => {
    expect(only("Pull Up", [logged({ reps: 12 }), logged({ reps: 8, weight: 20 })])).toEqual([
      { kind: "reps", reps: 12, at: AT },
      { kind: "load", weight: 20, at: AT },
    ]);
  });
});

describe("prItemsFor", () => {
  const AT = "2026-06-16T18:00:00Z";
  const pr = (best: ExerciseBest): ExercisePR => ({ ...best, date: "2026-06-01T00:00:00+00:00", isRecent: false });

  it("announces a load that beats the heaviest weight of any rep count, and nothing on a first-ever exercise", () => {
    const candidates: PrCandidate[] = [{ kind: "load", weight: 110, at: AT }];
    expect(
      prItemsFor("Bench Press", candidates, [pr({ kind: "rep_max", reps: 5, weight: 100 }), pr({ kind: "rep_max", reps: 3, weight: 105 })])
    ).toEqual([{ type: "pr", at: AT, exerciseName: "Bench Press", kind: "load", weight: 110, previousBest: 105 }]);
    expect(prItemsFor("Bench Press", [{ kind: "load", weight: 105, at: AT }], [pr({ kind: "rep_max", reps: 3, weight: 105 })])).toEqual([]);
    expect(prItemsFor("Bench Press", candidates, [])).toEqual([]);
  });

  it("announces more reps in a bodyweight set and a longer hold", () => {
    expect(
      prItemsFor("Pull Up", [{ kind: "reps", reps: 15, at: AT }], [pr({ kind: "best_reps", reps: 12 })])
    ).toEqual([{ type: "pr", at: AT, exerciseName: "Pull Up", kind: "reps", reps: 15, previousBest: 12 }]);
    expect(
      prItemsFor("Plank", [{ kind: "hold", durationSeconds: 120, at: AT }], [pr({ kind: "longest_hold", durationSeconds: 105 })])
    ).toEqual([{ type: "pr", at: AT, exerciseName: "Plank", kind: "hold", durationSeconds: 120, previousBest: 105 }]);
    expect(prItemsFor("Plank", [{ kind: "hold", durationSeconds: 100, at: AT }], [pr({ kind: "longest_hold", durationSeconds: 105 })])).toEqual([]);
  });

  it("judges a time and a carry against the best at the same distance only", () => {
    const prior = [
      pr({ kind: "best_time", distanceMeters: 1000, durationSeconds: 230 }),
      pr({ kind: "heaviest_carry", distanceMeters: 40, weight: 60 }),
    ];
    expect(
      prItemsFor(
        "Rowing",
        [
          { kind: "time", distanceMeters: 1000, durationSeconds: 222.1, at: AT },
          { kind: "time", distanceMeters: 500, durationSeconds: 105, at: AT },
        ],
        prior
      )
    ).toEqual([
      { type: "pr", at: AT, exerciseName: "Rowing", kind: "time", distanceMeters: 1000, durationSeconds: 222.1, previousBest: 230 },
    ]);
    expect(
      prItemsFor("Farmers Carry", [{ kind: "carry", distanceMeters: 40, weight: 64, at: AT }], prior)
    ).toEqual([{ type: "pr", at: AT, exerciseName: "Farmers Carry", kind: "carry", distanceMeters: 40, weight: 64, previousBest: 60 }]);
    expect(prItemsFor("Rowing", [{ kind: "time", distanceMeters: 1000, durationSeconds: 235, at: AT }], prior)).toEqual([]);
  });
});

describe("mergeAndCapActivity", () => {
  it("sorts newest-first across item types and caps the feed", () => {
    const items: ActivityItem[] = [
      { type: "check_in", at: "2026-06-10T08:00:00Z" },
      { type: "pr", at: "2026-06-12T08:00:00Z", exerciseName: "Squat", kind: "load", weight: 140, previousBest: 135 },
      { type: "session_completed", at: "2026-06-11T08:00:00Z", sessionName: "Push", exerciseCount: 5 },
    ];
    const merged = mergeAndCapActivity(items, 2);
    expect(merged.map((i) => i.type)).toEqual(["pr", "session_completed"]);
  });

  it("defaults to the feed cap", () => {
    const items: ActivityItem[] = Array.from({ length: 30 }, (_, i) => ({
      type: "check_in",
      at: `2026-06-${String((i % 28) + 1).padStart(2, "0")}T08:00:00Z`,
    }));
    expect(mergeAndCapActivity(items)).toHaveLength(ACTIVITY_FEED_CAP);
  });
});
