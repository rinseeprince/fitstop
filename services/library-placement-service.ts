import { supabaseAdmin } from "./supabase-admin";
import { getSavedPlanById } from "./coach-saved-plan-service";
import { createTrainingPlanAtomic } from "./training-service";
import { getNextPlanStartCap } from "./training-event-service";
import { validatePhaseBounds } from "./training-event-calendar-service";
import { deriveCycleInfoFromSessions } from "./coach-library-helpers";
import { getDateString } from "@/lib/date-helpers";
import type { TrainingEventInsert, CoachSavedExerciseRow } from "@/lib/database-helpers";
import type { Json } from "@/types/database";
import type { SavedSession, SavedExercise } from "@/types/training";
import type { SetSpec } from "@/utils/exercise-set-specs";
import type { InlinePlanBody } from "@/lib/validations/training";

// --- Shape used by both DB-backed and inline (in-memory) placements ---

// NOTE: no cycleLength/restPattern here. The whole authored program is the
// repeat unit, and placement derives its own `cycleSlots` from the session rows
// (see placePlaceablePlanOnCalendar). The library plan's cycle_length /
// rest_pattern COLUMNS still exist as derived metadata, but placement does not
// read them — carrying them on this shape only invited that mistake.
export type PlaceablePlan = {
  name: string;
  splitType: string | null;
  frequencyPerWeek: number | null;
  programDurationWeeks: number | null;
  defaultSurplusPercentage: number | null;
  sessions: SavedSession[];
};

// --- Place a saved plan onto a client's calendar ---

export async function placePlanOnCalendar(params: {
  savedPlanId: string;
  coachId: string;
  clientId: string;
  startDate: string;
  repeatCycles?: number;
  phaseId?: string;
}): Promise<{ planId: string; sessionsCreated: number; eventsCreated: number }> {
  const { savedPlanId, coachId, clientId, startDate, repeatCycles, phaseId } = params;

  // 1. Fetch saved plan with sessions + exercises
  const savedPlan = await getSavedPlanById(savedPlanId, coachId);
  if (!savedPlan) throw new Error("Saved plan not found");
  if (savedPlan.status !== "saved") throw new Error("Only saved plans can be placed on calendar");

  return placePlaceablePlanOnCalendar({
    plan: savedPlan,
    savedPlanId,
    coachId,
    clientId,
    startDate,
    repeatCycles,
    phaseId,
  });
}

// --- Place an EDITED working copy (not a saved template) onto a calendar ---

/**
 * Apply-without-overwrite: materialize a coach's edited working copy onto a
 * client's calendar WITHOUT mutating the library template. Stamps
 * saved_plan_id = NULL — an edited copy is not a copy of any single template, so
 * it carries no template link (this is both IDOR-safe, since no body-supplied
 * template id is trusted, and semantically honest; see the Phase 1 plan). Cycle
 * metadata is re-derived from the edited structure so a moved/removed rest day
 * rotates correctly, and any exercise_id from the (client-tampered) working copy
 * that isn't in the coach's own+global catalog is nulled before it is written.
 */
export async function placeInlineEditedPlanOnCalendar(params: {
  plan: InlinePlanBody;
  coachId: string;
  clientId: string;
  startDate: string;
  repeatCycles?: number;
  phaseId?: string;
}): Promise<{ planId: string; sessionsCreated: number; eventsCreated: number }> {
  const { plan, coachId, clientId, startDate, repeatCycles, phaseId } = params;

  const { frequencyPerWeek } = deriveCycleInfoFromSessions(
    plan.sessions.map((s) => ({
      weekIndex: s.weekIndex,
      orderIndex: s.orderIndex,
      isRest: s.isRest,
    })),
  );

  const ownedExerciseIds = await fetchOwnedExerciseIds(coachId);

  const placeable: PlaceablePlan = {
    name: plan.name,
    splitType: plan.splitType ?? null,
    frequencyPerWeek,
    programDurationWeeks: plan.programDurationWeeks ?? null,
    defaultSurplusPercentage: plan.defaultSurplusPercentage ?? null,
    sessions: plan.sessions.map((s) => inlineSessionToSaved(s, ownedExerciseIds)),
  };

  return placePlaceablePlanOnCalendar({
    plan: placeable,
    savedPlanId: null, // edited copy -> no template link (IDOR-safe + honest)
    coachId,
    clientId,
    startDate,
    repeatCycles,
    phaseId,
  });
}

/** Set of exercise ids the coach may reference: their own + global catalog. */
async function fetchOwnedExerciseIds(coachId: string): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin
    .from("exercises")
    .select("id")
    .or(`coach_id.eq.${coachId},coach_id.is.null`);
  if (error) throw new Error(`Failed to load exercise catalog: ${error.message}`);
  return new Set((data ?? []).map((r) => r.id));
}

// Map a validated inline-body session/exercise to the SavedSession/SavedExercise
// shape placePlaceablePlanOnCalendar consumes. Ids/timestamps are placeholders —
// the placement inserts fresh rows and never reads the source ids. A foreign
// exercise_id (not in the coach's own+global catalog) is nulled.
function inlineSessionToSaved(
  s: InlinePlanBody["sessions"][number],
  ownedExerciseIds: Set<string>,
): SavedSession {
  return {
    id: "",
    coachId: "",
    savedPlanId: null,
    name: s.name,
    focus: s.focus ?? null,
    orderIndex: s.orderIndex,
    weekIndex: s.weekIndex ?? 0,
    isRest: s.isRest,
    estimatedDurationMinutes: s.estimatedDurationMinutes ?? null,
    calorieSurplusPercentage: s.calorieSurplusPercentage ?? null,
    notes: s.notes ?? null,
    // SavedSessionType is the single literal 'training'; the placement path
    // doesn't read this field anyway (it clones into training_sessions).
    sessionType: "training",
    exercises: s.exercises.map((e) => inlineExerciseToSaved(e, ownedExerciseIds)),
    createdAt: "",
    updatedAt: "",
  };
}

function inlineExerciseToSaved(
  e: InlinePlanBody["sessions"][number]["exercises"][number],
  ownedExerciseIds: Set<string>,
): SavedExercise {
  return {
    id: "",
    savedSessionId: "",
    exerciseId: e.exerciseId && ownedExerciseIds.has(e.exerciseId) ? e.exerciseId : null,
    name: e.name,
    orderIndex: e.orderIndex,
    sets: e.sets,
    repsMin: e.repsMin ?? null,
    repsMax: e.repsMax ?? null,
    repsTarget: e.repsTarget ?? null,
    rpeTarget: e.rpeTarget ?? null,
    percentage1rm: e.percentage1rm ?? null,
    tempo: e.tempo ?? null,
    restSeconds: e.restSeconds ?? null,
    supersetGroup: e.supersetGroup ?? null,
    isWarmup: e.isWarmup ?? false,
    notes: e.notes ?? null,
    setSpecs: (e.setSpecs ?? null) as SetSpec[] | null,
    videoUrl: e.videoUrl ?? null,
    createdAt: "",
    updatedAt: "",
  };
}

async function placePlaceablePlanOnCalendar(params: {
  plan: PlaceablePlan;
  savedPlanId: string | null;
  coachId: string;
  clientId: string;
  startDate: string;
  repeatCycles?: number;
  phaseId?: string;
}): Promise<{ planId: string; sessionsCreated: number; eventsCreated: number }> {
  const {
    plan: savedPlan,
    savedPlanId,
    coachId,
    clientId,
    startDate,
    repeatCycles,
    phaseId,
  } = params;

  // The whole authored program (every week, ordered by (week_index, order_index))
  // is the repeat unit. Rest slots are cloned too so the placed plan is
  // self-describing about rest; the event generator below emits for non-rest slots
  // only. Every slot is a real row — a missing rest row would collapse the week.
  const cycleSlots = [...savedPlan.sessions].sort(
    (a, b) => a.weekIndex - b.weekIndex || a.orderIndex - b.orderIndex,
  );

  // 2. Compute the incoming plan's own window end FIRST (capped at the next
  //    coexisting plan's start). It bounds BOTH the RPC's additive delete and the
  //    event generation below to exactly the same range, so re-placing the same
  //    window is idempotent and non-overlapping plans coexist untouched. Length =
  //    (repeat count, default 1) × the whole-program slot count.
  const endDate = await calculatePlacementEndDate({
    phaseId,
    clientId,
    cycleLength: cycleSlots.length,
    repeatCycles: repeatCycles ?? null,
    startDate,
  });

  // 3. Additively insert the new plan as provenance and clear ONLY its own
  //    future window (the RPC no longer archives prior plans or wipes the
  //    calendar). Non-overlapping plans coexist; an overlapping placement wins
  //    only on its contested dates.
  const newPlanId = await createTrainingPlanAtomic({
    clientId,
    coachId,
    name: savedPlan.name,
    description: undefined,
    coachPrompt: "",
    splitType: savedPlan.splitType || "custom",
    // training_plans.frequency_per_week has CHECK (>= 1 AND <= 7); a 0 fallback
    // (or a stale unclamped multi-week total on an old plan row) fails the RPC.
    frequencyPerWeek: Math.min(7, Math.max(1, savedPlan.frequencyPerWeek || 1)),
    // Still written as plan metadata / RPC arg even though the placement window is
    // now driven by the repeat count × whole-program length, not this value.
    programDurationWeeks: savedPlan.programDurationWeeks ?? undefined,
    phaseId,
    effectiveFrom: startDate,
    windowEnd: endDate,
    // null -> inline placement (edited working copy), don't link back to any
    // library template. The helper normalizes falsy values to null for the RPC.
    savedPlanId: savedPlanId ?? undefined,
  });

  // 4. Clone EVERY slot (training + rest) in program order so the placed plan is
  //    self-describing about rest. Rest rows carry is_rest = true, no exercises,
  //    and null surplus. `clonedSlots` is the ordered cycle the event walk tiles.
  const clonedSlots: Array<{
    id: string;
    isRest: boolean;
    name: string;
    focus: string | null;
    calorieSurplusPercentage: number | null;
    estimatedCalories: number | null;
  }> = [];

  for (const savedSession of cycleSlots) {
    const surplusPercentage = savedSession.isRest
      ? null
      : savedSession.calorieSurplusPercentage ?? savedPlan.defaultSurplusPercentage ?? null;

    const { data: clonedSession, error: sessionError } = await supabaseAdmin
      .from("training_sessions")
      .insert({
        plan_id: newPlanId,
        name: savedSession.isRest ? "Rest" : savedSession.name,
        day_of_week: null,
        order_index: savedSession.orderIndex,
        week_index: savedSession.weekIndex,
        is_rest: savedSession.isRest,
        focus: savedSession.isRest ? null : savedSession.focus ?? null,
        notes: null,
        estimated_duration_minutes: savedSession.estimatedDurationMinutes ?? null,
        calorie_surplus_percentage: surplusPercentage,
        is_active: true,
      })
      .select("id")
      .single();

    if (sessionError || !clonedSession) {
      throw new Error(`Failed to clone session "${savedSession.name}": ${sessionError?.message}`);
    }

    // Clone exercises for training slots only (rest slots have none). Splat the
    // per-set model verbatim — the source row's compact columns are already the
    // correct projection of its set_specs.
    if (!savedSession.isRest && savedSession.exercises.length > 0) {
      const exerciseInserts = [...savedSession.exercises]
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((ex: SavedExercise) => ({
          session_id: clonedSession.id,
          name: ex.name,
          exercise_id: ex.exerciseId ?? null,
          order_index: ex.orderIndex,
          sets: ex.sets,
          reps_min: ex.repsMin ?? null,
          reps_max: ex.repsMax ?? null,
          reps_target: ex.repsTarget ?? null,
          rpe_target: ex.rpeTarget ?? null,
          percentage_1rm: ex.percentage1rm ?? null,
          tempo: ex.tempo ?? null,
          rest_seconds: ex.restSeconds ?? null,
          notes: ex.notes ?? null,
          superset_group: ex.supersetGroup ?? null,
          is_warmup: ex.isWarmup ?? false,
          set_specs: (ex.setSpecs ?? null) as unknown as Json,
          video_url: ex.videoUrl ?? null,
          is_active: true,
        }));

      const { error: exError } = await supabaseAdmin
        .from("training_exercises")
        .insert(exerciseInserts);

      if (exError) throw new Error(`Failed to clone exercises: ${exError.message}`);
    }

    clonedSlots.push({
      id: clonedSession.id,
      isRest: savedSession.isRest,
      name: savedSession.isRest ? "Rest" : savedSession.name,
      focus: savedSession.isRest ? null : savedSession.focus ?? null,
      calorieSurplusPercentage: surplusPercentage,
      estimatedCalories: null,
    });
  }

  // 5. Generate cycle-aware events (same window the RPC just cleared). Rest slots
  //    advance the cycle position but emit no event.
  const eventsCreated = await generateCycleAwareEvents({
    clientId,
    planId: newPlanId,
    cycleSlots: clonedSlots,
    startDate,
    endDate,
  });

  return {
    planId: newPlanId,
    sessionsCreated: clonedSlots.filter((s) => !s.isRest).length,
    eventsCreated,
  };
}

// --- Place a single saved session onto a client's calendar ---

export async function placeSessionOnCalendar(params: {
  savedSessionId: string;
  coachId: string;
  clientId: string;
  planId: string;
  targetDate: string;
}): Promise<{ sessionId: string; eventId: string }> {
  const { savedSessionId, coachId, clientId, planId, targetDate } = params;

  // 1. Fetch saved session with exercises
  const { data: savedSession, error: fetchError } = await supabaseAdmin
    .from("coach_saved_sessions")
    .select("*, coach_saved_exercises(*)")
    .eq("id", savedSessionId)
    .eq("coach_id", coachId)
    .single();

  if (fetchError || !savedSession) throw new Error("Saved session not found");

  // 2. Phase boundary validation
  await validatePhaseBounds(planId, targetDate);

  // 3. Clone session
  const { data: clonedSession, error: sessionError } = await supabaseAdmin
    .from("training_sessions")
    .insert({
      plan_id: planId,
      name: savedSession.name,
      day_of_week: null,
      order_index: savedSession.order_index,
      week_index: savedSession.week_index ?? 0,
      is_rest: false,
      focus: savedSession.focus ?? null,
      notes: savedSession.notes ?? null,
      estimated_duration_minutes: savedSession.estimated_duration_minutes ?? null,
      calorie_surplus_percentage: savedSession.calorie_surplus_percentage ?? null,
      is_active: true,
    })
    .select("id")
    .single();

  if (sessionError || !clonedSession) {
    throw new Error(`Failed to clone session: ${sessionError?.message}`);
  }

  // 4. Clone exercises
  const exercises = (savedSession.coach_saved_exercises ?? []).sort(
    (a: CoachSavedExerciseRow, b: CoachSavedExerciseRow) => a.order_index - b.order_index
  );

  if (exercises.length > 0) {
    const exerciseInserts = exercises.map((ex: CoachSavedExerciseRow) => ({
      session_id: clonedSession.id,
      name: ex.name,
      exercise_id: ex.exercise_id ?? null,
      order_index: ex.order_index,
      sets: ex.sets,
      reps_min: ex.reps_min ?? null,
      reps_max: ex.reps_max ?? null,
      reps_target: ex.reps_target ?? null,
      rpe_target: ex.rpe_target ?? null,
      percentage_1rm: ex.percentage_1rm ?? null,
      tempo: ex.tempo ?? null,
      rest_seconds: ex.rest_seconds ?? null,
      notes: ex.notes ?? null,
      superset_group: ex.superset_group ?? null,
      is_warmup: ex.is_warmup ?? false,
      set_specs: ex.set_specs ?? null,
      video_url: ex.video_url ?? null,
      is_active: true,
    }));

    const { error: exError } = await supabaseAdmin
      .from("training_exercises")
      .insert(exerciseInserts);

    if (exError) throw new Error(`Failed to clone exercises: ${exError.message}`);
  }

  // 5. Create single event
  const { data: event, error: eventError } = await supabaseAdmin
    .from("training_events")
    .insert({
      client_id: clientId,
      training_plan_id: planId,
      training_session_id: clonedSession.id,
      date: targetDate,
      session_name: savedSession.name,
      session_focus: savedSession.focus ?? null,
      calorie_surplus_percentage: savedSession.calorie_surplus_percentage ?? null,
      status: "scheduled",
      is_modified: true,
    })
    .select("id")
    .single();

  if (eventError || !event) {
    throw new Error(`Failed to create event: ${eventError?.message}`);
  }

  return { sessionId: clonedSession.id, eventId: event.id };
}

// --- Internal helpers ---

/**
 * Generate cycle-aware training events by walking calendar dates and tiling the
 * ordered program slots — the whole authored program (all weeks) is the repeat
 * unit. Each calendar day maps to cycleSlots[cyclePosition]; a rest slot advances
 * the position but emits NO event, so a rest day never spawns a training_event
 * (it still consumes its date). Each slot references a distinct cloned session id,
 * so re-tiling across repeats reuses ids and the (client, session, date) upsert
 * stays idempotent.
 */
async function generateCycleAwareEvents(params: {
  clientId: string;
  planId: string;
  cycleSlots: Array<{
    id: string;
    isRest: boolean;
    name: string;
    focus: string | null;
    calorieSurplusPercentage: number | null;
    estimatedCalories: number | null;
  }>;
  startDate: string;
  endDate: string;
}): Promise<number> {
  const { clientId, planId, cycleSlots, startDate, endDate } = params;

  const cycleLength = cycleSlots.length;
  if (cycleLength === 0) return 0;

  const rows: TrainingEventInsert[] = [];
  const start = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");
  let cyclePosition = 0;

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const slot = cycleSlots[cyclePosition];
    if (!slot.isRest) {
      rows.push({
        client_id: clientId,
        training_plan_id: planId,
        training_session_id: slot.id,
        date: getDateString(d),
        session_name: slot.name,
        session_focus: slot.focus ?? null,
        estimated_calories: slot.estimatedCalories ?? null,
        calorie_surplus_percentage: slot.calorieSurplusPercentage ?? null,
        status: "scheduled",
        is_modified: false,
      });
    }
    cyclePosition = (cyclePosition + 1) % cycleLength;
  }

  if (rows.length === 0) return 0;

  const { error } = await supabaseAdmin
    .from("training_events")
    .upsert(rows, {
      onConflict: "client_id,training_session_id,date",
      ignoreDuplicates: true,
    });

  if (error) throw new Error(`Failed to generate events: ${error.message}`);

  return rows.length;
}

/**
 * Calculate the placement window end date. The program length is the ONLY length
 * knob: (repeat count, default 1) × the whole-program slot count in days. There is
 * deliberately no programDurationWeeks or 8-week fallback — an empty "Repeat
 * Cycles" box means place exactly one pass of the authored program. The client's
 * containing phase end is a MAXIMUM cap only (a program never runs past it and
 * never stretches to fill it), as is the start of the next coexisting plan.
 */
async function calculatePlacementEndDate(params: {
  phaseId?: string;
  clientId: string;
  cycleLength: number;
  repeatCycles: number | null;
  startDate: string;
}): Promise<string> {
  const { phaseId, clientId, cycleLength, repeatCycles, startDate } = params;

  // Program length = (repeat count, default 1) × whole-program slot count.
  const repeats = repeatCycles && repeatCycles > 0 ? repeatCycles : 1;
  const days = Math.max(1, cycleLength) * repeats;
  const durationEnd = new Date(startDate + "T00:00:00");
  durationEnd.setDate(durationEnd.getDate() + days - 1);
  let computedEnd = getDateString(durationEnd);

  // Resolve the client's containing phase end (explicit phase, else the phase that
  // contains startDate) and apply it as a MAX cap only.
  let phaseEndDate: string | null = null;
  if (phaseId) {
    const { data: phase } = await supabaseAdmin
      .from("phases")
      .select("end_date, start_date, duration_weeks")
      .eq("id", phaseId)
      .maybeSingle();

    if (phase?.end_date) {
      phaseEndDate = phase.end_date;
    } else if (phase?.start_date && phase?.duration_weeks) {
      const d = new Date(phase.start_date + "T00:00:00");
      d.setDate(d.getDate() + phase.duration_weeks * 7 - 1);
      phaseEndDate = getDateString(d);
    }
  } else {
    // No explicit phase — look up the client's phase containing startDate and cap by it.
    const { data: containingPhase } = await supabaseAdmin
      .from("phases")
      .select("end_date, start_date, duration_weeks")
      .eq("client_id", clientId)
      .in("status", ["active", "planned"])
      .lte("start_date", startDate)
      .gte("end_date", startDate)
      .order("start_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (containingPhase?.end_date) {
      phaseEndDate = containingPhase.end_date;
    } else if (containingPhase?.start_date && containingPhase?.duration_weeks) {
      const d = new Date(containingPhase.start_date + "T00:00:00");
      d.setDate(d.getDate() + containingPhase.duration_weeks * 7 - 1);
      phaseEndDate = getDateString(d);
    }
  }

  if (phaseEndDate && phaseEndDate < computedEnd) computedEnd = phaseEndDate;

  // Additive placement: never let this plan's window bleed past the start of a
  // later coexisting plan.
  const nextPlanCap = await getNextPlanStartCap(clientId, startDate);
  if (nextPlanCap && nextPlanCap < computedEnd) return nextPlanCap;
  return computedEnd;
}
