import type { ExerciseProgressionPoint } from "@/types/training";
import type { ExerciseType } from "./exercise-types";

// The chart markers and the PR kinds, by exercise type
// (docs/TRAINING-UPGRADE-EXECUTION-PLAN.md section 4.4). The one table the
// coach's exercise data view, the client's performance view, the trend chart,
// the KPI strip, the PR grid and the Overview's PR feed read — the sibling of
// COLUMN_PRESET_FIELDS.
//
// A marker is a per-session value on ExerciseProgressionPoint. An exercise's
// TYPE says which markers lead its chart and are always offered; the LOGGED
// COLUMNS say which others follow (offeredMarkers): a session that has a value
// for a marker offers it. The values are computed on column rules, never
// names (utils/exercise-session-markers.ts): a set logged with reps and no
// load is a bodyweight set, a time with a distance is a timed distance, a time
// with no distance is a hold, and RPE is the top set's or, with no loaded set,
// the highest logged — so a run's RPE reaches the chart. RPE and Compliance are
// the coach's lenses and are never offered to the client. The Sessions table
// reads the same values (utils/exercise-session-columns.ts).

export const PROGRESS_MARKERS = [
  "weight",
  "e1rm",
  "volume",
  "rpe",
  "compliance",
  "reps",
  "pace",
  "distance",
  "split",
  "power",
  "time",
  "hold",
] as const;

export type ProgressMarker = (typeof PROGRESS_MARKERS)[number];

/** The numeric keys of a point a marker can plot. */
export type MarkerValueKey = {
  [K in keyof ExerciseProgressionPoint]: ExerciseProgressionPoint[K] extends number | null ? K : never;
}[keyof ExerciseProgressionPoint];

/** How a marker's number reads: the entry grammar's kinds plus the plain-number words. */
export type MarkerReadout =
  | "load"
  | "reps"
  | "rpe"
  | "sets"
  | "distance"
  | "duration"
  | "pace"
  | "split"
  | "watts";

export type ProgressMarkerSpec = {
  key: ProgressMarker;
  /** The lens word. */
  label: string;
  title: string;
  subtitle: string;
  /** "No {noun} recorded for this exercise." */
  noun: string;
  value: MarkerValueKey;
  readout: MarkerReadout;
  /** Which way is better, or null for a value with no best. */
  better: "higher" | "lower" | null;
  /** The KPI strip's word for the best in the window. */
  bestLabel: string;
  shape: "area" | "bar" | "compliance";
  /** Whether the chart stars the best point in the window. */
  star: boolean;
  coachOnly: boolean;
};

export const PROGRESS_MARKER_SPECS: Record<ProgressMarker, ProgressMarkerSpec> = {
  weight: { key: "weight", label: "Weight", title: "Top set weight over time", subtitle: "Heaviest weight lifted per session", noun: "weight", value: "topSetWeight", readout: "load", better: "higher", bestLabel: "Heaviest", shape: "area", star: true, coachOnly: false },
  e1rm: { key: "e1rm", label: "e1RM", title: "Estimated 1RM over time", subtitle: "Epley formula from top sets", noun: "estimated 1RM", value: "estimatedOneRepMax", readout: "load", better: "higher", bestLabel: "Best", shape: "area", star: false, coachOnly: false },
  volume: { key: "volume", label: "Volume", title: "Session volume", subtitle: "Total reps x weight per session", noun: "volume", value: "totalVolume", readout: "load", better: null, bestLabel: "Peak", shape: "bar", star: false, coachOnly: false },
  rpe: { key: "rpe", label: "RPE", title: "RPE over time", subtitle: "Top set RPE per session, or the highest logged", noun: "RPE data", value: "rpe", readout: "rpe", better: null, bestLabel: "Highest", shape: "area", star: false, coachOnly: true },
  compliance: { key: "compliance", label: "Compliance", title: "Prescribed vs completed sets", subtitle: "Per-session compliance", noun: "prescribed data", value: "actualSets", readout: "sets", better: null, bestLabel: "Most", shape: "compliance", star: false, coachOnly: true },
  reps: { key: "reps", label: "Reps", title: "Best set reps over time", subtitle: "Most reps in one set per session, without added weight", noun: "reps without a weight", value: "bestSetReps", readout: "reps", better: "higher", bestLabel: "Most", shape: "area", star: true, coachOnly: false },
  pace: { key: "pace", label: "Pace", title: "Pace over time", subtitle: "Fastest pace per session", noun: "pace", value: "bestPaceSecondsPerKm", readout: "pace", better: "lower", bestLabel: "Fastest", shape: "area", star: true, coachOnly: false },
  distance: { key: "distance", label: "Distance", title: "Distance per session", subtitle: "Total distance logged per session", noun: "distance", value: "totalDistanceMeters", readout: "distance", better: "higher", bestLabel: "Longest", shape: "bar", star: false, coachOnly: false },
  split: { key: "split", label: "Split", title: "Split over time", subtitle: "Fastest 500 m split per session", noun: "split", value: "bestSplitSecondsPer500m", readout: "split", better: "lower", bestLabel: "Fastest", shape: "area", star: true, coachOnly: false },
  power: { key: "power", label: "Watts", title: "Power over time", subtitle: "Highest watts per session", noun: "watts", value: "bestPower", readout: "watts", better: "higher", bestLabel: "Highest", shape: "area", star: true, coachOnly: false },
  time: { key: "time", label: "Time", title: "Fastest time per session", subtitle: "The fastest set that logged a distance and a time", noun: "timed set", value: "bestTimeSeconds", readout: "duration", better: "lower", bestLabel: "Fastest", shape: "area", star: true, coachOnly: false },
  hold: { key: "hold", label: "Longest time", title: "Longest time per session", subtitle: "The longest set that logged a time and no distance", noun: "hold", value: "longestHoldSeconds", readout: "duration", better: "higher", bestLabel: "Longest", shape: "area", star: true, coachOnly: false },
};

/** A type's lead marker, with the words the type gives it. */
type MarkerLead = {
  key: ProgressMarker;
  label?: string;
  title?: string;
  subtitle?: string;
};

/**
 * The markers each type leads with, in the order the lens row offers them
 * (section 4.4). Compliance is the coach's on every type. Strength's five are
 * the lenses that existed before the other types had charts, unchanged.
 */
export const EXERCISE_TYPE_MARKERS: Record<ExerciseType, readonly MarkerLead[]> = {
  strength: [{ key: "weight" }, { key: "e1rm" }, { key: "volume" }, { key: "rpe" }, { key: "compliance" }],
  bodyweight: [{ key: "reps", label: "Best set reps" }, { key: "compliance" }],
  endurance: [{ key: "pace" }, { key: "distance" }, { key: "compliance" }],
  erg: [{ key: "split" }, { key: "power" }, { key: "compliance" }],
  carry_sled: [
    { key: "weight", label: "Load", title: "Heaviest carry over time", subtitle: "Heaviest load carried per session" },
    { key: "time" },
    { key: "compliance" },
  ],
  holds: [
    { key: "hold", label: "Longest hold", title: "Longest hold over time", subtitle: "Longest hold per session" },
    { key: "compliance" },
  ],
};

/** A marker as one type's chart names it: the type's words where it leads with the marker, the marker's own otherwise. */
export function markerLens(type: ExerciseType, marker: ProgressMarker): ProgressMarkerSpec {
  const lead = EXERCISE_TYPE_MARKERS[type].find((l) => l.key === marker);
  return lead ? { ...PROGRESS_MARKER_SPECS[marker], ...lead } : PROGRESS_MARKER_SPECS[marker];
}

/** Whether any session in the window has a value for the marker. */
export function hasMarkerValue(
  marker: ProgressMarker,
  points: readonly ExerciseProgressionPoint[],
): boolean {
  const key = PROGRESS_MARKER_SPECS[marker].value;
  return points.some((p) => p[key] != null);
}

type MarkerAudience = "coach" | "client";

/**
 * The lenses an exercise offers: its type's leads, always, then every other
 * marker a session in the window has a value for — a chart follows what was
 * actually logged when that differs from the type. The client never sees the
 * coach's lenses.
 */
export function offeredMarkers(
  type: ExerciseType,
  points: readonly ExerciseProgressionPoint[],
  audience: MarkerAudience,
): ProgressMarker[] {
  const leads = EXERCISE_TYPE_MARKERS[type].map((l) => l.key);
  const followers = PROGRESS_MARKERS.filter(
    (marker) => !leads.includes(marker) && hasMarkerValue(marker, points),
  );
  return [...leads, ...followers].filter(
    (marker) => audience === "coach" || !PROGRESS_MARKER_SPECS[marker].coachOnly,
  );
}

/** The lens to show: the one picked while the exercise offers it, else the first it offers. */
export function effectiveMarker(
  selected: ProgressMarker,
  offered: readonly ProgressMarker[],
): ProgressMarker {
  return offered.includes(selected) ? selected : offered[0];
}

// --- Bests --------------------------------------------------------------------

/** The PR kinds, mirrored by get_exercise_prs (migration 188) and ExerciseBest. */
export const BEST_KINDS = ["rep_max", "best_reps", "best_time", "heaviest_carry", "longest_hold"] as const;

export type BestKind = (typeof BEST_KINDS)[number];

/** The heading over a kind's cards when an exercise has bests of more than one kind. */
export const BEST_KIND_LABELS: Record<BestKind, string> = {
  rep_max: "Rep maxes",
  best_reps: "Best set",
  best_time: "Best times",
  heaviest_carry: "Heaviest carries",
  longest_hold: "Longest hold",
};

/** The bests each type owns, in the order its PR grid lists them. */
export const EXERCISE_TYPE_BEST_KINDS: Record<ExerciseType, readonly BestKind[]> = {
  strength: ["rep_max"],
  bodyweight: ["best_reps"],
  endurance: ["best_time"],
  erg: ["best_time"],
  carry_sled: ["heaviest_carry", "best_time"],
  holds: ["longest_hold"],
};

const BEST_KIND_SET: ReadonlySet<string> = new Set(BEST_KINDS);

export function isBestKind(value: unknown): value is BestKind {
  return typeof value === "string" && BEST_KIND_SET.has(value);
}

/**
 * The kinds an exercise's PR grid shows, of those it has rows for: the type's
 * own first, then any other kind the logs carried, in BEST_KINDS order.
 */
export function orderedBestKinds(
  type: ExerciseType,
  present: ReadonlySet<BestKind>,
): BestKind[] {
  const leads = EXERCISE_TYPE_BEST_KINDS[type].filter((kind) => present.has(kind));
  const followers = BEST_KINDS.filter((kind) => present.has(kind) && !leads.includes(kind));
  return [...leads, ...followers];
}

/** What the PR grid's empty state tells the client to log, by type. */
export const PR_EMPTY_HINTS: Record<ExerciseType, string> = {
  strength: "Log sets with weight to start tracking PRs.",
  bodyweight: "Log your reps to start tracking PRs.",
  endurance: "Log a distance and a time to start tracking PRs.",
  erg: "Log a distance and a time to start tracking PRs.",
  carry_sled: "Log a load and a distance to start tracking PRs.",
  holds: "Log how long you held to start tracking PRs.",
};
