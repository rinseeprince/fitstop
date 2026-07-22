import type { z } from "zod";
import type {
  AmendPlacedPlanBody,
  replaceSessionSchema,
} from "@/lib/validations/training";
import type { TrainingExercise } from "@/types/training";
import type {
  PlacedPlanForBuilder,
  PlacedSlotRead,
} from "@/services/plan-amendment-service";
import {
  draftToSessionInputs,
  exerciseDraftToInput,
} from "./program-builder-serialize";
import { computeLockedSlotUids } from "./program-builder-lock-model";
import {
  DAYS_PER_WEEK,
  makeRestSlot,
  newUid,
  type DaySlotDraft,
  type ExerciseDraft,
  type ProgramDraft,
  type SessionDraft,
  type WeekDraft,
} from "./program-builder-types";

// Serialization boundary between PLACED client rows (training_sessions /
// training_exercises) and the builder's draft model. The tray reads a placed
// session into a SessionDraft and writes it back through the replace PUT; the
// amendment surface reads the whole plan via placedPlanToDraft and writes it
// back through draftToAmendBody.

export type PlacedSessionPayload = z.infer<typeof replaceSessionSchema>;

// Structural source both the tray's TrainingSession and the amendment reader's
// PlacedSlotRead satisfy — one conversion serves both surfaces.
export type PlacedSessionSource = {
  name: string;
  focus?: string | null;
  estimatedDurationMinutes?: number | null;
  calorieSurplusPercentage: number | null;
  notes?: string | null;
  exercises: TrainingExercise[];
};

/**
 * Clone a placed session row into an editable SessionDraft — fresh uids,
 * undefined→null coercions, `[]` setSpecs normalized to null (an empty array
 * fails the ≥1-non-warmup zod refine and would 400 the save), catalog
 * exerciseId preserved. `sessionType` is synthesized: training_sessions has
 * no session_type column. `exerciseIdByUid` maps each draft exercise uid back
 * to its training_exercises ROW id (not the catalog id) — unused by the tray
 * (the replace PUT is insert-fresh).
 */
export function trainingSessionToDraft(s: PlacedSessionSource): {
  draft: SessionDraft;
  exerciseIdByUid: Map<string, string>;
} {
  const exerciseIdByUid = new Map<string, string>();
  const exercises: ExerciseDraft[] = s.exercises.map((e) => {
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
      supersetGroup: e.supersetGroup ?? null,
      isWarmup: e.isWarmup,
      notes: e.notes ?? null,
      videoUrl: e.videoUrl ?? null,
    };
  });

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
      exercises,
    },
    exerciseIdByUid,
  };
}

/**
 * Serialize one SessionDraft into the replace-session PUT body. Reuses the
 * shared exerciseDraftToInput so per-set specs and video URLs survive verbatim
 * on this path exactly as they do on the library/inline paths.
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
    exercises: session.exercises.map(exerciseDraftToInput),
  };
}

// --- Whole-plan (amendment) serialization ------------------------------------

export type PlacedPlanDraftSeed = {
  draft: ProgramDraft;
  // Serializable — the assistant sends this array over the wire and the ops
  // ctx rebuilds the same Set on both sides.
  lockedSlotUids: string[];
  // Draft session uid → training_sessions row id (per SLOT — every slot gets a
  // fresh uid even if diverged data ever shared a row).
  sessionIdByUid: Map<string, string>;
  amendmentToken: string;
  fullyLocked: boolean;
};

/**
 * Build the editable draft tree from the amendment GET. Same dual path as
 * savedPlanToDraft: week-shaped when every weekIndex group is exactly 7 rows,
 * else a flat repack with tail rest padding (diverged plans — duplicate-week /
 * cloned-day colliding coords — take the flat path, and saving the amendment
 * normalizes the future back to the positional model). The read's canonical
 * order IS the slot-position order, so flattened draft position i maps to
 * read.sessions[i] — the invariant computeLockedSlotUids relies on.
 */
export function placedPlanToDraft(read: PlacedPlanForBuilder): PlacedPlanDraftSeed {
  const sessionIdByUid = new Map<string, string>();

  const slotFrom = (s: PlacedSlotRead, orderIndex: number): DaySlotDraft => {
    if (s.isRest) return makeRestSlot(orderIndex);
    const { draft } = trainingSessionToDraft(s);
    sessionIdByUid.set(draft.uid, s.id);
    return { uid: newUid("slot"), orderIndex, isRest: false, session: draft };
  };

  const ordered = read.sessions; // canonical (week, order, created_at, id)
  let weeks: WeekDraft[] = [];
  const hasWeekModel = ordered.some((s) => s.weekIndex > 0 || s.isRest);
  if (hasWeekModel) {
    const groups = new Map<number, PlacedSlotRead[]>();
    for (const s of ordered) {
      const group = groups.get(s.weekIndex);
      if (group) group.push(s);
      else groups.set(s.weekIndex, [s]);
    }
    if ([...groups.values()].every((g) => g.length === DAYS_PER_WEEK)) {
      weeks = [...groups.values()].map((group, w) => ({
        uid: newUid("wk"),
        weekIndex: w,
        days: group.map((s, i) => slotFrom(s, i)),
      }));
    }
  }

  if (weeks.length === 0) {
    const days: DaySlotDraft[] = ordered.map((s, i) =>
      slotFrom(s, i % DAYS_PER_WEEK),
    );
    while (days.length % DAYS_PER_WEEK !== 0 || days.length === 0) {
      days.push(makeRestSlot(days.length % DAYS_PER_WEEK));
    }
    for (let w = 0; w * DAYS_PER_WEEK < days.length; w++) {
      weeks.push({
        uid: newUid("wk"),
        weekIndex: w,
        days: days.slice(w * DAYS_PER_WEEK, (w + 1) * DAYS_PER_WEEK),
      });
    }
  }

  const draft: ProgramDraft = {
    id: read.plan.id,
    name: read.plan.name,
    description: null,
    status: "saved",
    splitType: read.plan.splitType,
    programDurationWeeks: read.plan.programDurationWeeks,
    // Placed surplus is ABSOLUTE (decision 10) — there is no stored plan
    // default; a null session surplus means "no surplus", never "inherit".
    defaultSurplusPercentage: null,
    weeks,
  };

  const lockedSlotUids = computeLockedSlotUids(read, weeks);
  return {
    draft,
    lockedSlotUids,
    sessionIdByUid,
    amendmentToken: read.amendmentToken,
    fullyLocked:
      weeks.length > 0 &&
      lockedSlotUids.length === weeks.length * DAYS_PER_WEEK,
  };
}

/**
 * Serialize the whole draft into the amendment PUT body — the shared
 * draftToSessionInputs (the canonical weekIndex*7+day grid the writer
 * validates), the coach's identity patch, and the drift token from the seed.
 */
export function draftToAmendBody(
  draft: ProgramDraft,
  planPatch: { name?: string; splitType?: string | null } | undefined,
  expectedToken: string,
): AmendPlacedPlanBody {
  return {
    sessions: draftToSessionInputs(draft),
    ...(planPatch ? { plan: planPatch } : {}),
    expectedToken,
  };
}
