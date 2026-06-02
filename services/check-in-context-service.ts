import { supabaseAdmin } from "./supabase-admin";
import { getActiveTrainingPlan } from "./training-service";
import { countEventsInRange, getEventsForDateRange } from "./training-event-service";
import { getNutritionEventsForDateRange } from "./nutrition-event-service";
import { mapNutritionEventToDisplayTarget } from "@/utils/nutrition-event-helpers";
import { getTodayDateString, getTrainingWeekStart, getTrainingWeekEnd } from "@/lib/date-helpers";
import { sanitizeForAIPrompt } from "@/utils/ai-prompt-sanitizer";
import type {
  CheckInTrainingContext,
  CheckInNutritionContext,
  CheckInTrainingEventDetail,
  SessionCompletionQuality,
  DayOfWeek,
} from "@/types/check-in";
import { promoteNutritionPlanIfReady } from "./nutrition-plan-service";

/**
 * Get training context for the check-in form
 * Returns the active training plan's sessions and exercises
 */
export const getCheckInTrainingContext = async (
  clientId: string
): Promise<CheckInTrainingContext> => {
  const plan = await getActiveTrainingPlan(clientId);

  if (!plan) {
    return { hasActivePlan: false, sessions: [] };
  }

  const trainingSessions = plan.sessions;

  return {
    hasActivePlan: true,
    planId: plan.id,
    planName: plan.name,
    sessions: trainingSessions.map((s) => ({
      id: s.id,
      name: s.name,
      dayOfWeek: s.dayOfWeek as DayOfWeek | undefined,
      focus: s.focus,
      exercises: s.exercises.map((e) => ({
        id: e.id,
        name: e.name,
        sets: e.sets,
        repsTarget: e.repsTarget || (e.repsMin && e.repsMax
          ? `${e.repsMin}-${e.repsMax}`
          : e.repsMin?.toString()),
      })),
    })),
  };
};

/**
 * Get nutrition context for the check-in form
 * Returns the client's nutrition targets for display
 */
export const getCheckInNutritionContext = async (
  clientId: string
): Promise<CheckInNutritionContext> => {
  // Promote planned plan if its effective date has arrived
  await promoteNutritionPlanIfReady(clientId);

  const { data: nutritionPlan, error } = await supabaseAdmin
    .from("nutrition_plans")
    .select("baseline_calories, protein_target_g, carb_target_g, fat_target_g, diet_type")
    .eq("client_id", clientId)
    .eq("status", "active")
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !nutritionPlan || !nutritionPlan.baseline_calories) {
    return { hasNutritionPlan: false };
  }

  // Try event-based targets for the current week
  const today = getTodayDateString();
  const weekStart = getTrainingWeekStart(today);
  const weekEnd = getTrainingWeekEnd(today);

  const [events, { data: clientRow }] = await Promise.all([
    getNutritionEventsForDateRange(clientId, weekStart, weekEnd),
    supabaseAdmin.from("clients").select("include_activity_burn").eq("id", clientId).single(),
  ]);
  const includeActivityBurn = clientRow?.include_activity_burn !== false;

  // Use event-based targets (all available events for the week)
  const weeklyTargets: Array<{ day: DayOfWeek; dayLabel: string; isTrainingDay: boolean; calories: number; proteinG: number; carbsG: number; fatG: number }> = events.slice(0, 7).map((event) => {
    const display = mapNutritionEventToDisplayTarget(event, includeActivityBurn);
    return {
      day: display.day as DayOfWeek,
      dayLabel: display.dayLabel,
      isTrainingDay: display.isTrainingDay,
      calories: display.calories,
      proteinG: display.proteinG,
      carbsG: display.carbsG,
      fatG: display.fatG,
    };
  });

  const count = weeklyTargets.length || 1;
  const avgCalories = Math.round(weeklyTargets.reduce((sum, d) => sum + d.calories, 0) / count);
  const avgProteinG = Math.round(weeklyTargets.reduce((sum, d) => sum + d.proteinG, 0) / count);
  const avgCarbsG = Math.round(weeklyTargets.reduce((sum, d) => sum + d.carbsG, 0) / count);
  const avgFatG = Math.round(weeklyTargets.reduce((sum, d) => sum + d.fatG, 0) / count);

  return {
    hasNutritionPlan: true,
    weeklyTargets,
    averageTargets: {
      calories: avgCalories,
      proteinG: avgProteinG,
      carbsG: avgCarbsG,
      fatG: avgFatG,
    },
  };
};

export type CheckInTrainingPeriodStats = {
  sessionsCompleted: number;
  sessionsPlanned: number;
};

/**
 * Get training session stats for the check-in period using training_events
 * (the source of truth for completion — same as the coach-side adherence count).
 * Only events with status='completed' count toward sessionsCompleted; partial,
 * skipped and missed do not. sessionsPlanned is every event in the window.
 */
export const getCheckInTrainingPeriodStats = async (
  clientId: string,
  periodStart: string,
  periodEnd: string
): Promise<CheckInTrainingPeriodStats> => {
  // Count completed events and planned events in parallel
  const [{ count, error }, sessionsPlanned] = await Promise.all([
    // date is the prescribed event date (YYYY-MM-DD)
    // supabaseAdmin: client portal reading own training_events (RLS exception 3)
    supabaseAdmin
      .from("training_events")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .eq("status", "completed")
      .gte("date", periodStart)
      .lte("date", periodEnd),
    countEventsInRange(clientId, periodStart, periodEnd),
  ]);

  if (error) {
    console.error("Error fetching training_events for check-in:", error.message);
  }

  const sessionsCompleted = count ?? 0;

  return { sessionsCompleted, sessionsPlanned };
};

/**
 * Single-source per-event training detail for the check-in period (Session 6.2).
 *
 * `training_events` is the source of truth for completion; each event is
 * LEFT-JOINed (in JS) to its linked `session_log` for notes + completion
 * quality. This MUST be the only place check-in code derives per-event training
 * detail — later sessions (6.3/6.4) reuse it and enrich it.
 *
 * Session 6.3 enrichment: each detail now carries `sessionLogId` (so per-exercise
 * lines, keyed by session_log_id, can be joined to the event) and resolves
 * `performedSessionName` when the linked log's performed session differs from the
 * event's prescribed session (an alt-session swap).
 *
 * At most three queries regardless of event count: one range read of events, one
 * batched read of the referenced session_logs, and (only when at least one swap
 * is detected) one batched read of the performed training_sessions' names.
 */
export async function getTrainingEventDetailsForPeriod(
  clientId: string,
  periodStart: string,
  periodEnd: string
): Promise<CheckInTrainingEventDetail[]> {
  const events = await getEventsForDateRange(clientId, periodStart, periodEnd);
  if (events.length === 0) return [];

  const sessionLogIds = events
    .map((e) => e.sessionLogId)
    .filter((id): id is string => id !== null);

  // LEFT-JOIN map: session_log_id -> { notes, completion_quality, performed session id }
  const logById = new Map<
    string,
    {
      notes: string | null;
      completionQuality: SessionCompletionQuality;
      trainingSessionId: string | null;
    }
  >();
  if (sessionLogIds.length > 0) {
    // supabaseAdmin: client portal reading own session_logs (RLS exception 3)
    const { data, error } = await supabaseAdmin
      .from("session_logs")
      .select("id, notes, completion_quality, training_session_id")
      .in("id", sessionLogIds);
    if (error) {
      console.error("Error fetching session_logs for check-in detail:", error.message);
    }
    for (const row of data ?? []) {
      logById.set(row.id, {
        notes: row.notes,
        completionQuality: row.completion_quality as SessionCompletionQuality,
        trainingSessionId: row.training_session_id,
      });
    }
  }

  // Swap detection: a logged session whose PERFORMED session differs from the
  // event's PRESCRIBED session. Batch-resolve the performed session names.
  const performedNameBySessionId = new Map<string, string>();
  const swappedPerformedIds = new Set<string>();
  for (const e of events) {
    const log = e.sessionLogId ? logById.get(e.sessionLogId) : undefined;
    if (
      log?.trainingSessionId &&
      e.trainingSessionId &&
      log.trainingSessionId !== e.trainingSessionId
    ) {
      swappedPerformedIds.add(log.trainingSessionId);
    }
  }
  if (swappedPerformedIds.size > 0) {
    // supabaseAdmin: client portal reading own training_sessions (RLS exception 3)
    const { data, error } = await supabaseAdmin
      .from("training_sessions")
      .select("id, name")
      .in("id", Array.from(swappedPerformedIds));
    if (error) {
      console.error("Error fetching performed session names for check-in detail:", error.message);
    }
    for (const row of data ?? []) {
      performedNameBySessionId.set(row.id, row.name);
    }
  }

  // events are already ordered by date ascending (getEventsForDateRange).
  return events.map((e) => {
    const log = e.sessionLogId ? logById.get(e.sessionLogId) : undefined;
    const detail: CheckInTrainingEventDetail = {
      eventId: e.id,
      date: e.date,
      sessionName: e.sessionName,
      status: e.status,
      logStatus: e.sessionLogId ? "logged" : "not_logged",
      trainingSessionId: e.trainingSessionId,
      sessionLogId: e.sessionLogId,
    };
    if (log) {
      if (log.notes) detail.notes = log.notes;
      detail.completionQuality = log.completionQuality;
      // Resolve the performed session name only on an actual swap.
      if (
        log.trainingSessionId &&
        e.trainingSessionId &&
        log.trainingSessionId !== e.trainingSessionId
      ) {
        detail.performedSessionName =
          performedNameBySessionId.get(log.trainingSessionId) ?? null;
      }
    }
    return detail;
  });
}

// Cap on per-session exercise lines surfaced to the AI prompt. Keeps the prompt
// size bounded; overflow collapses to a "…and N more" line (Session 6.3).
const MAX_EXERCISE_LINES_PER_SESSION = 8;

/**
 * Per-session exercise summary lines for the check-in AI prompt (Session 6.3).
 *
 * For each logged session (keyed by session_log_id) returns a compact list of
 * one line per logged exercise: `"{name} — {n} sets, top {weight}x{reps} @ RPE
 * {rpe}"` (the ` @ RPE {rpe}` suffix is omitted when the top set's rpe is null).
 * The "top" set is the heaviest (max weight), tie-broken by higher reps —
 * mirroring training-log-service's exercise_logs/set_logs aggregation.
 *
 * Non-blocking (CONVENTIONS §11): any failure returns an empty Map so the AI
 * prompt degrades to the per-event 6.2 detail rather than failing the summary.
 * At most two queries regardless of input size: one batched exercise_logs read,
 * one batched set_logs read.
 */
export async function getExerciseSummariesForPeriod(
  sessionLogIds: string[]
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (sessionLogIds.length === 0) return result;

  try {
    // supabaseAdmin: client portal reading own exercise_logs (RLS exception 3)
    const { data: exerciseRows, error: exErr } = await supabaseAdmin
      .from("exercise_logs")
      .select("id, session_log_id, performed_name, prescribed_exercise_snapshot")
      .in("session_log_id", sessionLogIds);
    if (exErr) {
      console.error("Error fetching exercise_logs for check-in summary:", exErr.message);
      return result;
    }
    const exLogs = exerciseRows ?? [];
    if (exLogs.length === 0) return result;

    const exLogIds = exLogs.map((r) => r.id);
    // supabaseAdmin: client portal reading own set_logs (RLS exception 3)
    const { data: setRows, error: setErr } = await supabaseAdmin
      .from("set_logs")
      .select("*")
      .in("exercise_log_id", exLogIds)
      .order("set_number", { ascending: true });
    if (setErr) {
      console.error("Error fetching set_logs for check-in summary:", setErr.message);
      return result;
    }

    // Group set_logs by exercise_log_id.
    const setsByExLog = new Map<
      string,
      Array<{ reps: number | null; weight: number | null; rpe: number | null }>
    >();
    for (const s of setRows ?? []) {
      const list = setsByExLog.get(s.exercise_log_id) ?? [];
      list.push({ reps: s.reps, weight: s.weight, rpe: s.rpe });
      setsByExLog.set(s.exercise_log_id, list);
    }

    // Build per-session lines, preserving exercise_logs order.
    const linesBySession = new Map<string, string[]>();
    for (const ex of exLogs) {
      const sets = setsByExLog.get(ex.id) ?? [];
      if (sets.length === 0) continue; // no per-set data → nothing to summarize

      const snapshot = ex.prescribed_exercise_snapshot as { name?: string } | null;
      const name = sanitizeForAIPrompt(
        ex.performed_name ?? snapshot?.name ?? "Unknown exercise"
      );

      // Top set: heaviest weight, tie-broken by higher reps. Treat null as -1
      // so sets with data always win over empty ones.
      const topSet = sets.reduce((best, cur) => {
        const bestW = best.weight ?? -1;
        const curW = cur.weight ?? -1;
        if (curW > bestW) return cur;
        if (curW === bestW && (cur.reps ?? -1) > (best.reps ?? -1)) return cur;
        return best;
      });

      const weight = topSet.weight ?? 0;
      const reps = topSet.reps ?? 0;
      let line = `${name} — ${sets.length} sets, top ${weight}x${reps}`;
      if (topSet.rpe != null) line += ` @ RPE ${topSet.rpe}`;

      const list = linesBySession.get(ex.session_log_id) ?? [];
      list.push(line);
      linesBySession.set(ex.session_log_id, list);
    }

    // Apply the per-session input-size cap.
    for (const [sessionLogId, lines] of linesBySession) {
      if (lines.length > MAX_EXERCISE_LINES_PER_SESSION) {
        const kept = lines.slice(0, MAX_EXERCISE_LINES_PER_SESSION);
        kept.push(`…and ${lines.length - MAX_EXERCISE_LINES_PER_SESSION} more`);
        result.set(sessionLogId, kept);
      } else {
        result.set(sessionLogId, lines);
      }
    }

    return result;
  } catch (error) {
    console.error(
      "Error building exercise summaries for check-in:",
      error instanceof Error ? error.message : "Unknown error"
    );
    return new Map();
  }
}
