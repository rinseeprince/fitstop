import { supabaseAdmin } from "@/services/supabase-admin";
import type { ClientIntake, ClientIntakeRow, ClientIntakeInput, IntakeStatus, PendingIntakeSummary } from "@/types/client-intake";
import { mapClientIntakeRow } from "@/lib/mappers";
import { intakeStepSchemas, intakeFullSchema } from "@/lib/validations/client-intake";

// supabaseAdmin required: client_intake operations are system-level writes
// from unauthenticated contexts (intake form via token). Auth enforced at API layer.
const db = supabaseAdmin;

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
  goalBodyFatPercentage: "goal_body_fat_percentage",
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

  return getIntake(invitation.client_id);
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
    .update(updateData as never)
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
  return mapClientIntakeRow(updated as unknown as ClientIntakeRow);
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
    } as never)
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
    .from("clients")
    .update({
      onboarding_status: "intake_completed",
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", clientId);

  return mapClientIntakeRow(updated as unknown as ClientIntakeRow);
}

/**
 * Get all pending, in_progress, or completed (unreviewed) intakes for a coach.
 * Returns a lightweight summary for the dashboard banner.
 */
export async function getCoachPendingIntakes(
  coachId: string
): Promise<PendingIntakeSummary[]> {
  const { data, error } = await db
    .from("client_intake")
    .select(
      `
      id,
      client_id,
      status,
      created_at,
      completed_at,
      client:client_id!inner (
        id,
        name,
        email,
        coach_id,
        active
      )
    `
    )
    .in("status", ["pending", "in_progress", "completed"])
    .is("reviewed_at", null)
    .eq("client.coach_id", coachId)
    // Deactivated clients are excluded. Their intake cannot be reviewed —
    // `getClientById` is active-filtered, so the banner's Review link 404s —
    // and counting them made the Clients nav badge (which reads this endpoint)
    // disagree with the roster's own "Ready for review" queue, which drops
    // them into Inactive.
    .eq("client.active", true)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to get pending intakes:", error);
    throw new Error("Failed to get pending intakes");
  }

  type IntakeWithClient = {
    id: string;
    client_id: string;
    status: IntakeStatus;
    created_at: string;
    completed_at: string | null;
    client: {
      id: string;
      name: string;
      email: string;
      coach_id: string;
      active: boolean;
    } | null;
  };

  return ((data || []) as IntakeWithClient[]).map((row) => ({
    id: row.id,
    clientId: row.client_id,
    clientName: row.client?.name ?? "Unknown",
    clientEmail: row.client?.email ?? "",
    status: row.status,
    invitedAt: row.created_at,
    completedAt: row.completed_at ?? undefined,
  }));
}

