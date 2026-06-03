import { supabaseAdmin } from "./supabase-admin";
import type {
  CheckIn,
  CheckInSessionCompletion,
  CheckInExerciseHighlight,
  CheckInWithDetails,
  DayOfWeek,
} from "@/types/check-in";
import type { CheckInExerciseHighlightRow } from "@/lib/database-helpers";
import { getCheckInById } from "./check-in-service";
import { getTrainingEventDetailsForPeriod } from "./check-in-context-service";
import { calculateCheckInPeriod } from "@/lib/date-helpers";
import { getClientById } from "./client-service";

const DAY_OF_WEEK_BY_INDEX: DayOfWeek[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

// Derive the day-of-week label from a YYYY-MM-DD date string. Parsed at local
// noon so the day is stable across DST boundaries (the same convention used
// elsewhere in the check-in UI for period day rendering).
const dayOfWeekFromDate = (date: string): DayOfWeek => {
  const d = new Date(`${date}T12:00:00`);
  return DAY_OF_WEEK_BY_INDEX[d.getDay()];
};

/**
 * Derive per-session training completions for a check-in directly from the spine
 * (`training_events` + `session_logs`) — the legacy completions table was dropped
 * in Session 6.4 (migration 098); there is no backing table anymore. The window
 * is the check-in's STORED `period_start`/`period_end` (migration 038); only legacy
 * pre-038 rows (both null) fall back to recomputing the period from the client's
 * expected check-in day. We NEVER recompute a today-relative window for a
 * historical check-in.
 *
 * The returned shape is the PRESERVED `CheckInSessionCompletion` (camelCase) the
 * UI already reads. `trainingSessionId` may be null (an alt-session swap or an
 * event without a linked session); React keys use `id`/`eventId` instead.
 */
export const deriveSessionCompletionsForCheckIn = async (
  checkIn: CheckIn
): Promise<CheckInSessionCompletion[]> => {
  let periodStart = checkIn.periodStart;
  let periodEnd = checkIn.periodEnd;

  // Legacy fallback ONLY when the stored period is missing (pre-038 rows). The
  // window is derived from the check-in's OWN createdAt date, never "today".
  if (!periodStart || !periodEnd) {
    const client = await getClientById(checkIn.clientId);
    if (client?.expectedCheckInDay) {
      const period = calculateCheckInPeriod(
        new Date(checkIn.createdAt),
        client.expectedCheckInDay
      );
      periodStart = period.periodStart;
      periodEnd = period.periodEnd;
    }
  }

  if (!periodStart || !periodEnd) {
    return [];
  }

  const details = await getTrainingEventDetailsForPeriod(
    checkIn.clientId,
    periodStart,
    periodEnd
  );

  return details.map((d) => ({
    id: d.eventId,
    checkInId: checkIn.id,
    trainingSessionId: d.trainingSessionId,
    sessionName: d.performedSessionName ?? d.sessionName,
    dayOfWeek: dayOfWeekFromDate(d.date),
    completed: d.status === "completed",
    completionQuality: d.completionQuality,
    notes: d.notes,
  }));
};

// Get exercise highlights for a check-in (public)
export const getCheckInExerciseHighlights = async (
  checkInId: string
): Promise<CheckInExerciseHighlightRow[]> => {
  const { data, error } = await supabaseAdmin
    .from("check_in_exercise_highlights")
    .select("*")
    .eq("check_in_id", checkInId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error fetching exercise highlights:", error.message);
    return [];
  }

  return data || [];
};

// Insert exercise highlights for a check-in
export const insertExerciseHighlights = async (
  checkInId: string,
  highlights: CheckInExerciseHighlight[]
): Promise<void> => {
  const rows = highlights.map((h) => ({
    check_in_id: checkInId,
    exercise_id: h.exerciseId ?? null,
    exercise_name: h.exerciseName,
    highlight_type: h.highlightType,
    details: h.details ?? null,
    weight_value: h.weightValue ?? null,
    weight_unit: h.weightUnit ?? null,
    reps: h.reps ?? null,
  }));

  const { error } = await supabaseAdmin
    .from("check_in_exercise_highlights")
    .insert(rows);

  if (error) {
    throw new Error(`Failed to insert exercise highlights: ${error.message}`);
  }
};

// Map internal row to domain type for exercise highlights
export const mapExerciseHighlight = (
  row: CheckInExerciseHighlightRow
): CheckInExerciseHighlight => ({
  id: row.id,
  checkInId: row.check_in_id,
  exerciseId: row.exercise_id ?? undefined,
  exerciseName: row.exercise_name,
  highlightType: row.highlight_type as CheckInExerciseHighlight["highlightType"],
  details: row.details ?? undefined,
  weightValue: row.weight_value ? parseFloat(String(row.weight_value)) : undefined,
  weightUnit: row.weight_unit as CheckInExerciseHighlight["weightUnit"],
  reps: row.reps ?? undefined,
});

// Get check-in with all related details
export const getCheckInWithDetails = async (
  checkInId: string
): Promise<CheckInWithDetails | null> => {
  const checkIn = await getCheckInById(checkInId);
  if (!checkIn) return null;

  const [sessionCompletions, highlightRows] = await Promise.all([
    deriveSessionCompletionsForCheckIn(checkIn),
    getCheckInExerciseHighlights(checkInId),
  ]);

  return {
    ...checkIn,
    sessionCompletions,
    exerciseHighlights: highlightRows.map(mapExerciseHighlight),
  };
};
