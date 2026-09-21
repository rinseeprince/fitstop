import type {
  ExerciseBest,
  ExercisePR,
  ExerciseProgressionPoint,
  ExerciseSessionSet,
} from "@/types/training";
import { hasLoad } from "./exercise-session-markers";
import { formatDistance, formatDuration, formatLoad, type UnitSystem } from "./unit-conversions";

// An exercise's records (get_exercise_prs, migration 188) as a coach and a
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

/** One record's words, the viewer's units: "8 Rep Max" 102.5 kg, "5 km" 24:10. */
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
    case "best_time":
      return {
        label: formatDistance(best.distanceMeters, viewer),
        numericLabel: true,
        value: formatDuration(best.durationSeconds),
        unit: "",
      };
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

/** Whether a set is the one a record was set by, on the record's own column rules. */
function setHolds(set: ExerciseSessionSet, best: ExerciseBest): boolean {
  switch (best.kind) {
    case "rep_max":
      return set.reps === best.reps && set.weight === best.weight;
    case "best_reps":
      return set.reps === best.reps && !hasLoad(set);
    case "best_time":
      return set.distanceMeters === best.distanceMeters && set.durationSeconds === best.durationSeconds;
    case "heaviest_carry":
      return set.distanceMeters === best.distanceMeters && set.weight === best.weight;
    case "longest_hold":
      return set.distanceMeters == null && set.durationSeconds === best.durationSeconds;
  }
}

/**
 * The records a session holds: those set on its day by one of its working
 * sets. A record keeps the day of the session that set it, so a session holds
 * a record until a later one beats it.
 */
export function recordsHeldBy(
  point: Pick<ExerciseProgressionPoint, "date" | "sets">,
  records: readonly ExercisePR[],
): ExercisePR[] {
  const day = new Date(point.date).getTime();
  return records.filter(
    (record) =>
      new Date(record.date).getTime() === day && point.sets.some((set) => setHolds(set, record)),
  );
}
