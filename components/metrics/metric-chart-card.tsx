"use client";

import { useMemo } from "react";
import { format, parseISO } from "date-fns";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ArrowDown, ArrowUp, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TrendDirection } from "@/types/check-in";
import type { DateRangeFilter } from "@/components/clients/metrics/hooks/use-metrics-data";

const DATE_RANGE_OPTIONS: { value: DateRangeFilter; label: string }[] = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "all", label: "All time" },
];

type MetricChartCardProps = {
  id: string;
  name: string;
  currentValue: number | null;
  unit: string;
  percentChange: number | null;
  trend: TrendDirection;
  chartData: Array<{ date: string; value: number }>;
  isHighlighted?: boolean;
  expanded?: boolean;
  dateRange?: DateRangeFilter;
  onDateRangeChange?: (range: DateRangeFilter) => void;
  onBack?: () => void;
  onRef?: (el: HTMLDivElement | null) => void;
};

// Color themes for different metrics
const METRIC_COLORS: Record<string, { stroke: string; fill: string; gradient: string }> = {
  weight: { stroke: "#8b5cf6", fill: "#8b5cf6", gradient: "violet" },
  bodyFat: { stroke: "#f43f5e", fill: "#f43f5e", gradient: "rose" },
  waist: { stroke: "#3b82f6", fill: "#3b82f6", gradient: "blue" },
  hips: { stroke: "#ec4899", fill: "#ec4899", gradient: "pink" },
  chest: { stroke: "#8b5cf6", fill: "#8b5cf6", gradient: "violet" },
  arms: { stroke: "#06b6d4", fill: "#06b6d4", gradient: "cyan" },
  thighs: { stroke: "#10b981", fill: "#10b981", gradient: "emerald" },
  mood: { stroke: "#f59e0b", fill: "#f59e0b", gradient: "amber" },
  energy: { stroke: "#ef4444", fill: "#ef4444", gradient: "red" },
  sleep: { stroke: "#6366f1", fill: "#6366f1", gradient: "indigo" },
  stress: { stroke: "#f97316", fill: "#f97316", gradient: "orange" },
};

const DEFAULT_COLOR = { stroke: "#8b5cf6", fill: "#8b5cf6", gradient: "violet" };

// Matches a raw ISO date (the server-shaped client-portal series). Coach-side
// labels are pre-formatted ("MMM d") and won't match, so they pass through.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

const getMetricColor = (metricId: string) => {
  return METRIC_COLORS[metricId] || DEFAULT_COLOR;
};

const getTrendDisplay = (trend: TrendDirection, metricId: string) => {
  const isStress = metricId === "stress";
  const isBodyMetric = ["weight", "bodyFat", "waist", "hips", "chest", "arms", "thighs"].includes(metricId);

  if (trend === "stable") {
    return { color: "text-muted-foreground", isPositive: null };
  }

  if (isStress) {
    return { color: trend === "down" ? "text-success" : "text-destructive", isPositive: trend === "down" };
  }

  if (isBodyMetric) {
    return { color: trend === "down" ? "text-success" : "text-destructive", isPositive: trend === "down" };
  }

  return { color: trend === "up" ? "text-success" : "text-destructive", isPositive: trend === "up" };
};

export const MetricChartCard = ({
  id,
  name,
  currentValue,
  unit,
  percentChange,
  trend,
  chartData,
  isHighlighted,
  expanded,
  dateRange,
  onDateRangeChange,
  onBack,
  onRef,
}: MetricChartCardProps) => {
  const hasData = chartData.length > 0;
  const colors = getMetricColor(id);
  const trendDisplay = getTrendDisplay(trend, id);
  const gradientId = `gradient-${id}`;

  // The client-portal series now arrives with RAW ISO dates (YYYY-MM-DD) — the
  // server emits locale-neutral data and the axis/tooltip label is formatted to
  // "MMM d" here, at render. The coach-side hook still pre-formats its own
  // "MMM d" labels, so anything that is not a parseable ISO date is passed
  // through unchanged (identical visual output for both callers).
  const displayData = useMemo(
    () =>
      chartData.map((point) => ({
        ...point,
        date: ISO_DATE.test(point.date)
          ? format(parseISO(point.date), "MMM d")
          : point.date,
      })),
    [chartData],
  );

  return (
    <Card
      ref={onRef}
      className={cn(
        "transition-all duration-200 overflow-hidden",
        isHighlighted && "ring-1 ring-primary"
      )}
    >
      <CardContent className="p-5">
        <div className="space-y-3">
          {/* Header with back button and date range for expanded view */}
          {expanded && onBack ? (
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={onBack}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <h3 className="text-sm font-medium text-muted-foreground">{name}</h3>
              </div>
              {dateRange && onDateRangeChange && (
                <Select value={dateRange} onValueChange={(v) => onDateRangeChange(v as DateRangeFilter)}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DATE_RANGE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          ) : (
            <h3 className="text-sm font-medium text-muted-foreground">{name}</h3>
          )}

          {/* Value and Trend */}
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight">
              {currentValue !== null ? currentValue : "—"}
            </span>
            <span className="text-lg font-medium text-muted-foreground">{unit}</span>
            {percentChange !== null && trend !== "stable" && (
              <span className={cn("flex items-center text-sm font-medium ml-1", trendDisplay.color)}>
                {trend === "down" ? (
                  <ArrowDown className="h-3.5 w-3.5" />
                ) : (
                  <ArrowUp className="h-3.5 w-3.5" />
                )}
                {Math.abs(percentChange)}%
              </span>
            )}
          </div>

          {/* Chart */}
          {hasData ? (
            <div className={cn("w-full -mx-2", expanded ? "h-[400px]" : "h-[140px]")}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={displayData} margin={{ top: 10, right: 10, bottom: 0, left: expanded ? 0 : 10 }}>
                  <defs>
                    <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={colors.fill} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={colors.fill} stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                    dy={8}
                  />
                  <YAxis
                    hide={!expanded}
                    domain={["dataMin - 5", "dataMax + 5"]}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                    width={40}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                      fontSize: "12px",
                      boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
                    }}
                    labelStyle={{ color: "hsl(var(--popover-foreground))", fontWeight: 500 }}
                    formatter={(value: number) => [`${value} ${unit}`, name]}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke={colors.stroke}
                    strokeWidth={2.5}
                    fill={`url(#${gradientId})`}
                    dot={expanded}
                    activeDot={{ r: 5, fill: colors.stroke, strokeWidth: 2, stroke: "#fff" }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className={cn("flex items-center justify-center", expanded ? "h-[400px]" : "h-[140px]")}>
              <p className="text-sm text-muted-foreground">No data available</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
