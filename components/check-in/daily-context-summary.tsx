"use client";

import type { DailyLog } from "@/types/daily-log";
import type { HabitLogWithDetails } from "@/types/daily-habit";
import { DailyContextCharts } from "./daily-context-charts";
import {
  NUTRITION_ADHERENCE_HIT_THRESHOLD,
  WEEKLY_NUTRITION_HIT_PER_DAY,
  WEEKLY_NUTRITION_PARTIAL_PER_DAY,
} from "@/lib/constants";

interface DailyContextSummaryProps {
  dailyLogs: DailyLog[];
  habitLogs: HabitLogWithDetails[];
  startDate: Date;
  endDate: Date;
}

export const DailyContextSummary = ({
  dailyLogs,
  habitLogs,
  startDate,
  endDate,
}: DailyContextSummaryProps) => {
  // Calculate expected days
  const daysDiff = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const logsCount = dailyLogs.length;
  
  if (logsCount === 0) {
    return null; // Don't show section if no logs
  }

  // Nutrition calculations - weekly totals and per-day breakdown
  const nutritionStats = dailyLogs.reduce((acc, log) => {
    if (log.caloriesConsumed !== undefined && log.targetCalories) {
      acc.totalCalories += log.caloriesConsumed;
      acc.totalTargets += log.targetCalories;
      acc.daysLogged++;

      const diff = log.caloriesConsumed - log.targetCalories;
      if (Math.abs(diff) <= NUTRITION_ADHERENCE_HIT_THRESHOLD) acc.daysOnTarget++;
      else if (diff > 0) acc.daysOver++;
      else acc.daysUnder++;
    }
    return acc;
  }, {
    totalCalories: 0,
    totalTargets: 0,
    daysLogged: 0,
    daysOnTarget: 0,
    daysOver: 0,
    daysUnder: 0,
  });

  // Weekly adherence judgment (scaled thresholds for the period)
  const weeklyCalorieDiff = nutritionStats.totalCalories - nutritionStats.totalTargets;
  const absWeeklyDiff = Math.abs(weeklyCalorieDiff);
  const hitThreshold = WEEKLY_NUTRITION_HIT_PER_DAY * daysDiff;
  const partialThreshold = WEEKLY_NUTRITION_PARTIAL_PER_DAY * daysDiff;
  const weeklyAdherence = nutritionStats.daysLogged === 0
    ? null
    : absWeeklyDiff <= hitThreshold ? "hit"
    : absWeeklyDiff <= partialThreshold ? "partial"
    : "missed";
  const adherencePct = nutritionStats.totalTargets > 0
    ? Math.round((nutritionStats.totalCalories / nutritionStats.totalTargets) * 100)
    : null;

  // Training calculations
  const trainingStats = dailyLogs.reduce((acc, log) => {
    if (log.trainingData?.trainingSessionId) {
      acc.totalSessions++;
      if (log.trainingData.sessionCompleted) acc.completedSessions++;
    }
    
    if (log.trainingData?.activityStatuses) {
      for (const [_, status] of Object.entries(log.trainingData.activityStatuses)) {
        acc.totalActivities++;
        if (status.completed) acc.completedActivities++;
      }
    }
    
    if (log.trainingData?.unplannedActivities) {
      acc.unplannedCount += log.trainingData.unplannedActivities.length;
    }
    
    return acc;
  }, {
    totalSessions: 0,
    completedSessions: 0,
    totalActivities: 0,
    completedActivities: 0,
    unplannedCount: 0,
  });

  // Habit calculations - group by habit and count completions
  const habitStats = habitLogs.reduce((acc, log) => {
    if (!acc[log.dailyHabitId]) {
      // Calculate days the habit existed in the period
      const habitCreatedDate = new Date(log.habitCreatedAt);
      const habitStartDate = habitCreatedDate > startDate ? habitCreatedDate : startDate;
      const daysExisted = Math.floor((endDate.getTime() - habitStartDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      
      acc[log.dailyHabitId] = {
        name: log.habitName,
        completed: 0,
        total: Math.max(1, daysExisted), // At least 1 day
        createdAt: log.habitCreatedAt,
      };
    }
    if (log.completed) acc[log.dailyHabitId].completed++;
    return acc;
  }, {} as Record<string, { name: string; completed: number; total: number; createdAt: string }>);

  return (
    <div className="bg-muted/50 rounded-lg p-4 mb-6">
      <h3 className="text-lg font-semibold text-foreground mb-4">
        Daily Tracking Summary ({logsCount} of {daysDiff} days logged)
      </h3>
      
      <DailyContextCharts
        dailyLogs={dailyLogs}
        startDate={startDate}
        endDate={endDate}
      />
      
      <div className="space-y-3 mt-4">
        {nutritionStats.daysLogged > 0 && (
          <div>
            <h4 className="font-medium text-foreground mb-1">Nutrition</h4>
            <div className="text-sm text-muted-foreground space-y-1">
              <div className="font-medium text-foreground">
                Weekly calories: {nutritionStats.totalCalories.toLocaleString()} / {nutritionStats.totalTargets.toLocaleString()}
                {adherencePct !== null && ` (${adherencePct}%)`}
                {weeklyAdherence && (
                  <span className={`ml-1 uppercase text-xs font-semibold ${
                    weeklyAdherence === "hit" ? "text-success" :
                    weeklyAdherence === "partial" ? "text-warning" :
                    "text-destructive"
                  }`}>
                    {weeklyAdherence}
                  </span>
                )}
              </div>
              <div>
                {nutritionStats.daysOnTarget} of {nutritionStats.daysLogged} days on target
                {nutritionStats.daysOver > 0 && ` | ${nutritionStats.daysOver} day${nutritionStats.daysOver !== 1 ? "s" : ""} over`}
                {nutritionStats.daysUnder > 0 && ` | ${nutritionStats.daysUnder} day${nutritionStats.daysUnder !== 1 ? "s" : ""} under`}
              </div>
            </div>
          </div>
        )}
        
        {trainingStats.totalSessions > 0 && (
          <div>
            <h4 className="font-medium text-foreground mb-1">Training</h4>
            <div className="text-sm text-muted-foreground space-y-1">
              <div>Completed {trainingStats.completedSessions}/{trainingStats.totalSessions} sessions</div>
              {trainingStats.totalActivities > 0 && (
                <div>{trainingStats.completedActivities}/{trainingStats.totalActivities} planned activities completed</div>
              )}
              {trainingStats.unplannedCount > 0 && (
                <div>{trainingStats.unplannedCount} unplanned activities</div>
              )}
            </div>
          </div>
        )}
        
        {Object.keys(habitStats).length > 0 && (
          <div>
            <h4 className="font-medium text-foreground mb-1">Habits</h4>
            <div className="text-sm text-muted-foreground space-y-1">
              {Object.values(habitStats).map((habit, idx) => (
                <div key={idx}>
                  {habit.name}: {habit.completed}/{habit.total} days
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};