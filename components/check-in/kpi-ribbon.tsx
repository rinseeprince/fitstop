"use client";

import { cn } from "@/lib/utils";
import {
  MONO,
  STAT_LABEL_DARK_CLASS,
  STAT_VALUE_DARK_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import type { CheckIn, GetCheckInComparisonResponse, MetricChange } from "@/types/check-in";
import type { DailyLog } from "@/types/daily-log";
import type { SessionSummary } from "@/lib/check-in/adherence";
import { useUnits } from "@/contexts/units-context";
import { formatWeight } from "@/utils/unit-conversions";

const round1 = (n: number): number => Math.round(n * 10) / 10;

type FullWeekTarget = {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
};

type KPIRibbonProps = {
  checkIn: CheckIn;
  dailyLogs: DailyLog[];
  comparisonData: GetCheckInComparisonResponse | null;
  contextStartDate: Date;
  contextEndDate: Date;
  fullWeekTarget?: FullWeekTarget | null;
  adherence: SessionSummary;
};

type Accent = "success" | "warning" | "destructive" | "neutral";

type DeltaInfo = { text: string; type: "positive" | "negative" | "neutral" };

type KPICardData = {
  label: string;
  value: string;
  unit?: string;
  // When true the value is a muted placeholder (e.g. "Not tracked"), not a metric.
  valueMuted?: boolean;
  delta?: DeltaInfo;
  subText?: string;
  // Semantic top accent: a colour read before the coach reads the number.
  accent: Accent;
};

// Semantic colour dot per cell - a colour read before the number. Teal Summit is
// a two-colour status system (teal good, amber attention); there is no red.
const dotClass: Record<Accent, string> = {
  success: "bg-[#0d9488]",
  warning: "bg-[#d97706]",
  destructive: "bg-[#d97706]",
  neutral: "bg-[rgba(255,255,255,0.25)]",
};

// Delta text colour on the dark strip.
function deltaTextClass(type: DeltaInfo["type"]): string {
  if (type === "positive") return "text-[#0d9488]";
  if (type === "negative") return "text-[#d97706]";
  return "text-[rgba(255,255,255,0.4)]";
}

function formatDeltaValue(val: number, invert: boolean): DeltaInfo {
  const rounded = Number(val.toFixed(1));
  const sign = rounded > 0 ? "+" : "";
  const isPositive = invert ? rounded < 0 : rounded > 0;
  return {
    text: `${sign}${rounded % 1 === 0 ? rounded : rounded.toFixed(1)}`,
    type: rounded === 0 ? "neutral" : isPositive ? "positive" : "negative",
  };
}

// Accent for a progress metric: good direction -> success, bad -> warning,
// no comparison -> neutral grey.
function accentFromDelta(comparison: { delta: DeltaInfo } | null): Accent {
  if (!comparison) return "neutral";
  if (comparison.delta.type === "positive") return "success";
  if (comparison.delta.type === "negative") return "warning";
  return "neutral";
}

export const KPIRibbon = ({
  checkIn,
  dailyLogs,
  comparisonData,
  contextStartDate,
  contextEndDate,
  fullWeekTarget,
  adherence,
}: KPIRibbonProps) => {
  const { preference } = useUnits();
  const changes = comparisonData?.comparison?.changes;
  const hasPreviousCheckIn = comparisonData?.comparison?.previous != null;
  const daysDiff = Math.floor((contextEndDate.getTime() - contextStartDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  // Comparison line for a progress metric: a real week-over-week delta when a
  // prior check-in exists, otherwise the change from the starting value on a
  // first check-in. Returns null when neither is available.
  const buildComparison = (
    current: number | undefined,
    change: MetricChange | undefined,
    startingValue: number | undefined,
    invert: boolean
  ): { label: string; delta: DeltaInfo } | null => {
    if (hasPreviousCheckIn && change?.change !== undefined) {
      return { label: "vs previous week", delta: formatDeltaValue(change.change, invert) };
    }
    if (!hasPreviousCheckIn && current !== undefined && startingValue !== undefined) {
      return { label: "vs start", delta: formatDeltaValue(current - startingValue, invert) };
    }
    return null;
  };

  // Calorie calculations
  const calStats = dailyLogs.reduce(
    (acc, log) => {
      if (log.caloriesConsumed !== undefined && log.targetCalories) {
        acc.total += log.caloriesConsumed;
        acc.target += log.targetCalories;
        acc.daysLogged++;
      }
      return acc;
    },
    { total: 0, target: 0, daysLogged: 0 }
  );

  // Daily average comparison for calorie adherence
  const effectiveTarget = fullWeekTarget ? fullWeekTarget.calories : calStats.target;
  const avgConsumed = calStats.daysLogged > 0 ? Math.round(calStats.total / calStats.daysLogged) : 0;
  const avgTarget = calStats.daysLogged > 0 ? Math.round(effectiveTarget / daysDiff) : 0;
  const dailyDiff = Math.abs(avgConsumed - avgTarget);
  const adherenceLabel =
    calStats.daysLogged === 0 ? null :
    dailyDiff <= 50 ? "HIT" :
    dailyDiff <= 150 ? "PARTIAL" : "MISSED";
  const caloriesAccent: Accent =
    adherenceLabel === null ? "neutral" :
    adherenceLabel === "HIT" ? "success" :
    adherenceLabel === "PARTIAL" ? "warning" : "destructive";

  // Training adherence comes from the shared helper (completed / prescribed) so
  // the hero matches the prescription panel and the comparison tab exactly.
  const trainingPct = adherence.pct;
  const trainingValue =
    adherence.prescribed > 0
      ? `${adherence.completed}/${adherence.prescribed}`
      : checkIn.workoutsCompleted
      ? String(checkIn.workoutsCompleted)
      : "--";
  const trainingAccent: Accent =
    trainingPct === null ? "neutral" :
    trainingPct >= 80 ? "success" :
    trainingPct >= 50 ? "warning" : "destructive";

  const weightComparison = buildComparison(
    checkIn.weight,
    changes?.weight,
    comparisonData?.goalProgress?.weight?.startingWeight,
    true
  );

  const hasBodyFat = checkIn.bodyFatPercentage !== undefined && checkIn.bodyFatPercentage !== null;
  const bodyFatComparison = hasBodyFat
    ? buildComparison(
        checkIn.bodyFatPercentage,
        changes?.bodyFatPercentage,
        comparisonData?.goalProgress?.bodyFat?.startingBodyFat,
        true
      )
    : null;

  const cards: KPICardData[] = [
    {
      label: "Weight",
      // Body weight: formatWeight, which converts freely and never snaps.
      // checkIn.weightUnit is a mapper constant, not the viewer's choice.
      value: checkIn.weight ? String(round1(formatWeight(checkIn.weight, preference).value)) : "--",
      unit: formatWeight(0, preference).unit,
      delta: weightComparison?.delta,
      subText: weightComparison?.label,
      accent: checkIn.weight ? accentFromDelta(weightComparison) : "neutral",
    },
    {
      label: "Body Fat",
      value: hasBodyFat ? String(checkIn.bodyFatPercentage) : "Not tracked",
      unit: hasBodyFat ? "%" : undefined,
      valueMuted: !hasBodyFat,
      delta: bodyFatComparison?.delta,
      subText: bodyFatComparison?.label,
      accent: hasBodyFat ? accentFromDelta(bodyFatComparison) : "neutral",
    },
    {
      label: "Calories",
      value: calStats.daysLogged > 0 ? avgConsumed.toLocaleString() : "No data",
      unit: calStats.daysLogged > 0 ? `/ ${avgTarget.toLocaleString()} avg/day` : undefined,
      valueMuted: calStats.daysLogged === 0,
      delta: adherenceLabel ? {
        text: adherenceLabel,
        type: adherenceLabel === "HIT" ? "positive" : adherenceLabel === "PARTIAL" ? "neutral" : "negative",
      } : undefined,
      subText: calStats.daysLogged > 0 ? `${calStats.daysLogged}/${daysDiff} days logged` : "No nutrition logs",
      accent: caloriesAccent,
    },
    {
      label: "Training",
      value: trainingValue,
      delta: trainingPct !== null ? {
        text: `${trainingPct}%`,
        type: trainingPct >= 80 ? "positive" : trainingPct >= 50 ? "neutral" : "negative",
      } : undefined,
      subText: "adherence",
      accent: trainingAccent,
    },
  ];

  return (
    <div className="bg-[#0f2027] rounded-[6px] p-5 grid grid-cols-4 animate-card-in">
      {cards.map((card, i) => (
        <div
          key={card.label}
          className={
            i < cards.length - 1
              ? "flex flex-col pl-5 pr-5 border-r border-[rgba(255,255,255,0.07)]"
              : "flex flex-col pl-5"
          }
        >
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass[card.accent]}`} />
            <span className={STAT_LABEL_DARK_CLASS}>
              {card.label}
            </span>
          </div>
          <div className="flex items-baseline gap-1 mt-1">
            {card.valueMuted ? (
              <span className="text-[13px] text-[rgba(255,255,255,0.3)]">{card.value}</span>
            ) : (
              <span className={cn(STAT_VALUE_DARK_CLASS, "text-[22px] leading-tight")}>
                {card.value}
              </span>
            )}
            {card.unit && (
              <span className={cn("text-[10px] text-[rgba(255,255,255,0.3)]", card.label === "Calories" && MONO)}>{card.unit}</span>
            )}
          </div>
          {(card.delta || card.subText) && (
            <div className="flex items-center gap-1.5 mt-1">
              {card.delta && (
                <span className={cn("text-[11px] font-medium", card.label !== "Calories" && MONO, deltaTextClass(card.delta.type))}>
                  {card.delta.text}
                </span>
              )}
              {card.subText && (
                <span className={cn("text-[10px] text-[rgba(255,255,255,0.3)]", card.label === "Calories" && calStats.daysLogged > 0 && MONO)}>{card.subText}</span>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
