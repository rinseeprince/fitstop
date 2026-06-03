"use client";

import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { TrendSparkline } from "./trend-sparkline";
import type { CheckInComparison, ProgressChartData, MetricChange } from "@/types/check-in";
import type { SessionSummary } from "@/lib/check-in/adherence";

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
    <div className={`text-xs flex items-center gap-1 justify-end font-mono-display ${deltaColor(change, !!inverse)}`}>
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
        <div className="font-semibold font-mono-display text-[#0c1a1e]">
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
        <div className="font-semibold font-mono-display text-[#0c1a1e]">
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
  const { current, previous, changes, timeBetweenCheckIns } = comparison;
  const hasPreviousCheckIn = previous !== null;
  const weightUnit = current.weightUnit || "kg";
  const measurementUnit = current.measurementUnit || "in";

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
    changes.stress?.current !== undefined;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h3 className="text-lg font-semibold text-[#0c1a1e]">
          {hasPreviousCheckIn ? "Progress comparison" : "Baseline established"}
        </h3>
        <p className="text-sm text-[#93b0b4]">
          {hasPreviousCheckIn && timeBetweenCheckIns
            ? `Comparing with the check-in from ${timeBetweenCheckIns} days ago`
            : "This is the first check-in. 1 data point, trends build next week."}
        </p>
      </div>

      {/* Body */}
      <div className={cardClass}>
        <h4 className={headingClass}>Body</h4>
        <div className="space-y-1">
          <MetricTrendRow
            label="Weight"
            current={changes.weight?.current}
            unit={` ${weightUnit}`}
            change={changes.weight}
            series={values(chartData.weight)}
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
          <MetricRow label="Waist" change={changes.waist} unit={` ${measurementUnit}`} inverse />
          <MetricRow label="Hips" change={changes.hips} unit={` ${measurementUnit}`} />
          <MetricRow label="Chest" change={changes.chest} unit={` ${measurementUnit}`} />
          <MetricRow label="Arms" change={changes.arms} unit={` ${measurementUnit}`} />
          <MetricRow label="Thighs" change={changes.thighs} unit={` ${measurementUnit}`} />
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
          </div>
        </div>
      )}
    </div>
  );
};
