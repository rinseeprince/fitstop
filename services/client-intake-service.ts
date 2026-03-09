import { supabaseAdmin } from "@/services/supabase-admin";
import type { ClientIntake, ClientIntakeRow, ClientIntakeInput } from "@/types/client-intake";
import { mapClientIntakeRow } from "@/lib/mappers";
import { intakeStepSchemas, intakeFullSchema } from "@/lib/validations/client-intake";

// Table not yet in generated types — use untyped .from() calls.
// supabaseAdmin is required here because client_intake is not in the
// generated Database type, so a typed server client cannot query it.
// Auth and ownership are enforced at the API route layer; RLS on
// client_intake provides additional defense-in-depth at the DB level.
const db = supabaseAdmin as { from: (table: string) => ReturnType<typeof supabaseAdmin.from> };
const clientsTable = "clients" as const;

// Explicit allowlist of camelCase → snake_case field mappings.
// Prevents arbitrary column names from being written to the DB.
const FIELD_MAP = {
  dateOfBirth: "date_of_birth",
  gender: "gender",
  height: "height",
  currentWeight: "current_weight",
  bodyFatPercentage: "body_fat_percentage",
  workActivityLevel: "work_activity_level",
  primaryGoal: "primary_goal",
  goalDetails: "goal_details",
  targetWeight: "target_weight",
  goalDeadline: "goal_deadline",
  goalDescription: "goal_description",
  motivation: "motivation",
  trainingExperienceLevel: "training_experience_level",
  trainingTimePreference: "training_time_preference",
  trainingLocation: "training_location",
  availableEquipment: "available_equipment",
  daysPerWeek: "days_per_week",
  sessionDurationMinutes: "session_duration_minutes",
  dietaryRequirements: "dietary_requirements",
  cookingFrequency: "cooking_frequency",
  nutritionNotes: "nutrition_notes",
  foodAllergies: "food_allergies",
  dietDescription: "diet_description",
  hasTrackedMacrosBefore: "has_tracked_macros_before",
  mealsPerDay: "meals_per_day",
  biggestNutritionChallenge: "biggest_nutrition_challenge",
  injuriesOrLimitations: "injuries_or_limitations",
  medicalNotes: "medical_notes",
  previousCoachingExperience: "previous_coaching_experience",
  previousCoachingDetails: "previous_coaching_details",
  anythingElse: "anything_else",
} satisfies Partial<Record<keyof ClientIntakeInput, string>>;

/** Custom error class for user-facing validation errors */
export class IntakeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntakeValidationError";
  }
}

/**
 * Create a new intake record for a client
 */
export async function createIntake(clientId: string): Promise<ClientIntake> {
  const { data, error } = await db
    .from("client_intake")
    .insert({ client_id: clientId, status: "pending" })
    .select()
    .single();

  if (error) {
    console.error("Failed to create intake:", error);
    throw new Error("Failed to create intake");
  }
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
    console.error("Failed to get intake:", error);
    throw new Error("Failed to get intake");
  }

  return mapClientIntakeRow(data as ClientIntakeRow);
}

/**
 * Get intake by invitation token (for the invite link flow)
 */
export async function getIntakeByToken(
  token: string
): Promise<ClientIntake | null> {
  const { data: invitation, error: invError } = await db
    .from("client_invitations")
    .select("client_id")
    .eq("token", token)
    .single();

  if (invError || !invitation) return null;

  return getIntake(invitation.client_id as string);
}

/**
 * Save a single step of the intake form.
 * Only allows saving on intakes with status 'pending' or 'in_progress'.
 */
export async function saveIntakeStep(
  clientId: string,
  step: number,
  data: Record<string, unknown>
): Promise<ClientIntake> {
  if (!Number.isInteger(step) || step < 1 || step > 5) {
    throw new IntakeValidationError("Invalid step number.");
  }

  // Validate data against the step schema (bounds verified above)
  const schema = intakeStepSchemas[step - 1];
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new IntakeValidationError(
      `Step ${step} validation failed: ${result.error.issues.map((i) => i.message).join(", ")}`
    );
  }

  // Map validated fields to snake_case using explicit allowlist
  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  const validated = result.data as Record<string, unknown>;
  for (const [key, value] of Object.entries(validated)) {
    if (value !== undefined) {
      const dbColumn = FIELD_MAP[key as keyof typeof FIELD_MAP];
      if (dbColumn) {
        updateData[dbColumn] = value;
      }
    }
  }

  // On step 1, mark as in_progress and set started_at
  if (step === 1) {
    updateData.status = "in_progress";
    updateData.started_at = new Date().toISOString();
  }

  // Only allow saving on pending or in_progress intakes
  const { data: updated, error } = await db
    .from("client_intake")
    .update(updateData)
    .eq("client_id", clientId)
    .in("status", ["pending", "in_progress"])
    .select()
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      throw new IntakeValidationError(
        "Cannot modify this intake. It may already be submitted or reviewed."
      );
    }
    console.error("Failed to save intake step:", error);
    throw new Error("Failed to save step");
  }
  return mapClientIntakeRow(updated as ClientIntakeRow);
}

/**
 * Submit the completed intake
 */
export async function submitIntake(
  clientId: string
): Promise<ClientIntake> {
  const intake = await getIntake(clientId);
  if (!intake) throw new IntakeValidationError("No intake found for this client");

  if (intake.status !== "in_progress") {
    throw new IntakeValidationError("Intake is not in progress and cannot be submitted");
  }

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
    throw new IntakeValidationError(
      `Intake incomplete: ${validation.error.issues.map((i) => i.message).join(", ")}`
    );
  }

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

  if (error) {
    console.error("Failed to submit intake:", error);
    throw new Error("Failed to submit intake");
  }

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

  if (error) {
    console.error("Failed to get pending intakes:", error);
    throw new Error("Failed to get pending intakes");
  }
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

  if (error) {
    console.error("Failed to review intake:", error);
    throw new Error("Failed to review intake");
  }

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

  const { data: client, error: clientError } = await db
    .from(clientsTable)
    .select(
      "current_weight, height, gender, date_of_birth, current_body_fat_percentage, goal_weight, goal_deadline, work_activity_level"
    )
    .eq("id", clientId)
    .single();

  if (clientError || !client) {
    console.error("Failed to fetch client for sync:", clientError);
    throw new Error("Client not found");
  }

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

  if (Object.keys(updates).length > 1) {
    const { error } = await supabaseAdmin
      .from(clientsTable)
      .update(updates)
      .eq("id", clientId);

    if (error) {
      console.error("Failed to sync metrics:", error);
      throw new Error("Failed to sync metrics");
    }
  }
}
