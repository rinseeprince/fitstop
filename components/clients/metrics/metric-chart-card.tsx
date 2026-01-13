"use client";

import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TrendDirection } from "@/types/check-in";

type MetricChartCardProps = {
  id: string;
  name: string;
  currentValue: number | null;
  unit: string;
  percentChange: number | null;
  trend: TrendDirection;
  chartData: Array<{ date: string; value: number }>;
  isHighlighted?: boolean;
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
    return { color: trend === "down" ? "text-emerald-500" : "text-rose-500", isPositive: trend === "down" };
  }

  if (isBodyMetric) {
    return { color: trend === "down" ? "text-emerald-500" : "text-rose-500", isPositive: trend === "down" };
  }

  return { color: trend === "up" ? "text-emerald-500" : "text-rose-500", isPositive: trend === "up" };
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
  onRef,
}: MetricChartCardProps) => {
  const hasData = chartData.length > 0;
  const colors = getMetricColor(id);
  const trendDisplay = getTrendDisplay(trend, id);
  const gradientId = `gradient-${id}`;

  return (
    <Card
      ref={onRef}
      className={cn(
        "transition-all duration-200 overflow-hidden",
        isHighlighted && "ring-2 ring-primary shadow-lg"
      )}
    >
      <CardContent className="p-5">
        <div className="space-y-3">
          {/* Header */}
          <h3 className="text-sm font-medium text-muted-foreground">{name}</h3>

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
            <div className="h-[140px] w-full -mx-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
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
                  <YAxis hide domain={["dataMin - 5", "dataMax + 5"]} />
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
                    dot={false}
                    activeDot={{ r: 5, fill: colors.stroke, strokeWidth: 2, stroke: "#fff" }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-[140px] flex items-center justify-center">
              <p className="text-sm text-muted-foreground">No data available</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
