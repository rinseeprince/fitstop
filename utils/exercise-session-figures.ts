import { format } from "date-fns";
import type { ExerciseProgressionPoint, ExerciseSessionSet } from "@/types/training";
import { dayFromUtcStamp } from "@/lib/date-helpers";
import type { ExerciseType } from "./exercise-types";
import type { MarkerValueKey } from "./exercise-progress-markers";
import { hasLoad } from "./exercise-session-markers";
import {
  formatDistance,
  formatDuration,
  formatLoad,
  formatPace,
  formatSplit,
  formatZone,
  type UnitSystem,
} from "./unit-conversions";

// The Sessions table beneath every exercise's chart, as a coach reads a
// session (docs/TRAINING-UPGRADE-EXECUTION-PLAN.md section 4.4, owner
// 2026-09-21): a row is a whole session, so it shows the session's working
// sets in coach shorthand, then a fixed few figures for the session as a whole
// chosen by the exercise's type, the main one first. The builder's columns
// describe one set and are not used here.
// A figure reads a value the progression point already carries
// (utils/exercise-session-markers.ts); where the chart plots the same figure it
// reads the same key, so a point and its row always match. The one table of the
// figures, read by the coach's exercise data view and the client's Performance
// view alike and restated for React Native in CLIENT-APP-REFERENCE.md.

export const SESSION_FIGURES = [
  "e1rm",
  "top_set",
  "volume",
  "rpe",
  "best_set",
  "total_reps",
  "pace",
  "distance",
  "time",
  "hr_zone",
  "split",
  "stroke_rate",
  "watts",
  "load",
  "longest_hold",
  "total_time",
] as const;

export type SessionFigure = (typeof SESSION_FIGURES)[number];

type FigureReadout =
  | "load"
  | "top_set"
  | "count"
  | "distance"
  | "duration"
  | "pace"
  | "split"
  | "zone";

type SessionFigureSpec = {
  /** The heading; a load's names the viewer's unit. */
  label: string;
  /** The sort's noun: "Highest e1RM first", "Fastest pace first". */
  noun: string;
  /** The point key the cell reads and the sort compares. */
  value: MarkerValueKey;
  readout: FigureReadout;
  /** The sort's words for the higher and the lower value first, and which a heading's first click sorts by. */
  higher: string;
  lower: string;
  leads: "higher" | "lower";
};

export const SESSION_FIGURE_SPECS: Record<SessionFigure, SessionFigureSpec> = {
  e1rm: { label: "e1RM", noun: "e1RM", value: "estimatedOneRepMax", readout: "load", higher: "Highest", lower: "Lowest", leads: "higher" },
  top_set: { label: "Top set", noun: "top set", value: "topSetWeight", readout: "top_set", higher: "Heaviest", lower: "Lightest", leads: "higher" },
  volume: { label: "Volume", noun: "volume", value: "totalVolume", readout: "load", higher: "Most", lower: "Least", leads: "higher" },
  rpe: { label: "RPE", noun: "RPE", value: "rpe", readout: "count", higher: "Highest", lower: "Lowest", leads: "higher" },
  best_set: { label: "Best set", noun: "reps in a set", value: "bestSetReps", readout: "count", higher: "Most", lower: "Fewest", leads: "higher" },
  total_reps: { label: "Total reps", noun: "total reps", value: "totalReps", readout: "count", higher: "Most", lower: "Fewest", leads: "higher" },
  pace: { label: "Pace", noun: "pace", value: "averagePaceSecondsPerKm", readout: "pace", higher: "Slowest", lower: "Fastest", leads: "lower" },
  distance: { label: "Distance", noun: "distance", value: "totalDistanceMeters", readout: "distance", higher: "Longest", lower: "Shortest", leads: "higher" },
  time: { label: "Time", noun: "time", value: "totalDurationSeconds", readout: "duration", higher: "Longest", lower: "Shortest", leads: "higher" },
  hr_zone: { label: "HR zone", noun: "HR zone", value: "maxHeartRateZone", readout: "zone", higher: "Highest", lower: "Lowest", leads: "higher" },
  split: { label: "Split", noun: "split", value: "averageSplitSecondsPer500m", readout: "split", higher: "Slowest", lower: "Fastest", leads: "lower" },
  stroke_rate: { label: "Stroke rate", noun: "stroke rate", value: "averageStrokeRate", readout: "count", higher: "Highest", lower: "Lowest", leads: "higher" },
  watts: { label: "Watts", noun: "watts", value: "averagePower", readout: "count", higher: "Most", lower: "Fewest", leads: "higher" },
  load: { label: "Load", noun: "load", value: "topSetWeight", readout: "load", higher: "Heaviest", lower: "Lightest", leads: "higher" },
  longest_hold: { label: "Longest hold", noun: "hold", value: "longestHoldSeconds", readout: "duration", higher: "Longest", lower: "Shortest", leads: "higher" },
  total_time: { label: "Total time", noun: "total time", value: "totalDurationSeconds", readout: "duration", higher: "Longest", lower: "Shortest", leads: "higher" },
};

/** Each type's figures, the main one first (owner, 2026-09-21). */
export const EXERCISE_TYPE_FIGURES: Record<ExerciseType, readonly SessionFigure[]> = {
  strength: ["e1rm", "top_set", "volume", "rpe"],
  bodyweight: ["best_set", "total_reps", "rpe"],
  endurance: ["pace", "distance", "time", "hr_zone"],
  erg: ["split", "distance", "time", "stroke_rate", "watts"],
  carry_sled: ["load", "distance", "time"],
  holds: ["longest_hold", "total_time", "rpe"],
};

/** A heading: a load's names the unit its bare numbers are in, the rest their figure. */
export function sessionFigureHeading(figure: SessionFigure, viewer: UnitSystem): string {
  const spec = SESSION_FIGURE_SPECS[figure];
  return spec.readout === "load" || spec.readout === "top_set"
    ? `${spec.label} (${formatLoad(0, viewer).unit})`
    : spec.label;
}

/** A session's date, as the PR cards read one: the day its stamp names. */
export function formatSessionDate(iso: string): string {
  return format(dayFromUtcStamp(iso), "MMM d, yyyy");
}

// A read-only load snaps like every other (CONVENTIONS section 20)
const loadNumber = (kg: number, viewer: UnitSystem): string =>
  formatLoad(kg, viewer).value.toLocaleString();

/** One figure of a session, in the viewer's units; null when the session has none. */
export function formatSessionFigure(
  figure: SessionFigure,
  point: ExerciseProgressionPoint,
  viewer: UnitSystem,
): string | null {
  const spec = SESSION_FIGURE_SPECS[figure];
  const value = point[spec.value];
  if (value == null) return null;
  switch (spec.readout) {
    case "load":
      return loadNumber(value, viewer);
    // The heaviest set, its reps with it
    case "top_set":
      return point.topSetReps == null
        ? loadNumber(value, viewer)
        : `${loadNumber(value, viewer)} × ${point.topSetReps}`;
    case "count":
      return value.toLocaleString();
    case "distance":
      return formatDistance(value, viewer);
    case "duration":
      return formatDuration(value);
    case "pace":
      return formatPace(value, viewer);
    case "split":
      return formatSplit(value);
    case "zone":
      return formatZone(value);
  }
}

// --- The sets ----------------------------------------------------------------

/** A set's reps when they are repeats of a distance or a time: 3 reps of 1 km (owner, 2026-09-21). */
const repeatsOf = (set: ExerciseSessionSet): number | null =>
  set.reps != null && set.reps > 1 && (set.distanceMeters != null || set.durationSeconds != null)
    ? set.reps
    : null;

/** One set in coach shorthand: `102.5 × 8`, `12`, `3 × 1 km`, `64 × 3 × 40 m`, `3 × 0:30`, `1:30`. */
function formatSet(set: ExerciseSessionSet, viewer: UnitSystem): string {
  const load = hasLoad(set) ? loadNumber(set.weight as number, viewer) : null;
  const times = repeatsOf(set);
  if (set.distanceMeters != null) {
    const distance = formatDistance(set.distanceMeters, viewer);
    const piece = times ? `${times} × ${distance}` : distance;
    return load ? `${load} × ${piece}` : piece;
  }
  // A lift's reps are its reps, whatever time it logged
  if (set.reps != null && (load || set.durationSeconds == null)) {
    return load ? `${load} × ${set.reps}` : String(set.reps);
  }
  if (set.durationSeconds != null) {
    const time = formatDuration(set.durationSeconds);
    return times ? `${times} × ${time}` : time;
  }
  return load as string;
}

/** A set that logged none of what the shorthand reads (an RIR or a tempo alone) says nothing there. */
const readsInShorthand = (set: ExerciseSessionSet): boolean =>
  hasLoad(set) || set.reps != null || set.distanceMeters != null || set.durationSeconds != null;

/** One piece of distance, done once, with no load: what a run of equal pieces groups. */
const isSinglePiece = (set: ExerciseSessionSet): boolean =>
  set.distanceMeters != null && !hasLoad(set) && repeatsOf(set) == null;

/**
 * The session's working sets in coach shorthand, in order — their shape, never
 * their times, which are the Time and Pace figures (owner, 2026-09-21):
 * `100 × 8 · 102.5 × 8`, `12 · 11 · 10`, `60 × 40 m`, `3 × 1 km`, `64 × 3 ×
 * 40 m`, `1:30 · 1:20` (a hold's length is its shape), and a run of pieces of
 * one distance done once each as one: `6 × 800 m`. Empty when no set logged
 * any of them.
 */
export function formatSessionSets(logged: readonly ExerciseSessionSet[], viewer: UnitSystem): string {
  const sets = logged.filter(readsInShorthand);
  const parts: string[] = [];
  let i = 0;
  while (i < sets.length) {
    const set = sets[i];
    if (!isSinglePiece(set)) {
      parts.push(formatSet(set, viewer));
      i += 1;
      continue;
    }
    let end = i + 1;
    while (
      end < sets.length &&
      isSinglePiece(sets[end]) &&
      sets[end].distanceMeters === set.distanceMeters
    ) {
      end += 1;
    }
    const count = end - i;
    const distance = formatDistance(set.distanceMeters as number, viewer);
    parts.push(count === 1 ? distance : `${count} × ${distance}`);
    i = end;
  }
  return parts.join(" · ");
}

/** The Sets heading: it names the load's unit when the window's sets carry one. */
export function sessionSetsHeading(
  points: readonly ExerciseProgressionPoint[],
  viewer: UnitSystem,
): string {
  const loaded = points.some((point) => point.sets.some(hasLoad));
  return loaded ? `Sets (${formatLoad(0, viewer).unit})` : "Sets";
}

// --- Sort ---------------------------------------------------------------------

export type SessionSort = { column: "date" | SessionFigure; order: "asc" | "desc" };

export const DEFAULT_SESSION_SORT: SessionSort = { column: "date", order: "desc" };

/** A sort's words: "Newest first", "Highest e1RM first", "Fastest pace first". */
export function sessionSortLabel(sort: SessionSort): string {
  if (sort.column === "date") return sort.order === "desc" ? "Newest first" : "Oldest first";
  const spec = SESSION_FIGURE_SPECS[sort.column];
  return `${sort.order === "desc" ? spec.higher : spec.lower} ${spec.noun} first`;
}

/**
 * What a click on a heading sorts by (owner, 2026-09-21): another figure, the
 * way it leads — highest e1RM, fastest pace, longest hold, newest first; the
 * one already sorted, the other way.
 */
export function nextSessionSort(current: SessionSort, column: "date" | SessionFigure): SessionSort {
  if (current.column === column) return { column, order: current.order === "desc" ? "asc" : "desc" };
  if (column === "date") return DEFAULT_SESSION_SORT;
  return { column, order: SESSION_FIGURE_SPECS[column].leads === "higher" ? "desc" : "asc" };
}

const newestFirst = (a: ExerciseProgressionPoint, b: ExerciseProgressionPoint): number =>
  a.date === b.date ? 0 : a.date < b.date ? 1 : -1;

/** The rows in the sort's order; a session with no value in the sorted figure goes last, newest first. */
export function sortSessions(
  points: readonly ExerciseProgressionPoint[],
  sort: SessionSort,
): ExerciseProgressionPoint[] {
  if (sort.column === "date") {
    const newest = [...points].sort(newestFirst);
    return sort.order === "desc" ? newest : newest.reverse();
  }
  const key = SESSION_FIGURE_SPECS[sort.column].value;
  return [...points].sort((a, b) => {
    const left = a[key];
    const right = b[key];
    if (left == null || right == null) {
      return left == null && right == null ? newestFirst(a, b) : left == null ? 1 : -1;
    }
    if (left !== right) return sort.order === "desc" ? right - left : left - right;
    return newestFirst(a, b);
  });
}
