import type { MetricPoint } from "@/utils/metric-points";
import type { MeasurementSource } from "@/lib/measurements/keys";
import { WELLNESS_KEYS } from "@/lib/wellness/keys";
import { DOWN_IS_GOOD } from "@/lib/metrics/good-direction";
import type { GoalChipTone } from "@/lib/goals/goal-chip";
import type { Tone, TotalChange, WindowComparison } from "@/utils/metric-derived-stats";

export type { Tone };

// View-model contract between use-merged-metrics (data side) and the Metrics
// page components. Built from the pure derivations in utils/metric-points.ts
// and utils/metric-derived-stats.ts.

// The metric-keyed panes — the ONLY values allowed to index metricsByTab,
// logRowsByTab and DEFAULT_FOCUS below.
export const METRIC_TABS = ["body", "wellness"] as const;

export type MetricTab = (typeof METRIC_TABS)[number];

// The Journey tab's pane switcher: the two metric panes plus the three that key
// nothing — Goals, Training (exercise analytics, moved here from the Training
// tab in Session 7.1) and Blocks. Kept separate from MetricTab so a non-metric
// pane can never leak into the metric-keyed data shapes below.
export const JOURNEY_SUBTABS = [
  "body",
  "goals",
  "training",
  "wellness",
  "blocks",
] as const;

export type JourneySubtab = (typeof JOURNEY_SUBTABS)[number];

// Derived from the const array so a new pane added to JOURNEY_SUBTABS is
// resolvable without touching this guard — the old two-way ternary silently
// sent every unknown value to "body" with no type error.
export function isJourneySubtab(value: string | null): value is JourneySubtab {
  return (JOURNEY_SUBTABS as readonly string[]).includes(value ?? "");
}

/** Whether a Journey pane is a metric pane — one that shows a metric's data. */
function isMetricTab(pane: JourneySubtab): pane is MetricTab {
  return (METRIC_TABS as readonly string[]).includes(pane);
}

/**
 * The metric derivations want a MetricTab, but a Journey pane may be one that
 * keys nothing (Goals, Training, Blocks). Those idle on "body" — nothing
 * metric-keyed renders on them, and a Log measurement dialog a browser Back
 * carries onto one of them shows the body default.
 *
 * It WHITELISTS the metric panes rather than naming the non-metric ones. The
 * blacklist this replaced (`pane === "blocks" ? "body" : pane`) put the burden
 * on whoever adds the next pane to remember this line exists; adding "training"
 * to JOURNEY_SUBTABS without touching it would have indexed the physique
 * metrics under a pane that renders none of them.
 */
export function toMetricTab(pane: JourneySubtab): MetricTab {
  return isMetricTab(pane) ? pane : "body";
}

export const DEFAULT_FOCUS: Record<MetricTab, string> = {
  body: "weight",
  wellness: "sleep",
};

export type MetricSummary = {
  id: string;
  name: string;
  tab: MetricTab;
  unit: string;
  /** The full ascending series. For a physique metric, the JOURNEY: readings
   *  from the start date on — a reading dated before it is listed in the log
   *  under "Before start" and is not a point here. */
  points: MetricPoint[];
  /** The newest reading of ANY date — never waits for the start date. */
  latest: { value: number; date: string; daysAgo: number } | null;
  first: { value: number; date: string } | null;
  entryCount: number;
  /** Physique: since the START DATE, against the baseline (the reading as of
   *  it, whose own date and source are carried). Wellness: the last 7 days'
   *  average against the client's first week of entries (D32). */
  totalChange: TotalChange | null;
  /** The start date while it is ahead — the since-start cell reads `Starts …`. */
  startsOn: string | null;
  /** null → the ENTRIES fallback stat is shown instead. */
  avgRate: { perWeek: number; weeks: number } | null;
  /** Card 1: the last 7 days, ending the client's today, against the 7 before. */
  lastWeek: WindowComparison;
  /** Card 2: the last 30 days against the 30 before. */
  lastMonth: WindowComparison;
  /** Card 3, fixed per metric (D31). */
  cardThree: CardThree;
  /** The goal target in display units (weight/bodyFat only), else null — the chart's goal line. */
  goal: number | null;
};

/** Card 3's kind — fixed per metric, so known before any figure is. */
export type CardThreeKind = "goal" | "lowest" | "highest" | "last90";

// Method bivariance makes the narrow ReadonlySet usable for a plain string id.
const DOWN_SET: ReadonlySet<string> = DOWN_IS_GOOD;

/**
 * Card 3 by metric (D31): the goal on weight and body fat, the worst score of
 * the last 30 days on a wellness score — the lowest, the highest where down is
 * good (stress, soreness) — and the last 90 days on a girth.
 */
export function cardThreeKind(metricId: string): CardThreeKind {
  if (metricId === "weight" || metricId === "bodyFat") return "goal";
  if ((WELLNESS_KEYS as readonly string[]).includes(metricId)) {
    return DOWN_SET.has(metricId) ? "highest" : "lowest";
  }
  return "last90";
}

export type CardThree =
  | { kind: "goal"; goal: GoalCard }
  /** `worst` is null when the last 30 days hold no entry. */
  | { kind: "lowest" | "highest"; worst: { value: number; date: string } | null }
  | { kind: "last90"; comparison: WindowComparison };

/** The Goal card: the goal read's state, then the target in force on the client's today. */
export type GoalCard =
  | { status: "pending" }
  | { status: "failed" }
  /** The goal in force sets no target for this metric, or no goal is in force. */
  | { status: "none" }
  /** `progress`: how far the newest reading is from the target, in the goal
   *  card's own words (`goalProgressChip`); null with no reading. */
  | { status: "set"; target: number; progress: { text: string; tone: GoalChipTone } | null };

export type LogRow = {
  /** A measurement row's id for a physique reading; a derived key for a wellness day. */
  id: string;
  date: string; // YYYY-MM-DD
  metricId: string;
  metricName: string;
  value: number;
  unit: string;
  /** Canonical kg / cm / % — the Edit dialog seeds from this, never from the
   *  display value. A wellness score is its own canonical value. */
  canonicalValue: number;
  change: { amount: number; tone: Tone } | null;
  note: string | null;
  source: MeasurementSource;
  /** The check-in stamp a physique reading carries; null otherwise. */
  sourceId: string | null;
  /** A measurement-log row: Edit, Remove and Restore apply. A wellness day has no row action. */
  isMeasurement: boolean;
  /** Set when the reading has been removed: muted, in no figure, restorable. */
  voided: { at: string; byName: string | null } | null;
  /** The reading every "now" figure uses. */
  isCurrent: boolean;
  /** The reading every "since start" figure uses. */
  isBaseline: boolean;
  /** Dated before the client's start date: listed, excluded from the journey's chart and maths. */
  beforeStart: boolean;
};
