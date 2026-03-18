"use client";

import { useMemo } from "react";
import { format } from "date-fns";
import type { ProgressData } from "@/services/client-portal-progress";
import type { TrendDirection } from "@/types/check-in";

export type ClientMetricData = {
  id: string;
  name: string;
  currentValue: number | null;
  unit: string;
  percentChange: number | null;
  trend: TrendDirection;
  chartData: Array<{ date: string; value: number }>;
};

const getTrend = (current: number | null, previous: number | null): TrendDirection => {
  if (current === null || previous === null) return "stable";
  const diff = current - previous;
  if (Math.abs(diff) < 0.5) return "stable";
  return diff > 0 ? "up" : "down";
};

const calculatePercentChange = (current: number | null, previous: number | null): number | null => {
  if (current === null || previous === null || previous === 0) return null;
  return Number((((current - previous) / previous) * 100).toFixed(1));
};

export const useClientProgressMetrics = (progressData: ProgressData | null) => {
  return useMemo(() => {
    if (!progressData) {
      return { bodyMetrics: [], wellnessMetrics: [] };
    }

    // Helper function to process metric history
    const processMetricHistory = (
      history: Array<{ date: string; [key: string]: any }> = [],
      metricKey: string,
      name: string,
      unit: string
    ): ClientMetricData => {
      const chartData = history.length > 0 ? history.map((point) => ({
        date: format(new Date(point.date), "MMM d"),
        value: point[metricKey] as number,
      })) : [];

      const latestPoint = history[history.length - 1];
      const previousPoint = history[history.length - 2];

      const currentValue = latestPoint ? (latestPoint[metricKey] as number) : null;
      const previousValue = previousPoint ? (previousPoint[metricKey] as number) : null;

      return {
        id: metricKey,
        name,
        currentValue,
        unit,
        percentChange: calculatePercentChange(currentValue, previousValue),
        trend: getTrend(currentValue, previousValue),
        chartData,
      };
    };

    // Body metrics
    const bodyMetrics: ClientMetricData[] = [
      processMetricHistory(
        progressData.weightHistory || [],
        "weight",
        "Weight",
        progressData.client?.weightUnit || "lbs"
      ),
      processMetricHistory(
        progressData.bodyFatHistory || [],
        "bodyFatPercentage",
        "Body Fat",
        "%"
      ),
      processMetricHistory(
        progressData.bodyMeasurements?.waistHistory || [],
        "waist",
        "Waist",
        progressData.client?.measurementUnit || "in"
      ),
      processMetricHistory(
        progressData.bodyMeasurements?.hipsHistory || [],
        "hips",
        "Hips",
        progressData.client?.measurementUnit || "in"
      ),
      processMetricHistory(
        progressData.bodyMeasurements?.chestHistory || [],
        "chest",
        "Chest",
        progressData.client?.measurementUnit || "in"
      ),
      processMetricHistory(
        progressData.bodyMeasurements?.armsHistory || [],
        "arms",
        "Arms",
        progressData.client?.measurementUnit || "in"
      ),
      processMetricHistory(
        progressData.bodyMeasurements?.thighsHistory || [],
        "thighs",
        "Thighs",
        progressData.client?.measurementUnit || "in"
      ),
    ];

    // Wellness metrics
    const wellnessMetrics: ClientMetricData[] = [
      processMetricHistory(
        progressData.wellnessMetrics?.moodHistory || [],
        "mood",
        "Mood",
        "/5"
      ),
      processMetricHistory(
        progressData.wellnessMetrics?.energyHistory || [],
        "energy",
        "Energy",
        "/10"
      ),
      processMetricHistory(
        progressData.wellnessMetrics?.sleepHistory || [],
        "sleep",
        "Sleep",
        "/10"
      ),
      processMetricHistory(
        progressData.wellnessMetrics?.stressHistory || [],
        "stress",
        "Stress",
        "/10"
      ),
    ];

    // Always return all metrics, even with empty data
    return {
      bodyMetrics,
      wellnessMetrics,
    };
  }, [progressData]);
};