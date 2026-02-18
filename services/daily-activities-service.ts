import { supabaseAdmin } from "./supabase-admin";
import type { DailyExternalActivity, DailyExternalActivityInput } from "@/types/daily-activity";
import type { Database } from "@/types/database";

type DailyExternalActivityRow = Database["public"]["Tables"]["daily_external_activities"]["Row"];

export const addActivity = async (
  clientId: string,
  data: DailyExternalActivityInput
): Promise<DailyExternalActivity> => {
  const activityData = {
    client_id: clientId,
    date: data.date,
    activity_name: data.activityName,
    intensity_level: data.intensityLevel,
    duration_minutes: data.durationMinutes,
    estimated_calories: data.estimatedCalories ?? null,
    notes: data.notes ?? null,
    updated_at: new Date().toISOString(),
  };

  const { data: result, error } = await supabaseAdmin
    .from("daily_external_activities")
    .insert(activityData)
    .select()
    .single();

  if (error) {
    console.error("Database operation error:", error);
    throw new Error(`Failed to add activity: ${error.message}`);
  }

  return {
    id: result.id,
    clientId: result.client_id,
    date: result.date,
    activityName: result.activity_name,
    intensityLevel: result.intensity_level as "low" | "moderate" | "vigorous",
    durationMinutes: result.duration_minutes,
    estimatedCalories: result.estimated_calories ?? undefined,
    notes: result.notes ?? undefined,
    createdAt: result.created_at,
    updatedAt: result.updated_at,
  };
};

export const getActivities = async (
  clientId: string,
  date: string
): Promise<DailyExternalActivity[]> => {
  const { data, error } = await supabaseAdmin
    .from("daily_external_activities")
    .select("*")
    .eq("client_id", clientId)
    .eq("date", date)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Database operation error:", error);
    throw new Error(`Failed to fetch activities: ${error.message}`);
  }

  return (data || []).map((row: DailyExternalActivityRow) => ({
    id: row.id,
    clientId: row.client_id,
    date: row.date,
    activityName: row.activity_name,
    intensityLevel: row.intensity_level as "low" | "moderate" | "vigorous",
    durationMinutes: row.duration_minutes,
    estimatedCalories: row.estimated_calories ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
};

export const getActivitiesRange = async (
  clientId: string,
  startDate: string,
  endDate: string
): Promise<DailyExternalActivity[]> => {
  const { data, error } = await supabaseAdmin
    .from("daily_external_activities")
    .select("*")
    .eq("client_id", clientId)
    .gte("date", startDate)
    .lte("date", endDate)
    .order("date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Database operation error:", error);
    throw new Error(`Failed to fetch activities: ${error.message}`);
  }

  return (data || []).map((row: DailyExternalActivityRow) => ({
    id: row.id,
    clientId: row.client_id,
    date: row.date,
    activityName: row.activity_name,
    intensityLevel: row.intensity_level as "low" | "moderate" | "vigorous",
    durationMinutes: row.duration_minutes,
    estimatedCalories: row.estimated_calories ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
};

export const updateActivity = async (
  activityId: string,
  clientId: string,
  data: Partial<DailyExternalActivityInput>
): Promise<DailyExternalActivity> => {
  const { data: existingActivity } = await supabaseAdmin
    .from("daily_external_activities")
    .select("client_id")
    .eq("id", activityId)
    .single();

  if (!existingActivity || existingActivity.client_id !== clientId) {
    throw new Error("Activity not found or access denied");
  }

  const updateData: Partial<Database["public"]["Tables"]["daily_external_activities"]["Update"]> = {
    updated_at: new Date().toISOString(),
  };

  if (data.date !== undefined) updateData.date = data.date;
  if (data.activityName !== undefined) updateData.activity_name = data.activityName;
  if (data.intensityLevel !== undefined) updateData.intensity_level = data.intensityLevel;
  if (data.durationMinutes !== undefined) updateData.duration_minutes = data.durationMinutes;
  if (data.estimatedCalories !== undefined) updateData.estimated_calories = data.estimatedCalories;
  if (data.notes !== undefined) updateData.notes = data.notes;

  const { data: result, error } = await supabaseAdmin
    .from("daily_external_activities")
    .update(updateData)
    .eq("id", activityId)
    .eq("client_id", clientId)
    .select()
    .single();

  if (error) {
    console.error("Database operation error:", error);
    throw new Error(`Failed to update activity: ${error.message}`);
  }

  return {
    id: result.id,
    clientId: result.client_id,
    date: result.date,
    activityName: result.activity_name,
    intensityLevel: result.intensity_level as "low" | "moderate" | "vigorous",
    durationMinutes: result.duration_minutes,
    estimatedCalories: result.estimated_calories ?? undefined,
    notes: result.notes ?? undefined,
    createdAt: result.created_at,
    updatedAt: result.updated_at,
  };
};

export const deleteActivity = async (
  activityId: string,
  clientId: string
): Promise<void> => {
  const { data: existingActivity } = await supabaseAdmin
    .from("daily_external_activities")
    .select("client_id")
    .eq("id", activityId)
    .single();

  if (!existingActivity || existingActivity.client_id !== clientId) {
    throw new Error("Activity not found or access denied");
  }

  const { error } = await supabaseAdmin
    .from("daily_external_activities")
    .delete()
    .eq("id", activityId)
    .eq("client_id", clientId);

  if (error) {
    console.error("Database operation error:", error);
    throw new Error(`Failed to delete activity: ${error.message}`);
  }
};

export const getActivityById = async (
  activityId: string
): Promise<DailyExternalActivity | null> => {
  const { data, error } = await supabaseAdmin
    .from("daily_external_activities")
    .select("*")
    .eq("id", activityId)
    .single();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    clientId: data.client_id,
    date: data.date,
    activityName: data.activity_name,
    intensityLevel: data.intensity_level as "low" | "moderate" | "vigorous",
    durationMinutes: data.duration_minutes,
    estimatedCalories: data.estimated_calories ?? undefined,
    notes: data.notes ?? undefined,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
};