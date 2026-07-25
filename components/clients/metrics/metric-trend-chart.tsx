"use client";

import { format } from "date-fns";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { cn } from "@/lib/utils";
import {
  MONO,
  TEXT_PRIMARY,
} from "@/components/clients/training/program-builder/builder-tokens";
import {
  ExerciseChartCard,
  LegendItem,
} from "@/components/training/exercise-data/exercise-chart-card";
import type { MetricPoint } from "@/utils/metric-points";
import type { MetricSummary } from "./metrics-view-types";

// Generic entry-series fork of exercise-trend-chart.tsx: one teal Area over the
// merged check-in + coach-entry points, with an amber dashed goal line.
// Chart constants are copied verbatim from that file.

type MetricTrendChartProps = {
  metric: MetricSummary;
  points: MetricPoint[];
};

const SERIES_COLOR = "#0d9488";
const GOAL_COLOR = "#d97706";
const GRID_LINE = "rgba(13, 148, 136, 0.06)";

const TICK_STYLE = { fontSize: 10, fill: "#93b0b4", fontFamily: "var(--font-mono-display)" };
const X_TICK_STYLE = { fontSize: 10, fill: "#93b0b4", fontFamily: "var(--font-mono-display)" };

const TOOLTIP_VALUE_CLASS = cn(MONO, "text-[13px] font-semibold", TEXT_PRIMARY);

// The popover recipe — hardcoded hex, never the OKLCH layer.
const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: "#fff",
    border: "1px solid rgba(13,148,136,0.08)",
    borderRadius: "6px",
    boxShadow: "0 10px 40px rgba(13,148,136,0.10)",
    fontSize: "12px",
  },
};

function formatDateShort(iso: string) {
  return format(new Date(iso), "MMM d");
}

function EntryTooltip({ active, payload, unit }: Record<string, unknown>) {
  if (!active || !Array.isArray(payload) || payload.length === 0) return null;
  const p = payload[0]?.payload as MetricPoint | undefined;
  if (!p) return null;

  return (
    <div style={TOOLTIP_STYLE.contentStyle} className="px-3 py-2">
      <p className={cn(MONO, "text-[11px] text-[#93b0b4]")}>
        {formatDateShort(p.date)}
      </p>
      <p className={TOOLTIP_VALUE_CLASS}>
        {p.value} {unit as string}
      </p>
    </div>
  );
}

// Hollow entry dots; the LAST point renders solid (the current value).
function EntryDot(props: Record<string, unknown>) {
  const { cx, cy, index, lastIndex } = props as {
    cx?: number;
    cy?: number;
    index: number;
    lastIndex: number;
  };
  if (cx == null || cy == null) return null;

  return (
    <circle
      cx={cx}
      cy={cy}
      r={3.5}
      fill={index === lastIndex ? SERIES_COLOR : "#fff"}
      stroke={SERIES_COLOR}
      strokeWidth={2}
    />
  );
}

export function MetricTrendChart({ metric, points }: MetricTrendChartProps) {
  const gradientId = `metric-trend-${metric.id}`;

  // Sparse x-axis: show every 3rd or 4th tick
  const xInterval =
    points.length <= 8 ? 0 : Math.max(1, Math.floor(points.length / 5));

  const legend = (
    <>
      <LegendItem color={SERIES_COLOR} label="Entry" />
      {metric.goal != null && (
        <span className="flex items-center gap-1.5 text-[11px] text-[#93b0b4]">
          <span className="w-[14px] border-t-2 border-dashed border-[#d97706]" />
          Goal
        </span>
      )}
    </>
  );

  return (
    <ExerciseChartCard
      title={`${metric.name} over time`}
      subtitle="Each logged entry in the selected range"
      legend={legend}
    >
      {points.length === 0 ? (
        // Range window excludes every entry (the metric itself has data —
        // the zero-entry state is handled upstream by the progression section).
        <div className="h-[260px] w-full">
          <p className="text-center text-[13px] text-[#93b0b4] py-12">
            No entries in the selected range.
          </p>
        </div>
      ) : (
        <div className="h-[260px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={points}
              margin={{ top: 10, right: 5, bottom: 0, left: 20 }}
            >
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={SERIES_COLOR} stopOpacity={0.08} />
                  <stop offset="100%" stopColor={SERIES_COLOR} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid horizontal vertical={false} stroke={GRID_LINE} />
              <XAxis
                dataKey="date"
                tickFormatter={formatDateShort}
                tick={X_TICK_STYLE}
                tickLine={false}
                axisLine={false}
                interval={xInterval}
              />
              <YAxis
                tick={TICK_STYLE}
                tickLine={false}
                axisLine={false}
                width={50}
                orientation="right"
              />
              <Tooltip
                content={<EntryTooltip unit={metric.unit} />}
                cursor={false}
              />
              {metric.goal != null && (
                <ReferenceLine
                  y={metric.goal}
                  stroke={GOAL_COLOR}
                  strokeDasharray="6 4"
                  strokeWidth={1.5}
                  label={{
                    value: `goal ${metric.goal}`,
                    position: "insideTopRight",
                    fill: GOAL_COLOR,
                    fontSize: 10,
                    fontFamily: "var(--font-mono-display)",
                  }}
                />
              )}
              <Area
                type="monotone"
                dataKey="value"
                stroke={SERIES_COLOR}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill={`url(#${gradientId})`}
                dot={(props: Record<string, unknown>) => (
                  <EntryDot
                    key={String(props.index)}
                    {...props}
                    lastIndex={points.length - 1}
                  />
                )}
                activeDot={{
                  r: 5,
                  fill: SERIES_COLOR,
                  strokeWidth: 2,
                  stroke: "#fff",
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </ExerciseChartCard>
  );
}
