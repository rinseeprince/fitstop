"use client";

import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { MONO, TEXT_PRIMARY } from "@/components/clients/training/program-builder/builder-tokens";
import { TrendSparkline } from "./trend-sparkline";
import type { CheckInComparison, ProgressChartData, MetricChange } from "@/types/check-in";
import type { SessionSummary } from "@/lib/check-in/adherence";
import { useUnits } from "@/contexts/units-context";
import { formatLength, formatWeight, type UnitSystem } from "@/utils/unit-conversions";

type CheckInComparisonViewProps = {
  comparison: CheckInComparison;
  chartData: ProgressChartData;
  // Shared training adherence (completed / prescribed) so the figure here is
  // identical to the hero card. Historical points use the stored snapshots.
  adherence: SessionSummary;
};

const values = (points: { value: number }[]): number[] => points.map((p) => p.value);

// Delta colour, Teal Summit two-colour: good direction -> teal, bad -> amber.
function deltaColor(change: MetricChange | undefined, inverse: boolean): string {
  if (!change || change.previous === undefined) return "text-[#93b0b4]";
  if (change.trend === "down") return inverse ? "text-[#0d9488]" : "text-[#d97706]";
  if (change.trend === "up") return inverse ? "text-[#d97706]" : "text-[#0d9488]";
  return "text-[#93b0b4]";
}

function DeltaText({ change, unit, inverse }: { change?: MetricChange; unit?: string; inverse?: boolean }) {
  if (!change || change.previous === undefined || change.change === undefined) return null;
  const Icon = change.trend === "up" ? TrendingUp : change.trend === "down" ? TrendingDown : Minus;
  return (
    <div className={cn("text-xs flex items-center gap-1 justify-end", MONO, deltaColor(change, !!inverse))}>
      <Icon className="h-3 w-3" strokeWidth={1.5} />
      <span>
        {change.change > 0 ? "+" : ""}
        {change.change}
        {unit || ""}
      </span>
    </div>
  );
}

// Delta-only row, used for body measurements (no trend series available).
function MetricRow({
  label,
  change,
  unit = "",
  inverse = false,
}: {
  label: string;
  change?: MetricChange;
  unit?: string;
  inverse?: boolean;
}) {
  if (!change || change.current === undefined) return null;
  return (
    <div className="flex items-center justify-between py-2 border-b border-[rgba(13,148,136,0.06)] last:border-0">
      <span className="text-sm font-medium text-[#5a7d82]">{label}</span>
      <div className="text-right">
        <div className={cn("font-semibold", MONO, TEXT_PRIMARY)}>
          {change.current}
          {unit}
        </div>
        <DeltaText change={change} unit={unit} inverse={inverse} />
      </div>
    </div>
  );
}

// Reading + week-over-week delta + trend sparkline (ghosted on a first check-in).
function MetricTrendRow({
  label,
  current,
  unit = "",
  change,
  series,
  inverse = false,
}: {
  label: string;
  current?: number;
  unit?: string;
  change?: MetricChange;
  series: number[];
  inverse?: boolean;
}) {
  if (current === undefined || current === null) return null;
  return (
    <div className="flex items-center gap-3 py-2 border-b border-[rgba(13,148,136,0.06)] last:border-0">
      <span className="text-sm font-medium text-[#5a7d82] flex-1">{label}</span>
      <TrendSparkline values={series} />
      <div className="text-right w-20">
        <div className={cn("font-semibold", MONO, TEXT_PRIMARY)}>
          {current}
          {unit}
        </div>
        <DeltaText change={change} unit={unit} inverse={inverse} />
      </div>
    </div>
  );
}

const cardClass = "bg-white border border-[rgba(13,148,136,0.08)] rounded-[6px] p-4";
const headingClass = "font-semibold mb-3 text-[#0c1a1e]";

export const CheckInComparisonView = ({ comparison, chartData, adherence }: CheckInComparisonViewProps) => {
  // `current` was destructured only for current.weightUnit / measurementUnit,
  // which were mapper constants rather than the coach's choice.
  const { previous, changes, timeBetweenCheckIns } = comparison;
  const hasPreviousCheckIn = previous !== null;
  // current.weightUnit / measurementUnit are mapper constants ("kg"/"cm"), not
  // the coach's choice — the `|| "kg"` and `|| "in"` fallbacks never fired.
  // Stored weights are kilograms and girths centimetres, so the VALUES convert
  // here too, not just the labels.
  const { preference } = useUnits();
  const weightUnit = formatWeight(0, preference).unit;
  const measurementUnit = formatLength(0, preference).unit;

  const round1 = (n: number): number => Math.round(n * 10) / 10;
  const convertChange = (
    change: MetricChange | undefined,
    to: (v: number, viewer: UnitSystem) => { value: number },
  ): MetricChange | undefined => {
    if (!change) return change;
    const at = (v: number | undefined) =>
      v === undefined ? undefined : round1(to(v, preference).value);
    return {
      ...change,
      current: at(change.current),
      previous: at(change.previous),
      // Recomputed from the converted endpoints so the delta reconciles with
      // the two numbers it describes; percentChange and trend are unitless.
      change:
        change.current !== undefined && change.previous !== undefined
          ? round1(to(change.current, preference).value - to(change.previous, preference).value)
          : at(change.change),
    };
  };
  const asWeight = (c?: MetricChange) => convertChange(c, formatWeight);
  const asLength = (c?: MetricChange) => convertChange(c, formatLength);
  const weightSeries = (vals: number[]) =>
    vals.map((v) => round1(formatWeight(v, preference).value));

  // Use the shared (recomputed) adherence for the latest series point so the
  // sparkline and the displayed value agree with the hero card.
  const adherenceSeries = values(chartData.adherence);
  if (adherenceSeries.length > 0 && adherence.pct !== null) {
    adherenceSeries[adherenceSeries.length - 1] = adherence.pct;
  }

  const hasWellbeing =
    changes.mood?.current !== undefined ||
    changes.energy?.current !== undefined ||
    changes.sleep?.current !== undefined ||
    changes.stress?.current !== undefined ||
    changes.soreness?.current !== undefined;

  return (
    <div className="space-y-6">
      {/* The heading went with the tabs — the page's rail names this section
          now. The lead line stays here rather than moving to the rail's meta:
          it is a SENTENCE, and a rail meta is set in mono
          (docs/newdesignsystem.md → "Prose vs data"). */}
      <p className="text-sm text-[#93b0b4]">
        {hasPreviousCheckIn && timeBetweenCheckIns
          ? `Comparing with the check-in from ${timeBetweenCheckIns} days ago`
          : "This is the first check-in. 1 data point, trends build next week."}
      </p>

      {/* Body */}
      <div className={cardClass}>
        <h4 className={headingClass}>Physique</h4>
        <div className="space-y-1">
          <MetricTrendRow
            label="Weight"
            current={asWeight(changes.weight)?.current}
            unit={` ${weightUnit}`}
            change={asWeight(changes.weight)}
            series={weightSeries(values(chartData.weight))}
            inverse
          />
          <MetricTrendRow
            label="Body Fat"
            current={changes.bodyFatPercentage?.current}
            unit="%"
            change={changes.bodyFatPercentage}
            series={values(chartData.bodyFat)}
            inverse
          />
          <MetricRow label="Waist" change={asLength(changes.waist)} unit={` ${measurementUnit}`} inverse />
          <MetricRow label="Hips" change={asLength(changes.hips)} unit={` ${measurementUnit}`} />
          <MetricRow label="Chest" change={asLength(changes.chest)} unit={` ${measurementUnit}`} />
          <MetricRow label="Arms" change={asLength(changes.arms)} unit={` ${measurementUnit}`} />
          <MetricRow label="Thighs" change={asLength(changes.thighs)} unit={` ${measurementUnit}`} />
        </div>
      </div>

      {/* Performance */}
      <div className={cardClass}>
        <h4 className={headingClass}>Performance</h4>
        <div className="space-y-1">
          <MetricRow label="Workouts completed" change={changes.workoutsCompleted} />
          <MetricTrendRow
            label="Adherence"
            current={adherence.pct ?? undefined}
            unit="%"
            series={adherenceSeries}
          />
        </div>
      </div>

      {/* Wellbeing */}
      {hasWellbeing && (
        <div className={cardClass}>
          <h4 className={headingClass}>Wellbeing</h4>
          <div className="space-y-1">
            <MetricTrendRow label="Mood" current={changes.mood?.current} unit="/5" change={changes.mood} series={values(chartData.mood)} />
            <MetricTrendRow label="Energy" current={changes.energy?.current} unit="/10" change={changes.energy} series={values(chartData.energy)} />
            <MetricTrendRow label="Sleep" current={changes.sleep?.current} unit="/10" change={changes.sleep} series={values(chartData.sleep)} />
            <MetricTrendRow label="Stress" current={changes.stress?.current} unit="/10" change={changes.stress} series={values(chartData.stress)} inverse />
            <MetricTrendRow label="Soreness" current={changes.soreness?.current} unit="/10" change={changes.soreness} series={values(chartData.soreness)} inverse />
          </div>
        </div>
      )}
    </div>
  );
};
