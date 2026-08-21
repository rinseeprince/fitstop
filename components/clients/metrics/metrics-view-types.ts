import type { MetricPoint } from "@/utils/metric-points";
import type { Tone } from "@/utils/metric-derived-stats";
import type { TrendDirection } from "@/types/check-in";

export type { Tone };

// View-model contract between use-merged-metrics (data side) and the Metrics
// page components. Built from the pure derivations in utils/metric-points.ts
// and utils/metric-derived-stats.ts.

// The metric-keyed panes — the ONLY values allowed to index metricsByTab,
// logRowsByTab and DEFAULT_FOCUS below.
export const METRIC_TABS = ["body", "wellness"] as const;

export type MetricTab = (typeof METRIC_TABS)[number];

// The Journey tab's pane switcher: the two metric panes plus the two that key
// nothing — Training (exercise analytics, moved here from the Training tab in
// Session 7.1) and Blocks. Kept separate from MetricTab so a non-metric pane
// can never leak into the metric-keyed data shapes below.
export const JOURNEY_SUBTABS = [
  "body",
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

/**
 * The metric derivations want a MetricTab, but a Journey pane may be one that
 * keys nothing (Training, Blocks). Those idle on "body" — nothing metric-keyed
 * renders on them.
 *
 * It WHITELISTS the metric panes rather than naming the non-metric ones. The
 * blacklist this replaced (`pane === "blocks" ? "body" : pane`) put the burden
 * on whoever adds the next pane to remember this line exists; adding "training"
 * to JOURNEY_SUBTABS without touching it would have indexed the physique
 * metrics under a pane that renders none of them.
 */
export function toMetricTab(pane: JourneySubtab): MetricTab {
  return (METRIC_TABS as readonly string[]).includes(pane)
    ? (pane as MetricTab)
    : "body";
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
  /** Full merged history, ascending by date. */
  points: MetricPoint[];
  latest: { value: number; date: string; daysAgo: number } | null;
  first: { value: number; date: string } | null;
  entryCount: number;
  frequencyLabel: string | null;
  totalChange: { delta: number; sinceDate: string } | null;
  /** null → the ENTRIES fallback stat is shown instead. */
  avgRate: { perWeek: number; weeks: number } | null;
  change30d: {
    kind: "30day" | "sinceFirst";
    delta: number;
    sinceDate?: string;
    trend: TrendDirection;
    tone: Tone;
  } | null;
  week:
    | { kind: "weekAvg"; currentAvg: number; prevAvg: number }
    | { kind: "latest"; value: number; date: string }
    | null;
  /** Resolved goal in display units (weight/bodyFat only), else null. */
  goal: number | null;
  /** Pre-formatted distance remaining, e.g. "1.2" (unit rendered by the UI). */
  goalToGo: string | null;
  best: { value: number; date: string } | null;
};

export type LogRow = {
  id: string;
  date: string; // YYYY-MM-DD
  metricId: string;
  metricName: string;
  value: number;
  unit: string;
  change: { amount: number; tone: Tone } | null;
  note: string | null;
  source: "check_in" | "coach_entry";
};
