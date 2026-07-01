import type { z } from "zod";
import type { overwriteSavedPlanSchema } from "@/lib/validations/training";
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
// exactly (same zod schema), with a globally monotonic order_index
// (weekIndex * 7 + dayPosition) so the library read — which sorts by
// order_index ALONE — returns slots in program order without a backend change.
//
// Coexistence caveat (until Phase 5 retires it): the old client-drawer editor
// serializes WITHOUT weekIndex/setSpecs/videoUrl, so saving a builder-authored
// program from that surface would flatten it. draft-editor.tsx guards this by
// disabling its overwrite/apply for week-model or set-spec plans.

export type ProgramOverwriteBody = z.infer<typeof overwriteSavedPlanSchema>;

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
 * Reconstruct the ordered slot sequence (session or null = rest) for a plan
 * that predates the week model: rest may live only in the plan's rest_pattern
 * (never materialized as rows). Falls back to the ordered session list —
 * materialized rest rows become rest slots — when the cycle metadata doesn't
 * reconcile with the row count.
 */
function legacySlotSequence(plan: SavedPlan, ordered: SavedSession[]): Array<SavedSession | null> {
  const hasMaterializedRest = ordered.some((s) => s.isRest);
  const cycleLength = plan.cycleLength ?? 0;
  if (
    !hasMaterializedRest &&
    plan.restPattern.length > 0 &&
    cycleLength === ordered.length + plan.restPattern.length
  ) {
    const restSet = new Set(plan.restPattern);
    const slots: Array<SavedSession | null> = [];
    let next = 0;
    for (let i = 0; i < cycleLength; i++) {
      slots.push(restSet.has(i) ? null : ordered[next++]);
    }
    return slots;
  }
  return ordered.map((s) => (s.isRest ? null : s));
}

/**
 * Build the editable draft tree from a SavedPlan. Week-shaped plans (any
 * weekIndex > 0 or is_rest row, AND every week grouping to exactly 7 rows) map
 * positionally. Everything else is a legacy flat plan and gets NORMALIZED into
 * the 7-slot week model: slot sequence reconstructed (see legacySlotSequence),
 * tail padded with rest to a whole week. Deliberate: a non-7-multiple rotating
 * cycle becomes a week-based program — the reshape only persists if the coach
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
    const slots = legacySlotSequence(plan, ordered);
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

/**
 * Serialize the whole draft tree into the overwrite body. Every slot becomes a
 * real session row — rest rows included (the placement date-walk needs all 7
 * rows per week or every later date slides). Throws rather than emit an empty
 * sessions array: overwrite is delete-then-reinsert, so an empty body would
 * wipe the program (normalize's min-1-week invariant makes this unreachable).
 */
export function draftToOverwriteBody(draft: ProgramDraft): ProgramOverwriteBody {
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
      exercises: (slot.session?.exercises ?? []).map((e, i) => ({
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
      })),
    })),
  );
  if (sessions.length === 0) {
    throw new Error("Refusing to serialize an empty program (overwrite would wipe it)");
  }
  return {
    // AI-sourced plans can carry names ≤200 / descriptions ≤1000 (their gen
    // schema is looser), but overwrite caps them at 100/500 — truncate rather
    // than hard-block the save of a plan whose description the builder
    // doesn't even surface.
    name: draft.name.slice(0, 100),
    description: draft.description ? draft.description.slice(0, 500) : draft.description,
    defaultSurplusPercentage: draft.defaultSurplusPercentage,
    sessions,
  };
}
