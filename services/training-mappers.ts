import type {
  TrainingPlan,
  TrainingSession,
  TrainingExercise,
  TrainingPlanStatus,
  TrainingSplitType,
} from "@/types/training";
import type { TrainingExerciseRow, TrainingSessionRow, TrainingPlanRow } from "@/lib/database-helpers";
import type { SetSpec } from "@/utils/exercise-set-specs";

// Map database row to TrainingExercise
export const mapExerciseRow = (row: TrainingExerciseRow): TrainingExercise => ({
  id: row.id,
  sessionId: row.session_id,
  name: row.name,
  orderIndex: row.order_index,
  sets: row.sets,
  repsMin: row.reps_min ?? undefined,
  repsMax: row.reps_max ?? undefined,
  repsTarget: row.reps_target ?? undefined,
  rpeTarget: row.rpe_target ?? undefined,
  percentage1rm: row.percentage_1rm ?? undefined,
  tempo: row.tempo ?? undefined,
  restSeconds: row.rest_seconds ?? undefined,
  notes: row.notes ?? undefined,
  supersetGroup: row.superset_group ?? undefined,
  isWarmup: row.is_warmup ?? false,
  setSpecs: (row.set_specs as SetSpec[] | null) ?? null,
  videoUrl: row.video_url ?? null,
  exerciseId: row.exercise_id ?? null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// Map database row to TrainingSession
export const mapSessionRow = (row: TrainingSessionRow, exercises: TrainingExercise[] = []): TrainingSession => ({
  id: row.id,
  planId: row.plan_id,
  name: row.name,
  dayOfWeek: row.day_of_week ?? undefined,
  orderIndex: row.order_index,
  focus: row.focus ?? undefined,
  notes: row.notes ?? undefined,
  estimatedDurationMinutes: row.estimated_duration_minutes ?? undefined,
  exercises,
  estimatedCalories: row.estimated_calories ?? undefined,
  caloriesCalculatedAt: row.calories_calculated_at ?? undefined,
  calorieSurplusPercentage: row.calorie_surplus_percentage ?? null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// Map database row to TrainingPlan
export const mapPlanRow = (row: TrainingPlanRow, sessions: TrainingSession[] = []): TrainingPlan => ({
  id: row.id,
  clientId: row.client_id,
  coachId: row.coach_id,
  name: row.name,
  description: row.description ?? undefined,
  status: row.status as TrainingPlanStatus,
  coachPrompt: row.coach_prompt ?? undefined,
  aiResponseRaw: row.ai_response_raw ?? undefined,
  splitType: row.split_type as TrainingSplitType,
  frequencyPerWeek: row.frequency_per_week,
  programDurationWeeks: row.program_duration_weeks ?? undefined,
  clientWeightKg: row.client_weight_kg ?? undefined,
  clientBodyFatPercentage: row.client_body_fat_percentage ?? undefined,
  clientGoalWeightKg: row.client_goal_weight_kg ?? undefined,
  clientTdee: row.client_tdee ?? undefined,
  avgMood: row.avg_mood ?? undefined,
  avgEnergy: row.avg_energy ?? undefined,
  avgSleep: row.avg_sleep ?? undefined,
  avgStress: row.avg_stress ?? undefined,
  recentAdherencePercentage: row.recent_adherence_percentage ?? undefined,
  effectiveFrom: row.effective_from ?? undefined,
  effectiveUntil: row.effective_until ?? undefined,
  sessions,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  deletedAt: row.deleted_at ?? undefined,
});
