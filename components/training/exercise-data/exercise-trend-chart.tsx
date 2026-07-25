"use client";

import { useMemo } from "react";
import { format } from "date-fns";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MONO,
  TEXT_PRIMARY,
} from "@/components/clients/training/program-builder/builder-tokens";
import { ExerciseChartCard, LegendItem } from "./exercise-chart-card";
import { computeInsight } from "./exercise-insight";
import type { ExerciseProgressionPoint } from "@/types/training";

type TrendMetric = "weight" | "e1rm" | "volume" | "rpe" | "compliance";

type ExerciseTrendChartProps = {
  data: ExerciseProgressionPoint[] | undefined;
  metric: TrendMetric;
  isLoading: boolean;
  /**
   * Whether to render the trend-commentary insight footer. Defaults to true
   * (coach view). The client view passes false: the insight copy is coach-style
   * analytics and hardcodes "kg", so it's suppressed there.
   */
  showInsight?: boolean;
};

// Teal-shifted system hues (docs/newdesignsystem.md) — one metric renders at a
// time, so the hue carries identity across visits, not simultaneous contrast.
const METRIC_COLORS: Record<TrendMetric, string> = {
  weight: "#0a5c55",
  e1rm: "#2d8fb5",
  volume: "#c8923a",
  rpe: "#c06060",
  compliance: "#0d9488",
};
// PRs are goal-hits: the goal amber, not the series hue.
const PR_STAR_COLOR = "#d97706";
const GRID_LINE = "rgba(13, 148, 136, 0.06)";
const PRESCRIBED_FILL = "rgba(13, 148, 136, 0.2)";

const CHART_TITLES: Record<TrendMetric, { title: string; subtitle: string }> = {
  weight: { title: "Top set weight over time", subtitle: "Heaviest weight lifted per session" },
  e1rm: { title: "Estimated 1RM over time", subtitle: "Epley formula from top sets" },
  volume: { title: "Session volume", subtitle: "Total reps x weight per session" },
  rpe: { title: "RPE over time", subtitle: "Top set RPE per session" },
  compliance: { title: "Prescribed vs completed sets", subtitle: "Per-session compliance" },
};

const DATA_KEYS: Record<TrendMetric, string> = {
  weight: "topSetWeight",
  e1rm: "estimatedOneRepMax",
  volume: "totalVolume",
  rpe: "topSetRpe",
  compliance: "actualSets",
};

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

// ---------------------------------------------------------------------------
// Custom tooltips
// ---------------------------------------------------------------------------

function MetricTooltip({ active, payload, metric }: Record<string, unknown>) {
  if (!active || !Array.isArray(payload) || payload.length === 0) return null;
  const p = payload[0]?.payload as ExerciseProgressionPoint | undefined;
  if (!p) return null;
  const m = metric as TrendMetric;

  return (
    <div style={TOOLTIP_STYLE.contentStyle} className="px-3 py-2">
      <p className={cn(MONO, "text-[11px] text-[#93b0b4]")}>{formatDateShort(p.date)}</p>
      {m === "weight" && (
        <p className={TOOLTIP_VALUE_CLASS}>
          {p.topSetWeight} x {p.topSetReps ?? "?"}
        </p>
      )}
      {m === "e1rm" && (
        <>
          <p className={TOOLTIP_VALUE_CLASS}>
            e1RM: {p.estimatedOneRepMax?.toFixed(1)}
          </p>
          {p.topSetWeight != null && p.topSetReps != null && (
            <p className="text-[11px] text-[#93b0b4]">
              from <span className={MONO}>{p.topSetWeight} x {p.topSetReps}</span>
            </p>
          )}
        </>
      )}
      {m === "volume" && (
        <p className={TOOLTIP_VALUE_CLASS}>
          {p.totalVolume?.toLocaleString()}
        </p>
      )}
      {m === "rpe" && (
        <p className={TOOLTIP_VALUE_CLASS}>
          RPE {p.topSetRpe}
        </p>
      )}
      {m === "compliance" && (
        <p className={TOOLTIP_VALUE_CLASS}>
          {p.prescribedSets != null
            ? `${p.actualSets} / ${p.prescribedSets} sets`
            : `${p.actualSets} sets`}
        </p>
      )}
    </div>
  );
}

// Custom dot: PR marker for weight metric
const WEIGHT_COLOR = METRIC_COLORS.weight;

function PrDot(props: Record<string, unknown>) {
  const { cx, cy, payload, data } = props as {
    cx: number;
    cy: number;
    payload: ExerciseProgressionPoint;
    data: ExerciseProgressionPoint[];
  };
  if (!payload || !data) return null;

  const maxWeight = Math.max(
    ...data.filter((p) => p.topSetWeight != null).map((p) => p.topSetWeight!),
  );
  const isPr = payload.topSetWeight === maxWeight;

  if (isPr) {
    return (
      <g>
        <circle cx={cx} cy={cy} r={9} fill={`${WEIGHT_COLOR}2e`} />
        <circle cx={cx} cy={cy} r={5} fill={WEIGHT_COLOR} />
        <circle cx={cx} cy={cy} r={2} fill="#fff" />
        <text
          x={cx}
          y={cy - 16}
          textAnchor="middle"
          fill={PR_STAR_COLOR}
          fontSize={12}
        >
          ★
        </text>
      </g>
    );
  }

  return (
    <circle cx={cx} cy={cy} r={3.5} fill="#fff" stroke={WEIGHT_COLOR} strokeWidth={2} />
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ExerciseTrendChart({
  data,
  metric,
  isLoading,
  showInsight = true,
}: ExerciseTrendChartProps) {
  const gradientId = `exercise-trend-${metric}`;

  const filteredData = useMemo(() => {
    if (!data) return [];
    if (metric === "rpe") return data.filter((p) => p.topSetRpe != null);
    if (metric === "weight") return data.filter((p) => p.topSetWeight != null);
    if (metric === "e1rm") return data.filter((p) => p.estimatedOneRepMax != null);
    if (metric === "volume") return data.filter((p) => p.totalVolume != null);
    return data;
  }, [data, metric]);

  const complianceSummary = useMemo(() => {
    if (metric !== "compliance") return null;
    const withPrescription = filteredData.filter((p) => p.prescribedSets != null);
    if (withPrescription.length === 0) return null;
    const hit = withPrescription.filter(
      (p) => p.actualSets >= (p.prescribedSets ?? 0),
    ).length;
    return `Hit prescribed sets in ${hit}/${withPrescription.length} sessions`;
  }, [metric, filteredData]);

  const insight = useMemo(
    () => (showInsight && data ? computeInsight(metric, data) : null),
    [metric, data, showInsight],
  );

  if (isLoading) {
    return <Skeleton className="h-[380px] w-full rounded-[6px]" />;
  }

  if (metric === "rpe" && data && data.length > 0 && filteredData.length === 0) {
    return (
      <p className="text-center text-[13px] text-[#93b0b4] py-12">
        No RPE data recorded for this exercise.
      </p>
    );
  }

  if (metric === "compliance" && data && data.every((p) => p.prescribedSets == null)) {
    return (
      <p className="text-center text-[13px] text-[#93b0b4] py-12">
        No prescribed data available for this exercise.
      </p>
    );
  }

  if (filteredData.length < 2) {
    return (
      <p className="text-center text-[13px] text-[#93b0b4] py-12">
        Not enough data yet. Log at least 2 sessions to see trends.
      </p>
    );
  }

  const titles = CHART_TITLES[metric];
  const dataKey = DATA_KEYS[metric];
  const color = METRIC_COLORS[metric];

  // Sparse x-axis: show every 3rd or 4th tick
  const xInterval = filteredData.length <= 8 ? 0 : Math.max(1, Math.floor(filteredData.length / 5));

  // Build legend for weight (dot + star) and compliance (prescribed + actual)
  const legend =
    metric === "weight" ? (
      <>
        <LegendItem color={color} label="Top set" />
        <LegendItem color={PR_STAR_COLOR} label="PR" icon="star" />
      </>
    ) : metric === "compliance" ? (
      <>
        <LegendItem color={PRESCRIBED_FILL} label="Prescribed" />
        <LegendItem color={color} label="Completed" />
      </>
    ) : null;

  const subtitle =
    metric === "compliance" && complianceSummary
      ? complianceSummary
      : titles.subtitle;

  // Volume and compliance use BarChart
  if (metric === "volume") {
    return (
      <ExerciseChartCard title={titles.title} subtitle={subtitle} insight={insight}>
        <div className="h-[260px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={filteredData} margin={{ top: 10, right: 5, bottom: 0, left: 20 }}>
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
              <Tooltip content={<MetricTooltip metric={metric} />} cursor={false} />
              <Bar dataKey={dataKey} fill={color} radius={[3, 3, 0, 0]} maxBarSize={24} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ExerciseChartCard>
    );
  }

  if (metric === "compliance") {
    return (
      <ExerciseChartCard title={titles.title} subtitle={subtitle} legend={legend} insight={insight}>
        <div className="h-[260px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={filteredData} margin={{ top: 10, right: 5, bottom: 0, left: 20 }}>
              <CartesianGrid horizontal vertical={false} stroke={GRID_LINE} />
              <XAxis
                dataKey="date"
                tickFormatter={formatDateShort}
                tick={X_TICK_STYLE}
                tickLine={false}
                axisLine={false}
                interval={xInterval}
              />
              <YAxis tick={TICK_STYLE} tickLine={false} axisLine={false} width={40} orientation="right" />
              <Tooltip content={<MetricTooltip metric={metric} />} cursor={false} />
              <Legend content={() => null} />
              <Bar dataKey="prescribedSets" fill={PRESCRIBED_FILL} radius={[3, 3, 0, 0]} maxBarSize={20} name="Prescribed" />
              <Bar dataKey="actualSets" fill={color} radius={[3, 3, 0, 0]} maxBarSize={20} name="Completed" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ExerciseChartCard>
    );
  }

  // AreaChart for weight, e1rm, rpe
  const showPrDots = metric === "weight";

  return (
    <ExerciseChartCard title={titles.title} subtitle={subtitle} legend={legend} insight={insight}>
      <div className="h-[260px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={filteredData} margin={{ top: 10, right: 5, bottom: 0, left: 20 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.08} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
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
              domain={metric === "rpe" ? [0, 10] : ["auto", "auto"]}
            />
            <Tooltip content={<MetricTooltip metric={metric} />} cursor={false} />
            <Area
              type="monotone"
              dataKey={dataKey}
              stroke={color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill={`url(#${gradientId})`}
              dot={
                showPrDots
                  ? (props: Record<string, unknown>) => (
                      <PrDot key={String(props.index)} {...props} data={filteredData} />
                    )
                  : { r: 3.5, fill: "#fff", stroke: color, strokeWidth: 2 }
              }
              activeDot={{ r: 5, fill: color, strokeWidth: 2, stroke: "#fff" }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </ExerciseChartCard>
  );
}
