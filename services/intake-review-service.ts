import { supabaseAdmin } from "@/services/supabase-admin";
import type { ClientIntake, ClientIntakeRow } from "@/types/client-intake";
import { mapClientIntakeRow } from "@/lib/mappers";
import { getIntake } from "@/services/client-intake-service";
import { recordBodyMetrics } from "@/services/body-metrics-service";
import { updateGoals } from "@/services/client-goals-service";

const db = supabaseAdmin;

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
    } as never)
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
    .update(updateData as never)
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
    .from("clients")
    .update({
      onboarding_status: "setup_in_progress",
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", clientId);

  return mapClientIntakeRow(data as unknown as ClientIntakeRow);
}

const FIELD_NAME_MAP: Record<string, string> = {
  current_weight: "weight",
  height: "height",
  gender: "gender",
  date_of_birth: "date of birth",
  current_body_fat_percentage: "body fat",
  goal_weight: "goal weight",
  goal_deadline: "goal deadline",
  goal_body_fat_percentage: "goal body fat",
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
    .from("clients")
    .select(
      "current_weight, starting_weight, height, gender, date_of_birth, current_body_fat_percentage, starting_body_fat_percentage, goal_weight, goal_body_fat_percentage, goal_deadline, work_activity_level, height_unit, weight_unit, unit_preference"
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
  if (client.starting_weight == null && intake.currentWeight != null) {
    updates.starting_weight = intake.currentWeight;
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
  if (
    client.starting_body_fat_percentage == null &&
    intake.bodyFatPercentage != null
  ) {
    updates.starting_body_fat_percentage = intake.bodyFatPercentage;
  }
  if (client.goal_weight == null && intake.targetWeight != null) {
    updates.goal_weight = intake.targetWeight;
  }
  if (client.goal_deadline == null && intake.goalDeadline != null) {
    updates.goal_deadline = intake.goalDeadline;
  }
  if (client.goal_body_fat_percentage == null && intake.goalBodyFatPercentage != null) {
    updates.goal_body_fat_percentage = intake.goalBodyFatPercentage;
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
      .from("clients")
      .update(updates as never)
      .eq("id", clientId);

    if (error) {
      console.error("Failed to sync metrics:", error);
      throw new Error("Failed to sync metrics");
    }
  }

  // Dual-write body metrics (non-blocking)
  if (updates.current_weight !== undefined || updates.current_body_fat_percentage !== undefined) {
    try {
      await recordBodyMetrics({
        clientId,
        weight: updates.current_weight as number | undefined,
        bodyFatPercentage: updates.current_body_fat_percentage as number | undefined,
        weightUnit: updates.weight_unit as string | undefined,
        source: "intake_sync",
      });
    } catch (dualWriteError) {
      console.error("Dual-write to body_metrics failed:", dualWriteError instanceof Error ? dualWriteError.message : "Unknown error");
    }
  }

  // Dual-write goals (non-blocking)
  if (updates.goal_weight !== undefined || updates.goal_body_fat_percentage !== undefined || updates.goal_deadline !== undefined) {
    try {
      await updateGoals(clientId, {
        goalWeight: updates.goal_weight as number | undefined,
        goalBodyFatPercentage: updates.goal_body_fat_percentage as number | undefined,
        goalDeadline: updates.goal_deadline as string | undefined,
      }, "intake");
    } catch (dualWriteError) {
      console.error("Dual-write to client_goals failed:", dualWriteError instanceof Error ? dualWriteError.message : "Unknown error");
    }
  }

  return syncedFields;
}
