import type { DailyHabitLog } from "@/types/daily-habit";
import { getDateString } from "@/lib/date-helpers";

/**
 * Pure logic functions for daily habits.
 * Extracted from daily-habits-service.ts to reduce file size.
 */

// Pure logic functions for testability
export const calculateCompletionRate = (logs: DailyHabitLog[], days: number): number => {
  if (days <= 0) return 0;
  
  const completed = logs.filter(log => log.completed).length;
  return Math.round((completed / days) * 100);
};

export const calculateCurrentStreak = (logs: DailyHabitLog[], today: Date = new Date()): number => {
  if (!logs.length) return 0;
  
  const sortedLogs = [...logs].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  
  let streak = 0;
  const checkDate = new Date(today);
  
  const todayDate = getDateString(checkDate);
  const hasCompletedLogToday = sortedLogs.some(log => log.date === todayDate && log.completed);
  
  // Start from today if completed, otherwise start from yesterday
  if (!hasCompletedLogToday) {
    checkDate.setDate(checkDate.getDate() - 1);
  }
  
  // Count consecutive completed days working backwards
  while (checkDate.getFullYear() >= today.getFullYear() - 1) {
    const logDate = getDateString(checkDate);
    const logForDate = sortedLogs.find(log => log.date === logDate);
    
    // If there's no log for this date OR log exists but not completed, streak ends
    if (!logForDate || !logForDate.completed) {
      break;
    }
    
    streak++;
    checkDate.setDate(checkDate.getDate() - 1);
  }
  
  return streak;
};

export const mapArrayIndexToSortOrder = (habitIds: string[]): { id: string; sortOrder: number }[] => {
  return habitIds.map((id, index) => ({ id, sortOrder: index }));
};