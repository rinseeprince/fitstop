import { describe, expect, it } from "vitest";
import type { ExerciseBestsRow } from "@/types/training";
import {
  BESTS_COLUMNS,
  DEFAULT_BESTS_SORT,
  bestsColumnHeading,
  bestsSortLabel,
  formatBestsCell,
  nextBestsSort,
  sortBests,
  type BestsColumn,
} from "./exercise-bests-table";

const row = (overrides: Partial<ExerciseBestsRow>): ExerciseBestsRow => ({
  exerciseId: "ex",
  name: "Exercise",
  exerciseType: "strength",
  sessionCount: 1,
  lastLoggedDate: "2026-09-01T00:00:00+00:00",
  heaviestLoad: null,
  bestEstimatedOneRepMax: null,
  bestSetReps: null,
  bestTime: null,
  heaviestCarry: null,
  longestHoldSeconds: null,
  ...overrides,
});

const bench = row({
  exerciseId: "bench",
  name: "Barbell Bench Press",
  sessionCount: 18,
  lastLoggedDate: "2026-09-20T00:00:00+00:00",
  heaviestLoad: 110,
  bestEstimatedOneRepMax: 150,
});
const running = row({
  exerciseId: "run",
  name: "Running",
  exerciseType: "endurance",
  sessionCount: 13,
  lastLoggedDate: "2026-09-21T00:00:00+00:00",
  bestTime: { race: "half_marathon", durationSeconds: 5530 },
});
const carry = row({
  exerciseId: "carry",
  name: "Farmer Carry",
  exerciseType: "carry_sled",
  sessionCount: 4,
  heaviestCarry: { weight: 70, distanceMeters: 40 },
});
const plank = row({ exerciseId: "plank", name: "plank", exerciseType: "holds", sessionCount: 6, longestHoldSeconds: 120 });
const pullUp = row({ exerciseId: "pull", name: "Pull Up", exerciseType: "bodyweight", sessionCount: 6, bestSetReps: 13 });

describe("the All exercises table's columns", () => {
  it("are the owner's: the exercise, its type, sessions and last day, then its bests (section 4.4)", () => {
    expect(BESTS_COLUMNS.map((column) => bestsColumnHeading(column, "metric"))).toEqual([
      "Exercise",
      "Type",
      "Sessions",
      "Last logged",
      "Heaviest load (kg)",
      "Best e1RM (kg)",
      "Most reps",
      "Best time",
      "Heaviest carry (kg)",
      "Longest hold",
    ]);
    expect(bestsColumnHeading("heaviest_carry", "imperial")).toBe("Heaviest carry (lbs)");
  });

  it("read each exercise's bests in the viewer's units, a dash where it has none", () => {
    const cells = (r: ExerciseBestsRow, viewer: "metric" | "imperial" = "metric") =>
      Object.fromEntries(BESTS_COLUMNS.map((column) => [column, formatBestsCell(column, r, viewer)]));
    expect(cells(bench)).toEqual({
      exercise: "Barbell Bench Press",
      type: "Strength",
      sessions: "18",
      last_logged: "Sep 20, 2026",
      heaviest_load: "110",
      best_e1rm: "150",
      most_reps: null,
      best_time: null,
      heaviest_carry: null,
      longest_hold: null,
    });
    // A best time names its race; a race reads the same for every viewer
    expect(formatBestsCell("best_time", running, "metric")).toBe("Half marathon · 1:32:10");
    expect(formatBestsCell("best_time", running, "imperial")).toBe("Half marathon · 1:32:10");
    // A carry names its distance, in the Sessions table's carry shorthand
    expect(formatBestsCell("heaviest_carry", carry, "metric")).toBe("70 × 40 m");
    expect(formatBestsCell("heaviest_carry", carry, "imperial")).toBe("155 × 44 yd");
    expect(formatBestsCell("heaviest_load", bench, "imperial")).toBe("242.5");
    expect(formatBestsCell("longest_hold", plank, "metric")).toBe("2:00");
    expect(formatBestsCell("most_reps", pullUp, "metric")).toBe("13");
    expect(formatBestsCell("type", carry, "metric")).toBe("Carry & sled");
  });
});

describe("sorting the All exercises table", () => {
  const rows = [plank, running, bench, carry, pullUp];
  const names = (sorted: ExerciseBestsRow[]) => sorted.map((r) => r.name);

  it("opens on most sessions first, the exercise picker's order, ties by name", () => {
    expect(DEFAULT_BESTS_SORT).toEqual({ column: "sessions", order: "desc" });
    expect(names(sortBests(rows, DEFAULT_BESTS_SORT))).toEqual([
      "Barbell Bench Press",
      "Running",
      "plank",
      "Pull Up",
      "Farmer Carry",
    ]);
  });

  it("sorts a heading's first click the way the column leads, and its second the other way", () => {
    const leads: Record<BestsColumn, string> = {
      exercise: "Name A to Z",
      type: "Type A to Z",
      sessions: "Most sessions first",
      last_logged: "Newest first",
      heaviest_load: "Heaviest load first",
      best_e1rm: "Highest e1RM first",
      most_reps: "Most reps first",
      best_time: "Fastest time first",
      heaviest_carry: "Heaviest carry first",
      longest_hold: "Longest hold first",
    };
    for (const column of BESTS_COLUMNS) {
      const first = nextBestsSort(column === "sessions" ? { column: "exercise", order: "asc" } : DEFAULT_BESTS_SORT, column);
      expect(bestsSortLabel(first), column).toBe(leads[column]);
      const second = nextBestsSort(first, column);
      expect(second, column).toEqual({ column, order: first.order === "asc" ? "desc" : "asc" });
    }
  });

  it("sorts names and types A to Z whatever their case", () => {
    expect(names(sortBests(rows, { column: "exercise", order: "asc" }))).toEqual([
      "Barbell Bench Press",
      "Farmer Carry",
      "plank",
      "Pull Up",
      "Running",
    ]);
    expect(names(sortBests(rows, { column: "type", order: "asc" }))).toEqual([
      "Pull Up", // Bodyweight
      "Farmer Carry", // Carry & sled
      "Running", // Endurance
      "plank", // Holds
      "Barbell Bench Press", // Strength
    ]);
  });

  it("puts an exercise with no value in the sorted column last, either way round, by name", () => {
    const heaviest = names(sortBests(rows, { column: "heaviest_load", order: "desc" }));
    expect(heaviest[0]).toBe("Barbell Bench Press");
    expect(heaviest.slice(1)).toEqual(["Farmer Carry", "plank", "Pull Up", "Running"]);
    const lightest = names(sortBests(rows, { column: "heaviest_load", order: "asc" }));
    expect(lightest[0]).toBe("Barbell Bench Press");
  });

  it("breaks a tie by name, whatever order the rows came in", () => {
    const tied = [
      row({ name: "Zercher Squat", sessionCount: 3 }),
      row({ name: "front squat", sessionCount: 3 }),
      row({ name: "Box Squat", sessionCount: 3 }),
    ];
    expect(names(sortBests(tied, DEFAULT_BESTS_SORT))).toEqual(["Box Squat", "front squat", "Zercher Squat"]);
    // Blanks tie too: by name, after every value
    expect(names(sortBests([...tied, bench], { column: "heaviest_load", order: "desc" }))).toEqual([
      "Barbell Bench Press",
      "Box Squat",
      "front squat",
      "Zercher Squat",
    ]);
  });

  it("puts the fastest time first, and the newest day", () => {
    const tempo = row({ name: "Tempo Run", exerciseType: "endurance", bestTime: { race: "5k", durationSeconds: 1205 } });
    expect(names(sortBests([running, tempo, bench], { column: "best_time", order: "asc" }))).toEqual([
      "Tempo Run",
      "Running",
      "Barbell Bench Press",
    ]);
    expect(names(sortBests(rows, { column: "last_logged", order: "desc" })).slice(0, 2)).toEqual([
      "Running",
      "Barbell Bench Press",
    ]);
  });
});
