import { supabaseAdmin } from "./supabase-admin";
import { getActiveTrainingPlan } from "./training-service";
import { getNutritionPlanForDate } from "./nutrition-plan-service";
import { getEventsForDateRange } from "./training-event-service";
import { getNutritionEventsForDateRange } from "./nutrition-days-service";
import { mapNutritionEventToDisplayTarget } from "@/utils/nutrition-event-helpers";
import { getTrainingWeekStart, getTrainingWeekEnd } from "@/lib/date-helpers";
import { getClientTodayString } from "./today-service";
import { getClientWeekAnchor } from "./check-in-week-service";
import { sanitizeForAIPrompt } from "@/utils/ai-prompt-sanitizer";
import type {
  CheckInTrainingContext,
  CheckInNutritionContext,
  CheckInTrainingEventDetail,
  DayOfWeek,
} from "@/types/check-in";
import { sessionExercises } from "@/utils/exercise-groups";

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
      exercises: sessionExercises(s).map((e) => ({
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
  // Client-local today: the check-in form's "current week" targets must agree
  // with the gate/period (also client-local) — at 00:30 local just past a UTC
  // week rollover, server-UTC today would show last week's targets. The week
  // ANCHOR is fetched alongside for the same reason: this window used to be
  // hard-Mon-Sun for every client, so a Wednesday client's "current week"
  // targets covered a different seven days from the period they were about to
  // report on.
  const [today, { weekday: checkInDay }] = await Promise.all([
    getClientTodayString(clientId),
    getClientWeekAnchor(clientId),
  ]);

  // Versioned model (migration 144): the gate is COVERING-existence — is a
  // version governing the client's today? The row is used only as this gate
  // (real targets come from the week's events below), and a queued-only chain
  // correctly reads as "no targets this week yet".
  const nutritionPlan = await getNutritionPlanForDate(clientId, today).catch((err) => {
    console.error("Check-in nutrition context plan lookup failed:", err);
    return null;
  });

  if (!nutritionPlan || !nutritionPlan.baseline_calories) {
    return { hasNutritionPlan: false };
  }

  // Try event-based targets for the current week
  const weekStart = getTrainingWeekStart(today, checkInDay);
  const weekEnd = getTrainingWeekEnd(today, checkInDay);

  const [events, { data: clientRow }] = await Promise.all([
    getNutritionEventsForDateRange(clientId, weekStart, weekEnd),
    supabaseAdmin
      .from("clients")
      .select("include_activity_burn, surplus_as_carbs")
      .eq("id", clientId)
      .single(),
  ]);
  const includeActivityBurn = clientRow?.include_activity_burn !== false;
  const surplusAsCarbs = clientRow?.surplus_as_carbs === true;

  // Use event-based targets (all available events for the week)
  const weeklyTargets: Array<{ day: DayOfWeek; dayLabel: string; isTrainingDay: boolean; calories: number; proteinG: number; carbsG: number; fatG: number }> = events.slice(0, 7).map((event) => {
    const display = mapNutritionEventToDisplayTarget(event, includeActivityBurn, surplusAsCarbs);
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

/**
 * Single-source per-workout training detail for the check-in period
 * (Session 6.2). Every check-in surface that shows or counts the period's
 * training reads THIS — the wizard's rows and stats, both single check-in
 * reads, and the AI prompt.
 *
 * `training_events` says whether each workout was logged; its own log, embedded
 * on the range read through the named foreign key, says how it went. The
 * quality is therefore always on the row — null when the client has not logged
 * it — and no reader derives it from the status word.
 *
 * Two queries regardless of workout count: one range read of the events with
 * their logs, and (only when at least one swap is detected) one batched read of
 * the performed `training_sessions`' names.
 */
export async function getTrainingEventDetailsForPeriod(
  clientId: string,
  periodStart: string,
  periodEnd: string
): Promise<CheckInTrainingEventDetail[]> {
  const events = await getEventsForDateRange(clientId, periodStart, periodEnd);
  if (events.length === 0) return [];

  // Swap detection: a logged session whose PERFORMED session differs from the
  // event's PRESCRIBED session. Batch-resolve the performed session names.
  const performedSessionIdOf = (event: (typeof events)[number]): string | null => {
    const performedId = event.log?.performedSessionId ?? null;
    if (!performedId || !event.trainingSessionId) return null;
    return performedId === event.trainingSessionId ? null : performedId;
  };

  const performedNameBySessionId = new Map<string, string>();
  const swappedPerformedIds = new Set<string>();
  for (const e of events) {
    const performedId = performedSessionIdOf(e);
    if (performedId) swappedPerformedIds.add(performedId);
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

  // Events are already in calendar order — by date, a day's sessions in the
  // day's order (getEventsForDateRange) — so a day holding several lists each.
  return events.map((e) => {
    const detail: CheckInTrainingEventDetail = {
      eventId: e.id,
      date: e.date,
      sessionName: e.sessionName,
      status: e.status,
      logStatus: e.sessionLogId ? "logged" : "not_logged",
      // Always set, so the row itself is a `TrainingWorkoutRead`: null is "the
      // client has not logged this", and every reader — the wizard's rows, the
      // review's pills, the AI prompt and `summariseTraining` — reads how the
      // workout went from here rather than from `status`.
      completionQuality: e.log?.completionQuality ?? null,
      trainingSessionId: e.trainingSessionId,
      sessionLogId: e.sessionLogId,
    };
    if (e.log?.notes) detail.notes = e.log.notes;
    const performedId = performedSessionIdOf(e);
    if (performedId) {
      detail.performedSessionName = performedNameBySessionId.get(performedId) ?? null;
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
