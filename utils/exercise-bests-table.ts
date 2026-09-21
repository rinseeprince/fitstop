import type { ExerciseBestsRow } from "@/types/training";
import { EXERCISE_TYPE_LABELS } from "./exercise-types";
import { formatLoadNumber, formatSessionDate } from "./exercise-session-figures";
import { raceName } from "./race-distances";
import { formatDistance, formatDuration, formatLoad, type UnitSystem } from "./unit-conversions";

// The All exercises table (docs/TRAINING-UPGRADE-EXECUTION-PLAN.md section 4.4,
// commit 16b): one row per exercise the client has logged — its name, type,
// sessions and last day — then its bests, each a summary of its records
// (get_client_exercise_bests), so a row never disagrees with the exercise's PR
// cards. Every heading sorts, the Sessions table's way: a first click the way
// the column leads, a second the other way, one sort, ties by name, blanks
// last. The one table of the columns, read by the coach's exercise data view
// and the client's Performance view alike and restated for React Native in
// CLIENT-APP-REFERENCE.md.

/** The exercise picker's first row, in both views: every exercise's bests, in this table. */
export const ALL_EXERCISES_LABEL = "All exercises";

export const BESTS_COLUMNS = [
  "exercise",
  "type",
  "sessions",
  "last_logged",
  "heaviest_load",
  "best_e1rm",
  "most_reps",
  "best_time",
  "heaviest_carry",
  "longest_hold",
] as const;

export type BestsColumn = (typeof BESTS_COLUMNS)[number];

type SortOrder = "asc" | "desc";

type BestsColumnSpec = {
  /** The heading; a load's names the viewer's unit, its numbers being bare. */
  label: string;
  load: boolean;
  /** What the sort compares; a row with none sorts last. */
  sortValue: (row: ExerciseBestsRow) => number | string | null;
  /** The sort's words for each order, and the order a heading's first click sorts by. */
  asc: string;
  desc: string;
  leads: SortOrder;
};

const BESTS_COLUMN_SPECS: Record<BestsColumn, BestsColumnSpec> = {
  exercise: { label: "Exercise", load: false, sortValue: (row) => row.name, asc: "Name A to Z", desc: "Name Z to A", leads: "asc" },
  type: { label: "Type", load: false, sortValue: (row) => EXERCISE_TYPE_LABELS[row.exerciseType], asc: "Type A to Z", desc: "Type Z to A", leads: "asc" },
  sessions: { label: "Sessions", load: false, sortValue: (row) => row.sessionCount, asc: "Fewest sessions first", desc: "Most sessions first", leads: "desc" },
  last_logged: { label: "Last logged", load: false, sortValue: (row) => new Date(row.lastLoggedDate).getTime(), asc: "Oldest first", desc: "Newest first", leads: "desc" },
  heaviest_load: { label: "Heaviest load", load: true, sortValue: (row) => row.heaviestLoad, asc: "Lightest load first", desc: "Heaviest load first", leads: "desc" },
  best_e1rm: { label: "Best e1RM", load: true, sortValue: (row) => row.bestEstimatedOneRepMax, asc: "Lowest e1RM first", desc: "Highest e1RM first", leads: "desc" },
  most_reps: { label: "Most reps", load: false, sortValue: (row) => row.bestSetReps, asc: "Fewest reps first", desc: "Most reps first", leads: "desc" },
  best_time: { label: "Best time", load: false, sortValue: (row) => row.bestTime?.durationSeconds ?? null, asc: "Fastest time first", desc: "Slowest time first", leads: "asc" },
  heaviest_carry: { label: "Heaviest carry", load: true, sortValue: (row) => row.heaviestCarry?.weight ?? null, asc: "Lightest carry first", desc: "Heaviest carry first", leads: "desc" },
  longest_hold: { label: "Longest hold", load: false, sortValue: (row) => row.longestHoldSeconds, asc: "Shortest hold first", desc: "Longest hold first", leads: "desc" },
};

/** A heading: a load's names the unit its bare numbers are in — "Heaviest load (kg)". */
export function bestsColumnHeading(column: BestsColumn, viewer: UnitSystem): string {
  const spec = BESTS_COLUMN_SPECS[column];
  return spec.load ? `${spec.label} (${formatLoad(0, viewer).unit})` : spec.label;
}

/**
 * One cell, in the viewer's units; null where the exercise has no such best.
 * A load is bare under its heading; a best time names its race and a carry its
 * distance, the words the PR cards and the Sessions table's sets read them in.
 */
export function formatBestsCell(column: BestsColumn, row: ExerciseBestsRow, viewer: UnitSystem): string | null {
  switch (column) {
    case "exercise":
      return row.name;
    case "type":
      return EXERCISE_TYPE_LABELS[row.exerciseType];
    case "sessions":
      return row.sessionCount.toLocaleString();
    case "last_logged":
      return formatSessionDate(row.lastLoggedDate);
    case "heaviest_load":
      return row.heaviestLoad == null ? null : formatLoadNumber(row.heaviestLoad, viewer);
    case "best_e1rm":
      return row.bestEstimatedOneRepMax == null ? null : formatLoadNumber(row.bestEstimatedOneRepMax, viewer);
    case "most_reps":
      return row.bestSetReps == null ? null : row.bestSetReps.toLocaleString();
    case "best_time":
      return row.bestTime
        ? `${raceName(row.bestTime.race)} · ${formatDuration(row.bestTime.durationSeconds)}`
        : null;
    case "heaviest_carry":
      return row.heaviestCarry
        ? `${formatLoadNumber(row.heaviestCarry.weight, viewer)} × ${formatDistance(row.heaviestCarry.distanceMeters, viewer)}`
        : null;
    case "longest_hold":
      return row.longestHoldSeconds == null ? null : formatDuration(row.longestHoldSeconds);
  }
}

// --- Sort ---------------------------------------------------------------------

export type BestsSort = { column: BestsColumn; order: SortOrder };

/** Most sessions first: the order the exercise picker lists them in. */
export const DEFAULT_BESTS_SORT: BestsSort = { column: "sessions", order: "desc" };

/** A sort's words: "Most sessions first", "Fastest time first", "Name A to Z". */
export function bestsSortLabel(sort: BestsSort): string {
  const spec = BESTS_COLUMN_SPECS[sort.column];
  return sort.order === "asc" ? spec.asc : spec.desc;
}

/** What a click on a heading sorts by: another column, the way it leads; the one already sorted, the other way. */
export function nextBestsSort(current: BestsSort, column: BestsColumn): BestsSort {
  if (current.column === column) return { column, order: current.order === "desc" ? "asc" : "desc" };
  return { column, order: BESTS_COLUMN_SPECS[column].leads };
}

const byName = (a: ExerciseBestsRow, b: ExerciseBestsRow): number =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

/** The rows in the sort's order; ties by name, and an exercise with no value in the sorted column last. */
export function sortBests(rows: readonly ExerciseBestsRow[], sort: BestsSort): ExerciseBestsRow[] {
  const value = BESTS_COLUMN_SPECS[sort.column].sortValue;
  return [...rows].sort((a, b) => {
    const left = value(a);
    const right = value(b);
    if (left == null || right == null) {
      return left == null && right == null ? byName(a, b) : left == null ? 1 : -1;
    }
    if (left !== right) {
      const ascending =
        typeof left === "string" && typeof right === "string"
          ? left.localeCompare(right, undefined, { sensitivity: "base" })
          : Number(left) - Number(right);
      if (ascending !== 0) return sort.order === "asc" ? ascending : -ascending;
    }
    return byName(a, b);
  });
}
