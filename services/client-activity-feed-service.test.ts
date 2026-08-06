import { describe, it, expect, vi } from "vitest";

vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("./exercise-analytics-service", () => ({ getExercisePRs: vi.fn() }));

import {
  buildMeasurementItems,
  collectNewExerciseBests,
  mergeAndCapActivity,
  predecessorKey,
  priorBestExcludingDates,
  ACTIVITY_FEED_CAP,
  type MetricEntryFeedRow,
} from "./client-activity-feed-service";
import type { ActivityItem } from "@/types/coach-brief";

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

describe("collectNewExerciseBests", () => {
  const sessionAt = new Map([
    ["log-1", "2026-06-14T18:00:00Z"],
    ["log-2", "2026-06-16T18:00:00Z"],
  ]);

  it("takes the heaviest non-warmup set, keyed on catalog id, across sessions", () => {
    const bests = collectNewExerciseBests(
      [
        {
          session_log_id: "log-1",
          exercise_id: "ex-1",
          performed_name: "Bench Press",
          prescribed_exercise_snapshot: null,
          training_exercises: null,
          set_logs: [
            { weight: 120, set_type: "warmup" },
            { weight: 100, set_type: "working" },
          ],
        },
        {
          session_log_id: "log-2",
          exercise_id: null,
          performed_name: "Bench Press",
          prescribed_exercise_snapshot: null,
          training_exercises: { exercise_id: "ex-1" },
          set_logs: [{ weight: 102.5, set_type: "amrap" }],
        },
      ],
      sessionAt
    );

    expect(bests).toEqual([
      {
        exerciseId: "ex-1",
        exerciseName: "Bench Press",
        newMax: 102.5,
        at: "2026-06-16T18:00:00Z",
      },
    ]);
  });

  it("falls back to a name identity and skips exercises with no loggable sets", () => {
    const bests = collectNewExerciseBests(
      [
        {
          session_log_id: "log-1",
          exercise_id: null,
          performed_name: "Sled Push",
          prescribed_exercise_snapshot: null,
          training_exercises: null,
          set_logs: [{ weight: 60, set_type: "working" }],
        },
        {
          session_log_id: "log-1",
          exercise_id: null,
          performed_name: "Plank",
          prescribed_exercise_snapshot: null,
          training_exercises: null,
          set_logs: [{ weight: null, set_type: "working" }],
        },
      ],
      sessionAt
    );

    expect(bests).toEqual([
      { exerciseId: null, exerciseName: "Sled Push", newMax: 60, at: "2026-06-14T18:00:00Z" },
    ]);
  });
});

describe("priorBestExcludingDates", () => {
  it("takes the max weight among rows not attributed to the new sessions", () => {
    expect(
      priorBestExcludingDates(
        [
          { weight: 100, date: "2026-06-01T00:00:00+00:00" },
          { weight: 105, date: "2026-06-08T00:00:00+00:00" },
          { weight: 110, date: "2026-06-12T00:00:00+00:00" },
        ],
        new Set(["2026-06-12"])
      )
    ).toBe(105);
  });

  it("returns null when every row belongs to the new sessions (first-ever exercise)", () => {
    expect(
      priorBestExcludingDates(
        [{ weight: 110, date: "2026-06-12T00:00:00+00:00" }],
        new Set(["2026-06-12"])
      )
    ).toBeNull();
  });

  it("does not treat a same-day session logged after Mark seen as its own prior best", () => {
    // The regression this replaced: completed_at is the prescribed day (midnight),
    // so an evening PR on a morning-anchored day looked like pre-anchor history.
    const rows = [
      { weight: 105, date: "2026-07-20T00:00:00+00:00" },
      { weight: 110, date: "2026-07-26T00:00:00+00:00" }, // the new session's own row
    ];
    expect(priorBestExcludingDates(rows, new Set(["2026-07-26"]))).toBe(105);
  });
});

describe("mergeAndCapActivity", () => {
  it("sorts newest-first across item types and caps the feed", () => {
    const items: ActivityItem[] = [
      { type: "check_in", at: "2026-06-10T08:00:00Z" },
      { type: "pr", at: "2026-06-12T08:00:00Z", exerciseName: "Squat", weight: 140, previousBest: 135 },
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
