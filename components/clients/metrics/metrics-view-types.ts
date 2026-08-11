import type { MetricPoint } from "@/utils/metric-points";
import type { Tone } from "@/utils/metric-derived-stats";
import type { TrendDirection } from "@/types/check-in";

export type { Tone };

// View-model contract between use-merged-metrics (data side) and the Metrics
// page components. Built from the pure derivations in utils/metric-points.ts
// and utils/metric-derived-stats.ts.

export type MetricTab = "body" | "wellness";

// The Journey tab's pane switcher: the two metric panes plus Blocks. Kept
// separate from MetricTab so "blocks" can never leak into the metric-keyed
// data shapes below (metricsByTab, logRowsByTab, DEFAULT_FOCUS).
export const JOURNEY_SUBTABS = ["body", "wellness", "blocks"] as const;

export type JourneySubtab = (typeof JOURNEY_SUBTABS)[number];

// Derived from the const array so a new pane added to JOURNEY_SUBTABS is
// resolvable without touching this guard — the old two-way ternary silently
// sent every unknown value to "body" with no type error.
export function isJourneySubtab(value: string | null): value is JourneySubtab {
  return (JOURNEY_SUBTABS as readonly string[]).includes(value ?? "");
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
