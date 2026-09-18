"use client";

import { CheckCircle2, Activity, Utensils, Flame, TrendingUp, TrendingDown } from "lucide-react";
import type { CheckInTrainingPeriodStats } from "@/types/check-in";
import type { NutritionPeriodSummary } from "@/utils/nutrition-period-summary";

type DailyLogsTrainingSummaryProps = {
  /**
   * The period's training, counted server-side by the ONE summariser
   * (`lib/training-adherence.ts`). Nothing is counted here: this block used to
   * fall back to an aggregation over `training_logs`, a table nothing has
   * written since the Daily Pulse was retired, so the fallback could only ever
   * report zero. `null` on a wire that carries no stats — the figures then read
   * as a dash rather than as nothing done.
   */
  trainingPeriodStats: CheckInTrainingPeriodStats | null;
  /**
   * The period's nutrition figures from the ONE kernel, off the context wire.
   * Rendered as they come: the food log carries no target, so nothing about
   * nutrition can be counted from the client's logs here. Absent on a wire that
   * predates the key — the block is then not shown at all.
   */
  nutritionSummary?: NutritionPeriodSummary | null;
};

export const DailyLogsTrainingSummary = ({
  trainingPeriodStats,
  nutritionSummary = null,
}: DailyLogsTrainingSummaryProps) => {
  const getSessionCompletionColor = (completed: number, total: number) => {
    if (total === 0) return "text-muted-foreground";
    const percentage = completed / total;
    if (percentage >= 1) return "text-success";
    if (percentage >= 0.8) return "text-warning";
    return "text-destructive";
  };

  const getNutritionColor = (hitDays: number, totalDays: number) => {
    if (totalDays === 0) return "text-muted-foreground";
    const percentage = hitDays / totalDays;
    if (percentage >= 0.85) return "text-success";
    if (percentage >= 0.57) return "text-warning";
    return "text-destructive";
  };

  const getSurplusDeficitColor = (surplus: number) => {
    if (Math.abs(surplus) < 100) return "text-success"; // Close to target
    if (surplus > 0) return "text-warning"; // Surplus
    return "text-destructive"; // Deficit
  };

  const getNetCalorieIcon = (surplus: number) => {
    if (surplus > 100) return <TrendingUp className="h-3 w-3" />;
    if (surplus < -100) return <TrendingDown className="h-3 w-3" />;
    return <CheckCircle2 className="h-3 w-3" />;
  };

  const net = nutritionSummary?.netCaloriesOnJudgedDays ?? null;

  return (
    <div className="space-y-4">
      {/* Training Sessions Summary */}
      <div className="p-4 rounded-lg bg-muted/50 space-y-3">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Training Summary</span>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Sessions Completed</span>
            {trainingPeriodStats ? (
              <span className={`text-sm font-semibold ${getSessionCompletionColor(trainingPeriodStats.sessionsCompleted, trainingPeriodStats.sessionsPlanned)}`}>
                {trainingPeriodStats.sessionsCompleted}/{trainingPeriodStats.sessionsPlanned}
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">--</span>
            )}
          </div>

          {/* The figure above counts every session the client logged, so a
              partly completed one is inside it. This row is the breakdown
              beside the number, never a second count — the rows above already
              show which were which. */}
          {trainingPeriodStats && trainingPeriodStats.sessionsPartial > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Of those, partial</span>
              <span className="text-sm font-semibold text-warning">
                {trainingPeriodStats.sessionsPartial}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Nutrition Summary — the kernel's figures, each over its own day set:
          days logged over the period, days on target over the days a target
          was prescribed, the intake average over the logged days and the
          target average over the days that had one. A day with no target is
          in no ratio, so a period with none reads "No targets set", never
          0 of 7 in red. */}
      {nutritionSummary && (
        <div className="p-4 rounded-lg bg-muted/50 space-y-3">
          <div className="flex items-center gap-2">
            <Utensils className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Nutrition Summary</span>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Days Logged</span>
              <span className="text-sm font-semibold">
                {nutritionSummary.loggedDays}/{nutritionSummary.periodDays} days
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Days On Target</span>
              {nutritionSummary.targetedDays > 0 ? (
                <span className={`text-sm font-semibold ${getNutritionColor(nutritionSummary.onTarget, nutritionSummary.targetedDays)}`}>
                  {nutritionSummary.onTarget}/{nutritionSummary.targetedDays} days
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">No targets set</span>
              )}
            </div>

            {nutritionSummary.intakePerLoggedDay && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Average Daily Intake</span>
                  <span className="text-sm font-semibold flex items-center gap-1">
                    <Flame className="h-3 w-3" />
                    {nutritionSummary.intakePerLoggedDay.calories} cal
                  </span>
                </div>

                {nutritionSummary.perJudgedDay && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Average Target</span>
                    <span className="text-sm text-muted-foreground">
                      {nutritionSummary.perJudgedDay.target.calories} cal
                    </span>
                  </div>
                )}
              </div>
            )}

            {net !== null && net !== 0 && (
              <div className="flex items-center justify-between pt-2 border-t">
                <span className="text-sm text-muted-foreground">Weekly Net</span>
                <span className={`text-sm font-semibold flex items-center gap-1 ${getSurplusDeficitColor(net)}`}>
                  {getNetCalorieIcon(net)}
                  {net > 0 ? '+' : ''}{net} cal
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
