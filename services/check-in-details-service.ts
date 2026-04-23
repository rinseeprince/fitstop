import { supabaseAdmin } from "./supabase-admin";
import type {
  CheckInSessionCompletion,
  CheckInExerciseHighlight,
  CheckInWithDetails,
} from "@/types/check-in";
import type {
  CheckInSessionCompletionRow,
  CheckInExerciseHighlightRow,
} from "@/lib/database-helpers";
import { getCheckInById } from "./check-in-service";

// Row type for session completions with joined training_sessions
type SessionCompletionWithSession = CheckInSessionCompletionRow & {
  training_sessions: { name: string; day_of_week: string | null } | null;
};

// Get session completions for a check-in (public, with joined session name)
export const getCheckInSessionCompletions = async (
  checkInId: string
): Promise<SessionCompletionWithSession[]> => {
  const { data, error } = await supabaseAdmin
    .from("check_in_session_completions")
    .select(`
      *,
      training_sessions!inner(name, day_of_week)
    `)
    .eq("check_in_id", checkInId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error fetching session completions:", error.message);
    return [];
  }

  return (data as SessionCompletionWithSession[]) || [];
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

// Insert session completions for a check-in
export const insertSessionCompletions = async (
  checkInId: string,
  completions: CheckInSessionCompletion[]
): Promise<void> => {
  const rows = completions.map((c) => ({
    check_in_id: checkInId,
    training_session_id: c.trainingSessionId,
    completed: c.completed,
    completion_quality: c.completionQuality ?? null,
    notes: c.notes ?? null,
  }));

  const { error } = await supabaseAdmin
    .from("check_in_session_completions")
    .insert(rows);

  if (error) {
    throw new Error(`Failed to insert session completions: ${error.message}`);
  }
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

// Map internal row to domain type for session completions
const mapSessionCompletion = (
  row: SessionCompletionWithSession
): CheckInSessionCompletion => ({
  id: row.id,
  checkInId: row.check_in_id,
  trainingSessionId: row.training_session_id,
  sessionName: row.training_sessions?.name || "Unknown Session",
  dayOfWeek: row.training_sessions?.day_of_week as CheckInSessionCompletion["dayOfWeek"],
  completed: row.completed,
  completionQuality: row.completion_quality as CheckInSessionCompletion["completionQuality"],
  notes: row.notes ?? undefined,
});

// Map internal row to domain type for exercise highlights
const mapExerciseHighlight = (
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

  const [sessionRows, highlightRows] = await Promise.all([
    getCheckInSessionCompletions(checkInId),
    getCheckInExerciseHighlights(checkInId),
  ]);

  return {
    ...checkIn,
    sessionCompletions: sessionRows.map(mapSessionCompletion),
    exerciseHighlights: highlightRows.map(mapExerciseHighlight),
  };
};
