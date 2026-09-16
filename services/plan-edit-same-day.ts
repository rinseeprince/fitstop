import { toPrescribedFields } from "@/utils/prescribed-fields";
import { groupSettingsToRow, type GroupSettingsInput } from "@/utils/exercise-groups";
import type { PlanEditDay } from "./plan-edit-service";

// =============================================================================
// Edit plan's "unchanged": a day the editor saves as it was laid keeps its
// edited mark; a day the coach changed in the editor loses it.
//
// The laid day is the editor's own read of the calendar (layDays in
// plan-edit-service.ts), re-read at save; the transaction's stale check then
// guarantees it is the calendar the editor opened. Pure: no database client.
// =============================================================================

type ExerciseContent = {
  name: string;
  exerciseId?: string | null;
  sets: number;
  repsMin?: number | null;
  repsMax?: number | null;
  repsTarget?: string | null;
  rpeTarget?: number | null;
  percentage1rm?: number | null;
  tempo?: string | null;
  restSeconds?: number | null;
  notes?: string | null;
  isWarmup?: boolean;
  setSpecs?: readonly object[] | null;
  videoUrl?: string | null;
  prescribedFields?: readonly string[] | null;
};

/** A group in the order its exercises are written. */
type GroupContent = GroupSettingsInput & { exercises: readonly ExerciseContent[] };

/** A session day in the order its groups are written. */
type DayContent = {
  name: string;
  focus?: string | null;
  notes?: string | null;
  estimatedDurationMinutes?: number | null;
  calorieSurplusPercentage?: number | null;
  groups: readonly GroupContent[];
};

// What the editor rewrites on a day nobody touched is evened out here, and
// nothing else: it numbers groups, exercises and sets by position, sends an
// empty set list as none, trims a video link and drops an empty
// prescribed-fields list (trainingSessionToDraft, normalizeDraft and
// exerciseDraftToInput).
function exerciseKey(exercise: ExerciseContent) {
  return {
    name: exercise.name,
    exerciseId: exercise.exerciseId ?? null,
    sets: exercise.sets,
    repsMin: exercise.repsMin ?? null,
    repsMax: exercise.repsMax ?? null,
    repsTarget: exercise.repsTarget ?? null,
    rpeTarget: exercise.rpeTarget ?? null,
    percentage1rm: exercise.percentage1rm ?? null,
    tempo: exercise.tempo ?? null,
    restSeconds: exercise.restSeconds ?? null,
    notes: exercise.notes ?? null,
    isWarmup: exercise.isWarmup ?? false,
    setSpecs: exercise.setSpecs?.length
      ? exercise.setSpecs.map((spec, i) => ({ ...spec, set_number: i + 1 }))
      : null,
    videoUrl: exercise.videoUrl?.trim() || null,
    prescribedFields: toPrescribedFields(exercise.prescribedFields),
  };
}

function dayKey(day: DayContent): string {
  // Keys sorted at every depth: a set spec read from the database and one
  // parsed from the save carry the same values in a different key order.
  return JSON.stringify(
    {
      name: day.name,
      focus: day.focus ?? null,
      notes: day.notes ?? null,
      estimatedDurationMinutes: day.estimatedDurationMinutes ?? null,
      calorieSurplusPercentage: day.calorieSurplusPercentage ?? null,
      groups: day.groups.map((group) => ({
        ...groupSettingsToRow(group),
        exercises: group.exercises.map(exerciseKey),
      })),
    },
    (_key, value: unknown) =>
      value !== null && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
          )
        : value,
  );
}

/**
 * True when the session day about to be written is the day as laid: the same
 * name, focus, notes, duration and surplus, and the same groups — settings and
 * exercises — in the same order. A day laid as rest is never unchanged by a
 * session.
 */
export function isDayUnchanged(laid: PlanEditDay | undefined, saved: DayContent): boolean {
  if (!laid || laid.isRest) return false;
  return dayKey(laid) === dayKey(saved);
}
