import type {
  SavedPlan,
  SavedSession,
  SavedExercise,
  SavedPlanStatus,
  SavedPlanSource,
  SavedSessionType,
  TrainingSplitType,
} from "@/types/training";
import type {
  CoachSavedPlanRow,
  CoachSavedSessionRow,
  CoachSavedExerciseRow,
} from "@/lib/database-helpers";
import type { SetSpec } from "@/utils/exercise-set-specs";

/**
 * Pure row-to-domain mappers for the coach saved-plan / saved-session /
 * saved-exercise tables.
 * so the same shapes can be reused across the split services without the
 * CRUD file importing itself.
 */

export function mapSavedExerciseRow(
  row: CoachSavedExerciseRow,
): SavedExercise {
  return {
    id: row.id,
    savedSessionId: row.saved_session_id,
    exerciseId: row.exercise_id ?? null,
    name: row.name,
    orderIndex: row.order_index,
    sets: row.sets,
    repsMin: row.reps_min ?? null,
    repsMax: row.reps_max ?? null,
    repsTarget: row.reps_target ?? null,
    rpeTarget: row.rpe_target ?? null,
    percentage1rm: row.percentage_1rm ?? null,
    tempo: row.tempo ?? null,
    restSeconds: row.rest_seconds ?? null,
    supersetGroup: row.superset_group ?? null,
    isWarmup: row.is_warmup ?? false,
    notes: row.notes ?? null,
    setSpecs: (row.set_specs as SetSpec[] | null) ?? null,
    videoUrl: row.video_url ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapSavedSessionRow(
  row: CoachSavedSessionRow,
  exercises: SavedExercise[] = [],
): SavedSession {
  return {
    id: row.id,
    coachId: row.coach_id,
    savedPlanId: row.saved_plan_id ?? null,
    name: row.name,
    focus: row.focus ?? null,
    orderIndex: row.order_index,
    weekIndex: row.week_index ?? 0,
    isRest: row.is_rest ?? false,
    estimatedDurationMinutes: row.estimated_duration_minutes ?? null,
    calorieSurplusPercentage: row.calorie_surplus_percentage ?? null,
    notes: row.notes ?? null,
    sessionType: row.session_type as SavedSessionType,
    exercises,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapSavedPlanRow(
  row: CoachSavedPlanRow,
  sessions: SavedSession[] = [],
): SavedPlan {
  return {
    id: row.id,
    coachId: row.coach_id,
    name: row.name,
    description: row.description ?? null,
    splitType: (row.split_type ?? null) as TrainingSplitType | null,
    frequencyPerWeek: row.frequency_per_week ?? null,
    status: row.status as SavedPlanStatus,
    cycleLength: row.cycle_length ?? null,
    restPattern: row.rest_pattern ?? [],
    defaultSurplusPercentage: row.default_surplus_percentage != null
      ? Number(row.default_surplus_percentage)
      : null,
    source: (row.source ?? "manual") as SavedPlanSource,
    coachPrompt: row.coach_prompt ?? null,
    programDurationWeeks: row.program_duration_weeks ?? null,
    sessions,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
