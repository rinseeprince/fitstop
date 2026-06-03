"use client";

import { motion } from "framer-motion";
import { Utensils } from "lucide-react";
import type { DailyLog } from "@/types/daily-log";
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
};

export const NutritionSection = ({
  dailyLogs,
  contextStartDate,
  contextEndDate,
  fullWeekTarget,
}: NutritionSectionProps) => {
  const daysDiff = Math.floor(
    (contextEndDate.getTime() - contextStartDate.getTime()) / (1000 * 60 * 60 * 24)
  ) + 1;

  const stats = dailyLogs.reduce(
    (acc, log) => {
      if (log.caloriesConsumed !== undefined && log.targetCalories) {
        acc.totalCals += log.caloriesConsumed;
        acc.targetCals += log.targetCalories;
        acc.daysLogged++;
      }
      if (log.proteinG != null) { acc.protein += log.proteinG; acc.proteinDays++; }
      if (log.carbsG != null) { acc.carbs += log.carbsG; acc.carbsDays++; }
      if (log.fatG != null) { acc.fat += log.fatG; acc.fatDays++; }
      if (log.targetProteinG != null) acc.targetProtein += log.targetProteinG;
      if (log.targetCarbsG != null) acc.targetCarbs += log.targetCarbsG;
      if (log.targetFatG != null) acc.targetFat += log.targetFatG;
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

  // Use full-week target (logged + plan-based unlogged) when available
  const effectiveTargetCals = fullWeekTarget ? fullWeekTarget.calories : stats.targetCals;
  const effectiveTargetProtein = fullWeekTarget ? fullWeekTarget.proteinG : stats.targetProtein;
  const effectiveTargetCarbs = fullWeekTarget ? fullWeekTarget.carbsG : stats.targetCarbs;
  const effectiveTargetFat = fullWeekTarget ? fullWeekTarget.fatG : stats.targetFat;

  const weeklyDiff = Math.abs(stats.totalCals - effectiveTargetCals);
  const hitThreshold = WEEKLY_NUTRITION_HIT_PER_DAY * daysDiff;
  const partialThreshold = WEEKLY_NUTRITION_PARTIAL_PER_DAY * daysDiff;
  const adherence =
    weeklyDiff <= hitThreshold ? "HIT" :
    weeklyDiff <= partialThreshold ? "PARTIAL" : "MISSED";

  const fillPct = effectiveTargetCals > 0 ? Math.min((stats.totalCals / effectiveTargetCals) * 100, 100) : 0;
  const dailyAvgCal = Math.round(stats.totalCals / daysDiff);

  // Weekly avg macros (divided by full period, not just logged days)
  const avgProtein = stats.proteinDays > 0 ? Math.round(stats.protein / daysDiff) : 0;
  const avgCarbs = stats.carbsDays > 0 ? Math.round(stats.carbs / daysDiff) : 0;
  const avgFat = stats.fatDays > 0 ? Math.round(stats.fat / daysDiff) : 0;

  // Weekly avg targets — use full-week values divided by period length
  const avgTargetProtein = effectiveTargetProtein > 0 ? Math.round(effectiveTargetProtein / daysDiff) : 0;
  const avgTargetCarbs = effectiveTargetCarbs > 0 ? Math.round(effectiveTargetCarbs / daysDiff) : 0;
  const avgTargetFat = effectiveTargetFat > 0 ? Math.round(effectiveTargetFat / daysDiff) : 0;

  const macros = [
    { label: "Protein", actual: avgProtein, target: avgTargetProtein, colorClass: "bg-protein" },
    { label: "Carbs", actual: avgCarbs, target: avgTargetCarbs, colorClass: "bg-carbs" },
    { label: "Fats", actual: avgFat, target: avgTargetFat, colorClass: "bg-fat" },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: 0.08 }}
      className="bg-white border border-[rgba(13,148,136,0.08)] rounded-[6px] p-5"
    >
      <div className="text-xs font-semibold uppercase tracking-[0.06em] text-[#5a7d82] mb-4 flex items-center gap-2">
        <Utensils className="w-4 h-4" strokeWidth={1.5} />
        Nutrition
      </div>
      <div className="grid grid-cols-2 gap-4">
        {/* Left: Calorie summary */}
        <div className="flex flex-col gap-2">
          <div className="flex justify-between items-baseline">
            <div>
              <div className="text-[28px] font-bold tracking-tight font-mono-display text-[#0c1a1e]">
                {stats.totalCals.toLocaleString()}
              </div>
              <div className="text-xs text-[#93b0b4]">
                of {effectiveTargetCals.toLocaleString()} kcal target
              </div>
            </div>
            <span
              className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-[4px] ${
                adherence === "HIT"
                  ? "bg-[rgba(13,148,136,0.08)] text-[#0d9488]"
                  : "bg-[rgba(245,158,11,0.07)] text-[#d97706]"
              }`}
            >
              {adherence} · {stats.daysLogged}/{daysDiff}
            </span>
          </div>
          <div className="h-2 bg-[rgba(13,148,136,0.06)] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#0d9488] rounded-full transition-all duration-500"
              style={{ width: `${fillPct}%` }}
            />
          </div>
          <div className="text-[11px] text-[#93b0b4] italic">
            Avg {dailyAvgCal.toLocaleString()} kcal / day (full week)
          </div>
        </div>

        {/* Right: Macros */}
        <div className="flex flex-col gap-2.5">
          <div className="text-xs font-medium text-[#5a7d82] mb-0.5">
            Avg macros / day (full week)
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
                <div className="text-xs text-[#93b0b4] w-20 text-right shrink-0 font-mono-display">
                  {macro.actual}g / {macro.target}g
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
};
