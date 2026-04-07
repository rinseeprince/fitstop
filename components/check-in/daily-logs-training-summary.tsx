"use client";

import { useMemo } from "react";
import { CheckCircle2, Activity, Utensils, Flame, TrendingUp, TrendingDown } from "lucide-react";
import type { DailyLog } from "@/types/daily-log";
import type { CheckInTrainingContext } from "@/types/check-in";
import { aggregateDailyLogs } from "@/utils/daily-logs-aggregation";

type TrainingPeriodStats = {
  sessionsCompleted: number;
  sessionsPlanned: number;
};

type DailyLogsTrainingSummaryProps = {
  dailyLogs: DailyLog[];
  trainingContext?: CheckInTrainingContext;
  trainingPeriodStats?: TrainingPeriodStats;
  periodDays?: number;
};

export const DailyLogsTrainingSummary = ({ dailyLogs, trainingContext, trainingPeriodStats, periodDays }: DailyLogsTrainingSummaryProps) => {
  const aggregated = useMemo(() => aggregateDailyLogs(dailyLogs), [dailyLogs]);

  // Use session_logs-based stats when available (same source as coach-side hero),
  // fall back to daily_logs aggregation for backward compatibility
  const sessionsCompleted = trainingPeriodStats?.sessionsCompleted ?? aggregated.sessionsCompleted;
  const totalPlannedTrainingSessions = trainingPeriodStats?.sessionsPlanned ?? aggregated.totalPlannedSessions;

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
            <span className={`text-sm font-semibold ${getSessionCompletionColor(sessionsCompleted, totalPlannedTrainingSessions)}`}>
              {sessionsCompleted}/{totalPlannedTrainingSessions}
            </span>
          </div>

          {aggregated.totalPlannedActivities > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Planned Activities</span>
              <span className="text-sm font-semibold">
                {aggregated.plannedActivitiesCompleted}/{aggregated.totalPlannedActivities} completed
              </span>
            </div>
          )}

          {aggregated.unplannedActivitiesCount > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Extra Activities</span>
              <span className="text-sm font-semibold text-success">
                +{aggregated.unplannedActivitiesCount} added
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Nutrition Summary */}
      <div className="p-4 rounded-lg bg-muted/50 space-y-3">
        <div className="flex items-center gap-2">
          <Utensils className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Nutrition Summary</span>
        </div>
        
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Days Logged</span>
            <span className={`text-sm font-semibold ${getNutritionColor(aggregated.nutritionHitDays, periodDays ?? 7)}`}>
              {aggregated.nutritionHitDays}/{periodDays ?? 7} days
            </span>
          </div>

          {aggregated.avgCalories > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Average Daily Intake</span>
                <span className="text-sm font-semibold flex items-center gap-1">
                  <Flame className="h-3 w-3" />
                  {aggregated.avgCalories} cal
                </span>
              </div>
              
              {aggregated.avgTargetCalories > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Average Target</span>
                  <span className="text-sm text-muted-foreground">
                    {aggregated.avgTargetCalories} cal
                  </span>
                </div>
              )}
            </div>
          )}

          {aggregated.totalSurplusDeficit !== 0 && (
            <div className="flex items-center justify-between pt-2 border-t">
              <span className="text-sm text-muted-foreground">Weekly Net</span>
              <span className={`text-sm font-semibold flex items-center gap-1 ${getSurplusDeficitColor(aggregated.totalSurplusDeficit)}`}>
                {getNetCalorieIcon(aggregated.totalSurplusDeficit)}
                {aggregated.totalSurplusDeficit > 0 ? '+' : ''}{aggregated.totalSurplusDeficit} cal
              </span>
            </div>
          )}
        </div>
      </div>

    </div>
  );
};