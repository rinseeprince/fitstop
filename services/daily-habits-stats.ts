import { supabaseAdmin } from "./supabase-admin";
import type { Database } from "@/types/database";
import { getTodayDateString, getDateDaysAgo } from "@/lib/date-helpers";
import { calculateCompletionRate, calculateCurrentStreak } from "./daily-habits-logic";

type DailyHabitLogRow = Database["public"]["Tables"]["daily_habit_logs"]["Row"];

export type HabitStats = {
  completionRate: number;
  currentStreak: number;
};

/**
 * Get habit statistics for a specific habit.
 * Extracted from daily-habits-service.ts to reduce file size.
 */
export const getHabitStats = async (
  clientId: string,
  habitId: string,
  days: number
): Promise<HabitStats> => {
  const endDate = getTodayDateString();
  const startDate = getDateDaysAgo(days - 1);
  
  const { data, error } = await supabaseAdmin
    .from("daily_habit_logs")
    .select("*")
    .eq("client_id", clientId)
    .eq("daily_habit_id", habitId)
    .gte("date", startDate)
    .lte("date", endDate)
    .order("date", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch habit stats: ${error.message}`);
  }

  const logs = (data || []).map((row: DailyHabitLogRow) => ({
    id: row.id,
    dailyHabitId: row.daily_habit_id,
    clientId: row.client_id,
    date: row.date,
    completed: row.completed,
    value: row.value ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  return {
    completionRate: calculateCompletionRate(logs, days),
    currentStreak: calculateCurrentStreak(logs),
  };
};