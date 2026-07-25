import { supabaseAdmin } from "./supabase-admin";
import { getSavedPlanById } from "./coach-saved-plan-service";
import { createTrainingPlanAtomic } from "./training-service";
import { deriveFrequencyPerWeek } from "./coach-library-helpers";
import { generateProgramEvents, calculatePlacementEndDate } from "./program-event-walk";
import type { TrainingEventInsert, TrainingEventRow, CoachSavedExerciseRow } from "@/lib/database-helpers";
import type { Json } from "@/types/database";
import type { SavedSession, SavedExercise } from "@/types/training";
import type { SetSpec } from "@/utils/exercise-set-specs";
import type { InlinePlanBody } from "@/lib/validations/training";

// --- Shape used by both DB-backed and inline (in-memory) placements ---

// NOTE: no derived length metadata here. Placement derives its own ordered
// `programSlots` from the session rows (see placePlaceablePlanOnCalendar) —
// the session rows are the only truth about program shape.
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
}): Promise<{ planId: string; sessionsCreated: number; eventsCreated: number }> {
  const { savedPlanId, coachId, clientId, startDate } = params;

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
  });
}

// --- Place an EDITED working copy (not a saved template) onto a calendar ---

/**
 * Apply-without-overwrite: materialize a coach's edited working copy onto a
 * client's calendar WITHOUT mutating the library template. Stamps
 * saved_plan_id = NULL — an edited copy is not a copy of any single template, so
 * it carries no template link (this is both IDOR-safe, since no body-supplied
 * template id is trusted, and semantically honest; see the Phase 1 plan).
 * frequency_per_week is re-derived from the edited structure, and any
 * exercise_id from the (client-tampered) working copy that isn't in the coach's
 * own+global catalog is nulled before it is written.
 */
export async function placeInlineEditedPlanOnCalendar(params: {
  plan: InlinePlanBody;
  coachId: string;
  clientId: string;
  startDate: string;
}): Promise<{ planId: string; sessionsCreated: number; eventsCreated: number }> {
  const { plan, coachId, clientId, startDate } = params;

  const frequencyPerWeek = deriveFrequencyPerWeek(
    plan.sessions.map((s) => ({
      weekIndex: s.weekIndex,
      isRest: s.isRest,
    })),
  );

  const referencedExerciseIds = plan.sessions.flatMap((s) =>
    s.exercises
      .map((e) => e.exerciseId)
      .filter((id): id is string => Boolean(id)),
  );
  const ownedExerciseIds = await fetchVisibleExerciseIds(coachId, referencedExerciseIds);

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
  });
}

// Max ids per `.in()` request. Neither `sessions[]` nor `exercises[]` is capped
// by the zod schema, so a long program's id list must be chunked to stay under
// the PostgREST request-line length ceiling.
const EXERCISE_ID_CHUNK = 150;

/**
 * Of `referencedIds`, the subset the coach may actually reference (their own +
 * the global catalog).
 *
 * Inverted on purpose. The previous shape loaded the WHOLE catalog and checked
 * membership, which silently truncated at PostgREST's 1000-row cap — the global
 * tier alone is 1512 rows, so ~512 valid ids fell out of the set and were nulled
 * as "foreign" on every placement, unrecoverably. Filtering by the ids this plan
 * actually references is bounded by plan size, not catalog size, and stays
 * correct at any scale. Same shape as coach-standalone-session-service.ts:67.
 *
 * Exported for the plan-amendment writer, which applies the same foreign-id
 * belt to its fresh future rows.
 */
export async function fetchVisibleExerciseIds(
  coachId: string,
  referencedIds: string[],
): Promise<Set<string>> {
  const unique = [...new Set(referencedIds)];
  const visible = new Set<string>();

  for (let i = 0; i < unique.length; i += EXERCISE_ID_CHUNK) {
    const chunk = unique.slice(i, i + EXERCISE_ID_CHUNK);
    const { data, error } = await supabaseAdmin
      .from("exercises")
      .select("id")
      .in("id", chunk)
      .or(`coach_id.eq.${coachId},coach_id.is.null`);
    if (error) throw new Error(`Failed to validate exercise ids: ${error.message}`);
    for (const row of data ?? []) visible.add(row.id);
  }

  return visible;
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

// H3 recoverability: `createTrainingPlanAtomic` commits its window DELETE +
// plan INSERT, then the service clones sessions and generates events OUTSIDE any
// transaction. A failure between them would leave the client's scheduled events
// deleted with nothing (or a partial plan) to replace them. Snapshot the
// scheduled events the RPC is about to delete BEFORE calling it, and restore
// them if the post-RPC work throws. Best-effort: a hard process kill between the
// RPC and the catch still loses the window (repair = re-place, event gen is an
// idempotent upsert). Bounded to <= ~1yr of events by the H5 window cap; paged.
async function snapshotWindowEvents(
  clientId: string,
  from: string,
  to: string,
): Promise<TrainingEventRow[]> {
  const rows: TrainingEventRow[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("training_events")
      .select("*")
      .eq("client_id", clientId)
      .eq("status", "scheduled")
      .gte("date", from)
      .lte("date", to)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) {
      throw new Error(`Failed to snapshot placement window: ${error.message}`);
    }
    if (!Array.isArray(data) || data.length === 0) break;
    rows.push(...(data as TrainingEventRow[]));
    if (data.length < PAGE) break;
  }
  return rows;
}

// Undo a failed placement: remove the partially-created plan (events FIRST — the
// event->plan FK is ON DELETE SET NULL, so deleting the plan first would strand
// ghost events), then restore the pre-RPC window snapshot. Never shadows the
// root cause — on a cleanup failure it augments the thrown message with the
// repair path.
async function compensatePlacement(params: {
  newPlanId: string;
  snapshot: TrainingEventRow[];
  rootErr: unknown;
}): Promise<never> {
  const { newPlanId, snapshot, rootErr } = params;
  const problems: string[] = [];

  const { error: evErr } = await supabaseAdmin
    .from("training_events")
    .delete()
    .eq("training_plan_id", newPlanId);
  if (evErr) problems.push(`event cleanup: ${evErr.message}`);

  const { error: planErr } = await supabaseAdmin
    .from("training_plans")
    .delete()
    .eq("id", newPlanId);
  if (planErr) problems.push(`plan cleanup: ${planErr.message}`);

  // The window is now clear of scheduled events (RPC deleted the old ones; the
  // step above deleted the new plan's). Re-insert the snapshot verbatim.
  for (let i = 0; i < snapshot.length; i += 500) {
    const chunk = snapshot.slice(i, i + 500) as unknown as TrainingEventInsert[];
    const { error: restoreErr } = await supabaseAdmin
      .from("training_events")
      .insert(chunk);
    if (restoreErr) {
      problems.push(`window restore: ${restoreErr.message}`);
      break;
    }
  }

  const rootMsg = rootErr instanceof Error ? rootErr.message : String(rootErr);
  if (problems.length > 0) {
    throw new Error(
      `${rootMsg}; placement compensation incomplete (${problems.join("; ")}) — re-place the plan to repair the calendar window`,
    );
  }
  throw rootErr instanceof Error ? rootErr : new Error(rootMsg);
}

async function placePlaceablePlanOnCalendar(params: {
  plan: PlaceablePlan;
  savedPlanId: string | null;
  coachId: string;
  clientId: string;
  startDate: string;
}): Promise<{ planId: string; sessionsCreated: number; eventsCreated: number }> {
  const {
    plan: savedPlan,
    savedPlanId,
    coachId,
    clientId,
    startDate,
  } = params;

  // The whole authored program (every week, ordered by (week_index, order_index))
  // placed exactly once. Rest slots are cloned too so the placed plan is
  // self-describing about rest; the event generator below emits for non-rest slots
  // only. Every slot is a real row — a missing rest row would collapse the week.
  const programSlots = [...savedPlan.sessions].sort(
    (a, b) => a.weekIndex - b.weekIndex || a.orderIndex - b.orderIndex,
  );

  // 2. Compute the incoming plan's own window end FIRST (capped at the next
  //    coexisting plan's start). It bounds BOTH the RPC's additive delete and the
  //    event generation below to exactly the same range, so re-placing the same
  //    window is idempotent and non-overlapping plans coexist untouched. Length =
  //    the whole-program slot count.
  const endDate = await calculatePlacementEndDate({
    clientId,
    slotCount: programSlots.length,
    startDate,
  });

  // H3: snapshot the scheduled events the RPC is about to delete, BEFORE it
  // commits, so a failure in the non-transactional clone/event-gen below can
  // restore them. Floor at startDate (a superset of the RPC's GREATEST(from,
  // today) delete) so the restore is exact regardless of the today boundary.
  const windowSnapshot = await snapshotWindowEvents(clientId, startDate, endDate);

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
    effectiveFrom: startDate,
    windowEnd: endDate,
    // null -> inline placement (edited working copy), don't link back to any
    // library template. The helper normalizes falsy values to null for the RPC.
    savedPlanId: savedPlanId ?? undefined,
  });

  // Everything below runs OUTSIDE the RPC's committed transaction. On any
  // failure, undo the partial plan and restore the pre-RPC window snapshot (H3).
  try {
  // 4. Clone EVERY slot (training + rest) in program order so the placed plan is
  //    self-describing about rest. Rest rows carry is_rest = true, no exercises,
  //    and null surplus. `clonedSlots` is the ordered program the event walk maps
  //    onto calendar dates.
  const clonedSlots: Array<{
    id: string;
    isRest: boolean;
    name: string;
    focus: string | null;
    calorieSurplusPercentage: number | null;
    estimatedCalories: number | null;
  }> = [];

  for (const savedSession of programSlots) {
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

  // 5. Generate the events (same window the RPC just cleared). Rest slots
  //    advance the slot position but emit no event.
  const eventsCreated = await generateProgramEvents({
    clientId,
    planId: newPlanId,
    programSlots: clonedSlots,
    startDate,
    endDate,
  });

  return {
    planId: newPlanId,
    sessionsCreated: clonedSlots.filter((s) => !s.isRest).length,
    eventsCreated,
  };
  } catch (err) {
    // Restore the calendar to its pre-placement state, then rethrow (never
    // shadows the root cause; augments it if cleanup itself fails).
    return await compensatePlacement({
      newPlanId,
      snapshot: windowSnapshot,
      rootErr: err,
    });
  }
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

  // 2. Resolve the slot position from the TARGET plan, never the template.
  //    A saved session's (week_index, order_index) describe where it sat in the
  //    program it was authored in; carried into a different plan they are
  //    meaningless. week_index is the dangerous one: the client read treats a
  //    plan as self-describing if ANY entry has week_index > 0, so one dropped
  //    session could flip a whole flat plan onto that branch and change how
  //    every rest day renders. An ad-hoc drop appends after the plan's last slot.
  const { data: lastSlot, error: slotError } = await supabaseAdmin
    .from("training_sessions")
    .select("week_index, order_index")
    .eq("plan_id", planId)
    .eq("is_active", true)
    .order("week_index", { ascending: false })
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (slotError) {
    throw new Error(`Failed to resolve plan slot position: ${slotError.message}`);
  }

  const weekIndex = lastSlot?.week_index ?? 0;
  const orderIndex = (lastSlot?.order_index ?? -1) + 1;

  // 4. Clone session
  const { data: clonedSession, error: sessionError } = await supabaseAdmin
    .from("training_sessions")
    .insert({
      plan_id: planId,
      name: savedSession.name,
      day_of_week: null,
      order_index: orderIndex,
      week_index: weekIndex,
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

  // 5. Clone exercises
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

  // 6. Create single event
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

// The date-walk (generateProgramEvents) and window calculator
// (calculatePlacementEndDate) live in ./program-event-walk — shared with the
// plan-amendment writer, which resumes the walk mid-program via startPosition.
