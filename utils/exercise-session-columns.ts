import { format } from "date-fns";
import type { ExerciseProgressionPoint } from "@/types/training";
import { dayFromUtcStamp } from "@/lib/date-helpers";
import { PROGRESS_MARKER_SPECS, type MarkerValueKey } from "./exercise-progress-markers";
import { BOX_LABELS } from "./set-log-measures";
import {
  formatDistance,
  formatDuration,
  formatLoad,
  formatPace,
  formatSplit,
  formatZone,
  type UnitSystem,
} from "./unit-conversions";

// The Sessions table beneath every exercise's chart
// (docs/TRAINING-UPGRADE-EXECUTION-PLAN.md section 4.4): one row per logged
// session in the window, one column per measure its sessions carry. The one
// table of its columns, read by the coach's exercise data view and the client's
// Performance view alike and restated for React Native in
// CLIENT-APP-REFERENCE.md. A cell is a value the progression point already
// carries, computed by one rule per measure (utils/exercise-session-markers.ts);
// a column with a chart twin reads the chart marker's own key, so the RPE lens
// and the RPE column read one value. Tempo joins in commit 16b, whose migration
// adds it to the read.

export const SESSION_COLUMNS = [
  "load",
  "reps",
  "bodyweight_reps",
  "rpe",
  "rir",
  "e1rm",
  "volume",
  "distance",
  "time",
  "hold",
  "pace",
  "split",
  "calories",
  "cadence",
  "stroke_rate",
  "resistance",
  "heart_rate_zone",
  "heart_rate",
  "power",
  "ftp_percent",
  "rest",
  "sets",
] as const;

export type SessionColumn = (typeof SESSION_COLUMNS)[number];

type ColumnReadout = "load" | "number" | "distance" | "duration" | "pace" | "split" | "zone" | "sets";

type SessionColumnSpec = {
  /** The heading; a load's names the viewer's unit. */
  label: string;
  /** The sort options' noun: "Heaviest load", "Fastest pace". */
  noun: string;
  group: "strength" | "endurance" | "framework";
  /** The point key the cell reads and the sort compares. */
  value: MarkerValueKey;
  /** A second value read beside the first, muted: the fastest time's distance. */
  aside?: MarkerValueKey;
  readout: ColumnReadout;
  /** The sort pair's words, for the higher and the lower value, and which is offered first. */
  higher: string;
  lower: string;
  leads: "higher" | "lower";
};

const MARKER = PROGRESS_MARKER_SPECS;

export const SESSION_COLUMN_SPECS: Record<SessionColumn, SessionColumnSpec> = {
  load: { label: BOX_LABELS.load, noun: "load", group: "strength", value: MARKER.weight.value, readout: "load", higher: "Heaviest", lower: "Lightest", leads: "higher" },
  reps: { label: BOX_LABELS.reps, noun: "reps", group: "strength", value: "topSetReps", readout: "number", higher: "Most", lower: "Fewest", leads: "higher" },
  bodyweight_reps: { label: "Bodyweight reps", noun: "bodyweight reps", group: "strength", value: MARKER.reps.value, readout: "number", higher: "Most", lower: "Fewest", leads: "higher" },
  rpe: { label: BOX_LABELS.rpe, noun: "RPE", group: "strength", value: MARKER.rpe.value, readout: "number", higher: "Highest", lower: "Lowest", leads: "higher" },
  rir: { label: BOX_LABELS.rir, noun: "RIR", group: "strength", value: "rir", readout: "number", higher: "Highest", lower: "Lowest", leads: "higher" },
  e1rm: { label: "e1RM", noun: "e1RM", group: "strength", value: MARKER.e1rm.value, readout: "load", higher: "Highest", lower: "Lowest", leads: "higher" },
  volume: { label: "Volume", noun: "volume", group: "strength", value: MARKER.volume.value, readout: "load", higher: "Highest", lower: "Lowest", leads: "higher" },
  distance: { label: BOX_LABELS.distance, noun: "distance", group: "endurance", value: MARKER.distance.value, readout: "distance", higher: "Longest", lower: "Shortest", leads: "higher" },
  time: { label: "Time", noun: "time", group: "endurance", value: MARKER.time.value, aside: "bestTimeDistanceMeters", readout: "duration", higher: "Slowest", lower: "Fastest", leads: "lower" },
  hold: { label: "Hold", noun: "hold", group: "endurance", value: MARKER.hold.value, readout: "duration", higher: "Longest", lower: "Shortest", leads: "higher" },
  pace: { label: BOX_LABELS.pace, noun: "pace", group: "endurance", value: MARKER.pace.value, readout: "pace", higher: "Slowest", lower: "Fastest", leads: "lower" },
  split: { label: BOX_LABELS.split, noun: "split", group: "endurance", value: MARKER.split.value, readout: "split", higher: "Slowest", lower: "Fastest", leads: "lower" },
  calories: { label: BOX_LABELS.calories, noun: "calories", group: "endurance", value: "totalCalories", readout: "number", higher: "Most", lower: "Fewest", leads: "higher" },
  cadence: { label: BOX_LABELS.cadence, noun: "cadence", group: "endurance", value: "maxCadence", readout: "number", higher: "Highest", lower: "Lowest", leads: "higher" },
  stroke_rate: { label: BOX_LABELS.stroke_rate, noun: "stroke rate", group: "endurance", value: "maxStrokeRate", readout: "number", higher: "Highest", lower: "Lowest", leads: "higher" },
  resistance: { label: BOX_LABELS.resistance, noun: "resistance", group: "endurance", value: "maxResistance", readout: "number", higher: "Highest", lower: "Lowest", leads: "higher" },
  heart_rate_zone: { label: BOX_LABELS.heart_rate_zone, noun: "HR zone", group: "endurance", value: "maxHeartRateZone", readout: "zone", higher: "Highest", lower: "Lowest", leads: "higher" },
  heart_rate: { label: BOX_LABELS.heart_rate, noun: "heart rate", group: "endurance", value: "maxHeartRate", readout: "number", higher: "Highest", lower: "Lowest", leads: "higher" },
  power: { label: BOX_LABELS.power, noun: "power", group: "endurance", value: MARKER.power.value, readout: "number", higher: "Highest", lower: "Lowest", leads: "higher" },
  ftp_percent: { label: BOX_LABELS.ftp_percent, noun: "% FTP", group: "endurance", value: "maxFtpPercent", readout: "number", higher: "Highest", lower: "Lowest", leads: "higher" },
  rest: { label: "Rest", noun: "rest", group: "framework", value: "averageRestSeconds", readout: "duration", higher: "Longest", lower: "Shortest", leads: "higher" },
  sets: { label: "Sets", noun: "sets", group: "framework", value: MARKER.compliance.value, readout: "sets", higher: "Most", lower: "Fewest", leads: "higher" },
};

/** The Columns menu's groups, the builder's three. */
export const SESSION_COLUMN_GROUPS = [
  { key: "strength", label: "Strength" },
  { key: "endurance", label: "Endurance" },
  { key: "framework", label: "Framework" },
] as const;

/** The columns the window's sessions carry, in the table's order: a column nothing recorded doesn't appear. */
export function sessionColumnsIn(points: readonly ExerciseProgressionPoint[]): SessionColumn[] {
  return SESSION_COLUMNS.filter((column) =>
    points.some((point) => point[SESSION_COLUMN_SPECS[column].value] != null),
  );
}

/** A heading: a load names the unit its bare numbers are in, the rest their measure. */
export function sessionColumnHeading(column: SessionColumn, viewer: UnitSystem): string {
  const spec = SESSION_COLUMN_SPECS[column];
  return spec.readout === "load" ? `${spec.label} (${formatLoad(0, viewer).unit})` : spec.label;
}

/** A session's date, as the PR cards read one: the day its stamp names. */
export function formatSessionDate(iso: string): string {
  return format(dayFromUtcStamp(iso), "MMM d, yyyy");
}

/**
 * One cell, in the viewer's units: its value and, for a time, its distance to
 * read beside it. Null when the session recorded nothing there.
 */
export function formatSessionCell(
  column: SessionColumn,
  point: ExerciseProgressionPoint,
  viewer: UnitSystem,
): { value: string; aside: string | null } | null {
  const spec = SESSION_COLUMN_SPECS[column];
  const value = point[spec.value];
  if (value == null) return null;
  const aside = spec.aside ? point[spec.aside] : null;
  return {
    value: formatReadout(spec.readout, value, point, viewer),
    aside: aside == null ? null : formatDistance(aside, viewer),
  };
}

function formatReadout(
  readout: ColumnReadout,
  value: number,
  point: ExerciseProgressionPoint,
  viewer: UnitSystem,
): string {
  switch (readout) {
    // A read-only load snaps like every other (CONVENTIONS section 20)
    case "load":
      return formatLoad(value, viewer).value.toLocaleString();
    case "number":
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
    // Sets done over sets prescribed, or the count alone with no prescription
    case "sets":
      return point.prescribedSets == null ? String(value) : `${value}/${point.prescribedSets}`;
  }
}

// --- Sort ---------------------------------------------------------------------

export type SessionSort = { column: "date" | SessionColumn; order: "asc" | "desc" };

export const DEFAULT_SESSION_SORT: SessionSort = { column: "date", order: "desc" };

type SessionSortOption = { value: string; label: string; sort: SessionSort };

export const sessionSortValue = (sort: SessionSort): string => `${sort.column}:${sort.order}`;

/** A sort's words: "Newest first", "Heaviest load", "Fastest pace". */
export function sessionSortLabel(sort: SessionSort): string {
  if (sort.column === "date") return sort.order === "desc" ? "Newest first" : "Oldest first";
  const spec = SESSION_COLUMN_SPECS[sort.column];
  return `${sort.order === "desc" ? spec.higher : spec.lower} ${spec.noun}`;
}

/**
 * The sort pairs for the shown columns: Newest first and Oldest first, then each
 * column's pair, the word it leads with first — Heaviest and Lightest load,
 * Fastest and Slowest pace.
 */
export function sessionSortOptions(columns: readonly SessionColumn[]): SessionSortOption[] {
  const option = (sort: SessionSort): SessionSortOption => ({
    value: sessionSortValue(sort),
    label: sessionSortLabel(sort),
    sort,
  });
  const options = [option({ column: "date", order: "desc" }), option({ column: "date", order: "asc" })];
  for (const column of columns) {
    const higher = option({ column, order: "desc" });
    const lower = option({ column, order: "asc" });
    options.push(...(SESSION_COLUMN_SPECS[column].leads === "higher" ? [higher, lower] : [lower, higher]));
  }
  return options;
}

/**
 * The sort the table shows: the one picked while its column is shown, else
 * Newest first — it returns when the column does. While the sessions are
 * pending nothing is known about the columns, so the pick stands.
 */
export function effectiveSessionSort(
  picked: SessionSort,
  shown: readonly SessionColumn[],
  pending: boolean,
): SessionSort {
  if (pending || picked.column === "date" || shown.includes(picked.column)) return picked;
  return DEFAULT_SESSION_SORT;
}

const newestFirst = (a: ExerciseProgressionPoint, b: ExerciseProgressionPoint): number =>
  a.date === b.date ? 0 : a.date < b.date ? 1 : -1;

/** The rows in the sort's order; a session with no value in the sorted column goes last, newest first. */
export function sortSessions(
  points: readonly ExerciseProgressionPoint[],
  sort: SessionSort,
): ExerciseProgressionPoint[] {
  if (sort.column === "date") {
    const newest = [...points].sort(newestFirst);
    return sort.order === "desc" ? newest : newest.reverse();
  }
  const key = SESSION_COLUMN_SPECS[sort.column].value;
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
