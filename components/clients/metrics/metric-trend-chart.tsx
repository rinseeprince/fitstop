"use client";

import { format } from "date-fns";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceArea,
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
import { getTodayDateString } from "@/lib/date-helpers";
import { toUtcMs, type MetricPoint } from "@/utils/metric-points";
import {
  clampBlockBands,
  DAY_MS,
  type BlockBandIdentity,
} from "./blocks/block-chart-bands";
import type { MetricSummary } from "./metrics-view-types";

// Generic entry-series fork of exercise-trend-chart.tsx: one teal Area over the
// merged check-in + coach-entry points, with an amber dashed goal line and
// (Session 3.5) journey-block background bands.
//
// The X axis is NUMERIC TIME (UTC-midnight epoch ms), not the old category
// scale over entry dates: a category axis spaces points by entry COUNT, which
// made block bands impossible (a block with no entries had no category to
// anchor to) and lied about time — uneven logging now renders as real gaps.

type MetricTrendChartProps = {
  metric: MetricSummary;
  points: MetricPoint[];
  /** The selected range in days; null = "All" (domain from the first entry). */
  windowDays: number | null;
  blockBands?: BlockBandIdentity[];
  showBlocks?: boolean;
  onToggleBlocks?: (show: boolean) => void;
};

const SERIES_COLOR = "#0d9488";
const GOAL_COLOR = "#d97706";
const GRID_LINE = "rgba(13, 148, 136, 0.06)";
const TICK_COUNT = 5;

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

// Local-midnight parse: a bare `new Date(iso)` parses UTC midnight and
// renders the PREVIOUS day in negative-offset timezones.
function formatDateShort(iso: string) {
  return format(new Date(iso + "T00:00:00"), "MMM d");
}

function formatTickMs(ms: number) {
  return formatDateShort(new Date(ms).toISOString().slice(0, 10));
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

export function MetricTrendChart({
  metric,
  points,
  windowDays,
  blockBands,
  showBlocks = false,
  onToggleBlocks,
}: MetricTrendChartProps) {
  const gradientId = `metric-trend-${metric.id}`;

  // The domain is the WINDOW, not the entries: [window start, end of today].
  // "All" anchors at the first entry. Day-slab semantics (+1 day) keep
  // today's dot off the right edge and let the current block's band reach
  // the end of today.
  const domainMax = toUtcMs(getTodayDateString()) + DAY_MS;
  const domainMin =
    windowDays != null
      ? domainMax - windowDays * DAY_MS
      : points.length > 0
        ? toUtcMs(points[0].date)
        : domainMax - DAY_MS;

  const ticks = Array.from(
    { length: TICK_COUNT },
    (_, i) => domainMin + ((domainMax - domainMin) * i) / (TICK_COUNT - 1)
  );

  const { bands, boundaries } =
    blockBands && showBlocks
      ? clampBlockBands(blockBands, domainMin, domainMax)
      : { bands: [], boundaries: [] };

  const data = points.map((p) => ({ ...p, ts: toUtcMs(p.date) }));

  const legend = (
    <>
      <LegendItem color={SERIES_COLOR} label="Entry" />
      {metric.goal != null && (
        <span className="flex items-center gap-1.5 text-[11px] text-[#93b0b4]">
          <span className="w-[14px] border-t-2 border-dashed border-[#d97706]" />
          Goal
        </span>
      )}
      {onToggleBlocks && blockBands && blockBands.length > 0 && (
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-[#93b0b4]">
          <input
            type="checkbox"
            checked={showBlocks}
            onChange={(event) => onToggleBlocks(event.target.checked)}
            className="h-3 w-3 accent-[#0d9488]"
          />
          Show blocks
        </label>
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
              data={data}
              margin={{ top: 10, right: 5, bottom: 0, left: 20 }}
            >
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={SERIES_COLOR} stopOpacity={0.08} />
                  <stop offset="100%" stopColor={SERIES_COLOR} stopOpacity={0} />
                </linearGradient>
              </defs>
              {/* Bands paint first — background context behind grid + series.
                  Identity is never colour-alone: every band carries its name
                  label, and boundaries carry white dividers. */}
              {bands.map((band) => (
                <ReferenceArea
                  key={band.id}
                  x1={band.x1}
                  x2={band.x2}
                  fill={band.color}
                  fillOpacity={band.muted ? 0.04 : 0.07}
                  strokeOpacity={0}
                  label={{
                    value: band.name,
                    position: "insideTop",
                    fill: band.color,
                    fontSize: 10,
                  }}
                />
              ))}
              {boundaries.map((edge) => (
                <ReferenceLine key={edge} x={edge} stroke="#fff" strokeWidth={2} />
              ))}
              <CartesianGrid horizontal vertical={false} stroke={GRID_LINE} />
              <XAxis
                dataKey="ts"
                type="number"
                domain={[domainMin, domainMax]}
                ticks={ticks}
                tickFormatter={formatTickMs}
                tick={X_TICK_STYLE}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={TICK_STYLE}
                tickLine={false}
                axisLine={false}
                width={50}
                orientation="right"
                domain={["auto", "auto"]}
              />
              <Tooltip
                content={<EntryTooltip unit={metric.unit} />}
                cursor={false}
              />
              {metric.goal != null && (
                <ReferenceLine
                  y={metric.goal}
                  // A goal outside the data's range must stretch the axis, not
                  // vanish (recharts discards out-of-domain reference lines).
                  ifOverflow="extendDomain"
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
