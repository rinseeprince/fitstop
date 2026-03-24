import { supabaseAdmin } from "./supabase-admin";
import type { DailyHabit, DailyHabitInput, DailyHabitLog } from "@/types/daily-habit";
import type { Database } from "@/types/database";
import { getTodayDateString } from "@/lib/date-helpers";
import { mapArrayIndexToSortOrder } from "./daily-habits-logic";

type DailyHabitRow = Database["public"]["Tables"]["daily_habits"]["Row"];
type DailyHabitLogRow = Database["public"]["Tables"]["daily_habit_logs"]["Row"];
type DailyHabitLogWithHabit = DailyHabitLogRow & {
  daily_habits: Pick<DailyHabitRow, 'name' | 'target_value' | 'target_unit' | 'is_boolean' | 'created_at'>;
};

type HabitLogWithDetails = DailyHabitLog & {
  habitName: string;
  targetValue?: number;
  targetUnit?: string;
  isBoolean: boolean;
  habitCreatedAt: string;
};

// Re-export pure logic functions from separate file
export { calculateCompletionRate, calculateCurrentStreak, mapArrayIndexToSortOrder } from "./daily-habits-logic";

// Database functions
export const getClientHabits = async (clientId: string, includeInactive = false): Promise<DailyHabit[]> => {
  let query = supabaseAdmin
    .from("daily_habits")
    .select("*")
    .eq("client_id", clientId);
  
  if (!includeInactive) {
    query = query.eq("is_active", true);
  }
  
  // Order by is_active (true first) and then by sort_order
  query = query.order("is_active", { ascending: false })
    .order("sort_order", { ascending: true });

  const { data, error } = await query;

  if (error) {
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
    throw new Error(`Failed to validate client: ${clientError.message}`);
  }

  if (clientData.coach_id !== coachId) {
    throw new Error("Coach does not own this client");
  }

  // Check if an inactive habit with the same name exists for this client
  const { data: existingHabit, error: existingError } = await supabaseAdmin
    .from("daily_habits")
    .select("*")
    .eq("client_id", clientId)
    .eq("name", data.name)
    .eq("is_active", false)
    .single();

  // If an inactive habit exists, reactivate it instead of creating a new one
  if (existingHabit && !existingError) {
    // Get the next sort order for reactivated habit
    const { data: lastActiveHabit } = await supabaseAdmin
      .from("daily_habits")
      .select("sort_order")
      .eq("client_id", clientId)
      .eq("is_active", true)
      .order("sort_order", { ascending: false })
      .limit(1)
      .single();

    const nextSortOrder = (lastActiveHabit?.sort_order ?? -1) + 1;

    // Update the existing habit to reactivate it and update its fields
    const { data: reactivatedResult, error: updateError } = await supabaseAdmin
      .from("daily_habits")
      .update({
        is_active: true,
        description: data.description,
        target_value: data.targetValue,
        target_unit: data.targetUnit,
        is_boolean: data.isBoolean,
        sort_order: nextSortOrder,
        phase_id: data.phaseId || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingHabit.id)
      .select()
      .single();

    if (updateError) {
      throw new Error(`Failed to reactivate habit: ${updateError.message}`);
    }

    return {
      id: reactivatedResult.id,
      coachId: reactivatedResult.coach_id,
      clientId: reactivatedResult.client_id,
      name: reactivatedResult.name,
      description: reactivatedResult.description ?? undefined,
      targetValue: reactivatedResult.target_value ?? undefined,
      targetUnit: reactivatedResult.target_unit ?? undefined,
      isBoolean: reactivatedResult.is_boolean,
      isActive: reactivatedResult.is_active,
      sortOrder: reactivatedResult.sort_order,
      createdAt: reactivatedResult.created_at,
      updatedAt: reactivatedResult.updated_at,
    };
  }

  // No existing inactive habit found, create a new one
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
    phase_id: data.phaseId || null,
    updated_at: new Date().toISOString(),
  };

  const { data: result, error } = await supabaseAdmin
    .from("daily_habits")
    .insert(habitData)
    .select()
    .single();

  if (error) {
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
  data: Partial<Pick<DailyHabitInput, 'name' | 'description' | 'targetValue' | 'targetUnit' | 'isBoolean'> & { isActive?: boolean }>
): Promise<DailyHabit> => {
  const updateData: Partial<Database["public"]["Tables"]["daily_habits"]["Update"]> = {
    updated_at: new Date().toISOString(),
  };

  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.targetValue !== undefined) updateData.target_value = data.targetValue;
  if (data.targetUnit !== undefined) updateData.target_unit = data.targetUnit;
  if (data.isBoolean !== undefined) updateData.is_boolean = data.isBoolean;
  if (data.isActive !== undefined) updateData.is_active = data.isActive;

  const { data: result, error } = await supabaseAdmin
    .from("daily_habits")
    .update(updateData)
    .eq("id", habitId)
    .select()
    .single();

  if (error) {
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
      daily_habits!inner(name, target_value, target_unit, is_boolean, created_at)
    `)
    .eq("client_id", clientId)
    .gte("date", startDate)
    .lte("date", endDate)
    .order("date", { ascending: true });

  if (error) {
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
    habitCreatedAt: row.daily_habits.created_at,
  }));
};

export const getTodayHabitLogs = async (clientId: string, date?: string): Promise<HabitLogWithDetails[]> => {
  const targetDate = date || getTodayDateString();
  
  const { data, error } = await supabaseAdmin
    .from("daily_habit_logs")
    .select(`
      *,
      daily_habits!inner(name, target_value, target_unit, is_boolean, created_at)
    `)
    .eq("client_id", clientId)
    .eq("date", targetDate);

  if (error) {
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
    habitCreatedAt: row.daily_habits.created_at,
  }));
};

// Re-export getHabitStats from separate stats file
export { getHabitStats } from "./daily-habits-stats";