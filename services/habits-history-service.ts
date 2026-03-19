import { supabaseAdmin } from "./supabase-admin";
import type { HabitMeta, HabitsHistoryRow } from "@/types/history";

/**
 * Fetches habits history with pivoted rows (one row per date, one column per habit).
 *
 * Uses supabaseAdmin: coach querying client data (RLS exception 3)
 *
 * KNOWN LIMITATION: Habit names and targets reflect their current state, not what
 * they were when logged. If a coach renames a habit, old rows will show the new name.
 * This is acceptable for MVP. A future enhancement will snapshot habit metadata onto
 * log rows (similar to how nutrition targets are snapshotted on daily_logs).
 */
export async function getHabitsHistory(
  clientId: string,
  options: { limit: number; offset: number }
): Promise<{ habits: HabitMeta[]; rows: HabitsHistoryRow[]; total: number }> {
  const { limit, offset } = options;

  // Query 1: Get all habits (active + inactive) for column definitions
  const { data: habitsData, error: habitsError } = await supabaseAdmin
    .from("daily_habits")
    .select("id, name, is_boolean, target_value, target_unit, is_active, created_at")
    .eq("client_id", clientId)
    .order("sort_order", { ascending: true });

  if (habitsError) {
    throw new Error(`Failed to fetch client habits: ${habitsError.message}`);
  }

  const habits: HabitMeta[] = (habitsData || []).map((h) => ({
    id: h.id,
    name: h.name,
    is_boolean: h.is_boolean,
    target_value: h.target_value,
    target_unit: h.target_unit,
    is_active: h.is_active,
    created_at: h.created_at,
  }));

  if (habits.length === 0) {
    return { habits, rows: [], total: 0 };
  }

  // Query 2: Fetch all log dates to compute distinct dates for pagination
  const { data: allDateRows, error: datesError } = await supabaseAdmin
    .from("daily_habit_logs")
    .select("date")
    .eq("client_id", clientId)
    .order("date", { ascending: false });

  if (datesError) {
    throw new Error(`Failed to fetch habit log dates: ${datesError.message}`);
  }

  const allDates = [...new Set((allDateRows || []).map((d) => d.date))];
  const paginatedDates = allDates.slice(offset, offset + limit);

  if (paginatedDates.length === 0) {
    return { habits, rows: [], total: allDates.length };
  }

  // Query 3: Fetch logs for the paginated dates
  const { data: logs, error: logsError } = await supabaseAdmin
    .from("daily_habit_logs")
    .select("date, daily_habit_id, completed, value, notes")
    .eq("client_id", clientId)
    .in("date", paginatedDates);

  if (logsError) {
    throw new Error(`Failed to fetch habit logs: ${logsError.message}`);
  }

  // Pivot: group logs by date into rows
  const habitIds = new Set(habits.map((h) => h.id));
  const dateMap = new Map<string, HabitsHistoryRow>();

  for (const date of paginatedDates) {
    dateMap.set(date, {
      date,
      habits: {},
      total_completed: 0,
      total_habits: 0,
    });
  }

  for (const log of logs || []) {
    const row = dateMap.get(log.date);
    if (!row) continue;
    if (!habitIds.has(log.daily_habit_id)) continue;

    row.habits[log.daily_habit_id] = {
      completed: log.completed,
      value: log.value,
      notes: log.notes,
    };
  }

  // Compute totals per row and copy habit entries to top-level properties
  // so HistoryTable's row[col.key] access pattern works for dynamic columns
  const rows: HabitsHistoryRow[] = paginatedDates.map((date) => {
    const row = dateMap.get(date)!;
    const entries = Object.values(row.habits);
    // Denominator: active habits that existed on this date (unlogged = missed)
    const activeHabitsOnDate = habits.filter(
      (h) => h.is_active && h.created_at <= date
    ).length;
    row.total_habits = activeHabitsOnDate;
    row.total_completed = entries.filter((e) => e.completed).length;
    for (const [habitId, entry] of Object.entries(row.habits)) {
      (row as Record<string, unknown>)[habitId] = entry;
    }
    return row;
  });

  return { habits, rows, total: allDates.length };
}
