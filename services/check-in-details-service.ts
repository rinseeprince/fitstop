import { supabaseAdmin } from "./supabase-admin";
import type {
  CheckIn,
  CheckInCustomAnswer,
  CheckInCustomAnswerInput,
  CheckInExerciseHighlight,
  CheckInTrainingEventDetail,
  CheckInWithDetails,
} from "@/types/check-in";
import type { CheckInExerciseHighlightRow } from "@/lib/database-helpers";
import { getCheckInById } from "./check-in-service";
import { getTrainingEventDetailsForPeriod } from "./check-in-context-service";
import { calculateCheckInPeriod } from "@/lib/date-helpers";
import { checkInWeekday } from "@/lib/check-in-week";
import { getClientById } from "./client-service";
import { getClientAdherenceForRange } from "./client-adherence-service";
import type { CheckInPeriodAdherence } from "@/types/coach-overview";

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
 * **Training is deliberately NOT on this wire.** The review page counts the
 * period's training itself, from the per-workout detail it already carries,
 * through `summariseTraining` (`lib/training-adherence.ts`) — completed is
 * full + PARTIAL there, while this kernel's training half is full-only. Two
 * numbers from two definitions on one screen is the defect; so the page keeps
 * its own training figure and this returns only what it is replacing.
 */
export const getCheckInPeriodAdherence = async (
  checkIn: CheckIn
): Promise<CheckInPeriodAdherence | null> => {
  const period = await resolveCheckInReportingPeriod(checkIn);
  if (!period) return null;

  const summary = await getClientAdherenceForRange(
    checkIn.clientId,
    period.periodStart,
    period.periodEnd,
    // The week's own last day stands in for "today" here: it only decides which
    // still-scheduled workouts read as missed, and the training half of this
    // summary is deliberately not on this wire.
    period.periodEnd
  );

  return {
    dates: summary.dates,
    loggedDates: summary.loggedDates,
    nutrition: summary.nutrition,
    habits: summary.habits,
  };
};

/**
 * The per-workout training detail for a check-in's own reporting period — the
 * same rows the client's wizard receives, read back for one submitted
 * check-in. There is no stored per-session table: the legacy completions table
 * was dropped in Session 6.4 (migration 098), and the spine
 * (`training_events` + its logs) is the only source.
 *
 * The window comes from `resolveCheckInReportingPeriod`, which is also what the
 * adherence figures use, so the two cannot describe different weeks. Empty when
 * the period cannot be resolved (a legacy row with no stored period and no
 * schedule to anchor a week to).
 */
export const getTrainingEventDetailsForCheckIn = async (
  checkIn: CheckIn
): Promise<CheckInTrainingEventDetail[]> => {
  const period = await resolveCheckInReportingPeriod(checkIn);
  if (!period) {
    return [];
  }

  return getTrainingEventDetailsForPeriod(
    checkIn.clientId,
    period.periodStart,
    period.periodEnd
  );
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

/**
 * Answers to the coach's custom questions for one check-in, in the order the
 * form asked them.
 *
 * The prompt is joined LIVE from `check_in_questions` rather than snapshotted
 * onto the answer: rewording a question relabels every past answer, because it
 * is the same question. A question archived after the fact still resolves —
 * `archived_at` retires it from future forms, not from history.
 */
export const getCheckInAnswers = async (
  checkInId: string
): Promise<CheckInCustomAnswer[]> => {
  const { data, error } = await supabaseAdmin
    .from("check_in_answers")
    .select("question_id, answer, created_at, check_in_questions ( prompt )")
    .eq("check_in_id", checkInId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error fetching check-in answers:", error.message);
    return [];
  }

  type AnswerRow = {
    question_id: string;
    answer: string;
    check_in_questions: { prompt: string } | null;
  };

  return ((data ?? []) as AnswerRow[]).map((row) => ({
    questionId: row.question_id,
    answer: row.answer,
    prompt: row.check_in_questions?.prompt ?? "Question",
  }));
};

/**
 * Write a check-in's custom answers.
 *
 * One multi-row INSERT, and it is NOT swallowed by its caller — unlike
 * `insertExerciseHighlights` above. A silently lost set of typed answers is
 * worse than a visible failure, and the caller records what that leaves behind
 * (see `submitCheckIn`).
 *
 * Blank answers, foreign question ids and duplicates are removed upstream by
 * `applyCheckInForm`; the filter here is the belt, so a future caller that
 * forgets to shape its payload cannot violate the column's CHECK.
 */
export const insertCheckInAnswers = async (
  checkInId: string,
  answers: CheckInCustomAnswerInput[]
): Promise<void> => {
  const rows = answers
    .filter((a) => typeof a.answer === "string" && a.answer.trim() !== "")
    .map((a) => ({
      check_in_id: checkInId,
      question_id: a.questionId,
      answer: a.answer,
    }));

  if (rows.length === 0) return;

  const { error } = await supabaseAdmin.from("check_in_answers").insert(rows);

  if (error) {
    throw new Error(`Failed to save your answers: ${error.message}`);
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

  const [highlightRows, customAnswers] = await Promise.all([
    getCheckInExerciseHighlights(checkInId),
    getCheckInAnswers(checkInId),
  ]);

  return {
    ...checkIn,
    exerciseHighlights: highlightRows.map(mapExerciseHighlight),
    customAnswers,
  };
};
