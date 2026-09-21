import { describe, it, expect, vi } from "vitest";

vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("./exercise-analytics-service", () => ({ getExercisePRs: vi.fn() }));

import {
  buildMeasurementItems,
  detectPrItems,
  exercisesLoggedIn,
  mergeAndCapActivity,
  predecessorKey,
  prItemsFor,
  ACTIVITY_FEED_CAP,
  type MetricEntryFeedRow,
} from "./client-activity-feed-service";
import { getExercisePRs } from "./exercise-analytics-service";
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

const exerciseRow = (
  overrides: Partial<{
    session_log_id: string;
    exercise_id: string | null;
    performed_name: string | null;
    prescribed_exercise_snapshot: unknown;
    training_exercises: { exercise_id: string | null } | null;
  }> = {}
) => ({
  session_log_id: "log-1",
  exercise_id: null,
  performed_name: null,
  prescribed_exercise_snapshot: null,
  training_exercises: null,
  ...overrides,
});

describe("exercisesLoggedIn", () => {
  it("names each exercise once, the way the records are keyed: the catalog id, direct or prescribed, else the name", () => {
    expect(
      exercisesLoggedIn([
        exerciseRow({ exercise_id: "ex-1", performed_name: "Bench Press" }),
        exerciseRow({ session_log_id: "log-2", training_exercises: { exercise_id: "ex-1" }, performed_name: "Bench Press" }),
        exerciseRow({ performed_name: "Sled Push" }),
        exerciseRow({ session_log_id: "log-2", performed_name: "sled push" }),
      ])
    ).toEqual([
      { exerciseId: "ex-1", exerciseName: "Bench Press" },
      { exerciseId: null, exerciseName: "Sled Push" },
    ]);
  });

  it("shows the prescription's name where the log typed none, and skips a log with no exercise to ask for", () => {
    expect(
      exercisesLoggedIn([
        exerciseRow({ training_exercises: { exercise_id: "ex-2" }, prescribed_exercise_snapshot: { name: "Pull Up" } }),
        exerciseRow({ prescribed_exercise_snapshot: { name: "Mystery" } }),
      ])
    ).toEqual([{ exerciseId: "ex-2", exerciseName: "Pull Up" }]);
  });
});

const NEW_AT = "2026-06-16T18:00:00Z";
const sessionAt = new Map([["new-log", NEW_AT]]);
const pr = (best: ExerciseBest, sessionLogId = "old-log"): ExercisePR => ({
  ...best,
  date: "2026-06-01T00:00:00+00:00",
  sessionLogId,
  isRecent: false,
});

describe("prItemsFor", () => {
  it("announces the heaviest load when a new session lifted more than ever, at any reps — and a first never", () => {
    const prior = [pr({ kind: "rep_max", reps: 5, weight: 100 }), pr({ kind: "rep_max", reps: 3, weight: 105 })];
    const now = [pr({ kind: "rep_max", reps: 5, weight: 100 }), pr({ kind: "rep_max", reps: 3, weight: 110 }, "new-log")];
    expect(prItemsFor("Bench Press", now, prior, sessionAt)).toEqual([
      { type: "pr", at: NEW_AT, exerciseName: "Bench Press", kind: "load", weight: 110, previousBest: 105 },
    ]);
    // A new 8-rep max under the heaviest weight is no load PR
    expect(
      prItemsFor("Bench Press", [...prior, pr({ kind: "rep_max", reps: 8, weight: 95 }, "new-log")], prior, sessionAt)
    ).toEqual([]);
    // Equalling the heaviest weight is no PR, whichever rep max holds it
    expect(
      prItemsFor("Bench Press", [pr({ kind: "rep_max", reps: 1, weight: 105 }, "new-log"), ...prior], prior, sessionAt)
    ).toEqual([]);
    // A first-ever exercise: nothing before it to beat
    expect(prItemsFor("Bench Press", now, [], sessionAt)).toEqual([]);
  });

  it("announces more reps in a bodyweight set and a longer hold, and nothing a new session doesn't hold", () => {
    expect(
      prItemsFor("Pull Up", [pr({ kind: "best_reps", reps: 15 }, "new-log")], [pr({ kind: "best_reps", reps: 12 })], sessionAt)
    ).toEqual([{ type: "pr", at: NEW_AT, exerciseName: "Pull Up", kind: "reps", reps: 15, previousBest: 12 }]);
    expect(
      prItemsFor(
        "Plank",
        [pr({ kind: "longest_hold", durationSeconds: 120 }, "new-log")],
        [pr({ kind: "longest_hold", durationSeconds: 105 })],
        sessionAt
      )
    ).toEqual([{ type: "pr", at: NEW_AT, exerciseName: "Plank", kind: "hold", durationSeconds: 120, previousBest: 105 }]);
    // The record stayed with an older session
    expect(
      prItemsFor("Plank", [pr({ kind: "longest_hold", durationSeconds: 105 })], [pr({ kind: "longest_hold", durationSeconds: 105 })], sessionAt)
    ).toEqual([]);
    // A first best set: nothing before it to beat
    expect(prItemsFor("Pull Up", [pr({ kind: "best_reps", reps: 15 }, "new-log")], [], sessionAt)).toEqual([]);
  });

  it("announces nothing for a new session that only equals the record, as a backfill dated before it can", () => {
    // First-achieved on a tie: a new session dated earlier holds a record it only equals
    expect(
      prItemsFor(
        "Running",
        [pr({ kind: "best_time", distanceMeters: 5000, durationSeconds: 1245, race: "5k" }, "new-log")],
        [pr({ kind: "best_time", distanceMeters: 5000, durationSeconds: 1245, race: "5k" })],
        sessionAt
      )
    ).toEqual([]);
    expect(
      prItemsFor("Pull Up", [pr({ kind: "best_reps", reps: 12 }, "new-log")], [pr({ kind: "best_reps", reps: 12 })], sessionAt)
    ).toEqual([]);
  });

  it("judges a time at a race distance against that race's record only, named by the race", () => {
    const prior = [
      pr({ kind: "best_time", distanceMeters: 5000, durationSeconds: 1245, race: "5k" }),
      pr({ kind: "best_time", distanceMeters: 10000, durationSeconds: 2640, race: "10k" }),
    ];
    const now = [
      pr({ kind: "best_time", distanceMeters: 5000, durationSeconds: 1210, race: "5k" }, "new-log"),
      pr({ kind: "best_time", distanceMeters: 10000, durationSeconds: 2640, race: "10k" }),
      // A first 1 km record: nothing before it at that race
      pr({ kind: "best_time", distanceMeters: 1000, durationSeconds: 225, race: "1k" }, "new-log"),
    ];
    expect(prItemsFor("Running", now, prior, sessionAt)).toEqual([
      {
        type: "pr",
        at: NEW_AT,
        exerciseName: "Running",
        kind: "time",
        distanceMeters: 5000,
        race: "5k",
        durationSeconds: 1210,
        previousBest: 1245,
      },
    ]);
  });

  it("judges a carry and a time at the distance logged against that distance only", () => {
    const prior = [
      pr({ kind: "heaviest_carry", distanceMeters: 40, weight: 60 }),
      pr({ kind: "best_time", distanceMeters: 40, durationSeconds: 38, race: null }),
    ];
    const now = [
      pr({ kind: "heaviest_carry", distanceMeters: 40, weight: 64 }, "new-log"),
      pr({ kind: "heaviest_carry", distanceMeters: 20, weight: 80 }, "new-log"),
      pr({ kind: "best_time", distanceMeters: 40, durationSeconds: 35, race: null }, "new-log"),
    ];
    expect(prItemsFor("Farmers Carry", now, prior, sessionAt)).toEqual([
      { type: "pr", at: NEW_AT, exerciseName: "Farmers Carry", kind: "carry", distanceMeters: 40, weight: 64, previousBest: 60 },
      {
        type: "pr",
        at: NEW_AT,
        exerciseName: "Farmers Carry",
        kind: "time",
        distanceMeters: 40,
        race: null,
        durationSeconds: 35,
        previousBest: 38,
      },
    ]);
  });
});

describe("detectPrItems", () => {
  const getPRs = vi.mocked(getExercisePRs);

  it("reads each exercise's records, and a second time only where a new session holds one", async () => {
    getPRs.mockReset();
    getPRs.mockImplementation((_clientId, options) => {
      if (options.exerciseId === "bench") {
        return Promise.resolve(
          options.excludeDates
            ? [pr({ kind: "rep_max", reps: 1, weight: 100 })]
            : [pr({ kind: "rep_max", reps: 1, weight: 105 }, "new-log")]
        );
      }
      // The run's records all stayed with older sessions
      return Promise.resolve([pr({ kind: "best_time", distanceMeters: 5000, durationSeconds: 1245, race: "5k" })]);
    });

    const items = await detectPrItems(
      "client-1",
      [
        { exerciseId: "bench", exerciseName: "Bench Press" },
        { exerciseId: null, exerciseName: "Running" },
      ],
      sessionAt,
      new Set(["2026-06-16"])
    );

    expect(items).toEqual([
      { type: "pr", at: NEW_AT, exerciseName: "Bench Press", kind: "load", weight: 105, previousBest: 100 },
    ]);
    expect(getPRs.mock.calls).toEqual([
      ["client-1", { exerciseId: "bench" }],
      ["client-1", { exerciseName: "Running" }],
      ["client-1", { exerciseId: "bench", excludeDates: ["2026-06-16"] }],
    ]);
  });

  it("keeps the rest of the feed when one exercise's read fails", async () => {
    getPRs.mockReset();
    getPRs.mockRejectedValue(new Error("boom"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      detectPrItems("client-1", [{ exerciseId: "bench", exerciseName: "Bench Press" }], sessionAt, new Set())
    ).resolves.toEqual([]);
    errors.mockRestore();
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
