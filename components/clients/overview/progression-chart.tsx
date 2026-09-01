"use client";

import { useMemo } from "react";
import {
  Area,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { TextSkeleton } from "@/components/text-skeleton";
import {
  MONO,
  STAT_LABEL_DARK_CLASS,
  STAT_VALUE_DARK_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import { rollingAverage, weeklyRate, type SeriesPoint } from "@/lib/overview/rolling-average";
import { toUtcMs } from "@/utils/metric-points";
import { getTodayDateStringInTimezone } from "@/lib/date-helpers";
import { formatDateOnlyShort } from "./overview-format";
import type { EffectiveGoal } from "@/lib/goals/resolve-effective-goal";
import type { MeasurementSeries } from "@/types/coach-overview";
import { useUnits } from "@/contexts/units-context";
import { formatWeight, type UnitSystem } from "@/utils/unit-conversions";

/**
 * Weight or body fat across the client's WHOLE journey, on the dark band.
 *
 * Not windowed, deliberately: the question this answers is "where has this
 * client got to since they started", which is a lifetime question. The axis
 * therefore runs from their start date to today whatever the data does, so an
 * empty stretch reads as an empty stretch rather than being cropped away.
 *
 * recharts, not hand-rolled SVG: it is already a dependency and
 * `metric-trend-chart.tsx` is the shipped precedent for this exact chart —
 * including two things worth inheriting rather than rediscovering. A goal line
 * outside the data's range **vanishes** unless `ifOverflow="extendDomain"` is
 * passed (recharts drops out-of-domain reference lines), which is the bug the
 * hand-drawn mockup reproduced; and the X axis must be NUMERIC TIME, because a
 * category axis spaces points by entry COUNT and so draws a client who logged
 * three times in one week and once in the next as evenly spaced.
 *
 * Two derivations are genuinely new here, and only these two: the rolling mean
 * and the window-scoped rate (`lib/overview/rolling-average.ts`). No
 * projections.
 */

export type ChartMetric = "weight" | "bodyFat";

type ProgressionChartProps = {
  series: MeasurementSeries | null;
  isLoading: boolean;
  metric: ChartMetric;
  onMetricChange: (metric: ChartMetric) => void;
  goal: EffectiveGoal;
  /** The client's start date — the axis' left edge. Null before activation. */
  startDate: string | null;
  /** The client's zone, so "today" is their today and not the coach's device. */
  timezone: string;
};

const SERIES_COLOR = "#0d9488";
const RAW_DOT_COLOR = "rgba(255,255,255,0.22)";
const GOAL_LINE_COLOR = "rgba(255,255,255,0.22)";

/**
 * Above this many readings the raw dots come off and the trend line carries it
 * alone. Same reasoning as `WellnessSparkline`'s threshold: a journey of two
 * years is well over a hundred readings in ~560px, and at that spacing the dots
 * merge into a band that hides the line they are meant to sit behind.
 */
const MAX_RAW_DOTS = 40;

const METRIC_OPTIONS: { value: ChartMetric; label: string }[] = [
  { value: "weight", label: "Weight" },
  { value: "bodyFat", label: "Body fat" },
];

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Canonical kg → the viewer's unit, at the render boundary, rounded to one
 * decimal — exactly what `use-merged-metrics.ts` does. Without the rounding an
 * imperial coach reads 374.78584571429193 where a metric one reads 170.
 * Body fat is already a percentage and passes straight through.
 */
function toViewer(value: number, metric: ChartMetric, viewer: UnitSystem): number {
  return metric === "weight" ? round1(formatWeight(value, viewer).value) : value;
}

/** The on-dark two-way toggle. */
function MetricLens({
  metric,
  onMetricChange,
}: {
  metric: ChartMetric;
  onMetricChange: (metric: ChartMetric) => void;
}) {
  return (
    // NOT <SegmentedControl>: that component is light-themed, and the shipped
    // on-dark answer is the lens row (exercise-search-select.tsx). It carries
    // neither the 0.05 tint nor the p-[2px] track, so it is not the hand-rolled
    // segmented control `check:labels` clause 3 exists to catch.
    <div className="flex shrink-0 items-center gap-0.5">
      {METRIC_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={metric === option.value}
          onClick={() => onMetricChange(option.value)}
          className={cn(
            "rounded-[4px] px-2 py-1 text-[11px] font-medium transition-colors",
            metric === option.value
              ? "bg-[rgba(13,148,136,0.15)] text-[#0d9488]"
              : "text-[rgba(255,255,255,0.45)] hover:text-white"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function ProgressionChart({
  series,
  isLoading,
  metric,
  onMetricChange,
  goal,
  startDate,
  timezone,
}: ProgressionChartProps) {
  const { preference } = useUnits();

  const unit = metric === "weight" ? formatWeight(0, preference).unit : "%";
  const goalRaw = metric === "weight" ? goal.goalWeightKg : goal.goalBodyFatPercentage;
  const goalValue = goalRaw == null ? null : toViewer(goalRaw, metric, preference);

  const { points, smoothed, current, rate } = useMemo(() => {
    const raw: SeriesPoint[] = (series?.[metric] ?? []).map((point) => ({
      date: point.date,
      value: toViewer(point.value, metric, preference),
    }));
    const mean = rollingAverage(raw);
    return {
      points: raw,
      smoothed: mean,
      current: raw.length > 0 ? raw[raw.length - 1].value : null,
      // The SMOOTHED series, so the figure is the trend's slope rather than the
      // distance between two possibly-noisy readings. Null under two points or
      // under a week of span — the same gate deriveHeroStats applies, because
      // below it an extrapolated weekly rate is arithmetic, not information.
      rate: weeklyRate(mean),
    };
  }, [series, metric, preference]);

  // Every point carries both the raw reading and its trailing mean, so one
  // dataset drives the line, the dots and the shared time axis.
  const data = useMemo(
    () =>
      points.map((point, i) => ({
        ts: toUtcMs(point.date),
        raw: point.value,
        mean: smoothed[i]?.value ?? point.value,
      })),
    [points, smoothed]
  );

  // The axis is the JOURNEY, not the data: [start date, today]. Anchoring it on
  // the readings instead would crop a client who stopped logging in June back to
  // June and quietly redraw the same trend as though it were current.
  const today = getTodayDateStringInTimezone(timezone);
  const domain = useMemo<[number, number]>(() => {
    const end = toUtcMs(today);
    // No start date (pre-activation) falls back to the first reading, and with
    // no readings either to a single day, which recharts is happy to render.
    const startFallback = points.length > 0 ? points[0].date : today;
    return [toUtcMs(startDate ?? startFallback), end];
  }, [startDate, today, points]);

  const gradientId = `progression-${metric}`;
  // Before the first response, `series` is null and `points` is empty — which
  // is indistinguishable from a client who has logged nothing. The readout must
  // not assert the second while waiting for the first.
  const isFirstLoad = isLoading && series === null;

  return (
    <div className="flex min-w-0 flex-col px-5 py-4">
      <div className="flex items-start gap-4">
        <div className="min-w-0">
          <p className={STAT_LABEL_DARK_CLASS}>
            {metric === "weight" ? "Weight" : "Body fat"}
          </p>
          <div className="mt-1">
            {isFirstLoad ? (
              <p>
                <span className={cn(STAT_VALUE_DARK_CLASS, "text-[26px] leading-none")}>
                  <TextSkeleton className="w-16" />
                </span>
              </p>
            ) : current === null ? (
              <span className="text-[13px] text-[rgba(255,255,255,0.3)]">Not recorded</span>
            ) : (
              <p>
                <span
                  className={cn(STAT_VALUE_DARK_CLASS, "text-[26px] leading-none")}
                >
                  {current.toFixed(1)}
                </span>
                <span className="ml-1 text-[12px] font-normal text-[rgba(255,255,255,0.3)]">
                  {unit}
                </span>
              </p>
            )}
          </div>
          {/* Rendered in BOTH states: removing the line while loading made the
              band grow when the rate landed (newdesignsystem → Loading &
              async states). */}
          <p
            className={cn(
              "mt-1.5 text-[11px]",
              !isFirstLoad && rate !== null
                ? cn(MONO, "text-[#0d9488]")
                : "text-[rgba(255,255,255,0.3)]"
            )}
          >
            {isFirstLoad ? (
              <TextSkeleton className="w-20" />
            ) : rate === null ? (
              // Word-only, so it stays sans beside the mono rate it replaces.
              points.length === 0
                ? "No measurements in this window"
                : "Not enough logged to state a rate"
            ) : (
              `${rate > 0 ? "+" : ""}${rate.toFixed(2)} ${unit}/wk`
            )}
          </p>
        </div>
        <div className="ml-auto">
          <MetricLens metric={metric} onMetricChange={onMetricChange} />
        </div>
      </div>

      <div className="mt-2 h-[104px] w-full">
        {isFirstLoad ? (
          <Skeleton className="h-full w-full rounded-[6px] bg-[rgba(255,255,255,0.06)]" />
        ) : points.length === 0 ? (
          // An empty window still shows where the target is: a goal is a fact
          // about the CLIENT, not about what these 30 days happen to contain.
          // Drawn as plain markup rather than through recharts, which renders
          // nothing at all — reference line included — for an empty dataset.
          <div className="flex h-full items-center">
            {goalValue !== null && (
              <div className="w-full">
                <div className="border-t border-dashed border-[rgba(255,255,255,0.22)]" />
                <p
                  className={cn(MONO, "mt-1 text-right text-[9px] text-[rgba(255,255,255,0.35)]")}
                >
                  goal {goalValue}
                </p>
              </div>
            )}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {/* Composed, not AreaChart: the raw readings ride as a Scatter
                  beside the trend Area, and only ComposedChart hosts both. */}
            <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={SERIES_COLOR} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={SERIES_COLOR} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="ts" type="number" domain={domain} hide />
              <YAxis hide domain={["auto", "auto"]} />
              {goalValue !== null && (
                <ReferenceLine
                  y={goalValue}
                  // A goal outside the data's range must stretch the axis, not
                  // vanish — recharts discards out-of-domain reference lines.
                  ifOverflow="extendDomain"
                  stroke={GOAL_LINE_COLOR}
                  strokeDasharray="3 3"
                  label={{
                    value: `goal ${goalValue}`,
                    position: "insideTopRight",
                    fill: "rgba(255,255,255,0.35)",
                    fontSize: 9,
                    fontFamily: "var(--font-mono-display)",
                  }}
                />
              )}
              <Area
                type="monotone"
                dataKey="mean"
                stroke={SERIES_COLOR}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill={`url(#${gradientId})`}
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
              {/* The raw readings, behind the trend — a sparse series has to
                  LOOK sparse, or a smooth line over three points in sixty days
                  reads as sixty days of daily weigh-ins. */}
              {points.length <= MAX_RAW_DOTS && (
                <Scatter
                  dataKey="raw"
                  fill={RAW_DOT_COLOR}
                  shape="circle"
                  legendType="none"
                  isAnimationActive={false}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* The axis' own ends — where this client STARTED and today — rather than
          the first and last readings. Those two are the same thing for a client
          who logs, and the difference is the point for one who stopped. */}
      <div className="mt-1 flex items-center justify-between">
        <span className={cn(MONO, "text-[10px] text-[rgba(255,255,255,0.3)]")}>
          {startDate ? formatDateOnlyShort(startDate) : "Start"}
        </span>
        <span className={cn(MONO, "text-[10px] text-[rgba(255,255,255,0.3)]")}>
          {formatDateOnlyShort(today)}
        </span>
      </div>
    </div>
  );
}
