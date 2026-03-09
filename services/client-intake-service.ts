import { supabaseAdmin } from "@/services/supabase-admin";
import type { ClientIntake } from "@/types/client-intake";
import { mapClientIntakeRow } from "@/lib/mappers";
import { intakeStepSchemas, intakeFullSchema } from "@/lib/validations/client-intake";

// Table not yet in generated types — cast to any for .from() calls
// Once types/database.ts is regenerated, replace with typed table references
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabaseAdmin as any;
const clientsTable = "clients" as const;

// DB row shape (until types/database.ts is regenerated)
type ClientIntakeRow = {
  id: string;
  client_id: string;
  status: string;
  date_of_birth: string | null;
  gender: string | null;
  height: number | null;
  height_unit: string | null;
  current_weight: number | null;
  weight_unit: string | null;
  body_fat_percentage: number | null;
  work_activity_level: string | null;
  primary_goal: string | null;
  goal_details: string | null;
  target_weight: number | null;
  goal_deadline: string | null;
  goal_description: string | null;
  motivation: string | null;
  training_experience_level: string | null;
  training_time_preference: string | null;
  training_location: string | null;
  available_equipment: string[] | null;
  days_per_week: number | null;
  session_duration_minutes: number | null;
  dietary_requirements: string[] | null;
  cooking_frequency: string | null;
  nutrition_notes: string | null;
  food_allergies: string | null;
  diet_description: string | null;
  has_tracked_macros_before: boolean | null;
  meals_per_day: number | null;
  biggest_nutrition_challenge: string | null;
  injuries_or_limitations: string | null;
  medical_notes: string | null;
  previous_coaching_experience: boolean | null;
  previous_coaching_details: string | null;
  anything_else: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  coach_review_notes: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

/**
 * Create a new intake record for a client
 */
export async function createIntake(clientId: string): Promise<ClientIntake> {
  const { data, error } = await db
    .from("client_intake")
    .insert({ client_id: clientId, status: "pending" })
    .select()
    .single();

  if (error) throw new Error(`Failed to create intake: ${error.message}`);
  return mapClientIntakeRow(data as ClientIntakeRow);
}

/**
 * Get intake for a client (most recent)
 */
export async function getIntake(
  clientId: string
): Promise<ClientIntake | null> {
  const { data, error } = await db
    .from("client_intake")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw new Error(`Failed to get intake: ${error.message}`);
  }

  return mapClientIntakeRow(data as ClientIntakeRow);
}

/**
 * Get intake by invitation token (for the invite link flow)
 */
export async function getIntakeByToken(
  token: string
): Promise<ClientIntake | null> {
  // First find the client via invitation token
  const { data: invitation, error: invError } = await db
    .from("client_invitations")
    .select("client_id")
    .eq("token", token)
    .single();

  if (invError || !invitation) return null;

  return getIntake(invitation.client_id as string);
}

/**
 * Save a single step of the intake form
 */
export async function saveIntakeStep(
  clientId: string,
  step: number,
  data: Record<string, unknown>
): Promise<ClientIntake> {
  // Validate step number
  if (step < 1 || step > 5) {
    throw new Error(`Invalid step number: ${step}. Must be 1-5.`);
  }

  // Validate data against the step schema
  const schema = intakeStepSchemas[step - 1];
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new Error(
      `Validation failed for step ${step}: ${result.error.issues.map((i) => i.message).join(", ")}`
    );
  }

  // Map camelCase fields to snake_case for DB
  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  // Convert validated data keys to snake_case
  const validated = result.data as Record<string, unknown>;
  for (const [key, value] of Object.entries(validated)) {
    if (value !== undefined) {
      updateData[camelToSnake(key)] = value;
    }
  }

  // On step 1, mark as in_progress and set started_at
  if (step === 1) {
    updateData.status = "in_progress";
    updateData.started_at = new Date().toISOString();
  }

  const { data: updated, error } = await db
    .from("client_intake")
    .update(updateData)
    .eq("client_id", clientId)
    .select()
    .single();

  if (error) throw new Error(`Failed to save step ${step}: ${error.message}`);
  return mapClientIntakeRow(updated as ClientIntakeRow);
}

/**
 * Submit the completed intake
 */
export async function submitIntake(
  clientId: string
): Promise<ClientIntake> {
  // Fetch current intake to validate completeness
  const intake = await getIntake(clientId);
  if (!intake) throw new Error("No intake found for this client");

  // Validate all required fields are present
  const fullData = {
    dateOfBirth: intake.dateOfBirth,
    gender: intake.gender,
    height: intake.height,
    currentWeight: intake.currentWeight,
    bodyFatPercentage: intake.bodyFatPercentage,
    primaryGoal: intake.primaryGoal,
    targetWeight: intake.targetWeight,
    goalDeadline: intake.goalDeadline,
    goalDescription: intake.goalDescription,
    motivation: intake.motivation,
    workActivityLevel: intake.workActivityLevel,
    daysPerWeek: intake.daysPerWeek,
    trainingTimePreference: intake.trainingTimePreference,
    trainingLocation: intake.trainingLocation,
    availableEquipment: intake.availableEquipment,
    sessionDurationMinutes: intake.sessionDurationMinutes,
    dietaryRequirements: intake.dietaryRequirements,
    foodAllergies: intake.foodAllergies,
    dietDescription: intake.dietDescription,
    cookingFrequency: intake.cookingFrequency,
    hasTrackedMacrosBefore: intake.hasTrackedMacrosBefore,
    mealsPerDay: intake.mealsPerDay,
    biggestNutritionChallenge: intake.biggestNutritionChallenge,
    injuriesOrLimitations: intake.injuriesOrLimitations,
    trainingExperienceLevel: intake.trainingExperienceLevel,
    previousCoachingExperience: intake.previousCoachingExperience,
    previousCoachingDetails: intake.previousCoachingDetails,
    anythingElse: intake.anythingElse,
  };

  const validation = intakeFullSchema.safeParse(fullData);
  if (!validation.success) {
    throw new Error(
      `Intake incomplete: ${validation.error.issues.map((i) => i.message).join(", ")}`
    );
  }

  // Update intake status
  const { data: updated, error } = await db
    .from("client_intake")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("client_id", clientId)
    .eq("status", "in_progress")
    .select()
    .single();

  if (error) throw new Error(`Failed to submit intake: ${error.message}`);

  // Update client onboarding status
  await db
    .from(clientsTable)
    .update({
      onboarding_status: "intake_completed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", clientId);

  return mapClientIntakeRow(updated as ClientIntakeRow);
}

/**
 * Get all completed but unreviewed intakes for a coach
 */
export async function getCoachPendingIntakes(
  coachId: string
): Promise<ClientIntake[]> {
  const { data, error } = await db
    .from("client_intake")
    .select(
      `
      *,
      client:client_id!inner (
        id,
        coach_id
      )
    `
    )
    .eq("status", "completed")
    .is("reviewed_at", null)
    .eq("client.coach_id", coachId);

  if (error) throw new Error(`Failed to get pending intakes: ${error.message}`);
  return (data || []).map((row: unknown) =>
    mapClientIntakeRow(row as ClientIntakeRow)
  );
}

/**
 * Mark an intake as reviewed by the coach
 */
export async function reviewIntake(
  clientId: string,
  coachId: string,
  notes?: string
): Promise<ClientIntake> {
  const updateData: Record<string, unknown> = {
    status: "reviewed",
    reviewed_at: new Date().toISOString(),
    reviewed_by: coachId,
    updated_at: new Date().toISOString(),
  };

  if (notes !== undefined) {
    updateData.coach_review_notes = notes;
  }

  const { data, error } = await db
    .from("client_intake")
    .update(updateData)
    .eq("client_id", clientId)
    .eq("status", "completed")
    .select()
    .single();

  if (error) throw new Error(`Failed to review intake: ${error.message}`);

  // Update client onboarding status
  await db
    .from(clientsTable)
    .update({
      onboarding_status: "setup_in_progress",
      updated_at: new Date().toISOString(),
    })
    .eq("id", clientId);

  return mapClientIntakeRow(data as ClientIntakeRow);
}

/**
 * Sync intake metrics to the client record.
 * Only sets fields that are currently null on the client (does not overwrite).
 */
export async function syncMetricsToClient(
  clientId: string
): Promise<void> {
  const intake = await getIntake(clientId);
  if (!intake) throw new Error("No intake found for this client");

  // Fetch current client data to check existing values
  const { data: client, error: clientError } = await db
    .from(clientsTable)
    .select(
      "current_weight, height, gender, date_of_birth, current_body_fat_percentage, goal_weight, goal_deadline, work_activity_level"
    )
    .eq("id", clientId)
    .single();

  if (clientError || !client)
    throw new Error("Client not found");

  // Only set fields the client doesn't already have
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (client.current_weight == null && intake.currentWeight != null) {
    updates.current_weight = intake.currentWeight;
  }
  if (client.height == null && intake.height != null) {
    updates.height = intake.height;
  }
  if (client.gender == null && intake.gender != null) {
    updates.gender = intake.gender;
  }
  if (client.date_of_birth == null && intake.dateOfBirth != null) {
    updates.date_of_birth = intake.dateOfBirth;
  }
  if (
    client.current_body_fat_percentage == null &&
    intake.bodyFatPercentage != null
  ) {
    updates.current_body_fat_percentage = intake.bodyFatPercentage;
  }
  if (client.goal_weight == null && intake.targetWeight != null) {
    updates.goal_weight = intake.targetWeight;
  }
  if (client.goal_deadline == null && intake.goalDeadline != null) {
    updates.goal_deadline = intake.goalDeadline;
  }
  if (client.work_activity_level == null && intake.workActivityLevel != null) {
    updates.work_activity_level = intake.workActivityLevel;
  }

  // Only update if there are new fields to set
  if (Object.keys(updates).length > 1) {
    const { error } = await supabaseAdmin
      .from(clientsTable)
      .update(updates)
      .eq("id", clientId);

    if (error)
      throw new Error(`Failed to sync metrics: ${error.message}`);
  }
}

// -------------------------------------------------------
// Internal helper
// -------------------------------------------------------

function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}
