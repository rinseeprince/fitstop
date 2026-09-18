import type {
  TrainingPlan,
  TrainingSession,
  TrainingExercise,
  TrainingExerciseGroup,
  TrainingPlanStatus,
  TrainingSplitType,
} from "@/types/training";
import type {
  TrainingExerciseGroupRow,
  TrainingExerciseRow,
  TrainingSessionRow,
  TrainingPlanRow,
} from "@/lib/database-helpers";
import type { SetSpec } from "@/utils/exercise-set-specs";
import { groupSettingsFromRow, nestRowsIntoGroups } from "@/utils/exercise-groups";
import { toPrescribedFields } from "@/utils/prescribed-fields";

/**
 * The columns every read of client exercises selects: the row and the group it
 * sits in (migration 178), named by its foreign key. A group is read through
 * the exercises that point at it, never on its own — so a group whose exercises
 * were all retired is read by nobody.
 */
export const EXERCISE_WITH_GROUP_COLUMNS =
  "*, exercise_group:training_exercise_groups!training_exercises_group_fkey(*)";

/** A training_exercises row read with EXERCISE_WITH_GROUP_COLUMNS. */
export type TrainingExerciseWithGroupRow = TrainingExerciseRow & {
  exercise_group: TrainingExerciseGroupRow;
};

// Map database row to TrainingExercise
export const mapExerciseRow = (row: TrainingExerciseRow): TrainingExercise => ({
  id: row.id,
  sessionId: row.session_id,
  groupId: row.group_id,
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
  isWarmup: row.is_warmup ?? false,
  setSpecs: (row.set_specs as SetSpec[] | null) ?? null,
  videoUrl: row.video_url ?? null,
  // Migration 183. Dropping it here once widened every client's grid back to
  // all five columns regardless of the coach's picker, because TrainingExercise
  // declared it optional and nothing complained. It is required on that type,
  // so no mapper can lose it silently again.
  prescribedFields: toPrescribedFields(row.prescribed_fields),
  exerciseId: row.exercise_id ?? null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapGroupRow = (
  row: TrainingExerciseGroupRow,
  exercises: TrainingExercise[],
): TrainingExerciseGroup => ({
  id: row.id,
  sessionId: row.session_id,
  orderIndex: row.order_index,
  ...groupSettingsFromRow(row),
  exercises,
});

/** One session's exercise rows, read with their groups, as its groups in order. */
export function mapExerciseRowsToGroups(
  rows: readonly TrainingExerciseWithGroupRow[],
): TrainingExerciseGroup[] {
  return nestRowsIntoGroups(
    rows.map((row) => ({ group: row.exercise_group, exercise: row })),
  ).map(({ group, exercises }) => mapGroupRow(group, exercises.map(mapExerciseRow)));
}

/** Exercise rows of many sessions, read with their groups, as each session's groups in order. */
export function mapExerciseRowsToGroupsBySession(
  rows: readonly TrainingExerciseWithGroupRow[],
): Map<string, TrainingExerciseGroup[]> {
  const bySession = new Map<string, TrainingExerciseWithGroupRow[]>();
  for (const row of rows) {
    const list = bySession.get(row.session_id) ?? [];
    list.push(row);
    bySession.set(row.session_id, list);
  }
  return new Map(
    [...bySession].map(([sessionId, sessionRows]) => [
      sessionId,
      mapExerciseRowsToGroups(sessionRows),
    ]),
  );
}

// Map database row to TrainingSession
export const mapSessionRow = (row: TrainingSessionRow, groups: TrainingExerciseGroup[] = []): TrainingSession => ({
  id: row.id,
  planId: row.plan_id,
  name: row.name,
  dayOfWeek: row.day_of_week ?? undefined,
  orderIndex: row.order_index,
  focus: row.focus ?? undefined,
  notes: row.notes ?? undefined,
  estimatedDurationMinutes: row.estimated_duration_minutes ?? undefined,
  groups,
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
