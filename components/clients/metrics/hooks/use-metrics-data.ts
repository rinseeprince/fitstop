"use client";

import { useMemo } from "react";
import { format } from "date-fns";
import { getTrend, calculatePercentChange } from "@/utils/metric-shaping";
import type { CheckIn, TrendDirection } from "@/types/check-in";

// Retained for the shared MetricChartCard (also consumed by the client portal's
// metrics-hub). The coach metrics tab no longer drives charts by this enum — it
// uses the resolved time-scope window below (Session 7.5).
export type DateRangeFilter = "7d" | "30d" | "90d" | "all";
export type MetricCategory = "body" | "wellness";

/** Resolved time-scope window. `null` = unbounded on that side (Session 7.5). */
export type MetricsWindow = { start: string | null; end: string | null };

export type MetricData = {
  id: string;
  name: string;
  key: keyof CheckIn;
  category: MetricCategory;
  unit: string;
  currentValue: number | null;
  previousValue: number | null;
  percentChange: number | null;
  trend: TrendDirection;
  lastUpdated: string | null;
  chartData: Array<{ date: string; value: number }>;
};

type MetricDefinition = {
  id: string;
  name: string;
  key: keyof CheckIn;
  category: MetricCategory;
  getUnit: (weightUnit?: string, measurementUnit?: string) => string;
  domain?: [number, number];
};

const METRIC_DEFINITIONS: MetricDefinition[] = [
  // Body metrics
  { id: "weight", name: "Weight", key: "weight", category: "body", getUnit: (w) => w || "lbs" },
  { id: "bodyFat", name: "Body Fat", key: "bodyFatPercentage", category: "body", getUnit: () => "%" },
  { id: "waist", name: "Waist", key: "waist", category: "body", getUnit: (_, m) => m || "in" },
  { id: "hips", name: "Hips", key: "hips", category: "body", getUnit: (_, m) => m || "in" },
  { id: "chest", name: "Chest", key: "chest", category: "body", getUnit: (_, m) => m || "in" },
  { id: "arms", name: "Arms", key: "arms", category: "body", getUnit: (_, m) => m || "in" },
  { id: "thighs", name: "Thighs", key: "thighs", category: "body", getUnit: (_, m) => m || "in" },
  // Wellness metrics
  { id: "mood", name: "Mood", key: "mood", category: "wellness", getUnit: () => "/5", domain: [1, 5] },
  { id: "energy", name: "Energy", key: "energy", category: "wellness", getUnit: () => "/10", domain: [1, 10] },
  { id: "sleep", name: "Sleep", key: "sleep", category: "wellness", getUnit: () => "/10", domain: [1, 10] },
  { id: "stress", name: "Stress", key: "stress", category: "wellness", getUnit: () => "/10", domain: [1, 10] },
];

// Filter check-ins to the resolved window. The end bound is inclusive-by-date
// (compare the createdAt date part), so a check-in submitted on a phase's final
// day still counts. Null bounds skip that side.
const filterByWindow = (checkIns: CheckIn[], scopeWindow: MetricsWindow): CheckIn[] => {
  const { start, end } = scopeWindow;
  if (!start && !end) return checkIns;
  return checkIns.filter((ci) => {
    const date = ci.createdAt.slice(0, 10);
    if (start && date < start) return false;
    if (end && date > end) return false;
    return true;
  });
};

export const useMetricsData = (
  checkIns: CheckIn[],
  scopeWindow: MetricsWindow,
  weightUnit?: string,
  measurementUnit?: string
): { bodyMetrics: MetricData[]; wellnessMetrics: MetricData[]; isLoading: boolean } => {
  return useMemo(() => {
    const filteredCheckIns = filterByWindow(checkIns, scopeWindow);
    const sortedCheckIns = [...filteredCheckIns].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    const processMetric = (def: MetricDefinition): MetricData => {
      const checkInsWithValue = sortedCheckIns.filter(
        (ci) => ci[def.key] !== null && ci[def.key] !== undefined
      );

      const chartData = checkInsWithValue.map((ci) => ({
        date: format(new Date(ci.createdAt), "MMM d"),
        value: ci[def.key] as number,
      }));

      const latestCheckIn = checkInsWithValue[checkInsWithValue.length - 1];
      const previousCheckIn = checkInsWithValue[checkInsWithValue.length - 2];

      const currentValue = latestCheckIn ? (latestCheckIn[def.key] as number) : null;
      const previousValue = previousCheckIn ? (previousCheckIn[def.key] as number) : null;

      return {
        id: def.id,
        name: def.name,
        key: def.key,
        category: def.category,
        unit: def.getUnit(weightUnit, measurementUnit),
        currentValue,
        previousValue,
        percentChange: calculatePercentChange(currentValue, previousValue),
        trend: getTrend(currentValue, previousValue),
        lastUpdated: latestCheckIn?.createdAt || null,
        chartData,
      };
    };

    const allMetrics = METRIC_DEFINITIONS.map(processMetric);

    return {
      bodyMetrics: allMetrics.filter((m) => m.category === "body"),
      wellnessMetrics: allMetrics.filter((m) => m.category === "wellness"),
      isLoading: false,
    };
  }, [checkIns, scopeWindow, weightUnit, measurementUnit]);
};
