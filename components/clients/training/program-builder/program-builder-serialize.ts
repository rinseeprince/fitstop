import { toPrescribedFields } from "@/utils/prescribed-fields";
import type { z } from "zod";
import type {
  createStandaloneSessionSchema,
  InlinePlanBody,
  overwriteSavedPlanSchema,
} from "@/lib/validations/training";
import type { SavedPlan, SavedSession, SavedExercise } from "@/types/training";
import {
  DAYS_PER_WEEK,
  newUid,
  makeRestSlot,
  type DaySlotDraft,
  type ExerciseDraft,
  type ProgramDraft,
  type SessionDraft,
  type WeekDraft,
} from "./program-builder-types";

// Serialization boundary between the builder's draft tree and the saved-plan
// API. draftToOverwriteBody targets POST /api/training/saved-plans/[id]/overwrite
// and draftToInlinePlanBody targets the client-apply inline placement — both
// off the shared draftToSessionInputs, with a globally monotonic order_index
// (weekIndex * 7 + dayPosition) so the library read — which sorts by
// order_index ALONE — returns slots in program order without a backend change.
// This builder is the only editor for a client's draft, so weekIndex/setSpecs/
// videoUrl must survive every path through here.

type ProgramOverwriteBody = z.infer<typeof overwriteSavedPlanSchema>;

function exerciseToDraft(e: SavedExercise): ExerciseDraft {
  return {
    uid: newUid("ex"),
    exerciseId: e.exerciseId,
    name: e.name,
    setSpecs: e.setSpecs && e.setSpecs.length > 0 ? e.setSpecs : null,
    sets: e.sets,
    repsMin: e.repsMin,
    repsMax: e.repsMax,
    repsTarget: e.repsTarget,
    rpeTarget: e.rpeTarget,
    percentage1rm: e.percentage1rm,
    tempo: e.tempo,
    restSeconds: e.restSeconds,
    supersetGroup: e.supersetGroup,
    isWarmup: e.isWarmup,
    notes: e.notes,
    videoUrl: e.videoUrl,
    prescribedFields: toPrescribedFields(e.prescribedFields),
  };
}

function sessionToDraft(s: SavedSession): SessionDraft {
  return {
    uid: newUid("sess"),
    name: s.name,
    focus: s.focus,
    estimatedDurationMinutes: s.estimatedDurationMinutes,
    calorieSurplusPercentage: s.calorieSurplusPercentage,
    notes: s.notes,
    sessionType: s.sessionType,
    exercises: s.exercises.map(exerciseToDraft),
  };
}

/**
 * Clone a standalone library session into a placeable SessionDraft — fresh
 * uids, `exerciseId` preserved, setSpecs normalized ([] → null), videoUrl
 * carried. Pure clone-by-value: the drawer/popover insert never references
 * the library row, so later library edits can't touch placed programs.
 */
export function savedSessionToDraft(s: SavedSession): SessionDraft {
  // Surplus is a PROGRAM-level (and per-client) decision, not a movement-
  // template attribute — the training is the constant, the surplus is dynamic.
  // So a library session dragged into a program inherits the program default;
  // it never carries its own stored surplus as a silent per-day override.
  return { ...sessionToDraft(s), calorieSurplusPercentage: null };
}

function slotFromSession(
  session: SavedSession | null,
  orderIndex: number,
): DaySlotDraft {
  if (!session) return makeRestSlot(orderIndex);
  return {
    uid: newUid("slot"),
    orderIndex,
    isRest: false,
    session: sessionToDraft(session),
  };
}

/**
 * Build the editable draft tree from a SavedPlan. Week-shaped plans (any
 * weekIndex > 0 or is_rest row, AND every week grouping to exactly 7 rows) map
 * positionally. Everything else is a flat plan and gets NORMALIZED into the
 * 7-slot week model: materialized rest rows become rest slots, tail padded with
 * rest to a whole week. Deliberate: the reshape only persists if the coach
 * saves (read-only view never writes).
 */
export function savedPlanToDraft(plan: SavedPlan): ProgramDraft {
  const ordered = [...plan.sessions].sort(
    (a, b) => a.weekIndex - b.weekIndex || a.orderIndex - b.orderIndex,
  );

  let weeks: WeekDraft[] = [];
  const hasWeekModel = ordered.some((s) => s.weekIndex > 0 || s.isRest);
  if (hasWeekModel) {
    const groups = new Map<number, SavedSession[]>();
    for (const s of ordered) {
      const group = groups.get(s.weekIndex);
      if (group) group.push(s);
      else groups.set(s.weekIndex, [s]);
    }
    if ([...groups.values()].every((g) => g.length === DAYS_PER_WEEK)) {
      weeks = [...groups.values()].map((group, w) => ({
        uid: newUid("wk"),
        weekIndex: w,
        days: group.map((s, i) => slotFromSession(s.isRest ? null : s, i)),
      }));
    }
  }

  if (weeks.length === 0) {
    const slots: Array<SavedSession | null> = ordered.map((s) =>
      s.isRest ? null : s,
    );
    while (slots.length % DAYS_PER_WEEK !== 0 || slots.length === 0) {
      slots.push(null);
    }
    for (let w = 0; w * DAYS_PER_WEEK < slots.length; w++) {
      weeks.push({
        uid: newUid("wk"),
        weekIndex: w,
        days: slots
          .slice(w * DAYS_PER_WEEK, (w + 1) * DAYS_PER_WEEK)
          .map((s, i) => slotFromSession(s, i)),
      });
    }
  }

  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    status: plan.status,
    splitType: plan.splitType,
    programDurationWeeks: plan.programDurationWeeks,
    defaultSurplusPercentage: plan.defaultSurplusPercentage,
    weeks,
  };
}

// One exercise-input mapping shared by the overwrite body, the standalone
// create payload and the placed-session payload (placed-serialize.ts) — the
// write paths must never drift (a field missed on one side silently drops
// per-set data on that path).
export function exerciseDraftToInput(e: ExerciseDraft, i: number) {
  return {
    name: e.name,
    exerciseId: e.exerciseId,
    orderIndex: i,
    sets: Math.min(20, Math.max(1, Math.round(e.sets))),
    repsMin: e.repsMin,
    repsMax: e.repsMax,
    repsTarget: e.repsTarget,
    rpeTarget: e.rpeTarget,
    percentage1rm: e.percentage1rm,
    tempo: e.tempo,
    restSeconds: e.restSeconds,
    notes: e.notes,
    supersetGroup: e.supersetGroup,
    isWarmup: e.isWarmup,
    // [] must never reach the API — it fails the ≥1-non-warmup refine and
    // 400s the whole save. normalizeDraft reverts [] to null upstream;
    // this is the last-line belt.
    setSpecs: e.setSpecs && e.setSpecs.length > 0 ? e.setSpecs : null,
    videoUrl: e.videoUrl?.trim() ? e.videoUrl.trim() : null,
    // null, never [] — an empty list is refused by the 149 CHECK and would
    // render the client an empty grid.
    prescribedFields: e.prescribedFields?.length ? e.prescribedFields : null,
  };
}

type StandaloneSessionPayload = z.infer<typeof createStandaloneSessionSchema>;

/**
 * Serialize one SessionDraft into the standalone-session create body (the
 * create-blank slide-over's "Save session"). Same exercise mapping as the
 * overwrite path, so per-set specs and video URLs survive verbatim.
 */
export function sessionDraftToStandalonePayload(
  session: SessionDraft,
): StandaloneSessionPayload {
  return {
    name: session.name.slice(0, 100),
    focus: session.focus,
    estimatedDurationMinutes: session.estimatedDurationMinutes,
    // A saved workout is a reusable movement template — surplus is a program/
    // client decision, so it never travels with the workout. It inherits the
    // program default wherever it is next placed.
    calorieSurplusPercentage: null,
    notes: session.notes,
    exercises: session.exercises.map(exerciseDraftToInput),
  };
}

/**
 * Serialize the whole draft tree into the API session-input array — every slot
 * becomes a real session row, rest rows included (the placement date-walk needs
 * all 7 rows per week or every later date slides). Globally-monotonic
 * orderIndex (weekIndex * 7 + dayPosition). Shared by BOTH write paths — the
 * library overwrite body and the client-apply inline body — so a field missed
 * on one side can't silently drop per-set data on the other. Throws rather than
 * emit an empty array (normalize's min-1-week invariant makes this unreachable):
 * overwrite is delete-then-reinsert and inline placement of nothing is equally
 * wrong.
 */
export function draftToSessionInputs(draft: ProgramDraft): ProgramOverwriteBody["sessions"] {
  const sessions = draft.weeks.flatMap((week) =>
    week.days.map((slot, day) => ({
      name: slot.session?.name ?? "Rest",
      focus: slot.session?.focus ?? null,
      orderIndex: week.weekIndex * DAYS_PER_WEEK + day,
      weekIndex: week.weekIndex,
      isRest: slot.session == null,
      estimatedDurationMinutes: slot.session?.estimatedDurationMinutes ?? null,
      calorieSurplusPercentage: slot.session?.calorieSurplusPercentage ?? null,
      notes: slot.session?.notes ?? null,
      sessionType: slot.session?.sessionType ?? "training",
      exercises: (slot.session?.exercises ?? []).map(exerciseDraftToInput),
    })),
  );
  if (sessions.length === 0) {
    throw new Error("Refusing to serialize an empty program (nothing to place or save)");
  }
  return sessions;
}

/**
 * Serialize the whole draft tree into the library overwrite body (POST
 * /api/training/saved-plans/[id]/overwrite). AI-sourced plans can carry names
 * ≤200 / descriptions ≤1000 (their gen schema is looser), but overwrite caps
 * them at 100/500 (matching the header's edit limits) — truncate rather than
 * hard-block the save of a plan seeded from a looser AI draft.
 */
export function draftToOverwriteBody(draft: ProgramDraft): ProgramOverwriteBody {
  return {
    name: draft.name.slice(0, 100),
    description: draft.description ? draft.description.slice(0, 500) : draft.description,
    splitType: draft.splitType ? draft.splitType.slice(0, 100) : draft.splitType,
    defaultSurplusPercentage: draft.defaultSurplusPercentage,
    sessions: draftToSessionInputs(draft),
  };
}

/**
 * Serialize the whole draft tree into the inline-placement body (client apply —
 * POST /api/clients/[id]/training/place-from-library, type:"inline"). Shares
 * draftToSessionInputs with the overwrite path, so per-set specs / video /
 * weekIndex / rest rows land on the client's calendar verbatim. Two field notes:
 * splitType is the free-text program focus (carried through so a client's placed
 * plan keeps it); programDurationWeeks is metadata only (the placement window is
 * the whole-program slot count, NOT this field), so fall back to the authored
 * week count.
 */
export function draftToInlinePlanBody(draft: ProgramDraft): InlinePlanBody {
  return {
    name: draft.name.slice(0, 100),
    splitType: draft.splitType ? draft.splitType.slice(0, 100) : draft.splitType,
    programDurationWeeks: draft.programDurationWeeks ?? draft.weeks.length,
    defaultSurplusPercentage: draft.defaultSurplusPercentage,
    sessions: draftToSessionInputs(draft),
  };
}
