import { supabaseAdmin } from "@/services/supabase-admin";
import type { ClientIntake, ClientIntakeRow } from "@/types/client-intake";
import { mapClientIntakeRow } from "@/lib/mappers";
import { getIntake } from "@/services/client-intake-service";

const db = supabaseAdmin as { from: (table: string) => ReturnType<typeof supabaseAdmin.from> };
const clientsTable = "clients" as const;

/**
 * Save coach review notes without changing the intake status
 */
export async function saveCoachNotes(
  clientId: string,
  notes: string
): Promise<void> {
  const { error } = await db
    .from("client_intake")
    .update({
      coach_review_notes: notes,
      updated_at: new Date().toISOString(),
    })
    .eq("client_id", clientId)
    .in("status", ["completed", "reviewed"]);

  if (error) {
    console.error("Failed to save coach notes:", error);
    throw new Error("Failed to save notes");
  }
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

const FIELD_NAME_MAP: Record<string, string> = {
  current_weight: "weight",
  height: "height",
  gender: "gender",
  date_of_birth: "date of birth",
  current_body_fat_percentage: "body fat",
  goal_weight: "goal weight",
  goal_deadline: "goal deadline",
  work_activity_level: "activity level",
  height_unit: "height unit",
  weight_unit: "weight unit",
  unit_preference: "unit preference",
};

/**
 * Sync intake metrics to the client record.
 * Only sets fields that are currently null on the client (does not overwrite).
 * Returns a list of human-readable field names that were synced.
 */
export async function syncMetricsToClient(
  clientId: string
): Promise<string[]> {
  const intake = await getIntake(clientId);
  if (!intake) throw new Error("No intake found for this client");

  const { data: client, error: clientError } = await db
    .from(clientsTable)
    .select(
      "current_weight, height, gender, date_of_birth, current_body_fat_percentage, goal_weight, goal_deadline, work_activity_level, height_unit, weight_unit, unit_preference"
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
  // Always sync units alongside their metrics — a value without its unit is meaningless
  if (intake.heightUnit != null) {
    updates.height_unit = intake.heightUnit;
  }
  if (intake.weightUnit != null) {
    updates.weight_unit = intake.weightUnit;
  }
  if (intake.weightUnit === "kg" || intake.heightUnit === "cm") {
    updates.unit_preference = "metric";
  } else if (intake.weightUnit || intake.heightUnit) {
    updates.unit_preference = "imperial";
  }

  const syncedFields = Object.keys(updates)
    .filter((k) => k !== "updated_at")
    .map((k) => FIELD_NAME_MAP[k] ?? k);

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

  return syncedFields;
}
