"use client";

import { useMemo } from "react";
import type { DailyHabit, DailyHabitLog } from "@/types/daily-habit";
import { HabitProgressCard } from "./habit-progress-card";
import { calculateCompletionRate, calculateCurrentStreak } from "@/services/daily-habits-logic";

interface HabitsSectionProps {
  habits: DailyHabit[];
  habitLogs: DailyHabitLog[];
}

interface ProcessedHabitData {
  habit: DailyHabit;
  logs: DailyHabitLog[];
  currentStreak: number;
  completionRate7d: number;
  completionRate30d: number;
  chartData: Array<{ date: string; completed: boolean }>;
}

export function HabitsSection({ habits, habitLogs }: HabitsSectionProps) {
  // Process habit data for display
  const processedHabits = useMemo(() => {
    // Generate last 28 days date range
    const endDate = new Date();
    const startDate = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000);
    const dateRange: string[] = [];
    
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      dateRange.push(new Date(d).toISOString().split('T')[0]);
    }
    
    return habits.map((habit): ProcessedHabitData => {
      // Filter logs for this habit
      const habitSpecificLogs = habitLogs.filter(log => log.dailyHabitId === habit.id);
      
      // Create a map for quick lookup
      const logMap = new Map<string, boolean>();
      habitSpecificLogs.forEach(log => {
        logMap.set(log.date, log.completed);
      });
      
      // Generate chart data for last 28 days
      const chartData = dateRange.map(date => ({
        date,
        completed: logMap.get(date) || false
      }));
      
      // Calculate stats using the imported functions
      const currentStreak = calculateCurrentStreak(habitSpecificLogs);
      
      // Get last 7 days of logs for 7d completion rate
      const last7Days = dateRange.slice(-7);
      const logs7d = habitSpecificLogs.filter(log => last7Days.includes(log.date));
      const completionRate7d = logs7d.length > 0 
        ? Math.round((logs7d.filter(log => log.completed).length / 7) * 100)
        : 0;
      
      // Calculate 30d completion rate
      const completionRate30d = calculateCompletionRate(habitSpecificLogs, 30);
      
      return {
        habit,
        logs: habitSpecificLogs,
        currentStreak,
        completionRate7d,
        completionRate30d,
        chartData
      };
    });
  }, [habits, habitLogs]);
  
  if (habits.length === 0) {
    return null;
  }
  
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">My Habits</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {processedHabits.map((data) => (
          <HabitProgressCard
            key={data.habit.id}
            habit={data.habit}
            chartData={data.chartData}
            currentStreak={data.currentStreak}
            completionRate7d={data.completionRate7d}
            completionRate30d={data.completionRate30d}
          />
        ))}
      </div>
    </div>
  );
}