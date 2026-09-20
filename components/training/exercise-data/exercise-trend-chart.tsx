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
import { computeInsight, usesStrengthAnalytics } from "./exercise-insight";
import {
  formatDistance,
  formatDuration,
  formatLoad,
  formatPace,
  formatSplit,
  type UnitSystem,
} from "@/utils/unit-conversions";
import {
  formatMarkerNumber,
  markerSeriesValue,
  markerUnit,
} from "@/utils/exercise-marker-format";
import {
  markerLens,
  type ProgressMarker,
  type ProgressMarkerSpec,
} from "@/utils/exercise-progress-markers";
import type { ExerciseType } from "@/utils/exercise-types";
import { useUnits } from "@/contexts/units-context";
import type { ExerciseProgressionPoint } from "@/types/training";

// The trend chart of one marker (utils/exercise-progress-markers.ts): the
// marker says what it plots, how its numbers read, which way is better and
// whether the best point in the window is starred; the exercise's type gives
// it its words where the type leads with it.

type ExerciseTrendChartProps = {
  data: ExerciseProgressionPoint[] | undefined;
  metric: ProgressMarker;
  exerciseType: ExerciseType;
  isLoading: boolean;
  /**
   * Whether to render the trend-commentary insight footer. Defaults to true
   * (coach view). The client view passes false: the insight copy is coach-style
   * analytics and hardcodes "kg", so it's suppressed there.
   */
  showInsight?: boolean;
};

// Teal-shifted system hues (docs/newdesignsystem.md) — one metric renders at a
// time, so the hue carries identity across visits, not simultaneous contrast:
// deep teal for a type's leading marker, cyan for a derived one, honey for a
// total, rose for RPE.
const METRIC_COLORS: Record<ProgressMarker, string> = {
  weight: "#0a5c55",
  e1rm: "#2d8fb5",
  volume: "#c8923a",
  rpe: "#c06060",
  compliance: "#0d9488",
  reps: "#0a5c55",
  pace: "#0a5c55",
  distance: "#c8923a",
  split: "#0a5c55",
  power: "#2d8fb5",
  time: "#0a5c55",
  hold: "#0a5c55",
};
// PRs are goal-hits: the goal amber, not the series hue.
const PR_STAR_COLOR = "#d97706";
const GRID_LINE = "rgba(13, 148, 136, 0.06)";
const PRESCRIBED_FILL = "rgba(13, 148, 136, 0.2)";

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

const isClock = (spec: ProgressMarkerSpec) =>
  spec.readout === "pace" || spec.readout === "split" || spec.readout === "duration";

/**
 * A point as plotted: the three loads in the viewer's unit (the load lenses
 * and their tooltips read them), the plotted key in its own display unit, and
 * `source`, the canonical point every other tooltip line reads.
 */
type PlottedPoint = ExerciseProgressionPoint & { source: ExerciseProgressionPoint };

// ---------------------------------------------------------------------------
// Custom tooltips
// ---------------------------------------------------------------------------

function MetricTooltip({ active, payload, spec, viewer }: Record<string, unknown>) {
  if (!active || !Array.isArray(payload) || payload.length === 0) return null;
  const plotted = payload[0]?.payload as PlottedPoint | undefined;
  if (!plotted) return null;
  const s = spec as ProgressMarkerSpec;
  const v = viewer as UnitSystem;
  const p = plotted.source;
  // Loads arrive already converted (see plottedData); this only labels them.
  const u = formatLoad(0, v).unit;
  const with_ = (parts: (string | null)[]) => parts.filter((part): part is string => !!part).join(" · ");

  let line: string | null = null;
  let sub: string | null = null;
  switch (s.key) {
    case "weight":
      line = with_([
        `${plotted.topSetWeight}${u}${p.topSetReps != null ? ` x ${p.topSetReps}` : ""}`,
        p.topSetDistanceMeters != null ? formatDistance(p.topSetDistanceMeters, v) : null,
        p.topSetDurationSeconds != null ? formatDuration(p.topSetDurationSeconds) : null,
      ]);
      break;
    case "e1rm":
      line = `e1RM: ${plotted.estimatedOneRepMax?.toFixed(1)}${u}`;
      sub =
        plotted.topSetWeight != null && p.topSetReps != null
          ? `${plotted.topSetWeight}${u} x ${p.topSetReps}`
          : null;
      break;
    case "volume":
      line = `${plotted.totalVolume?.toLocaleString()}${u}`;
      break;
    case "rpe":
      line = `RPE ${p.topSetRpe}`;
      break;
    case "compliance":
      line =
        p.prescribedSets != null
          ? `${p.actualSets} / ${p.prescribedSets} sets`
          : `${p.actualSets} sets`;
      break;
    case "reps":
      line = `${p.bestSetReps} reps`;
      break;
    case "pace":
      line = with_([
        p.bestPaceSecondsPerKm != null ? formatPace(p.bestPaceSecondsPerKm, v) : null,
        p.bestPaceDistanceMeters != null ? formatDistance(p.bestPaceDistanceMeters, v) : null,
      ]);
      break;
    case "distance":
      line = p.totalDistanceMeters != null ? formatDistance(p.totalDistanceMeters, v) : null;
      break;
    case "split":
      line = with_([
        p.bestSplitSecondsPer500m != null ? formatSplit(p.bestSplitSecondsPer500m) : null,
        p.bestSplitDistanceMeters != null ? formatDistance(p.bestSplitDistanceMeters, v) : null,
      ]);
      break;
    case "power":
      line = `${p.bestPower} W`;
      break;
    case "time":
      line = with_([
        p.bestTimeSeconds != null ? formatDuration(p.bestTimeSeconds) : null,
        p.bestTimeDistanceMeters != null ? formatDistance(p.bestTimeDistanceMeters, v) : null,
        p.bestTimeWeight != null ? `${formatLoad(p.bestTimeWeight, v).value}${u}` : null,
      ]);
      break;
    case "hold":
      line = p.longestHoldSeconds != null ? formatDuration(p.longestHoldSeconds) : null;
      break;
  }

  return (
    <div style={TOOLTIP_STYLE.contentStyle} className="px-3 py-2">
      <p className={cn(MONO, "text-[11px] text-[#93b0b4]")}>{formatDateShort(p.date)}</p>
      {line && <p className={TOOLTIP_VALUE_CLASS}>{line}</p>}
      {sub && (
        <p className="text-[11px] text-[#93b0b4]">
          from <span className={MONO}>{sub}</span>
        </p>
      )}
    </div>
  );
}

// Custom dot: the best point in the window, by the marker's own direction
function BestDot(props: Record<string, unknown>) {
  const { cx, cy, payload, data, spec, color } = props as {
    cx: number;
    cy: number;
    payload: PlottedPoint;
    data: PlottedPoint[];
    spec: ProgressMarkerSpec;
    color: string;
  };
  if (!payload || !data) return null;

  const values = data
    .map((p) => p[spec.value])
    .filter((value): value is number => value != null);
  const bestValue = spec.better === "lower" ? Math.min(...values) : Math.max(...values);
  const isBest = payload[spec.value] === bestValue;

  if (isBest) {
    return (
      <g>
        <circle cx={cx} cy={cy} r={9} fill={`${color}2e`} />
        <circle cx={cx} cy={cy} r={5} fill={color} />
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
    <circle cx={cx} cy={cy} r={3.5} fill="#fff" stroke={color} strokeWidth={2} />
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ExerciseTrendChart({
  data,
  metric,
  exerciseType,
  isLoading,
  showInsight = true,
}: ExerciseTrendChartProps) {
  const { preference } = useUnits();
  const spec = markerLens(exerciseType, metric);
  const gradientId = `exercise-trend-${metric}`;

  // Stored values are canonical (kilograms, metres, seconds per km), so the
  // SERIES is converted here — not just the axis label. Labelling a kg series
  // "lbs" would be worse than an unlabelled chart. Read-only render, so
  // formatLoad (which snaps an imperial conversion to a loadable increment) is
  // the right helper for a load.
  const plottedData = useMemo((): PlottedPoint[] => {
    if (!data) return [];
    const toLoad = (kg: number | null) =>
      kg == null ? kg : formatLoad(kg, preference).value;
    const converted = data.map((p): PlottedPoint => {
      const out: PlottedPoint = {
        ...p,
        topSetWeight: toLoad(p.topSetWeight),
        estimatedOneRepMax: toLoad(p.estimatedOneRepMax),
        totalVolume: toLoad(p.totalVolume),
        source: p,
      };
      const raw = p[spec.value];
      if (spec.readout !== "load" && raw != null) {
        (out as Record<typeof spec.value, number | null>)[spec.value] = markerSeriesValue(
          spec.readout,
          raw,
          preference,
        );
      }
      return out;
    });
    if (metric === "compliance") return converted;
    return converted.filter((p) => p[spec.value] != null);
  }, [data, metric, spec, preference]);

  const complianceSummary = useMemo(() => {
    if (metric !== "compliance") return null;
    const withPrescription = plottedData.filter((p) => p.prescribedSets != null);
    if (withPrescription.length === 0) return null;
    const hit = withPrescription.filter(
      (p) => p.actualSets >= (p.prescribedSets ?? 0),
    ).length;
    return `Hit prescribed sets in ${hit}/${withPrescription.length} sessions`;
  }, [metric, plottedData]);

  const insight = useMemo(
    () =>
      showInsight && data && usesStrengthAnalytics(exerciseType, metric)
        ? computeInsight(metric, data, preference)
        : null,
    [metric, exerciseType, data, showInsight, preference],
  );

  if (isLoading) {
    return <Skeleton className="h-[380px] w-full rounded-[6px]" />;
  }

  if (metric === "compliance" && data && data.every((p) => p.prescribedSets == null)) {
    return (
      <p className="text-center text-[13px] text-[#93b0b4] py-12">
        No prescribed data available for this exercise.
      </p>
    );
  }

  if (metric !== "compliance" && data && data.length > 0 && plottedData.length === 0) {
    return (
      <p className="text-center text-[13px] text-[#93b0b4] py-12">
        No {spec.noun} recorded for this exercise.
      </p>
    );
  }

  if (plottedData.length < 2) {
    return (
      <p className="text-center text-[13px] text-[#93b0b4] py-12">
        Not enough data yet. Log at least 2 sessions to see trends.
      </p>
    );
  }

  const dataKey = spec.value;
  const color = METRIC_COLORS[metric];

  // Sparse x-axis: show every 3rd or 4th tick
  const xInterval = plottedData.length <= 8 ? 0 : Math.max(1, Math.floor(plottedData.length / 5));

  // Legend: the weight lens keeps its Top set + PR pair; any other starred
  // marker names itself and its best; compliance names its two bars.
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
    ) : spec.star ? (
      <>
        <LegendItem color={color} label={spec.label} />
        <LegendItem color={PR_STAR_COLOR} label={spec.bestLabel} icon="star" />
      </>
    ) : null;

  // The unit rides on the subtitle rather than the Y axis: the axis is 40-50px
  // wide and appending "kg" to every tick overflows it. Reps, RPE and sets
  // carry no unit — their titles say what they count.
  const unit = markerUnit(spec.readout, preference);
  const subtitleUnit =
    spec.readout === "reps" || spec.readout === "rpe" || spec.readout === "sets" ? "" : unit;
  const subtitle =
    metric === "compliance" && complianceSummary
      ? complianceSummary
      : subtitleUnit
        ? `${spec.subtitle} · ${subtitleUnit}`
        : spec.subtitle;

  const tickFormatter = isClock(spec)
    ? (value: number) => formatMarkerNumber(spec.readout, value)
    : undefined;
  const tooltip = <MetricTooltip spec={spec} viewer={preference} />;

  // Totals per session are bars
  if (spec.shape === "bar") {
    return (
      <ExerciseChartCard title={spec.title} subtitle={subtitle} insight={insight}>
        <div className="h-[260px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={plottedData} margin={{ top: 10, right: 5, bottom: 0, left: 20 }}>
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
              <Tooltip content={tooltip} cursor={false} />
              <Bar dataKey={dataKey} fill={color} radius={[3, 3, 0, 0]} maxBarSize={24} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ExerciseChartCard>
    );
  }

  if (metric === "compliance") {
    return (
      <ExerciseChartCard title={spec.title} subtitle={subtitle} legend={legend} insight={insight}>
        <div className="h-[260px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={plottedData} margin={{ top: 10, right: 5, bottom: 0, left: 20 }}>
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
              <Tooltip content={tooltip} cursor={false} />
              <Legend content={() => null} />
              <Bar dataKey="prescribedSets" fill={PRESCRIBED_FILL} radius={[3, 3, 0, 0]} maxBarSize={20} name="Prescribed" />
              <Bar dataKey="actualSets" fill={color} radius={[3, 3, 0, 0]} maxBarSize={20} name="Completed" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ExerciseChartCard>
    );
  }

  // AreaChart for everything else
  return (
    <ExerciseChartCard title={spec.title} subtitle={subtitle} legend={legend} insight={insight}>
      <div className="h-[260px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={plottedData} margin={{ top: 10, right: 5, bottom: 0, left: 20 }}>
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
              tickFormatter={tickFormatter}
            />
            <Tooltip content={tooltip} cursor={false} />
            <Area
              type="monotone"
              dataKey={dataKey}
              stroke={color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill={`url(#${gradientId})`}
              dot={
                spec.star
                  ? (props: Record<string, unknown>) => (
                      <BestDot
                        key={String(props.index)}
                        {...props}
                        data={plottedData}
                        spec={spec}
                        color={color}
                      />
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
