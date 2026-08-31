"use client";

import { cn } from "@/lib/utils";
import { SectionLabel } from "@/components/programs/shared/section-label";
import {
  MONO,
  MONO_META_CLASS,
  TEXT_PRIMARY,
} from "@/components/clients/training/program-builder/builder-tokens";
import type { DailyLog } from "@/types/daily-log";
import type { CheckInPeriodAdherence } from "@/types/coach-overview";
import {
  WEEKLY_NUTRITION_HIT_PER_DAY,
  WEEKLY_NUTRITION_PARTIAL_PER_DAY,
} from "@/lib/constants";

type FullWeekTarget = {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
};

type NutritionSectionProps = {
  dailyLogs: DailyLog[];
  contextStartDate: Date;
  contextEndDate: Date;
  fullWeekTarget?: FullWeekTarget | null;
  /**
   * Server-computed nutrition figures for the period. The pill's fraction is
   * days ON TARGET; the weekly HIT/PARTIAL/MISSED verdict beside it stays
   * locally derived from the kcal totals, because it answers a different
   * question (did the WEEK land near its target) and is already target-based.
   */
  nutrition: CheckInPeriodAdherence["nutrition"] | null;
  /** The period's day count — the DENOMINATOR. Never a locally derived one. */
  periodDays: number | null;
};

export const NutritionSection = ({
  dailyLogs,
  contextStartDate,
  contextEndDate,
  fullWeekTarget,
  nutrition,
  periodDays,
}: NutritionSectionProps) => {
  // The server's own date count wins: it is what the rails and the on-target
  // figure are indexed against, and it resolves differently from a locally
  // derived one on a legacy row. The local span is the fallback for exactly
  // those rows, where there is no server number to prefer.
  const localDays = Math.floor(
    (contextEndDate.getTime() - contextStartDate.getTime()) / (1000 * 60 * 60 * 24)
  ) + 1;
  const daysInPeriod = periodDays ?? localDays;

  const stats = dailyLogs.reduce(
    (acc, log) => {
      if (log.caloriesConsumed !== undefined && log.targetCalories) {
        acc.totalCals += log.caloriesConsumed;
        acc.targetCals += log.targetCalories;
        acc.daysLogged++;
      }
      // Each macro's target is summed over the days that macro was LOGGED, so
      // the bar compares an average with the target that applied on the very
      // days it averages. Summing targets over all seven while the actual
      // covered three compared two different weeks on one bar.
      if (log.proteinG != null) {
        acc.protein += log.proteinG;
        acc.targetProtein += log.targetProteinG ?? 0;
        acc.proteinDays++;
      }
      if (log.carbsG != null) {
        acc.carbs += log.carbsG;
        acc.targetCarbs += log.targetCarbsG ?? 0;
        acc.carbsDays++;
      }
      if (log.fatG != null) {
        acc.fat += log.fatG;
        acc.targetFat += log.targetFatG ?? 0;
        acc.fatDays++;
      }
      return acc;
    },
    {
      totalCals: 0, targetCals: 0, daysLogged: 0,
      protein: 0, carbs: 0, fat: 0,
      proteinDays: 0, carbsDays: 0, fatDays: 0,
      targetProtein: 0, targetCarbs: 0, targetFat: 0,
    }
  );

  if (stats.daysLogged === 0) return null;

  // The TOTAL is the whole period's target: it answers "did they eat what they
  // were supposed to", and a day they skipped is a day they failed to.
  const effectiveTargetCals = fullWeekTarget ? fullWeekTarget.calories : stats.targetCals;

  const weeklyDiff = Math.abs(stats.totalCals - effectiveTargetCals);
  const hitThreshold = WEEKLY_NUTRITION_HIT_PER_DAY * daysInPeriod;
  const partialThreshold = WEEKLY_NUTRITION_PARTIAL_PER_DAY * daysInPeriod;
  const adherence =
    weeklyDiff <= hitThreshold ? "HIT" :
    weeklyDiff <= partialThreshold ? "PARTIAL" : "MISSED";

  const fillPct = effectiveTargetCals > 0 ? Math.min((stats.totalCals / effectiveTargetCals) * 100, 100) : 0;

  // The AVERAGES are over LOGGED days, and that is not an inconsistency with
  // the total above it — the two answer different questions. An adherence
  // figure asks "did you do what you were supposed to", so an unlogged day
  // counts against it. An average asks "what was it typically", and an unlogged
  // day is UNKNOWN, not zero: dividing by days with no data does not make the
  // average smaller, it makes it wrong. Three logged days at ~161g of protein
  // used to render as 69g against a 159g target — a client who was almost
  // exactly on target, shown as having collapsed.
  const avgCal = Math.round(stats.totalCals / stats.daysLogged);
  const perLoggedDay = (total: number, days: number) =>
    days > 0 ? Math.round(total / days) : 0;

  const avgProtein = perLoggedDay(stats.protein, stats.proteinDays);
  const avgCarbs = perLoggedDay(stats.carbs, stats.carbsDays);
  const avgFat = perLoggedDay(stats.fat, stats.fatDays);

  const avgTargetProtein = perLoggedDay(stats.targetProtein, stats.proteinDays);
  const avgTargetCarbs = perLoggedDay(stats.targetCarbs, stats.carbsDays);
  const avgTargetFat = perLoggedDay(stats.targetFat, stats.fatDays);

  const macros = [
    { label: "Protein", actual: avgProtein, target: avgTargetProtein, colorClass: "bg-protein" },
    { label: "Carbs", actual: avgCarbs, target: avgTargetCarbs, colorClass: "bg-carbs" },
    { label: "Fats", actual: avgFat, target: avgTargetFat, colorClass: "bg-fat" },
  ];

  return (
    // A flex ITEM, not a grid cell: the page puts this beside its sibling, and
    // either section can return null on an empty week. A null child emits no
    // node, so the survivor takes the full row without the page having to know
    // which one rendered. `min-w-0` stops the mono numerals setting the basis.
    <div className="flex min-w-0 flex-1 flex-col">
      {/* Coverage on the rail, adherence in the pill. How many days the client
          logged food and how many of them landed on target are different
          questions, and the pill had been carrying a coverage fallback only
          because there was nowhere else to put it. */}
      <SectionLabel
        label="Nutrition"
        meta={`${stats.daysLogged} of ${daysInPeriod} days logged`}
      />
      <div className="flex-1 rounded-[6px] bg-white p-5">
        <div className="flex flex-col gap-4">
          {/* Calories */}
          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-baseline">
              <div>
                <div className={cn("text-[28px] font-bold tracking-tight", MONO, TEXT_PRIMARY)}>
                  {stats.totalCals.toLocaleString()}
                </div>
                <div className="text-xs text-[#93b0b4]">
                  of {effectiveTargetCals.toLocaleString()} kcal target
                </div>
              </div>
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-[4px]",
                  MONO,
                  adherence === "HIT"
                    ? "bg-[rgba(13,148,136,0.08)] text-[#0d9488]"
                    : "bg-[rgba(245,158,11,0.07)] text-[#d97706]"
                )}
              >
                {adherence}
                {nutrition ? ` · ${nutrition.onTarget}/${daysInPeriod} on target` : ""}
              </span>
            </div>
            <div className="h-2 bg-[rgba(13,148,136,0.06)] rounded-full overflow-hidden">
              <div
                className="h-full bg-[#0d9488] rounded-full transition-all duration-500"
                style={{ width: `${fillPct}%` }}
              />
            </div>
            <div className="text-[11px] text-[#93b0b4] italic">
              Avg {avgCal.toLocaleString()} kcal / logged day
            </div>
          </div>

          {/* Macros, under the calories they break down */}
          <div className="flex flex-col gap-2.5">
            <div className="text-xs font-medium text-[#5a7d82] mb-0.5">
              Avg macros / logged day
            </div>
            {macros.map((macro) => {
              const pct = macro.target > 0 ? Math.min((macro.actual / macro.target) * 100, 100) : 0;
              return (
                <div key={macro.label} className="flex items-center gap-2.5">
                  <div className="text-xs font-medium text-[#5a7d82] w-14 shrink-0">
                    {macro.label}
                  </div>
                  <div className="flex-1 h-1.5 bg-[rgba(13,148,136,0.06)] rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${macro.colorClass}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className={cn(MONO_META_CLASS, "text-xs w-20 text-right shrink-0")}>
                    {macro.actual}g / {macro.target}g
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
