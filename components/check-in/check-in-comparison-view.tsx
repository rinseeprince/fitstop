"use client";

import { Card } from "@/components/ui/card";
import { ProgressCharts } from "./progress-charts";
import type { CheckInComparison, ProgressChartData, MetricChange } from "@/types/check-in";
import { ArrowUp, ArrowDown, Minus, TrendingUp, TrendingDown } from "lucide-react";

type CheckInComparisonViewProps = {
  comparison: CheckInComparison;
  chartData: ProgressChartData;
};

// Helper to render trend icon
const TrendIcon = ({ trend }: { trend?: "up" | "down" | "stable" }) => {
  if (!trend) return null;

  if (trend === "up") {
    return <ArrowUp className="h-4 w-4 text-red-500" />;
  } else if (trend === "down") {
    return <ArrowDown className="h-4 w-4 text-green-500" />;
  } else {
    return <Minus className="h-4 w-4 text-gray-500" />;
  }
};

// Helper to format change value
const formatChange = (change?: number, unit?: string): string => {
  if (change === undefined) return "—";
  const sign = change > 0 ? "+" : "";
  return `${sign}${change}${unit || ""}`;
};

// Helper to format percent change
const formatPercentChange = (percentChange?: number): string => {
  if (percentChange === undefined) return "";
  const sign = percentChange > 0 ? "+" : "";
  return `(${sign}${percentChange}%)`;
};

// Metric row component
const MetricRow = ({
  label,
  metric,
  unit = "",
  inverse = false, // if true, down is good (like weight loss)
}: {
  label: string;
  metric?: MetricChange;
  unit?: string;
  inverse?: boolean;
}) => {
  if (!metric || metric.current === undefined) return null;

  const hasComparison = metric.previous !== undefined;
  const changeColor = !hasComparison
    ? "text-muted-foreground"
    : inverse
    ? metric.trend === "down"
      ? "text-green-600 dark:text-green-400"
      : metric.trend === "up"
      ? "text-red-600 dark:text-red-400"
      : "text-muted-foreground"
    : metric.trend === "up"
    ? "text-green-600 dark:text-green-400"
    : metric.trend === "down"
    ? "text-red-600 dark:text-red-400"
    : "text-muted-foreground";

  return (
    <div className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <div className="flex items-center gap-3">
        <div className="text-right">
          <div className="font-semibold">
            {metric.current}
            {unit}
          </div>
          {hasComparison && (
            <div className={`text-xs flex items-center gap-1 justify-end ${changeColor}`}>
              {inverse ? (
                metric.trend === "down" ? (
                  <TrendingDown className="h-3 w-3" />
                ) : metric.trend === "up" ? (
                  <TrendingUp className="h-3 w-3" />
                ) : (
                  <Minus className="h-3 w-3" />
                )
              ) : metric.trend === "up" ? (
                <TrendingUp className="h-3 w-3" />
              ) : metric.trend === "down" ? (
                <TrendingDown className="h-3 w-3" />
              ) : (
                <Minus className="h-3 w-3" />
              )}
              <span>
                {formatChange(metric.change, unit)} {formatPercentChange(metric.percentChange)}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const CheckInComparisonView = ({
  comparison,
  chartData,
}: CheckInComparisonViewProps) => {
  const { current, previous, changes, timeBetweenCheckIns } = comparison;

  const hasPreviousCheckIn = previous !== null;

  // Reconstruct check-ins array for ProgressCharts
  const checkIns = [current, ...(previous ? [previous] : [])];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Progress Comparison</h3>
        {hasPreviousCheckIn && timeBetweenCheckIns && (
          <p className="text-sm text-muted-foreground">
            Comparing with check-in from {timeBetweenCheckIns} days ago
          </p>
        )}
        {!hasPreviousCheckIn && (
          <p className="text-sm text-muted-foreground">
            This is the first check-in. No comparison data available.
          </p>
        )}
      </div>

      {/* Body Metrics */}
      <Card className="p-4">
        <h4 className="font-semibold mb-4 flex items-center gap-2">
          <span className="text-blue-600 dark:text-blue-400">📊</span>
          Body Metrics
        </h4>
        <div className="space-y-1">
          <MetricRow
            label="Weight"
            metric={changes.weight}
            unit={` ${current.weightUnit || "lbs"}`}
            inverse
          />
          <MetricRow
            label="Body Fat %"
            metric={changes.bodyFatPercentage}
            unit="%"
            inverse
          />
          <MetricRow
            label="Waist"
            metric={changes.waist}
            unit={` ${current.measurementUnit || "in"}`}
            inverse
          />
          <MetricRow
            label="Hips"
            metric={changes.hips}
            unit={` ${current.measurementUnit || "in"}`}
          />
          <MetricRow
            label="Chest"
            metric={changes.chest}
            unit={` ${current.measurementUnit || "in"}`}
          />
          <MetricRow
            label="Arms"
            metric={changes.arms}
            unit={` ${current.measurementUnit || "in"}`}
          />
          <MetricRow
            label="Thighs"
            metric={changes.thighs}
            unit={` ${current.measurementUnit || "in"}`}
          />
        </div>
      </Card>

      {/* Performance Metrics */}
      <Card className="p-4">
        <h4 className="font-semibold mb-4 flex items-center gap-2">
          <span className="text-green-600 dark:text-green-400">💪</span>
          Performance Metrics
        </h4>
        <div className="space-y-1">
          <MetricRow
            label="Workouts Completed"
            metric={changes.workoutsCompleted}
          />
          <MetricRow
            label="Adherence"
            metric={changes.adherencePercentage}
            unit="%"
          />
        </div>
      </Card>

      {/* Subjective Metrics */}
      {(changes.mood || changes.energy || changes.sleep || changes.stress) && (
        <Card className="p-4">
          <h4 className="font-semibold mb-4 flex items-center gap-2">
            <span className="text-purple-600 dark:text-purple-400">🧘</span>
            Wellbeing Metrics
          </h4>
          <div className="space-y-1">
            <MetricRow label="Mood" metric={changes.mood} unit="/5" />
            <MetricRow label="Energy" metric={changes.energy} unit="/10" />
            <MetricRow label="Sleep Quality" metric={changes.sleep} unit="/10" />
            <MetricRow label="Stress Level" metric={changes.stress} unit="/10" inverse />
          </div>
        </Card>
      )}

      {/* Progress Charts */}
      <div>
        <h4 className="font-semibold mb-4">Historical Trends</h4>
        <ProgressCharts checkIns={checkIns} />
      </div>
    </div>
  );
};
