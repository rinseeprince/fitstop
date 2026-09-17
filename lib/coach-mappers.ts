import type {
  SavedPlan,
  SavedSession,
  SavedExercise,
  SavedExerciseGroup,
  SavedPlanStatus,
  SavedPlanSource,
  SavedSessionType,
  TrainingSplitType,
} from "@/types/training";
import type {
  CoachSavedPlanRow,
  CoachSavedSessionRow,
  CoachSavedExerciseRow,
  CoachSavedExerciseGroupRow,
} from "@/lib/database-helpers";
import type { SetSpec } from "@/utils/exercise-set-specs";
import { groupSettingsFromRow } from "@/utils/exercise-groups";

/**
 * Pure row-to-domain mappers for the coach saved-plan / saved-session /
 * saved-exercise tables.
 * so the same shapes can be reused across the split services without the
 * CRUD file importing itself.
 */

function mapSavedExerciseRow(
  row: CoachSavedExerciseRow,
): SavedExercise {
  return {
    id: row.id,
    savedSessionId: row.saved_session_id,
    groupId: row.group_id,
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
    isWarmup: row.is_warmup ?? false,
    notes: row.notes ?? null,
    setSpecs: (row.set_specs as SetSpec[] | null) ?? null,
    videoUrl: row.video_url ?? null,
    prescribedFields: row.prescribed_fields ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSavedGroupRow(
  row: CoachSavedExerciseGroupRow,
  exercises: SavedExercise[],
): SavedExerciseGroup {
  return {
    id: row.id,
    savedSessionId: row.saved_session_id,
    orderIndex: row.order_index,
    ...groupSettingsFromRow(row),
    exercises,
  };
}

function mapSavedSessionRow(
  row: CoachSavedSessionRow,
  groups: SavedExerciseGroup[] = [],
): SavedSession {
  return {
    id: row.id,
    coachId: row.coach_id,
    savedPlanId: row.saved_plan_id ?? null,
    name: row.name,
    focus: row.focus ?? null,
    orderIndex: row.order_index,
    weekIndex: row.week_index ?? 0,
    dayOrder: row.day_order,
    isRest: row.is_rest ?? false,
    estimatedDurationMinutes: row.estimated_duration_minutes ?? null,
    calorieSurplusPercentage: row.calorie_surplus_percentage ?? null,
    notes: row.notes ?? null,
    sessionType: row.session_type as SavedSessionType,
    groups,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The embed a library session is read with: its groups, each with its exercises. */
export const SAVED_SESSION_GROUPS_EMBED =
  "coach_saved_exercise_groups!coach_saved_exercise_groups_saved_session_id_fkey(*, coach_saved_exercises!coach_saved_exercises_group_fkey(*))";

/** A library session row read through SAVED_SESSION_GROUPS_EMBED. */
export type SavedSessionTreeRow = CoachSavedSessionRow & {
  coach_saved_exercise_groups?: Array<
    CoachSavedExerciseGroupRow & { coach_saved_exercises?: CoachSavedExerciseRow[] | null }
  > | null;
};

type Positioned = { id: string; order_index: number };
const byPosition = (a: Positioned, b: Positioned) =>
  a.order_index - b.order_index || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * A library session read with its groups and their exercises, in order: the
 * groups by their place in the session, each group's exercises by their place
 * in it. The one ordering every library read uses. A group holds at least one
 * exercise, so a group row left without any (a save killed between its two
 * inserts) is not a group of the session.
 */
export function mapSavedSessionTree(row: SavedSessionTreeRow): SavedSession {
  const groups = [...(row.coach_saved_exercise_groups ?? [])]
    .filter((group) => (group.coach_saved_exercises ?? []).length > 0)
    .sort(byPosition)
    .map((group) =>
      mapSavedGroupRow(
        group,
        [...(group.coach_saved_exercises ?? [])].sort(byPosition).map(mapSavedExerciseRow),
      ),
    );
  return mapSavedSessionRow(row, groups);
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
