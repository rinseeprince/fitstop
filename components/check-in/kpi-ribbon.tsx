"use client";

import { motion } from "framer-motion";
import type { CheckIn, GetCheckInComparisonResponse, MetricChange } from "@/types/check-in";
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

type KPIRibbonProps = {
  checkIn: CheckIn;
  dailyLogs: DailyLog[];
  comparisonData: GetCheckInComparisonResponse | null;
  contextStartDate: Date;
  contextEndDate: Date;
  fullWeekTarget?: FullWeekTarget | null;
};

type KPICardData = {
  label: string;
  value: string;
  unit?: string;
  delta?: { text: string; type: "positive" | "negative" | "neutral" };
  subText?: string;
  borderColor: string;
};

function formatDelta(change?: MetricChange, invert = false): KPICardData["delta"] {
  if (!change?.change) return undefined;
  const val = change.change;
  const isPositive = invert ? val < 0 : val > 0;
  const sign = val > 0 ? "+" : "";
  return {
    text: `${sign}${val % 1 === 0 ? val : val.toFixed(1)}`,
    type: val === 0 ? "neutral" : isPositive ? "positive" : "negative",
  };
}

export const KPIRibbon = ({
  checkIn,
  dailyLogs,
  comparisonData,
  contextStartDate,
  contextEndDate,
  fullWeekTarget,
}: KPIRibbonProps) => {
  const changes = comparisonData?.comparison?.changes;
  const daysDiff = Math.floor((contextEndDate.getTime() - contextStartDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

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

  // Use full-week target (logged + plan-based unlogged) when available
  const effectiveTarget = fullWeekTarget ? fullWeekTarget.calories : calStats.target;
  const weeklyDiff = Math.abs(calStats.total - effectiveTarget);
  const hitThreshold = WEEKLY_NUTRITION_HIT_PER_DAY * daysDiff;
  const partialThreshold = WEEKLY_NUTRITION_PARTIAL_PER_DAY * daysDiff;
  const adherenceLabel =
    calStats.daysLogged === 0 ? null :
    weeklyDiff <= hitThreshold ? "HIT" :
    weeklyDiff <= partialThreshold ? "PARTIAL" : "MISSED";

  // Training calculations
  const trainingStats = dailyLogs.reduce(
    (acc, log) => {
      if (log.trainingData?.trainingSessionId) {
        acc.total++;
        if (log.trainingData.sessionCompleted) acc.completed++;
      }
      return acc;
    },
    { total: 0, completed: 0 }
  );

  const trainingPct = trainingStats.total > 0
    ? Math.round((trainingStats.completed / trainingStats.total) * 100)
    : null;

  // Mood average
  // Mood average normalized to full week (unlogged days count as 0)
  const moodVals = dailyLogs.filter((l) => l.mood != null).map((l) => l.mood!);
  const avgMood = moodVals.length > 0
    ? (moodVals.reduce((a, b) => a + b, 0) / daysDiff).toFixed(1)
    : null;

  const cards: KPICardData[] = [
    {
      label: "Weight",
      value: checkIn.weight ? String(checkIn.weight) : "--",
      unit: checkIn.weightUnit || "kg",
      delta: changes?.weight ? formatDelta(changes.weight, true) : undefined,
      subText: changes?.weight ? "vs previous week" : undefined,
      borderColor: "before:bg-success",
    },
    {
      label: "Body Fat",
      value: checkIn.bodyFatPercentage ? String(checkIn.bodyFatPercentage) : "--",
      unit: "%",
      delta: changes?.bodyFatPercentage ? formatDelta(changes.bodyFatPercentage, true) : undefined,
      subText: changes?.bodyFatPercentage ? "vs previous week" : undefined,
      borderColor: "before:bg-success",
    },
    {
      label: "Calories",
      value: calStats.daysLogged > 0 ? calStats.total.toLocaleString() : "--",
      unit: calStats.daysLogged > 0 ? `/ ${effectiveTarget.toLocaleString()}` : undefined,
      delta: adherenceLabel ? {
        text: `${adherenceLabel}`,
        type: adherenceLabel === "HIT" ? "positive" : adherenceLabel === "PARTIAL" ? "neutral" : "negative",
      } : undefined,
      subText: calStats.daysLogged > 0 ? `${calStats.daysLogged}/${daysDiff} days logged` : undefined,
      borderColor: "before:bg-success",
    },
    {
      label: "Training",
      value: trainingStats.total > 0 ? `${trainingStats.completed}/${trainingStats.total}` : checkIn.workoutsCompleted ? String(checkIn.workoutsCompleted) : "--",
      delta: trainingPct !== null ? {
        text: `${trainingPct}%`,
        type: trainingPct >= 80 ? "positive" : trainingPct >= 50 ? "neutral" : "negative",
      } : undefined,
      subText: "adherence",
      borderColor: "before:bg-success",
    },
    {
      label: "Avg Mood",
      value: avgMood || (checkIn.mood ? String(checkIn.mood) : "--"),
      unit: "/5",
      delta: changes?.mood ? formatDelta(changes.mood) : undefined,
      subText: changes?.mood ? "vs previous week" : undefined,
      borderColor: "before:bg-primary",
    },
  ];

  return (
    <div className="grid grid-cols-5 gap-3">
      {cards.map((card, i) => (
        <motion.div
          key={card.label}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.03, duration: 0.2, ease: "easeOut" }}
          className={`bg-card border border-border rounded-lg p-4 relative overflow-hidden before:absolute before:top-0 before:left-0 before:right-0 before:h-[3px] ${card.borderColor}`}
        >
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
            {card.label}
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-[22px] font-bold tracking-tight">
              {card.value}
            </span>
            {card.unit && (
              <span className="text-sm text-muted-foreground font-normal">
                {card.unit}
              </span>
            )}
          </div>
          {(card.delta || card.subText) && (
            <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
              {card.delta && (
                <span
                  className={`text-xs font-medium px-1.5 py-px rounded ${
                    card.delta.type === "positive"
                      ? "bg-success/10 text-success"
                      : card.delta.type === "negative"
                      ? "bg-destructive/10 text-destructive"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {card.delta.text}
                </span>
              )}
              {card.subText && <span>{card.subText}</span>}
            </div>
          )}
        </motion.div>
      ))}
    </div>
  );
};
