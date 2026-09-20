import type { ExerciseProgressionPoint } from "@/types/training";
import { calculateEpleyE1RM } from "./exercise-analytics-helpers";

// One session's chart markers from its logged sets — the per-set math behind
// every progression point (services/exercise-analytics-service.ts), on the
// column rules utils/exercise-progress-markers.ts describes. Warm-ups count
// toward nothing here; failure and drop sets count like working sets.

/** A logged set as the aggregation reads it: its type and the measures the markers use, canonical. */
export type MarkerSet = {
  setType: string;
  reps: number | null;
  weight: number | null;
  rpe: number | null;
  distanceMeters: number | null;
  durationSeconds: number | null;
  paceSecondsPerKm: number | null;
  splitSecondsPer500m: number | null;
  power: number | null;
};

type SessionMarkerValues = Omit<
  ExerciseProgressionPoint,
  "date" | "sessionLogId" | "prescribedSets" | "prescribedRepsMin" | "prescribedRepsMax"
>;

/** A load is a weight above zero: a blank box and a typed 0 both say "no weight". */
export const hasLoad = (set: MarkerSet): boolean => set.weight != null && set.weight > 0;

/** Reps logged with no load: the shape best set reps counts. */
export const isBodyweightSet = (set: MarkerSet): boolean => set.reps != null && !hasLoad(set);

/** A time logged with a distance: a timed distance, where the fastest counts. */
export const isTimedDistance = (set: MarkerSet): boolean =>
  set.durationSeconds != null && set.distanceMeters != null;

/** A time logged with no distance: a hold, where the longest counts. */
export const isHold = (set: MarkerSet): boolean =>
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

  let totalDistanceMeters: number | null = null;
  for (const s of working) {
    if (s.distanceMeters != null) {
      totalDistanceMeters = (totalDistanceMeters ?? 0) + s.distanceMeters;
    }
  }

  return {
    topSetWeight: topSet?.weight ?? null,
    topSetReps: topSet?.reps ?? null,
    topSetRpe: topSet?.rpe ?? null,
    topSetDistanceMeters: topSet?.distanceMeters ?? null,
    topSetDurationSeconds: topSet?.durationSeconds ?? null,
    estimatedOneRepMax: estimatedOneRepMax != null ? round1(estimatedOneRepMax) : null,
    totalVolume,
    bestSetReps: bestReps?.reps ?? null,
    bestPaceSecondsPerKm: bestPace?.paceSecondsPerKm ?? null,
    bestPaceDistanceMeters: bestPace?.distanceMeters ?? null,
    totalDistanceMeters,
    bestSplitSecondsPer500m: bestSplit?.splitSecondsPer500m ?? null,
    bestSplitDistanceMeters: bestSplit?.distanceMeters ?? null,
    bestPower: bestPower?.power ?? null,
    bestTimeSeconds: bestTime?.durationSeconds ?? null,
    bestTimeDistanceMeters: bestTime?.distanceMeters ?? null,
    bestTimeWeight: bestTime && hasLoad(bestTime) ? bestTime.weight : null,
    longestHoldSeconds: longestHold?.durationSeconds ?? null,
    actualSets: working.length,
  };
}
