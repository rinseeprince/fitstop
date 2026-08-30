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
import { checkInWeekday } from "@/lib/check-in-week";
import { getClientById } from "./client-service";
import { getClientAdherenceForRange } from "./client-adherence-service";
import type { CheckInPeriodAdherence } from "@/types/coach-overview";

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
 * The window a check-in REPORTED on: the stored `period_start`/`period_end`
 * (migration 038), else — for legacy pre-038 rows where both are null — a
 * window recomputed from the check-in's OWN `createdAt` and the client's week
 * anchor. Never a today-relative window for a historical check-in.
 *
 * `null` when neither resolves: the row is pre-038 AND the client has no
 * schedule to anchor a week to. Callers render an empty state rather than
 * inventing a period, because any window they picked would be a different week
 * from the one the coach is reading.
 *
 * Extracted so the training derivation and the adherence figures resolve the
 * SAME window. They read different tables; disagreeing about which seven days
 * they cover would be invisible and wrong.
 */
export const resolveCheckInReportingPeriod = async (
  checkIn: CheckIn
): Promise<{ periodStart: string; periodEnd: string } | null> => {
  if (checkIn.periodStart && checkIn.periodEnd) {
    return { periodStart: checkIn.periodStart, periodEnd: checkIn.periodEnd };
  }

  const client = await getClientById(checkIn.clientId);
  if (!client?.nextCheckInDue) return null;

  const period = calculateCheckInPeriod(
    new Date(checkIn.createdAt),
    checkInWeekday(client)
  );
  return { periodStart: period.periodStart, periodEnd: period.periodEnd };
};

/**
 * The nutrition and habit figures for a check-in's own period, from the shipped
 * Overview kernel — one definition of "on target" and "eligible" across both
 * surfaces rather than a second one written into the review's renderers.
 *
 * **Training is deliberately NOT on this wire.** The review page's training
 * figure is `summariseSessions` (full + partial completions); the kernel's is
 * full-only. Both are defensible, but shipping both onto one screen is exactly
 * the two-live-conventions problem this commit exists to remove — so the page
 * keeps its own training number and this returns only what it is replacing.
 */
export const getCheckInPeriodAdherence = async (
  checkIn: CheckIn
): Promise<CheckInPeriodAdherence | null> => {
  const period = await resolveCheckInReportingPeriod(checkIn);
  if (!period) return null;

  const summary = await getClientAdherenceForRange(
    checkIn.clientId,
    period.periodStart,
    period.periodEnd
  );

  return {
    dates: summary.dates,
    nutrition: summary.nutrition,
    habits: summary.habits,
  };
};

/**
 * Derive per-session training completions for a check-in directly from the spine
 * (`training_events` + `session_logs`) — the legacy completions table was dropped
 * in Session 6.4 (migration 098); there is no backing table anymore. The window
 * comes from `resolveCheckInReportingPeriod`, which is also what the adherence
 * figures use, so the two cannot describe different weeks.
 *
 * The returned shape is the PRESERVED `CheckInSessionCompletion` (camelCase) the
 * UI already reads. `trainingSessionId` may be null (an alt-session swap or an
 * event without a linked session); React keys use `id`/`eventId` instead.
 */
export const deriveSessionCompletionsForCheckIn = async (
  checkIn: CheckIn
): Promise<CheckInSessionCompletion[]> => {
  const period = await resolveCheckInReportingPeriod(checkIn);
  if (!period) {
    return [];
  }

  const details = await getTrainingEventDetailsForPeriod(
    checkIn.clientId,
    period.periodStart,
    period.periodEnd
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
  // Canonical kilograms since migration 141 — a constant, not a column.
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
