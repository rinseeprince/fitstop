import type { ExerciseProgressionPoint, ExerciseSessionSet } from "@/types/training";
import type { LoggedActuals } from "./set-log-measures";
import { calculateEpleyE1RM } from "./exercise-analytics-helpers";

// One session's values from its logged sets — the per-set math behind every
// progression point (services/exercise-analytics-service.ts): the chart
// markers, on the column rules utils/exercise-progress-markers.ts describes,
// and the figures of the Sessions table (utils/exercise-session-figures.ts),
// which reads the same values (docs/TRAINING-UPGRADE-EXECUTION-PLAN.md section
// 4.4). A lift's values are its top set's and its best estimate; an endurance
// session's are the session's own — its distance and time added up, every
// repeat counted, and the average pace and split over them. Reps on a set with
// a distance or a time are repeats, never a rep count, so such a set makes no
// best set, e1RM, volume or rep total — get_exercise_prs (migration 192) reads
// the records off the same sets, a set's time the same way. Warm-ups count
// toward nothing here; failure and drop sets count like working sets.

/**
 * A logged set as the aggregation reads it: its type and every numeric measure
 * a set can record (utils/set-log-measures.ts, by wire key), canonical. Tempo
 * is text and is not among them.
 */
export type MarkerSet = { setType: string } & Omit<LoggedActuals, "tempo">;

/** The measures the set shapes below read — a lift, a bodyweight set, a hold. */
type SetShape = ExerciseSessionSet;

type SessionMarkerValues = Omit<
  ExerciseProgressionPoint,
  "date" | "sessionLogId" | "eventId" | "prescribedSets" | "prescribedRepsMin" | "prescribedRepsMax"
>;

/** A load is a weight above zero: a blank box and a typed 0 both say "no weight". */
export const hasLoad = (set: Pick<SetShape, "weight">): boolean =>
  set.weight != null && set.weight > 0;

/**
 * A set with a distance or a time: its reps are repeats — 3 reps of 1 km is
 * 3 km, 3 reps of 30 s is 1:30 (owner, 2026-09-21) — never a rep count.
 */
const hasDistanceOrTime = (set: Pick<SetShape, "distanceMeters" | "durationSeconds">): boolean =>
  set.distanceMeters != null || set.durationSeconds != null;

/** Reps logged with no load, and neither a distance nor a time: the shape best set reps counts. */
export const isBodyweightSet = (set: SetShape): boolean =>
  set.reps != null && !hasLoad(set) && !hasDistanceOrTime(set);

/**
 * A load logged with neither a distance nor a time — lifted, not carried or
 * held — so its reps are reps: the shape the e1RM, the volume and the rep maxes
 * read.
 */
export const isLift = (set: SetShape): boolean => hasLoad(set) && !hasDistanceOrTime(set);

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

const sum = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((total, v) => total + v, 0);

const mean = (values: readonly number[]): number | null =>
  values.length === 0 ? null : (sum(values) as number) / values.length;

/**
 * How many times a set was done. On a set with a distance or a time its reps
 * are repeats — 3 reps of 1 km is 3 km, 3 reps of 30 s is 1:30 (owner,
 * 2026-09-21); a set with no reps was done once. Only a distance and a time are
 * multiplied, so a lift's reps stay its reps.
 */
const repeats = (set: MarkerSet): number => (set.reps != null && set.reps > 0 ? set.reps : 1);

/**
 * The time one repeat of a set took: the time typed, else, over a distance, the
 * time its pace or split gives (owner, 2026-09-21). A typed time wins over a
 * typed pace, and nothing typed is changed — this is the session's arithmetic.
 */
function repeatTime(set: MarkerSet): number | null {
  if (set.durationSeconds != null) return set.durationSeconds;
  if (set.distanceMeters == null) return null;
  if (set.paceSecondsPerKm != null) return (set.paceSecondsPerKm * set.distanceMeters) / 1000;
  if (set.splitSecondsPer500m != null) return (set.splitSecondsPer500m * set.distanceMeters) / 500;
  return null;
}

/**
 * The session's average time per `perMeters` — its pace, or its split — its
 * time over its distance across every repeat of the sets that have both; else,
 * with no such set, the mean of the ones typed, each counted once per repeat.
 */
function averageRate(
  working: readonly MarkerSet[],
  perMeters: number,
  typed: (set: MarkerSet) => number | null,
  round: (n: number) => number,
): number | null {
  let time = 0;
  let distance = 0;
  for (const set of working) {
    const taken = repeatTime(set);
    if (taken == null || set.distanceMeters == null) continue;
    time += repeats(set) * taken;
    distance += repeats(set) * set.distanceMeters;
  }
  if (distance > 0) return round((time / distance) * perMeters);
  let total = 0;
  let count = 0;
  for (const set of working) {
    const value = typed(set);
    if (value == null) continue;
    total += repeats(set) * value;
    count += repeats(set);
  }
  return count === 0 ? null : round(total / count);
}

const roundedMean = (values: readonly number[]): number | null => {
  const m = mean(values);
  return m == null ? null : Math.round(m);
};

export function aggregateSessionMarkers(sets: readonly MarkerSet[]): SessionMarkerValues {
  const working = sets.filter((s) => s.setType !== "warmup");

  // Top set: the heaviest load of any set — a carry's included, which its Load
  // lens reads — tiebreak by the higher rep count
  let topSet: MarkerSet | null = null;
  for (const s of working.filter(hasLoad)) {
    if (
      topSet == null ||
      (s.weight as number) > (topSet.weight as number) ||
      (s.weight === topSet.weight && (s.reps ?? 0) > (topSet.reps ?? 0))
    ) {
      topSet = s;
    }
  }

  // Volume: SUM(reps * weight) over the lifts with reps; e1RM: the best Epley
  // estimate among them. A carry's or a timed set's reps are repeats, not reps.
  let totalVolume: number | null = null;
  let estimatedOneRepMax: number | null = null;
  for (const s of working.filter(isLift)) {
    if (s.reps == null) continue;
    totalVolume = (totalVolume ?? 0) + s.reps * (s.weight as number);
    const e1rm = calculateEpleyE1RM(s.weight as number, s.reps);
    if (e1rm != null && (estimatedOneRepMax == null || e1rm > estimatedOneRepMax)) {
      estimatedOneRepMax = e1rm;
    }
  }

  const bestReps = best(working.filter(isBodyweightSet), (s) => s.reps, "higher");
  const longestHold = best(working.filter(isHold), (s) => s.durationSeconds, "higher");
  // Every repeat of every set: its distance, and its time typed or from its pace
  const totalDistance = sum(
    recorded(working, (s) => (s.distanceMeters == null ? null : repeats(s) * s.distanceMeters)),
  );
  const totalDuration = sum(
    recorded(working, (s) => {
      const taken = repeatTime(s);
      return taken == null ? null : repeats(s) * taken;
    }),
  );

  return {
    sets: working.map((s) => ({
      weight: s.weight,
      reps: s.reps,
      distanceMeters: s.distanceMeters,
      durationSeconds: s.durationSeconds,
    })),
    topSetWeight: topSet?.weight ?? null,
    topSetReps: topSet?.reps ?? null,
    topSetDistanceMeters: topSet?.distanceMeters ?? null,
    topSetDurationSeconds: topSet?.durationSeconds ?? null,
    // The top set's, even when it recorded none; with no loaded set in the
    // session there is no top set, and the hardest effort logged stands in
    rpe: topSet ? topSet.rpe : highest(recorded(working, (s) => s.rpe)),
    estimatedOneRepMax: estimatedOneRepMax != null ? round1(estimatedOneRepMax) : null,
    totalVolume,
    bestSetReps: bestReps?.reps ?? null,
    // Every set's reps, but a set's repeats are not reps
    totalReps: sum(recorded(working, (s) => (hasDistanceOrTime(s) ? null : s.reps))),
    totalDistanceMeters: totalDistance,
    totalDurationSeconds: totalDuration == null ? null : round1(totalDuration),
    // A pace is whole seconds, a split tenths (utils/set-log-measures.ts)
    averagePaceSecondsPerKm: averageRate(working, 1000, (s) => s.paceSecondsPerKm, Math.round),
    averageSplitSecondsPer500m: averageRate(working, 500, (s) => s.splitSecondsPer500m, round1),
    averageStrokeRate: roundedMean(recorded(working, (s) => s.strokeRate)),
    averagePower: roundedMean(recorded(working, (s) => s.power)),
    maxHeartRateZone: highest(recorded(working, (s) => s.heartRateZone)),
    longestHoldSeconds: longestHold?.durationSeconds ?? null,
    actualSets: working.length,
  };
}
