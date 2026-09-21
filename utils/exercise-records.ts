import type { ExerciseBest, ExercisePR, ExerciseProgressionPoint } from "@/types/training";
import { raceName } from "./race-distances";
import { formatDistance, formatDuration, formatLoad, type UnitSystem } from "./unit-conversions";

// An exercise's records (get_exercise_prs, migration 192) as a coach and a
// client read them: the PR cards' words, and which session holds each record —
// the star on a row of the Sessions table, beside the words of the card it
// names (docs/TRAINING-UPGRADE-EXECUTION-PLAN.md section 4.4).

type RecordWords = {
  label: string;
  /** The label is a number ("8 Rep Max", "5 km") and reads in the mono face. */
  numericLabel: boolean;
  value: string;
  unit: string;
};

/**
 * One record's words, the viewer's units: "8 Rep Max" 102.5 kg, "5 km" 24:10.
 * A best time at a race distance reads the race's name, the same for every
 * viewer ("5 km", "1 mile", "Half marathon"); one at the distance logged reads
 * the distance in the viewer's units.
 */
export function describeRecord(best: ExerciseBest, viewer: UnitSystem): RecordWords {
  switch (best.kind) {
    case "rep_max": {
      const load = formatLoad(best.weight, viewer);
      return {
        label: best.reps === 1 ? "1 Rep Max" : `${best.reps} Rep Max`,
        numericLabel: true,
        value: String(load.value),
        unit: load.unit,
      };
    }
    case "best_reps":
      return { label: "Best set", numericLabel: false, value: String(best.reps), unit: "reps" };
    case "best_time": {
      const label = best.race ? raceName(best.race) : formatDistance(best.distanceMeters, viewer);
      return {
        label,
        // "5 km" is a number; "Half marathon" is words
        numericLabel: /\d/.test(label),
        value: formatDuration(best.durationSeconds),
        unit: "",
      };
    }
    case "heaviest_carry": {
      const load = formatLoad(best.weight, viewer);
      return {
        label: `${formatDistance(best.distanceMeters, viewer)} carry`,
        numericLabel: true,
        value: String(load.value),
        unit: load.unit,
      };
    }
    case "longest_hold":
      return {
        label: "Longest hold",
        numericLabel: false,
        value: formatDuration(best.durationSeconds),
        unit: "",
      };
  }
}

/** A record on one line: "8 Rep Max · 102.5 kg". */
export function recordLine(best: ExerciseBest, viewer: UnitSystem): string {
  const words = describeRecord(best, viewer);
  return `${words.label} · ${words.value}${words.unit ? ` ${words.unit}` : ""}`;
}

/**
 * The records a session holds: those its sets set, named by the session on
 * each record (get_exercise_prs). A record keeps the session that set it, so a
 * session holds a record until a later one beats it.
 */
export function recordsHeldBy(
  point: Pick<ExerciseProgressionPoint, "sessionLogId">,
  records: readonly ExercisePR[],
): ExercisePR[] {
  return records.filter((record) => record.sessionLogId === point.sessionLogId);
}
