import type { z } from "zod";
import type {
  PlanEditSaveBody,
  replaceSessionSchema,
} from "@/lib/validations/training";
import type { TrainingExercise, TrainingExerciseGroup } from "@/types/training";
import type { PlanForEditing } from "@/services/plan-edit-service";
import {
  draftToSessionInputs,
  groupDraftToInput,
} from "./program-builder-serialize";
import type { EditableDays } from "./program-builder-lock-model";
import { toPrescribedFields } from "@/utils/prescribed-fields";
import { groupSettingsOf } from "@/utils/exercise-groups";
import { daysBetween } from "@/utils/metric-points";
import {
  DAYS_PER_WEEK,
  makeRestSlot,
  newUid,
  type DaySlotDraft,
  type ExerciseDraft,
  type ExerciseGroupDraft,
  type ProgramDraft,
  type SessionDraft,
  type WeekDraft,
} from "./program-builder-types";

// Serialization boundary between a client's placed rows and the builder's
// draft model. The tray reads a placed session into a SessionDraft and writes
// it back through the replace PUT; the plan editor reads the whole plan via
// planForEditingToDraft and saves it through draftToPlanEditBody.

type PlacedSessionPayload = z.infer<typeof replaceSessionSchema>;

// Structural source both the tray's TrainingSession and the plan editor's
// session day satisfy — one conversion serves both surfaces.
type PlacedSessionSource = {
  name: string;
  focus?: string | null;
  estimatedDurationMinutes?: number | null;
  calorieSurplusPercentage: number | null;
  notes?: string | null;
  groups: TrainingExerciseGroup[];
};

/**
 * Clone a placed session row into an editable SessionDraft — fresh uids for
 * its groups and exercises, undefined→null coercions, `[]` setSpecs
 * normalized to null (an empty array fails the ≥1-non-warmup zod refine and
 * would 400 the save), catalog exerciseId preserved. `sessionType` is
 * synthesized: training_sessions has no session_type column.
 * `exerciseIdByUid` maps each draft exercise uid back to its
 * training_exercises ROW id (not the catalog id) — unused by the tray (the
 * replace PUT is insert-fresh).
 */
export function trainingSessionToDraft(s: PlacedSessionSource): {
  draft: SessionDraft;
  exerciseIdByUid: Map<string, string>;
} {
  const exerciseIdByUid = new Map<string, string>();
  const toExerciseDraft = (e: TrainingExercise): ExerciseDraft => {
    const uid = newUid("ex");
    exerciseIdByUid.set(uid, e.id);
    return {
      uid,
      exerciseId: e.exerciseId ?? null,
      name: e.name,
      setSpecs: e.setSpecs && e.setSpecs.length > 0 ? e.setSpecs : null,
      sets: e.sets,
      repsMin: e.repsMin ?? null,
      repsMax: e.repsMax ?? null,
      repsTarget: e.repsTarget ?? null,
      rpeTarget: e.rpeTarget ?? null,
      percentage1rm: e.percentage1rm ?? null,
      tempo: e.tempo ?? null,
      restSeconds: e.restSeconds ?? null,
      isWarmup: e.isWarmup,
      notes: e.notes ?? null,
      videoUrl: e.videoUrl ?? null,
      prescribedFields: toPrescribedFields(e.prescribedFields),
    };
  };
  const groups: ExerciseGroupDraft[] = s.groups.map((group) => ({
    uid: newUid("grp"),
    ...groupSettingsOf(group),
    exercises: group.exercises.map(toExerciseDraft),
  }));

  return {
    draft: {
      uid: newUid("sess"),
      name: s.name,
      focus: s.focus ?? null,
      estimatedDurationMinutes: s.estimatedDurationMinutes ?? null,
      // Placed surplus is ABSOLUTE (owner decision 10): the placed row carries
      // the resolved value — there is no stored plan default to inherit, so
      // null here means "no surplus", not "inherit".
      calorieSurplusPercentage: s.calorieSurplusPercentage ?? null,
      notes: s.notes ?? null,
      sessionType: "training",
      groups,
    },
    exerciseIdByUid,
  };
}

/**
 * Serialize one SessionDraft into the replace-session PUT body. Reuses the
 * shared groupDraftToInput so groups, per-set specs and video URLs survive
 * verbatim on this path exactly as they do on the library/inline paths.
 */
export function sessionDraftToPlacedPayload(
  session: SessionDraft,
): PlacedSessionPayload {
  return {
    name: session.name.slice(0, 100),
    focus: session.focus,
    estimatedDurationMinutes: session.estimatedDurationMinutes,
    calorieSurplusPercentage: session.calorieSurplusPercentage,
    notes: session.notes,
    groups: session.groups.map(groupDraftToInput),
  };
}

// --- The plan editor -----------------------------------------------------------

type PlanEditorSeed = {
  draft: ProgramDraft;
  /** The editable days, as positions from the plan's start. */
  editableDays: EditableDays;
  /** The client's today as a position; null when outside the grid. */
  todayPosition: number | null;
};

/**
 * Build the editable draft from the plan editor's read: one slot per day,
 * weeks of seven, slot i = the plan's day effective_from + i — the position
 * the lock model and the save both count in. Session days clone the day's row
 * (trainingSessionToDraft); rest days and greyed days are empty slots.
 */
export function planForEditingToDraft(read: PlanForEditing): PlanEditorSeed {
  const days: DaySlotDraft[] = read.days.map((day, i) =>
    day.isRest
      ? makeRestSlot(i % DAYS_PER_WEEK)
      : {
          uid: newUid("slot"),
          orderIndex: i % DAYS_PER_WEEK,
          isRest: false,
          session: trainingSessionToDraft(day).draft,
        },
  );
  const weeks: WeekDraft[] = [];
  for (let w = 0; w * DAYS_PER_WEEK < days.length; w++) {
    weeks.push({
      uid: newUid("wk"),
      weekIndex: w,
      days: days.slice(w * DAYS_PER_WEEK, (w + 1) * DAYS_PER_WEEK),
    });
  }

  const from = read.plan.effectiveFrom;
  const todayPosition = daysBetween(from, read.clientToday);
  return {
    draft: {
      id: read.plan.id,
      name: read.plan.name,
      description: null,
      status: "saved",
      splitType: read.plan.splitType,
      programDurationWeeks: weeks.length,
      // A placed session's surplus is ABSOLUTE: there is no plan default to
      // inherit, so null here means "no surplus", never "inherit".
      defaultSurplusPercentage: null,
      weeks,
    },
    editableDays: {
      from: daysBetween(from, read.firstEditableDate),
      through: read.limit ? daysBetween(from, read.limit.endsOn) : null,
    },
    todayPosition:
      todayPosition >= 0 && todayPosition < days.length ? todayPosition : null,
  };
}

/**
 * The plan editor's save body: the whole grid (draftToSessionInputs, the
 * canonical weekIndex*7+day slots the server counts in), the plan's name and
 * focus, and the read's version, unchanged.
 */
export function draftToPlanEditBody(draft: ProgramDraft, version: string): PlanEditSaveBody {
  return {
    sessions: draftToSessionInputs(draft),
    plan: {
      name: draft.name.slice(0, 100),
      splitType: draft.splitType ? draft.splitType.slice(0, 100) : draft.splitType,
    },
    version,
  };
}
