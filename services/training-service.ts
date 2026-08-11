import { supabaseAdmin } from "./supabase-admin";
import type { TrainingPlan, TrainingSession, TrainingExercise, UpdateTrainingPlanRequest } from "@/types/training";
import type { TrainingPlanUpdate } from "@/lib/database-helpers";
import { mapExerciseRow, mapSessionRow, mapPlanRow } from "./training-mappers";
import { getClientTodayString } from "@/services/today-service";
import { fetchAllByChunkedIds } from "@/lib/paged-fetch";
import { coversDate } from "./training-plan-window";

// Re-export moved functions so existing imports continue to work
export { updateSession, deleteSession, getSessionWithExercises, updateSurplusForFutureEvents } from "./training-session-service";
export { updateExercise, addExercise, deleteExercise } from "./training-exercise-service";

// Fetch sessions with exercises for a plan (shared helper)
const fetchSessionsWithExercises = async (planId: string): Promise<TrainingSession[]> => {
  const { data: sessionRows, error: sessionError } = await supabaseAdmin
    .from("training_sessions")
    .select("*")
    .eq("plan_id", planId)
    .eq("is_active", true)
    // Rest days are real rows on placed multi-week programs (migration 121); this
    // coach-facing workout list excludes them so counts stay workout-only.
    .eq("is_rest", false)
    .order("week_index", { ascending: true })
    .order("order_index", { ascending: true });

  if (sessionError) throw new Error(`Failed to fetch sessions: ${sessionError.message}`);
  const sessionList = sessionRows || [];
  if (sessionList.length === 0) return [];

  const sessionIds = sessionList.map((s) => s.id);
  // Chunked AND paged. Unpaged this truncated at PostgREST's ~1000-row cap,
  // reached by a 5-day program at 29 weeks (5 sessions x 7 exercises = 35
  // rows/week). Because the order was `order_index` alone, the cut was not a
  // tail but a horizontal slice across ALL sessions: every session past the
  // threshold showed its first few exercises and then stopped. This read feeds
  // getActiveTrainingPlan, which reaches the client dashboard, the coach
  // nutrition page and the check-in AI prompt.
  const exerciseRows = await fetchAllByChunkedIds(sessionIds, (chunk, from, to) =>
    supabaseAdmin
      .from("training_exercises")
      .select("*")
      .in("session_id", chunk)
      .eq("is_active", true)
      .order("session_id", { ascending: true })
      .order("order_index", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
    { errorLabel: "exercises" },
  );

  const exercisesBySession = new Map<string, TrainingExercise[]>();
  for (const row of exerciseRows) {
    const sessionId = row.session_id;
    if (!exercisesBySession.has(sessionId)) {
      exercisesBySession.set(sessionId, []);
    }
    exercisesBySession.get(sessionId)!.push(mapExerciseRow(row));
  }

  return sessionList.map((sessionRow) =>
    mapSessionRow(sessionRow, exercisesBySession.get(sessionRow.id) || [])
  );
};

// Get the training plan whose date range covers a specific date. Under additive
// placement, plans are coexisting provenance rows; "active" is date-driven, not
// a status. effective_until stays NULL on placed plans, so resolution falls out
// of effective_from ordering (the latest-started plan whose start <= date).
export const getTrainingPlanForDate = async (
  clientId: string,
  date: string
): Promise<TrainingPlan | null> => {
  const { data: planRow, error: planError } = await coversDate(
    supabaseAdmin
      .from("training_plans")
      .select("*")
      .eq("client_id", clientId)
      .is("deleted_at", null)
      .neq("status", "archived"),
    date
  )
    .order("effective_from", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (planError || !planRow) return null;
  const sessions = await fetchSessionsWithExercises(planRow.id);
  return mapPlanRow(planRow, sessions);
};

/**
 * Lightweight date-driven plan-id lookup - id only, no sessions/exercises.
 * Same window predicate as getTrainingPlanForDate. Used by hot per-write paths
 * (resolvePlanContextForDate's training fallback) that must not pay for
 * fetchSessionsWithExercises. .maybeSingle() so no covering plan resolves to
 * null (clean 422, not a 500).
 */
export const getTrainingPlanIdForDate = async (
  clientId: string,
  date: string
): Promise<string | null> => {
  const { data, error } = await coversDate(
    supabaseAdmin
      .from("training_plans")
      .select("id")
      .eq("client_id", clientId)
      .is("deleted_at", null)
      .neq("status", "archived"),
    date
  )
    .order("effective_from", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch training plan id for date: ${error.message}`);
  }
  return data?.id ?? null;
};

/**
 * The same lookup as getTrainingPlanIdForDate, one column wider.
 *
 * A sibling rather than a widened signature: getTrainingPlanIdForDate is typed
 * `string | null` and getActiveTrainingPlanId below depends on that.
 * Deliberately NOT getTrainingPlanForDate — that one is `select("*")`
 * plus fetchSessionsWithExercises, the ~210 kB payload the coach nutrition tab
 * was rewritten to stop fetching.
 */
export const getTrainingPlanSummaryForDate = async (
  clientId: string,
  date: string
): Promise<{ id: string; name: string } | null> => {
  const { data, error } = await coversDate(
    supabaseAdmin
      .from("training_plans")
      .select("id, name")
      .eq("client_id", clientId)
      .is("deleted_at", null)
      .neq("status", "archived"),
    date
  )
    .order("effective_from", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch training plan summary for date: ${error.message}`);
  }
  return data ? { id: data.id, name: data.name } : null;
};

/** The columns every consumer of the future-plan predicate needs. */
export type NextFutureTrainingPlan = {
  id: string;
  name: string;
  effectiveFrom: string;
  splitType: string;
  frequencyPerWeek: number;
  programDurationWeeks: number | null;
};

/**
 * The soonest plan whose window has not opened yet — the window-flipped twin of
 * getTrainingPlanForDate, and the ONE owner of that predicate.
 *
 * It exists because the predicate was hand-rolled three times and the copy that
 * forgot `.neq("status", "archived")` re-surfaced retired plans as the client's
 * current program: "Delete future sessions" archives every plan without clearing
 * its future `effective_from`, so the next read dug one back out and titled the
 * Training tab with a program that had no sessions behind it.
 *
 * Placement deliberately permits a future start date (only the past is
 * rejected), so a queued program is a supported state, not an edge case.
 */
export const getNextFutureTrainingPlan = async (
  clientId: string,
  date: string
): Promise<NextFutureTrainingPlan | null> => {
  const { data, error } = await supabaseAdmin
    .from("training_plans")
    .select("id, name, effective_from, split_type, frequency_per_week, program_duration_weeks")
    .eq("client_id", clientId)
    .is("deleted_at", null)
    .neq("status", "archived")
    .gt("effective_from", date)
    .order("effective_from", { ascending: true })
    // Tiebreak on created_at, matching getTrainingPlanForDate: two programs
    // queued for the SAME start date otherwise resolve arbitrarily, and this is
    // the sole owner of the predicate for both the Overview card and the
    // Training tab. Newest wins, so a correction placed over a queued program
    // is the one announced.
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    // Degrade to "nothing queued" rather than failing the whole read — both
    // callers render a summary that is still useful without it.
    console.error("Failed to read next future training plan:", error);
    return null;
  }
  if (!data) return null;

  return {
    id: data.id,
    name: data.name,
    effectiveFrom: data.effective_from,
    splitType: data.split_type,
    frequencyPerWeek: data.frequency_per_week,
    programDurationWeeks: data.program_duration_weeks,
  };
};

export type TrainingPlanWindowSummary = {
  id: string;
  name: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
};

/**
 * Every coach-visible plan whose window OVERLAPS [rangeStart, rangeEnd],
 * earliest-starting first — the journey-block facts read ("which programs ran
 * during this block"). An overlap question, not the starts-later question
 * getNextFutureTrainingPlan owns, but it carries the same exclusions
 * (`deleted_at IS NULL`, `status <> 'archived'`) for the same reason: the copy
 * that forgot them re-surfaced retired plans. Overlap is
 * `effective_from <= rangeEnd AND (effective_until >= rangeStart OR open)` —
 * the range-widened form of coversDate's single-date predicate.
 */
export const getTrainingPlansOverlapping = async (
  clientId: string,
  rangeStart: string,
  rangeEnd: string
): Promise<TrainingPlanWindowSummary[]> => {
  const { data, error } = await supabaseAdmin
    .from("training_plans")
    .select("id, name, effective_from, effective_until")
    .eq("client_id", clientId)
    .is("deleted_at", null)
    .neq("status", "archived")
    .lte("effective_from", rangeEnd)
    .or(`effective_until.gte.${rangeStart},effective_until.is.null`)
    .order("effective_from", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch overlapping training plans: ${error.message}`);
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    effectiveFrom: row.effective_from,
    effectiveUntil: row.effective_until,
  }));
};

// The "active" training plan is the provenance plan whose range covers the
// client's local today (date-driven; no status='active' singleton, no promotion).
export const getActiveTrainingPlan = async (clientId: string): Promise<TrainingPlan | null> => {
  const today = await getClientTodayString(clientId);
  return getTrainingPlanForDate(clientId, today);
};

export const getActiveTrainingPlanId = async (
  clientId: string
): Promise<string | null> => {
  const today = await getClientTodayString(clientId);
  return getTrainingPlanIdForDate(clientId, today);
};

// Get training plan by ID
export const getTrainingPlanById = async (planId: string): Promise<TrainingPlan | null> => {
  const { data: planRow, error: planError } = await supabaseAdmin
    .from("training_plans")
    .select("*")
    .eq("id", planId)
    .single();
  if (planError || !planRow) return null;
  const sessions = await fetchSessionsWithExercises(planId);
  return mapPlanRow(planRow, sessions);
};

// Update training plan
export const updateTrainingPlan = async (
  planId: string,
  updates: UpdateTrainingPlanRequest
): Promise<TrainingPlan> => {
  const updateData: Partial<TrainingPlanUpdate> = { updated_at: new Date().toISOString() };

  if (updates.name !== undefined) updateData.name = updates.name;
  if (updates.description !== undefined) updateData.description = updates.description;
  if (updates.status !== undefined) updateData.status = updates.status;
  if (updates.frequencyPerWeek !== undefined) updateData.frequency_per_week = updates.frequencyPerWeek;
  if (updates.programDurationWeeks !== undefined)
    updateData.program_duration_weeks = updates.programDurationWeeks;

  const { error } = await supabaseAdmin
    .from("training_plans")
    .update(updateData)
    .eq("id", planId);

  if (error) throw new Error(`Failed to update plan: ${error.message}`);

  const plan = await getTrainingPlanById(planId);
  if (!plan) throw new Error("Plan not found after update");
  return plan;
};

// Archive training plan
export const archiveTrainingPlan = async (planId: string): Promise<void> => {
  const { error } = await supabaseAdmin
    .from("training_plans")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("id", planId);

  if (error) throw new Error(`Failed to archive plan: ${error.message}`);
};

// Atomically archive old plan + insert new plan via RPC
export const createTrainingPlanAtomic = async (params: {
  clientId: string;
  coachId: string;
  name: string;
  description?: string;
  coachPrompt: string;
  aiResponseRaw?: string;
  splitType: string;
  frequencyPerWeek: number;
  programDurationWeeks?: number;
  clientWeightKg?: number;
  clientBodyFatPercentage?: number;
  clientGoalWeightKg?: number;
  clientTdee?: number;
  avgMood?: number;
  avgEnergy?: number;
  avgSleep?: number;
  avgStress?: number;
  recentAdherencePercentage?: number;
  effectiveFrom?: string;
  savedPlanId?: string;
  /** End of the incoming plan's own window; bounds the RPC's additive delete. */
  windowEnd?: string;
}): Promise<string> => {
  // Client-local today (coach-tz fallback) — computed here, not threaded from
  // callers, so every placement path judges active-vs-planned correctly.
  const pToday = await getClientTodayString(params.clientId);

  const { data: newPlanId, error: rpcError } = await supabaseAdmin
    .rpc("create_training_plan_atomic" as never, {
      p_client_id: params.clientId,
      p_coach_id: params.coachId,
      p_name: params.name,
      p_description: params.description ?? null,
      p_coach_prompt: params.coachPrompt,
      p_ai_response_raw: params.aiResponseRaw ?? null,
      p_split_type: params.splitType,
      p_frequency_per_week: params.frequencyPerWeek,
      p_program_duration_weeks: params.programDurationWeeks ?? null,
      p_client_weight_kg: params.clientWeightKg ?? null,
      p_client_body_fat_percentage: params.clientBodyFatPercentage ?? null,
      p_client_goal_weight_kg: params.clientGoalWeightKg ?? null,
      p_client_tdee: params.clientTdee ?? null,
      p_avg_mood: params.avgMood ?? null,
      p_avg_energy: params.avgEnergy ?? null,
      p_avg_sleep: params.avgSleep ?? null,
      p_avg_stress: params.avgStress ?? null,
      p_recent_adherence_percentage: params.recentAdherencePercentage ?? null,
      p_effective_from: params.effectiveFrom ?? null,
      p_saved_plan_id: params.savedPlanId ?? null,
      p_today: pToday,
      p_window_end: params.windowEnd ?? null,
    } as never) as unknown as { data: string | null; error: { message: string } | null };

  if (rpcError || !newPlanId) {
    throw new Error(`Failed to create training plan atomically: ${rpcError?.message || "No data returned"}`);
  }

  return newPlanId;
};
