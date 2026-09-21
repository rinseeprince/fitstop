import type { ExerciseProgressionPoint } from "@/types/training";
import type { LoggedActuals } from "./set-log-measures";
import { calculateEpleyE1RM } from "./exercise-analytics-helpers";

// One session's values from its logged sets — the per-set math behind every
// progression point (services/exercise-analytics-service.ts): the chart
// markers, on the column rules utils/exercise-progress-markers.ts describes,
// and every value the Sessions table reads (utils/exercise-session-columns.ts),
// by one rule per measure (docs/TRAINING-UPGRADE-EXECUTION-PLAN.md section 4.4).
// Warm-ups count toward nothing here; failure and drop sets count like working
// sets.

/**
 * A logged set as the aggregation reads it: its type and every numeric measure
 * a set can record (utils/set-log-measures.ts, by wire key), canonical. Tempo
 * is text and is not among them.
 */
export type MarkerSet = { setType: string } & Omit<LoggedActuals, "tempo">;

/** The measures the set shapes below read — a lift, a bodyweight set, a timed distance, a hold. */
export type SetShape = Pick<MarkerSet, "weight" | "reps" | "distanceMeters" | "durationSeconds">;

type SessionMarkerValues = Omit<
  ExerciseProgressionPoint,
  "date" | "sessionLogId" | "prescribedSets" | "prescribedRepsMin" | "prescribedRepsMax"
>;

/** A load is a weight above zero: a blank box and a typed 0 both say "no weight". */
export const hasLoad = (set: Pick<SetShape, "weight">): boolean =>
  set.weight != null && set.weight > 0;

/** Reps logged with no load: the shape best set reps counts. */
export const isBodyweightSet = (set: Pick<SetShape, "weight" | "reps">): boolean =>
  set.reps != null && !hasLoad(set);

/** A time logged with a distance: a timed distance, where the fastest counts. */
export const isTimedDistance = (set: Pick<SetShape, "durationSeconds" | "distanceMeters">): boolean =>
  set.durationSeconds != null && set.distanceMeters != null;

/** A time logged with no distance: a hold, where the longest counts. */
export const isHold = (set: Pick<SetShape, "durationSeconds" | "distanceMeters">): boolean =>
  set.durationSeconds != null && set.distanceMeters == null;

const round1 = (n: number): number => Math.round(n * 10) / 10;

function best<T extends MarkerSet>(
  sets: readonly T[],
  value: (set: T) => number | null,
  better: "higher" | "lower",
): T | null {
  let chosen: T | null = null;
  let chosenValue: number | null = null;
  for (const set of sets) {
    const v = value(set);
    if (v == null) continue;
    if (
      chosenValue == null ||
      (better === "higher" ? v > chosenValue : v < chosenValue)
    ) {
      chosen = set;
      chosenValue = v;
    }
  }
  return chosen;
}

/** The values a measure recorded across the sets, blanks left out. */
const recorded = (sets: readonly MarkerSet[], value: (set: MarkerSet) => number | null): number[] =>
  sets.flatMap((set) => {
    const v = value(set);
    return v == null ? [] : [v];
  });

const highest = (values: readonly number[]): number | null =>
  values.length === 0 ? null : Math.max(...values);

const lowest = (values: readonly number[]): number | null =>
  values.length === 0 ? null : Math.min(...values);

const sum = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((total, v) => total + v, 0);

export function aggregateSessionMarkers(sets: readonly MarkerSet[]): SessionMarkerValues {
  const working = sets.filter((s) => s.setType !== "warmup");
  const lifts = working.filter(hasLoad);

  // Top set: the heaviest load, tiebreak by the higher rep count
  let topSet: MarkerSet | null = null;
  for (const s of lifts) {
    if (
      topSet == null ||
      (s.weight as number) > (topSet.weight as number) ||
      (s.weight === topSet.weight && (s.reps ?? 0) > (topSet.reps ?? 0))
    ) {
      topSet = s;
    }
  }

  // Volume: SUM(reps * weight) over sets with both; e1RM: the best Epley estimate
  let totalVolume: number | null = null;
  let estimatedOneRepMax: number | null = null;
  for (const s of lifts) {
    if (s.reps == null) continue;
    totalVolume = (totalVolume ?? 0) + s.reps * (s.weight as number);
    const e1rm = calculateEpleyE1RM(s.weight as number, s.reps);
    if (e1rm != null && (estimatedOneRepMax == null || e1rm > estimatedOneRepMax)) {
      estimatedOneRepMax = e1rm;
    }
  }

  const bestReps = best(working.filter(isBodyweightSet), (s) => s.reps, "higher");
  const bestPace = best(working, (s) => s.paceSecondsPerKm, "lower");
  const bestSplit = best(working, (s) => s.splitSecondsPer500m, "lower");
  const bestPower = best(working, (s) => s.power, "higher");
  const bestTime = best(working.filter(isTimedDistance), (s) => s.durationSeconds, "lower");
  const longestHold = best(working.filter(isHold), (s) => s.durationSeconds, "higher");

  const restTaken = recorded(working, (s) => s.restSeconds);

  return {
    topSetWeight: topSet?.weight ?? null,
    topSetReps: topSet?.reps ?? null,
    topSetDistanceMeters: topSet?.distanceMeters ?? null,
    topSetDurationSeconds: topSet?.durationSeconds ?? null,
    // The top set's, even when it recorded none; with no loaded set in the
    // session there is no top set, and the hardest effort logged stands in
    rpe: topSet ? topSet.rpe : highest(recorded(working, (s) => s.rpe)),
    rir: topSet ? topSet.rir : lowest(recorded(working, (s) => s.rir)),
    estimatedOneRepMax: estimatedOneRepMax != null ? round1(estimatedOneRepMax) : null,
    totalVolume,
    bestSetReps: bestReps?.reps ?? null,
    bestPaceSecondsPerKm: bestPace?.paceSecondsPerKm ?? null,
    bestPaceDistanceMeters: bestPace?.distanceMeters ?? null,
    totalDistanceMeters: sum(recorded(working, (s) => s.distanceMeters)),
    bestSplitSecondsPer500m: bestSplit?.splitSecondsPer500m ?? null,
    bestSplitDistanceMeters: bestSplit?.distanceMeters ?? null,
    bestPower: bestPower?.power ?? null,
    bestTimeSeconds: bestTime?.durationSeconds ?? null,
    bestTimeDistanceMeters: bestTime?.distanceMeters ?? null,
    bestTimeWeight: bestTime && hasLoad(bestTime) ? bestTime.weight : null,
    longestHoldSeconds: longestHold?.durationSeconds ?? null,
    totalCalories: sum(recorded(working, (s) => s.calories)),
    maxCadence: highest(recorded(working, (s) => s.cadence)),
    maxStrokeRate: highest(recorded(working, (s) => s.strokeRate)),
    maxResistance: highest(recorded(working, (s) => s.resistance)),
    maxHeartRateZone: highest(recorded(working, (s) => s.heartRateZone)),
    maxHeartRate: highest(recorded(working, (s) => s.heartRate)),
    maxFtpPercent: highest(recorded(working, (s) => s.ftpPercent)),
    averageRestSeconds:
      restTaken.length === 0 ? null : Math.round((sum(restTaken) as number) / restTaken.length),
    actualSets: working.length,
  };
}
