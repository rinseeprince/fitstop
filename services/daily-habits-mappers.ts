import type { DailyHabit, DailyHabitLog, HabitLogWithDetails } from "@/types/daily-habit";
import type { Database } from "@/types/database";

type DailyHabitRow = Database["public"]["Tables"]["daily_habits"]["Row"];
type DailyHabitLogRow = Database["public"]["Tables"]["daily_habit_logs"]["Row"];

export type DailyHabitLogWithHabit = DailyHabitLogRow & {
  daily_habits: Pick<DailyHabitRow, 'name' | 'target_value' | 'target_unit' | 'is_boolean' | 'created_at' | 'effective_date'>;
};

export const mapHabitRow = (row: DailyHabitRow): DailyHabit => ({
  id: row.id,
  coachId: row.coach_id,
  clientId: row.client_id,
  name: row.name,
  description: row.description ?? undefined,
  targetValue: row.target_value ?? undefined,
  targetUnit: row.target_unit ?? undefined,
  isBoolean: row.is_boolean,
  isActive: row.is_active,
  sortOrder: row.sort_order,
  effectiveDate: row.effective_date,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const mapHabitLogRow = (row: DailyHabitLogRow): DailyHabitLog => ({
  id: row.id,
  dailyHabitId: row.daily_habit_id,
  clientId: row.client_id,
  date: row.date,
  completed: row.completed,
  value: row.value ?? undefined,
  notes: row.notes ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const mapHabitLogWithDetailsRow = (row: DailyHabitLogWithHabit): HabitLogWithDetails => ({
  id: row.id,
  dailyHabitId: row.daily_habit_id,
  clientId: row.client_id,
  date: row.date,
  completed: row.completed,
  value: row.value ?? undefined,
  notes: row.notes ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  habitName: row.daily_habits.name,
  targetValue: row.daily_habits.target_value ?? undefined,
  targetUnit: row.daily_habits.target_unit ?? undefined,
  isBoolean: row.daily_habits.is_boolean,
  habitCreatedAt: row.daily_habits.created_at,
  habitEffectiveDate: row.daily_habits.effective_date,
});
