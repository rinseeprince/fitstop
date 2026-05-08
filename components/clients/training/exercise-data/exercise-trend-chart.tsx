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
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import type { ExerciseProgressionPoint } from "@/types/training";

type TrendMetric = "weight" | "e1rm" | "volume" | "rpe" | "compliance";

type ExerciseTrendChartProps = {
  data: ExerciseProgressionPoint[] | undefined;
  metric: TrendMetric;
  isLoading: boolean;
};

const METRIC_CONFIG: Record<
  TrendMetric,
  { color: string; label: string; dataKey: string }
> = {
  weight: { color: "#8b5cf6", label: "Weight", dataKey: "topSetWeight" },
  e1rm: { color: "#10b981", label: "Est. 1RM", dataKey: "estimatedOneRepMax" },
  volume: { color: "#3b82f6", label: "Volume", dataKey: "totalVolume" },
  rpe: { color: "#f59e0b", label: "RPE", dataKey: "topSetRpe" },
  compliance: { color: "#0d9488", label: "Actual", dataKey: "actualSets" },
};

const TICK_STYLE = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };

const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: "hsl(var(--popover))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "8px",
    boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)",
    fontSize: "12px",
  },
};

function formatDateShort(iso: string) {
  return format(new Date(iso), "MMM d");
}

// ---------------------------------------------------------------------------
// Custom tooltips
// ---------------------------------------------------------------------------

function WeightTooltip({ active, payload }: Record<string, unknown>) {
  if (!active || !Array.isArray(payload) || payload.length === 0) return null;
  const p = payload[0]?.payload as ExerciseProgressionPoint | undefined;
  if (!p) return null;
  return (
    <div style={TOOLTIP_STYLE.contentStyle} className="px-3 py-2">
      <p className="text-[11px] text-[#93b0b4]">{formatDateShort(p.date)}</p>
      <p className="text-[13px] font-semibold text-[#0c1a1e] font-mono-display">
        {p.topSetWeight} x {p.topSetReps ?? "?"}
      </p>
    </div>
  );
}

function E1rmTooltip({ active, payload }: Record<string, unknown>) {
  if (!active || !Array.isArray(payload) || payload.length === 0) return null;
  const p = payload[0]?.payload as ExerciseProgressionPoint | undefined;
  if (!p) return null;
  return (
    <div style={TOOLTIP_STYLE.contentStyle} className="px-3 py-2">
      <p className="text-[11px] text-[#93b0b4]">{formatDateShort(p.date)}</p>
      <p className="text-[13px] font-semibold text-[#0c1a1e] font-mono-display">
        e1RM: {p.estimatedOneRepMax?.toFixed(1)}
      </p>
      {p.topSetWeight != null && p.topSetReps != null && (
        <p className="text-[11px] text-[#93b0b4]">
          from {p.topSetWeight} x {p.topSetReps}
        </p>
      )}
    </div>
  );
}

function VolumeTooltip({ active, payload }: Record<string, unknown>) {
  if (!active || !Array.isArray(payload) || payload.length === 0) return null;
  const p = payload[0]?.payload as ExerciseProgressionPoint | undefined;
  if (!p) return null;
  return (
    <div style={TOOLTIP_STYLE.contentStyle} className="px-3 py-2">
      <p className="text-[11px] text-[#93b0b4]">{formatDateShort(p.date)}</p>
      <p className="text-[13px] font-semibold text-[#0c1a1e] font-mono-display">
        {p.totalVolume?.toLocaleString()}
      </p>
    </div>
  );
}

function RpeTooltip({ active, payload }: Record<string, unknown>) {
  if (!active || !Array.isArray(payload) || payload.length === 0) return null;
  const p = payload[0]?.payload as ExerciseProgressionPoint | undefined;
  if (!p) return null;
  return (
    <div style={TOOLTIP_STYLE.contentStyle} className="px-3 py-2">
      <p className="text-[11px] text-[#93b0b4]">{formatDateShort(p.date)}</p>
      <p className="text-[13px] font-semibold text-[#0c1a1e] font-mono-display">
        RPE {p.topSetRpe}
      </p>
    </div>
  );
}

function ComplianceTooltip({ active, payload }: Record<string, unknown>) {
  if (!active || !Array.isArray(payload) || payload.length === 0) return null;
  const p = payload[0]?.payload as ExerciseProgressionPoint | undefined;
  if (!p) return null;
  return (
    <div style={TOOLTIP_STYLE.contentStyle} className="px-3 py-2">
      <p className="text-[11px] text-[#93b0b4]">{formatDateShort(p.date)}</p>
      <p className="text-[13px] font-semibold text-[#0c1a1e]">
        {p.prescribedSets != null
          ? `${p.actualSets} / ${p.prescribedSets} sets`
          : `${p.actualSets} sets (no prescription)`}
      </p>
    </div>
  );
}

const TOOLTIPS: Record<TrendMetric, React.FC<Record<string, unknown>>> = {
  weight: WeightTooltip,
  e1rm: E1rmTooltip,
  volume: VolumeTooltip,
  rpe: RpeTooltip,
  compliance: ComplianceTooltip,
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ExerciseTrendChart({
  data,
  metric,
  isLoading,
}: ExerciseTrendChartProps) {
  const config = METRIC_CONFIG[metric];
  const gradientId = `exercise-trend-${metric}`;

  const filteredData = useMemo(() => {
    if (!data) return [];
    if (metric === "rpe") return data.filter((p) => p.topSetRpe != null);
    if (metric === "weight") return data.filter((p) => p.topSetWeight != null);
    if (metric === "e1rm")
      return data.filter((p) => p.estimatedOneRepMax != null);
    if (metric === "volume") return data.filter((p) => p.totalVolume != null);
    return data;
  }, [data, metric]);

  // Compliance summary stat (must be before early returns per rules-of-hooks)
  const complianceSummary = useMemo(() => {
    if (metric !== "compliance") return null;
    const withPrescription = filteredData.filter((p) => p.prescribedSets != null);
    if (withPrescription.length === 0) return null;
    const hit = withPrescription.filter(
      (p) => p.actualSets >= (p.prescribedSets ?? 0),
    ).length;
    return `Hit prescribed sets in ${hit}/${withPrescription.length} sessions`;
  }, [metric, filteredData]);

  if (isLoading) {
    return <Skeleton className="h-[300px] w-full rounded-[6px]" />;
  }

  // RPE-specific empty state
  if (metric === "rpe" && data && data.length > 0 && filteredData.length === 0) {
    return (
      <p className="text-center text-[13px] text-[#93b0b4] py-12">
        No RPE data recorded for this exercise.
      </p>
    );
  }

  // Compliance: all prescribedSets null
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

  const CustomTooltip = TOOLTIPS[metric];

  // Volume and compliance use BarChart
  if (metric === "volume") {
    return (
      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={filteredData}
            margin={{ top: 10, right: 10, bottom: 0, left: 0 }}
          >
            <XAxis
              dataKey="date"
              tickFormatter={formatDateShort}
              tick={TICK_STYLE}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={TICK_STYLE}
              tickLine={false}
              axisLine={false}
              width={50}
            />
            <Tooltip content={<CustomTooltip />} cursor={false} />
            <Bar
              dataKey={config.dataKey}
              fill={config.color}
              radius={[3, 3, 0, 0]}
              maxBarSize={24}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (metric === "compliance") {
    return (
      <div>
        {complianceSummary && (
          <p className="text-[13px] text-[#0c1a1e] font-medium mb-3">
            {complianceSummary}
          </p>
        )}
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={filteredData}
              margin={{ top: 10, right: 10, bottom: 0, left: 0 }}
            >
              <XAxis
                dataKey="date"
                tickFormatter={formatDateShort}
                tick={TICK_STYLE}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={TICK_STYLE}
                tickLine={false}
                axisLine={false}
                width={40}
              />
              <Tooltip content={<CustomTooltip />} cursor={false} />
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="hsl(var(--border))"
              />
              <Bar
                dataKey="prescribedSets"
                fill="rgba(13,148,136,0.3)"
                radius={[3, 3, 0, 0]}
                maxBarSize={20}
                name="Prescribed"
              />
              <Bar
                dataKey="actualSets"
                fill="#0d9488"
                radius={[3, 3, 0, 0]}
                maxBarSize={20}
                name="Actual"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  // AreaChart for weight, e1rm, rpe
  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={filteredData}
          margin={{ top: 10, right: 10, bottom: 0, left: 0 }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={config.color} stopOpacity={0.3} />
              <stop
                offset="100%"
                stopColor={config.color}
                stopOpacity={0.05}
              />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="date"
            tickFormatter={formatDateShort}
            tick={TICK_STYLE}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={TICK_STYLE}
            tickLine={false}
            axisLine={false}
            width={50}
            domain={metric === "rpe" ? [0, 10] : ["auto", "auto"]}
          />
          <Tooltip content={<CustomTooltip />} cursor={false} />
          <Area
            type="monotone"
            dataKey={config.dataKey}
            stroke={config.color}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={{
              r: 5,
              fill: config.color,
              strokeWidth: 2,
              stroke: "#fff",
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
