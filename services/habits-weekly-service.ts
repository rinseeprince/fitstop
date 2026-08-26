import { supabaseAdmin } from "./supabase-admin";
import { getTrainingWeekDays } from "@/lib/date-helpers";
import { getTodayDateString, getDateDaysFrom, getDateString } from "@/lib/date-helpers";
import type { WeeklyHabitRow, WeeklyHabitDay, WeeklyHabitDayStatus, WeekSummary, WeeklyHabitsResponse } from "@/types/history";

const STREAK_LOOKBACK_DAYS = 90;

type HabitRecord = {
  id: string;
  name: string;
  is_boolean: boolean;
  target_value: number | null;
  target_unit: string | null;
  created_at: string;
  effective_date: string;
};

type LogRecord = {
  date: string;
  daily_habit_id: string;
  completed: boolean;
  value: number | null;
};

/**
 * Fetches weekly habit data for a coaching week, including per-day status,
 * weekly rates, and an all-habits streak.
 *
 * Uses supabaseAdmin: coach querying client data (RLS exception 3)
 */
export async function getWeeklyHabitsData(
  clientId: string,
  weekStart: string,
  checkInDay?: string | null,
  // Viewer-local today (the coach route passes coach-local); marks day
  // statuses and bounds the streak window. Server UTC is only the fallback.
  todayAnchor?: string
): Promise<WeeklyHabitsResponse> {
  const weekDays = getTrainingWeekDays(weekStart, checkInDay);
  const today = todayAnchor ?? getTodayDateString();

  // Query 1: Active habits sorted by sort_order
  const { data: habitsData, error: habitsError } = await supabaseAdmin
    .from("daily_habits")
    .select("id, name, is_boolean, target_value, target_unit, created_at, effective_date")
    .eq("client_id", clientId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (habitsError) {
    throw new Error(`Failed to fetch habits: ${habitsError.message}`);
  }

  const habits: HabitRecord[] = habitsData || [];

  if (habits.length === 0) {
    return {
      habits: [],
      summary: { todayCompleted: 0, todayTotal: 0, weeklyRate: 0, activeCount: 0, allHabitsStreak: 0 },
      weekDays,
    };
  }

  // Query 2: Logs for the 7 coaching-week dates
  const { data: weekLogs, error: weekLogsError } = await supabaseAdmin
    .from("daily_habit_logs")
    .select("date, daily_habit_id, completed, value")
    .eq("client_id", clientId)
    .in("date", weekDays);

  if (weekLogsError) {
    throw new Error(`Failed to fetch week logs: ${weekLogsError.message}`);
  }

  // Query 3: Logs for streak calculation (up to 90 days back from today —
  // anchored to the same viewer-local today as the walk, or a maximal streak
  // loses its earliest fetched day across a UTC/viewer day boundary)
  const streakStart = getDateDaysFrom(new Date(today + "T00:00:00"), -(STREAK_LOOKBACK_DAYS - 1));
  const { data: streakLogs, error: streakError } = await supabaseAdmin
    .from("daily_habit_logs")
    .select("date, daily_habit_id, completed, value")
    .eq("client_id", clientId)
    .gte("date", streakStart)
    .lte("date", today);

  if (streakError) {
    throw new Error(`Failed to fetch streak logs: ${streakError.message}`);
  }

  // Build lookup: date -> habitId -> log
  const weekLogMap = buildLogMap(weekLogs || []);

  // Pivot into rows
  const habitRows = buildHabitRows(habits, weekDays, weekLogMap, today);

  // Compute summary
  const summary = buildSummary(habits, habitRows, weekDays, weekLogMap, today, streakLogs || []);

  return { habits: habitRows, summary, weekDays };
}

function buildLogMap(logs: LogRecord[]): Map<string, Map<string, LogRecord>> {
  const map = new Map<string, Map<string, LogRecord>>();
  for (const log of logs) {
    let dateMap = map.get(log.date);
    if (!dateMap) {
      dateMap = new Map();
      map.set(log.date, dateMap);
    }
    dateMap.set(log.daily_habit_id, log);
  }
  return map;
}

function getDayStatus(
  date: string,
  habitEffectiveDate: string,
  log: LogRecord | undefined,
  today: string
): WeeklyHabitDayStatus {
  // Habit starts tracking on its effective date
  if (habitEffectiveDate > date) return "not-tracked";
  // Future date
  if (date > today) return "future";
  // Has a completed log
  if (log?.completed) return "completed";
  // Today but not completed yet
  if (date === today) return "pending";
  // Past date, not completed
  return "missed";
}

function buildHabitRows(
  habits: HabitRecord[],
  weekDays: string[],
  logMap: Map<string, Map<string, LogRecord>>,
  today: string
): WeeklyHabitRow[] {
  return habits.map((habit) => {
    let eligible = 0;
    let completed = 0;

    const days: WeeklyHabitDay[] = weekDays.map((date) => {
      const log = logMap.get(date)?.get(habit.id);
      const status = getDayStatus(date, habit.effective_date, log, today);

      if (status !== "future" && status !== "not-tracked") {
        eligible++;
        if (status === "completed") completed++;
      }

      return {
        date,
        completed: log?.completed ?? false,
        value: log?.value ?? null,
        status,
      };
    });

    const weeklyRate = eligible > 0 ? Math.round((completed / eligible) * 100) : 0;

    return {
      habitId: habit.id,
      habitName: habit.name,
      isBoolean: habit.is_boolean,
      targetValue: habit.target_value,
      targetUnit: habit.target_unit,
      days,
      weeklyRate,
    };
  });
}

function buildSummary(
  habits: HabitRecord[],
  habitRows: WeeklyHabitRow[],
  weekDays: string[],
  _logMap: Map<string, Map<string, LogRecord>>,
  today: string,
  streakLogs: LogRecord[]
): WeekSummary {
  // Today stats
  let todayCompleted = 0;
  let todayTotal = 0;
  for (const row of habitRows) {
    const todayDay = row.days.find((d) => d.date === today);
    if (todayDay && todayDay.status !== "not-tracked" && todayDay.status !== "future") {
      todayTotal++;
      if (todayDay.status === "completed") todayCompleted++;
    }
  }

  // Aggregate weekly rate
  let totalEligible = 0;
  let totalCompleted = 0;
  for (const row of habitRows) {
    for (const day of row.days) {
      if (day.status !== "future" && day.status !== "not-tracked") {
        totalEligible++;
        if (day.status === "completed") totalCompleted++;
      }
    }
  }
  const weeklyRate = totalEligible > 0 ? Math.round((totalCompleted / totalEligible) * 100) : 0;

  // All-habits streak
  const allHabitsStreak = calculateAllHabitsStreak(habits, streakLogs, today);

  return {
    todayCompleted,
    todayTotal,
    weeklyRate,
    activeCount: habits.length,
    allHabitsStreak,
  };
}

function calculateAllHabitsStreak(
  habits: HabitRecord[],
  logs: LogRecord[],
  today: string
): number {
  if (habits.length === 0) return 0;

  // Build log lookup: date -> Set of completed habit IDs
  const completedByDate = new Map<string, Set<string>>();
  for (const log of logs) {
    if (!log.completed) continue;
    let set = completedByDate.get(log.date);
    if (!set) {
      set = new Set();
      completedByDate.set(log.date, set);
    }
    set.add(log.daily_habit_id);
  }

  let streak = 0;
  const checkDate = new Date(today + "T00:00:00");

  for (let i = 0; i < STREAK_LOOKBACK_DAYS; i++) {
    const dateStr = getDateString(checkDate);
    const activeOnDate = habits.filter((h) => h.effective_date <= dateStr);

    if (activeOnDate.length === 0) break;

    const completedSet = completedByDate.get(dateStr);
    const allCompleted = activeOnDate.every((h) => completedSet?.has(h.id));

    if (!allCompleted) break;

    streak++;
    checkDate.setDate(checkDate.getDate() - 1);
  }

  return streak;
}
