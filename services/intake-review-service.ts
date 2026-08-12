import { supabaseAdmin } from "@/services/supabase-admin";
import type { ClientIntake, ClientIntakeRow } from "@/types/client-intake";
import { mapClientIntakeRow } from "@/lib/mappers";
import { getIntake } from "@/services/client-intake-service";
import { recordBodyMetrics } from "@/services/body-metrics-service";
import { updateGoals } from "@/services/client-goals-service";
import { recalculateClientEnergy } from "@/services/client-energy-service";

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
    } as never) // TODO: remove as never once client_intake types are regenerated
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
  const updateData: {
    status: string;
    reviewed_at: string;
    reviewed_by: string;
    updated_at: string;
    coach_review_notes?: string;
  } = {
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
    .update(updateData as never) // TODO: remove as never once client_intake types are regenerated
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

  // TODO: remove double-cast once client_intake types are regenerated
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
      "current_weight, starting_weight, height, gender, date_of_birth, current_body_fat_percentage, starting_body_fat_percentage, goal_weight, goal_body_fat_percentage, goal_deadline, work_activity_level"
    )
    .eq("id", clientId)
    .single();

  if (clientError || !client) {
    console.error("Failed to fetch client for sync:", clientError);
    throw new Error("Client not found");
  }

  // Typed loosely because we conditionally add fields — cast to `as never` at the update site
  const updates: Record<string, string | number | undefined> = {
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
  // The goal fields go in their OWN object, which never reaches the `clients`
  // UPDATE below: `updateGoals` owns `client_goals` and the `clients.*` mirror,
  // and a second writer here is what let the two stores disagree. The
  // only-if-currently-null guards are unchanged — they still read the raw mirror
  // columns, which is the right question ("has this client already got one?").
  const goalUpdates: Record<string, string | number | undefined> = {};

  if (client.goal_weight == null && intake.targetWeight != null) {
    goalUpdates.goal_weight = intake.targetWeight;
  }
  if (client.goal_deadline == null && intake.goalDeadline != null) {
    goalUpdates.goal_deadline = intake.goalDeadline;
  }
  if (client.goal_body_fat_percentage == null && intake.goalBodyFatPercentage != null) {
    goalUpdates.goal_body_fat_percentage = intake.goalBodyFatPercentage;
  }
  if (client.work_activity_level == null && intake.workActivityLevel != null) {
    updates.work_activity_level = intake.workActivityLevel;
  }
  // No unit sync any more. The intake values above are already canonical kg/cm
  // (intake-step-1.tsx converts before persisting) and the tag columns are gone
  // with migration 141, so there is no unit to carry alongside them.
  //
  // The unit_preference derivation that used to live here is gone too, and
  // deliberately not replaced: it force-set every approved intake client to
  // metric, because client_intake.weight_unit defaults to 'kg' (034:30) and the
  // intake toggle only ever reached localStorage. Overwriting a client's own
  // display preference from a field they never actually set is not a sync.
  // Spans BOTH objects. This is the list the coach is shown ("Synced: goal
  // weight, goal deadline…"), so splitting the goals out of `updates` without
  // this would quietly stop reporting fields the sync still writes.
  const syncedFields = [...Object.keys(updates), ...Object.keys(goalUpdates)]
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
        // Already kilograms — client_intake stores canonical kg.
        weight: updates.current_weight as number | undefined,
        bodyFatPercentage: updates.current_body_fat_percentage as number | undefined,
        source: "intake_sync",
      });
    } catch (dualWriteError) {
      console.error("Dual-write to body_metrics failed:", dualWriteError instanceof Error ? dualWriteError.message : "Unknown error");
    }
  }

  // Goals are written ONCE, by `updateGoals`, from the object the `clients`
  // UPDATE above never saw. **This throws**: a swallowed failure here left the
  // mirror carrying an intake goal that `client_goals` never received, and the
  // review page reported a successful sync. The metric fields are already
  // committed and are unaffected.
  if (Object.keys(goalUpdates).length > 0) {
    await updateGoals(clientId, {
      goalWeight: goalUpdates.goal_weight as number | undefined,
      goalBodyFatPercentage: goalUpdates.goal_body_fat_percentage as number | undefined,
      goalDeadline: goalUpdates.goal_deadline as string | undefined,
    }, "intake");
  }

  // Recompute the energy pair from the freshly-synced data (non-blocking).
  // This used to write `{ bmr }` alone, leaving TDEE derived from a BMR that no
  // longer existed. The helper reads the row itself, so the getClientById
  // re-fetch that used to sit here is gone.
  try {
    const energy = await recalculateClientEnergy(clientId);
    if (energy.status === "written") {
      syncedFields.push("BMR & TDEE");
    }
  } catch (energyError) {
    console.error("Energy recalculation after sync failed:", energyError instanceof Error ? energyError.message : "Unknown error");
  }

  return syncedFields;
}
