"use client";

import { cn } from "@/lib/utils";
import {
  MONO,
  STAT_LABEL_DARK_CLASS,
  STAT_VALUE_DARK_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import type { CheckIn, GetCheckInComparisonResponse } from "@/types/check-in";
import { formatDeltaValue, type DeltaInfo } from "./delta-format";
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

  // Comparison line for a progress metric: the delta against the PREVIOUS
  // CHECK-IN when one exists, otherwise the change from the starting value on a
  // first check-in. Returns null when neither is available.
  //
  // A check-in is a periodic report, so it reports against the previous report;
  // a measurement logged in between belongs to the Journey series and is
  // deliberately not consulted here (owner decision, 2026-08-31). The label says
  // "vs last check-in" rather than "vs previous week" because the gap between two
  // check-ins is whatever it is — this cell once read "vs previous week" above a
  // delta measured against a check-in 92 days old.
  const buildComparison = (
    current: number | undefined,
    change: number | undefined,
    startingValue: number | undefined,
    invert: boolean
  ): { label: string; delta: DeltaInfo } | null => {
    if (hasPreviousCheckIn && change !== undefined) {
      return { label: "vs last check-in", delta: formatDeltaValue(change, invert) };
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

  // Training comes from `summariseSessions` — completed (full + PARTIAL) over
  // prescribed. One derivation feeds this cell, the training section and the AI
  // prompt; the stored `check_ins.workouts_completed` counts full only and is
  // deliberately not read here. It is the RN wire's column, and rendering it
  // beside a derived figure is what put "3/5" on this strip above an AI summary
  // saying "completed only 2 out of 5".
  //
  // No fallback to that column when nothing was prescribed: a bare count with no
  // denominator, computed a different way, is not the same statistic.
  const trainingPct = adherence.pct;
  const trainingValue =
    adherence.prescribed > 0 ? `${adherence.completed}/${adherence.prescribed}` : "--";

  // The fraction already says how many of the prescribed sessions were done. What
  // it cannot say is that one of those was only partly completed — so the
  // sub-line qualifies the numerator, names what was skipped, and never reads
  // "All complete" over a missed session.
  const trainingSubText =
    adherence.prescribed === 0
      ? "No sessions prescribed"
      : [
          adherence.partial > 0 ? `${adherence.partial} partial` : null,
          adherence.missed > 0 ? `${adherence.missed} missed` : null,
        ]
          .filter(Boolean)
          .join(" · ") || "All complete";
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
      // No delta: the percentage the fraction already implies was displaced by
      // the breakdown, which says something the fraction cannot. It still drives
      // `trainingAccent`, so 3 of 5 is still amber.
      label: "Training",
      value: trainingValue,
      subText: trainingSubText,
      accent: trainingAccent,
    },
  ];

  return (
    <div className="bg-[#0f2027] rounded-[6px] p-5 grid grid-cols-4">
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
              cell", whose delta was the word HIT. Sub-lines are phrases ("vs
              last check-in", "days on target", "1 partial · 2 missed") and so are
              never mono: the rule is numerals only. */}
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
