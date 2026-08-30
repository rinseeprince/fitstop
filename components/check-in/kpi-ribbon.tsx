"use client";

import { cn } from "@/lib/utils";
import {
  MONO,
  STAT_LABEL_DARK_CLASS,
  STAT_VALUE_DARK_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import type { CheckIn, GetCheckInComparisonResponse, MetricChange } from "@/types/check-in";
import type { SessionSummary } from "@/lib/check-in/adherence";
import type { CheckInPeriodAdherence } from "@/types/coach-overview";
import { useUnits } from "@/contexts/units-context";
import { formatWeight } from "@/utils/unit-conversions";

const round1 = (n: number): number => Math.round(n * 10) / 10;

// The four props the old Calories cell needed to average kcal over the days a
// client happened to log — dailyLogs, both context dates and fullWeekTarget —
// left with it. The ribbon now takes the figure already computed, not the rows
// to compute it from.
type KPIRibbonProps = {
  checkIn: CheckIn;
  comparisonData: GetCheckInComparisonResponse | null;
  adherence: SessionSummary;
  /**
   * The period's nutrition figures, server-computed. `null` on a legacy row
   * whose reporting period cannot be resolved — the cell then reads its empty
   * state rather than falling back to a second, client-side definition.
   */
  nutrition: CheckInPeriodAdherence["nutrition"] | null;
  /** The period's day count — the DENOMINATOR. Never a locally derived one. */
  periodDays: number | null;
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

  comparisonData,
  nutrition,
  periodDays,
  adherence,
}: KPIRibbonProps) => {
  const { preference } = useUnits();
  const changes = comparisonData?.comparison?.changes;
  const hasPreviousCheckIn = comparisonData?.comparison?.previous != null;

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

  // Days ON TARGET over the whole period — not an average of the days they
  // happened to log. Three logged days at target used to read "HIT" against a
  // daily average, which is a statement about three days dressed as a statement
  // about the week. The 50 / 150 kcal literals that produced it went with it;
  // "on target" is the persisted per-day `nutrition_adherence`, one definition
  // shared with the Overview rails.
  const onTarget = nutrition?.onTarget ?? 0;
  const nutritionDenominator = periodDays ?? 0;
  const hasNutrition = nutrition !== null && nutritionDenominator > 0;
  const nutritionPct = nutrition?.pct ?? null;
  const nutritionAccent: Accent =
    !hasNutrition || nutritionPct === null ? "neutral" :
    nutritionPct >= 80 ? "success" :
    nutritionPct >= 50 ? "warning" : "destructive";

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
      label: "Nutrition",
      value: hasNutrition ? `${onTarget}/${nutritionDenominator}` : "--",
      valueMuted: !hasNutrition,
      delta: hasNutrition && nutritionPct !== null ? {
        text: `${nutritionPct}%`,
        type: nutritionPct >= 80 ? "positive" : nutritionPct >= 50 ? "neutral" : "negative",
      } : undefined,
      subText: hasNutrition ? "days on target" : "No nutrition logs",
      accent: nutritionAccent,
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
              <span className="text-[10px] text-[rgba(255,255,255,0.3)]">{card.unit}</span>
            )}
          </div>
          {/* Every delta is a numeral (a signed value or a percentage), so mono
              is unconditional — it used to be spelled as "not the Calories
              cell", whose delta was the word HIT. Sub-lines are words ("vs
              previous week", "days on target", "adherence") and so are never
              mono: the rule is numerals only. */}
          {(card.delta || card.subText) && (
            <div className="flex items-center gap-1.5 mt-1">
              {card.delta && (
                <span className={cn("text-[11px] font-medium", MONO, deltaTextClass(card.delta.type))}>
                  {card.delta.text}
                </span>
              )}
              {card.subText && (
                <span className="text-[10px] text-[rgba(255,255,255,0.3)]">{card.subText}</span>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
