import { supabaseAdmin } from "@/services/supabase-admin";
import type { ClientIntake, ClientIntakeRow } from "@/types/client-intake";
import { mapClientIntakeRow } from "@/lib/mappers";
import { getIntake } from "@/services/client-intake-service";
import {
  appendMeasurements,
  getCurrentMeasurements,
} from "@/services/measurements-service";
import { updateGoals } from "@/services/client-goals-service";
import { recalculateClientEnergy } from "@/services/client-energy-service";
import { getTodayDateStringInTimezone } from "@/lib/date-helpers";
import type { MeasurementValues } from "@/lib/measurements/keys";

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
  height: "height",
  gender: "gender",
  date_of_birth: "date of birth",
  goal_weight: "goal weight",
  goal_deadline: "goal deadline",
  goal_body_fat_percentage: "goal body fat",
  work_activity_level: "activity level",
};

const READING_NAMES: Record<keyof MeasurementValues, string> = {
  weight: "weight",
  bodyFat: "body fat",
  waist: "waist",
  hips: "hips",
  chest: "chest",
  arms: "arms",
  thighs: "thighs",
};

/**
 * Sync intake metrics to the client record.
 * Only sets fields that are currently null on the client (does not overwrite),
 * and records the intake's weight and body fat as `intake` readings in the
 * measurement log only when the client has no reading of that metric yet.
 * Returns a list of human-readable field names that were synced.
 */
export async function syncMetricsToClient(
  clientId: string
): Promise<string[]> {
  const intake = await getIntake(clientId);
  if (!intake) throw new Error("No intake found for this client");

  const [{ data: client, error: clientError }, current] = await Promise.all([
    db
      .from("clients")
      .select(
        "height, gender, date_of_birth, goal_weight, goal_body_fat_percentage, goal_deadline, work_activity_level, timezone"
      )
      .eq("id", clientId)
      .single(),
    getCurrentMeasurements(clientId),
  ]);

  if (clientError || !client) {
    console.error("Failed to fetch client for sync:", clientError);
    throw new Error("Client not found");
  }

  // Typed loosely because we conditionally add fields — cast to `as never` at the update site
  const updates: Record<string, string | number | undefined> = {
    updated_at: new Date().toISOString(),
  };

  // "Fill only when the client has no reading" — the guard reads the log's
  // newest reading, the same source every other "where are they now" reader
  // uses, so a client already weighed in cannot be overwritten by a sync.
  const readings: MeasurementValues = {};
  if (current.weight === undefined && intake.currentWeight != null) {
    readings.weight = intake.currentWeight;
  }
  if (current.bodyFat === undefined && intake.bodyFatPercentage != null) {
    readings.bodyFat = intake.bodyFatPercentage;
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
  // Spans all three. This is the list the coach is shown ("Synced: weight,
  // goal weight, goal deadline…"), so a store left out of it would quietly
  // stop reporting fields the sync still writes.
  const syncedFields = [
    ...(Object.keys(readings) as (keyof MeasurementValues)[]).map((k) => READING_NAMES[k]),
    ...[...Object.keys(updates), ...Object.keys(goalUpdates)]
      .filter((k) => k !== "updated_at")
      .map((k) => FIELD_NAME_MAP[k] ?? k),
  ];

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

  // The intake's readings, dated the day the client captured them (the
  // questionnaire's completion, on their calendar), else today. A second
  // statement after the profile UPDATE (CONVENTIONS §2 item 13): if it throws
  // the profile fields stand, the sync reports failure, and a re-run is safe —
  // the guard above sees the fields already filled and only the readings left.
  if (Object.keys(readings).length > 0) {
    const capturedAt = intake.completedAt ? new Date(intake.completedAt) : new Date();
    await appendMeasurements({
      clientId,
      source: "intake",
      recordedOn: getTodayDateStringInTimezone(client.timezone, capturedAt),
      values: readings,
    });
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

  // Recompute the energy pair from the freshly-synced profile (non-blocking).
  // The readings above recompute it themselves when they are the client's
  // newest; this covers height, gender, birth date and activity level, and is
  // idempotent when both ran. It used to write `{ bmr }` alone, leaving TDEE
  // derived from a BMR that no longer existed.
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
