import { supabaseAdmin } from "./supabase-admin";
import type { Client, ClientCheckInConfig } from "@/types/check-in";
import type { CreateClientInput, UpdateClientInput, UpdateCheckInConfigInput } from "@/lib/validations/client";

// Extended client type with check-in info
export type ClientWithCheckInInfo = Client & {
  lastCheckInDate?: string;
  engagement?: "high" | "medium" | "low";
};

// Helper function to calculate engagement level from last check-in date
const calculateEngagement = (lastCheckInDate: string | null): "high" | "medium" | "low" => {
  if (!lastCheckInDate) return "low";

  const now = new Date();
  const lastCheckIn = new Date(lastCheckInDate);
  const daysSinceLastCheckIn = Math.floor((now.getTime() - lastCheckIn.getTime()) / (1000 * 60 * 60 * 24));

  if (daysSinceLastCheckIn < 7) return "high";
  if (daysSinceLastCheckIn < 14) return "medium";
  return "low";
};

// Helper function to map database row to Client type
const mapDatabaseRowToClient = (row: any): Client => ({
  id: row.id,
  coachId: row.coach_id,
  name: row.name,
  email: row.email,
  avatarUrl: row.avatar_url,
  notes: row.notes,
  active: row.active,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  height: row.height,
  heightUnit: row.height_unit,
  gender: row.gender,
  dateOfBirth: row.date_of_birth,
  goalWeight: row.goal_weight,
  goalBodyFatPercentage: row.goal_body_fat_percentage,
  weightUnit: row.weight_unit,
  currentWeight: row.current_weight,
  currentBodyFatPercentage: row.current_body_fat_percentage,
  bmr: row.bmr,
  tdee: row.tdee,
  checkInFrequency: row.check_in_frequency,
  checkInFrequencyDays: row.check_in_frequency_days,
  expectedCheckInDay: row.expected_check_in_day,
  lastReminderSentAt: row.last_reminder_sent_at,
  reminderPreferences: row.reminder_preferences,
  totalCheckInsExpected: row.total_check_ins_expected,
  totalCheckInsCompleted: row.total_check_ins_completed,
  checkInAdherenceRate: row.check_in_adherence_rate,
  currentStreak: row.current_streak,
  longestStreak: row.longest_streak,
  // Nutrition fields
  unitPreference: row.unit_preference,
  workActivityLevel: row.work_activity_level,
  trainingVolumeHours: row.training_volume_hours,
  proteinTargetGPerKg: row.protein_target_g_per_kg,
  dietType: row.diet_type,
  goalDeadline: row.goal_deadline,
  nutritionPlanCreatedDate: row.nutrition_plan_created_date,
  nutritionPlanBaseWeightKg: row.nutrition_plan_base_weight_kg,
  calorieTarget: row.calorie_target,
  proteinTargetG: row.protein_target_g,
  carbTargetG: row.carb_target_g,
  fatTargetG: row.fat_target_g,
  customMacrosEnabled: row.custom_macros_enabled,
  customProteinG: row.custom_protein_g,
  customCarbG: row.custom_carb_g,
  customFatG: row.custom_fat_g,
});

// Create a new client
export const createClient = async (
  coachId: string,
  clientData: CreateClientInput
): Promise<Client> => {
  const { data, error} = await (supabaseAdmin as any)
    .from("clients")
    .insert({
      coach_id: coachId,
      name: clientData.name,
      email: clientData.email,
      notes: clientData.notes || null,
      height: clientData.height || null,
      height_unit: clientData.heightUnit || "in",
      gender: clientData.gender || null,
      goal_weight: clientData.goalWeight || null,
      goal_body_fat_percentage: clientData.goalBodyFatPercentage || null,
      weight_unit: clientData.weightUnit || "lbs",
      current_weight: clientData.currentWeight || null,
      current_body_fat_percentage: clientData.currentBodyFatPercentage || null,
      active: true,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error("A client with this email already exists");
    }
    throw new Error(`Failed to create client: ${error.message}`);
  }

  return mapDatabaseRowToClient(data);
};

// Get all clients for a coach with last check-in info
export const getClientsForCoach = async (
  coachId: string
): Promise<ClientWithCheckInInfo[]> => {
  // Use a single query with relational syntax to fetch clients with their latest check-in
  // This avoids the N+1 query problem
  const { data: clients, error: clientsError } = await supabaseAdmin
    .from("clients")
    .select(`
      *,
      check_ins!client_id (
        created_at
      )
    `)
    .eq("coach_id", coachId)
    .order("created_at", { ascending: false });

  if (clientsError) {
    throw new Error(`Failed to fetch clients: ${clientsError.message}`);
  }

  if (!clients || clients.length === 0) {
    return [];
  }

  // Transform clients with check-in info
  return clients.map((client: any) => {
    // Get the most recent check-in date
    const checkIns = client.check_ins || [];
    const sortedCheckIns = checkIns.sort((a: any, b: any) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    const lastCheckInDate = sortedCheckIns[0]?.created_at;

    return {
      ...mapDatabaseRowToClient(client),
      lastCheckInDate: lastCheckInDate || undefined,
      engagement: calculateEngagement(lastCheckInDate || null),
    };
  });
};

// Get a single client by ID
export const getClientById = async (clientId: string): Promise<Client | null> => {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .select("*")
    .eq("id", clientId)
    .single();

  if (error || !data) {
    return null;
  }

  return mapDatabaseRowToClient(data);
};

// Update a client
export const updateClient = async (
  clientId: string,
  clientData: UpdateClientInput
): Promise<Client> => {
  const updateData: any = {
    updated_at: new Date().toISOString(),
  };

  if (clientData.name !== undefined) updateData.name = clientData.name;
  if (clientData.email !== undefined) updateData.email = clientData.email;
  if (clientData.notes !== undefined) updateData.notes = clientData.notes || null;
  if (clientData.active !== undefined) updateData.active = clientData.active;
  if (clientData.height !== undefined) updateData.height = clientData.height || null;
  if (clientData.heightUnit !== undefined) updateData.height_unit = clientData.heightUnit;
  if (clientData.gender !== undefined) updateData.gender = clientData.gender || null;
  if (clientData.goalWeight !== undefined) updateData.goal_weight = clientData.goalWeight || null;
  if (clientData.goalBodyFatPercentage !== undefined) updateData.goal_body_fat_percentage = clientData.goalBodyFatPercentage || null;
  if (clientData.weightUnit !== undefined) updateData.weight_unit = clientData.weightUnit;
  if (clientData.currentWeight !== undefined) updateData.current_weight = clientData.currentWeight || null;
  if (clientData.currentBodyFatPercentage !== undefined) updateData.current_body_fat_percentage = clientData.currentBodyFatPercentage || null;

  const { data, error } = await (supabaseAdmin as any)
    .from("clients")
    .update(updateData)
    .eq("id", clientId)
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error("A client with this email already exists");
    }
    throw new Error(`Failed to update client: ${error.message}`);
  }

  return mapDatabaseRowToClient(data);
};

// Delete a client (soft delete - set active to false)
export const deleteClient = async (clientId: string): Promise<void> => {
  const { error } = await (supabaseAdmin as any)
    .from("clients")
    .update({
      active: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", clientId);

  if (error) {
    throw new Error(`Failed to delete client: ${error.message}`);
  }
};

// Permanently delete a client (use with caution)
export const permanentlyDeleteClient = async (clientId: string): Promise<void> => {
  const { error } = await supabaseAdmin
    .from("clients")
    .delete()
    .eq("id", clientId);

  if (error) {
    throw new Error(`Failed to permanently delete client: ${error.message}`);
  }
};

// Update client check-in configuration
export const updateClientCheckInConfig = async (
  clientId: string,
  config: UpdateCheckInConfigInput
): Promise<Client> => {
  const updateData: any = {
    check_in_frequency: config.checkInFrequency,
    check_in_frequency_days: config.checkInFrequencyDays || null,
    expected_check_in_day: config.expectedCheckInDay || null,
    reminder_preferences: config.reminderPreferences,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await (supabaseAdmin as any)
    .from("clients")
    .update(updateData)
    .eq("id", clientId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update check-in config: ${error.message}`);
  }

  return mapDatabaseRowToClient(data);
};
