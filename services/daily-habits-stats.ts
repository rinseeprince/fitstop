import { supabaseAdmin } from "./supabase-admin";
import type { Database } from "@/types/database";
import { getTodayDateString, getDateDaysFrom } from "@/lib/date-helpers";
import { calculateCompletionRate, calculateCurrentStreak } from "./daily-habits-logic";

// Window end anchor: callers pass the viewer-local today (the coach stats
// route passes coach-local); server UTC is only the unanchored fallback.
const resolveWindow = (days: number, endDateAnchor?: string) => {
  const endDate = endDateAnchor ?? getTodayDateString();
  const startDate = getDateDaysFrom(new Date(endDate + "T00:00:00"), -(days - 1));
  return { startDate, endDate };
};

type DailyHabitLogRow = Database["public"]["Tables"]["daily_habit_logs"]["Row"];

export type HabitStats = {
  completionRate: number;
  currentStreak: number;
};

/**
 * Get stats for all habits of a client in a single query.
 * Fetches all habit logs in the date window, groups by habit, and computes per-habit stats.
 */
export const getAllHabitStats = async (
  clientId: string,
  habitIds: string[],
  days: number,
  endDateAnchor?: string
): Promise<Record<string, HabitStats>> => {
  if (habitIds.length === 0) return {};

  const { startDate, endDate } = resolveWindow(days, endDateAnchor);

  const { data, error } = await supabaseAdmin
    .from("daily_habit_logs")
    .select("*")
    .eq("client_id", clientId)
    .in("daily_habit_id", habitIds)
    .gte("date", startDate)
    .lte("date", endDate)
    .order("date", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch habit stats: ${error.message}`);
  }

  // Group logs by habit ID
  const logsByHabit = new Map<string, DailyHabitLogRow[]>();
  for (const row of data || []) {
    const existing = logsByHabit.get(row.daily_habit_id) || [];
    existing.push(row);
    logsByHabit.set(row.daily_habit_id, existing);
  }

  // Compute stats per habit
  const result: Record<string, HabitStats> = {};
  for (const habitId of habitIds) {
    const rows = logsByHabit.get(habitId) || [];
    const logs = rows.map((row: DailyHabitLogRow) => ({
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
    result[habitId] = {
      completionRate: calculateCompletionRate(logs, days),
      currentStreak: calculateCurrentStreak(logs, new Date(endDate + "T00:00:00")),
    };
  }

  return result;
};