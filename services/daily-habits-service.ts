import { supabaseAdmin } from "./supabase-admin";
import type { DailyHabit, DailyHabitInput, DailyHabitLog, DailyHabitLogInput } from "@/types/daily-habit";
import type { Database } from "@/types/database";
import { getTodayDateString, getDateString, getDateDaysAgo } from "@/lib/date-helpers";

type DailyHabitRow = Database["public"]["Tables"]["daily_habits"]["Row"];
type DailyHabitLogRow = Database["public"]["Tables"]["daily_habit_logs"]["Row"];
type DailyHabitLogWithHabit = DailyHabitLogRow & {
  daily_habits: Pick<DailyHabitRow, 'name' | 'target_value' | 'target_unit' | 'is_boolean'>;
};

type HabitLogWithDetails = DailyHabitLog & {
  habitName: string;
  targetValue?: number;
  targetUnit?: string;
  isBoolean: boolean;
};

type HabitStats = {
  completionRate: number;
  currentStreak: number;
};

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
  let checkDate = new Date(today);
  
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

// Database functions
export const getClientHabits = async (clientId: string): Promise<DailyHabit[]> => {
  const { data, error } = await supabaseAdmin
    .from("daily_habits")
    .select("*")
    .eq("client_id", clientId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("Error fetching client habits:", error);
    throw new Error(`Failed to fetch client habits: ${error.message}`);
  }

  return (data || []).map((row: DailyHabitRow) => ({
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
};

export const createHabit = async (
  coachId: string,
  clientId: string,
  data: DailyHabitInput
): Promise<DailyHabit> => {
  // Validate that coach owns this client
  const { data: clientData, error: clientError } = await supabaseAdmin
    .from("clients")
    .select("coach_id")
    .eq("id", clientId)
    .single();

  if (clientError) {
    console.error("Error validating client:", clientError);
    throw new Error(`Failed to validate client: ${clientError.message}`);
  }

  if (clientData.coach_id !== coachId) {
    throw new Error("Coach does not own this client");
  }

  // Get the next sort order
  const { data: lastHabit } = await supabaseAdmin
    .from("daily_habits")
    .select("sort_order")
    .eq("client_id", clientId)
    .eq("is_active", true)
    .order("sort_order", { ascending: false })
    .limit(1)
    .single();

  const nextSortOrder = (lastHabit?.sort_order ?? -1) + 1;

  const habitData = {
    coach_id: coachId,
    client_id: clientId,
    name: data.name,
    description: data.description,
    target_value: data.targetValue,
    target_unit: data.targetUnit,
    is_boolean: data.isBoolean,
    sort_order: nextSortOrder,
    updated_at: new Date().toISOString(),
  };

  const { data: result, error } = await supabaseAdmin
    .from("daily_habits")
    .insert(habitData)
    .select()
    .single();

  if (error) {
    console.error("Database operation error:", error);
    throw new Error(`Failed to create habit: ${error.message}`);
  }

  return {
    id: result.id,
    coachId: result.coach_id,
    clientId: result.client_id,
    name: result.name,
    description: result.description ?? undefined,
    targetValue: result.target_value ?? undefined,
    targetUnit: result.target_unit ?? undefined,
    isBoolean: result.is_boolean,
    isActive: result.is_active,
    sortOrder: result.sort_order,
    createdAt: result.created_at,
    updatedAt: result.updated_at,
  };
};

export const updateHabit = async (
  habitId: string,
  data: Partial<Pick<DailyHabitInput, 'name' | 'description' | 'targetValue' | 'targetUnit' | 'isBoolean'>>
): Promise<DailyHabit> => {
  const updateData: Partial<Database["public"]["Tables"]["daily_habits"]["Update"]> = {
    updated_at: new Date().toISOString(),
  };

  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.targetValue !== undefined) updateData.target_value = data.targetValue;
  if (data.targetUnit !== undefined) updateData.target_unit = data.targetUnit;
  if (data.isBoolean !== undefined) updateData.is_boolean = data.isBoolean;

  const { data: result, error } = await supabaseAdmin
    .from("daily_habits")
    .update(updateData)
    .eq("id", habitId)
    .select()
    .single();

  if (error) {
    console.error("Database operation error:", error);
    throw new Error(`Failed to update habit: ${error.message}`);
  }

  return {
    id: result.id,
    coachId: result.coach_id,
    clientId: result.client_id,
    name: result.name,
    description: result.description ?? undefined,
    targetValue: result.target_value ?? undefined,
    targetUnit: result.target_unit ?? undefined,
    isBoolean: result.is_boolean,
    isActive: result.is_active,
    sortOrder: result.sort_order,
    createdAt: result.created_at,
    updatedAt: result.updated_at,
  };
};

export const deactivateHabit = async (habitId: string): Promise<void> => {
  const { error } = await supabaseAdmin
    .from("daily_habits")
    .update({ 
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", habitId);

  if (error) {
    console.error("Database operation error:", error);
    throw new Error(`Failed to deactivate habit: ${error.message}`);
  }
};

export const reorderHabits = async (habitIds: string[]): Promise<void> => {
  const sortOrderMappings = mapArrayIndexToSortOrder(habitIds);
  
  // Update sort orders in parallel
  const updatePromises = sortOrderMappings.map(({ id, sortOrder }) =>
    supabaseAdmin
      .from("daily_habits")
      .update({ 
        sort_order: sortOrder,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
  );

  const results = await Promise.all(updatePromises);
  
  const errors = results.filter(result => result.error);
  if (errors.length > 0) {
    throw new Error(`Failed to reorder habits: ${errors[0].error?.message || 'Unknown error'}`);
  }
};

export const logHabit = async (
  habitId: string,
  clientId: string,
  date: string,
  completed: boolean,
  value?: number
): Promise<DailyHabitLog> => {
  const logData = {
    daily_habit_id: habitId,
    client_id: clientId,
    date,
    completed,
    value,
    updated_at: new Date().toISOString(),
  };

  const { data: result, error } = await supabaseAdmin
    .from("daily_habit_logs")
    .upsert(logData, {
      onConflict: "daily_habit_id,date",
    })
    .select()
    .single();

  if (error) {
    console.error("Database operation error:", error);
    throw new Error(`Failed to log habit: ${error.message}`);
  }

  return {
    id: result.id,
    dailyHabitId: result.daily_habit_id,
    clientId: result.client_id,
    date: result.date,
    completed: result.completed,
    value: result.value ?? undefined,
    notes: result.notes ?? undefined,
    createdAt: result.created_at,
    updatedAt: result.updated_at,
  };
};

export const getHabitLogs = async (
  clientId: string,
  startDate: string,
  endDate: string
): Promise<HabitLogWithDetails[]> => {
  const { data, error } = await supabaseAdmin
    .from("daily_habit_logs")
    .select(`
      *,
      daily_habits!inner(name, target_value, target_unit, is_boolean)
    `)
    .eq("client_id", clientId)
    .gte("date", startDate)
    .lte("date", endDate)
    .order("date", { ascending: true });

  if (error) {
    console.error("Database operation error:", error);
    throw new Error(`Failed to fetch habit logs: ${error.message}`);
  }

  return (data || []).map((row: DailyHabitLogWithHabit) => ({
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
  }));
};

export const getTodayHabitLogs = async (clientId: string): Promise<HabitLogWithDetails[]> => {
  const today = getTodayDateString();
  
  const { data, error } = await supabaseAdmin
    .from("daily_habit_logs")
    .select(`
      *,
      daily_habits!inner(name, target_value, target_unit, is_boolean)
    `)
    .eq("client_id", clientId)
    .eq("date", today);

  if (error) {
    console.error("Database operation error:", error);
    throw new Error(`Failed to fetch today's habit logs: ${error.message}`);
  }

  return (data || []).map((row: DailyHabitLogWithHabit) => ({
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
  }));
};

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
    console.error("Database operation error:", error);
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