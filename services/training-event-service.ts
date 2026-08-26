import { supabaseAdmin } from "./supabase-admin";
import type { TrainingEvent, TrainingEventStatus, TrainingEventSummary } from "@/types/training";
import type { SessionCompletionQuality } from "@/types/check-in";
import type { TrainingEventRow, TrainingEventInsert } from "@/lib/database-helpers";
import { getTodayDateString, getDateString, DAY_NUM } from "@/lib/date-helpers";
import { fetchAllByChunkedIds } from "@/lib/paged-fetch";

// --- Row mapper ---

function mapEventRow(row: TrainingEventRow): TrainingEvent {
  return {
    id: row.id,
    clientId: row.client_id,
    trainingPlanId: row.training_plan_id,
    trainingSessionId: row.training_session_id,
    date: row.date,
    sessionName: row.session_name,
    sessionFocus: row.session_focus,
    estimatedCalories: row.estimated_calories,
    status: row.status as TrainingEventStatus,
    sessionLogId: row.session_log_id,
    isModified: row.is_modified,
    calorieSurplusPercentage: row.calorie_surplus_percentage ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// --- Session input type (narrower than full TrainingSession) ---

export type SessionInput = {
  id: string;
  name: string;
  dayOfWeek?: string;
  focus?: string;
  estimatedCalories?: number;
  calorieSurplusPercentage?: number | null;
};

// --- Generate events ---

/**
 * Generate training events for a plan within a date range.
 * Creates one event row per training session per matching date.
 * Uses upsert with ignoreDuplicates to safely handle re-runs.
 *
 * WEEKDAY generator — it filters sessions on `dayOfWeek`, so it is inert on
 * product data (placement writes `day_of_week: null`, migration 121; the
 * product path is `generateProgramEvents`). Kept deliberately for the
 * documented seed script (`scripts/seed-scale-client.ts`, ARCHITECTURE →
 * weekday authoring) and its tests.
 */
export async function generateTrainingEvents(
  clientId: string,
  planId: string,
  sessions: SessionInput[],
  startDate: string,
  endDate: string
): Promise<void> {
  // Keep sessions with a day assigned
  const trainingSessions = sessions.filter((s) => s.dayOfWeek);

  if (trainingSessions.length === 0) return;

  // Build dayNumber → sessions[] map
  const dayMap = new Map<number, SessionInput[]>();
  for (const session of trainingSessions) {
    const dayNum = DAY_NUM[session.dayOfWeek!.toLowerCase()];
    if (dayNum === undefined) continue;
    const existing = dayMap.get(dayNum) ?? [];
    existing.push(session);
    dayMap.set(dayNum, existing);
  }

  // Iterate dates and build insert rows
  const rows: TrainingEventInsert[] = [];
  const start = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const sessionsForDay = dayMap.get(d.getDay());
    if (!sessionsForDay) continue;

    const dateStr = getDateString(d);
    for (const session of sessionsForDay) {
      rows.push({
        client_id: clientId,
        training_plan_id: planId,
        training_session_id: session.id,
        date: dateStr,
        session_name: session.name,
        session_focus: session.focus ?? null,
        estimated_calories: session.estimatedCalories ?? null,
        calorie_surplus_percentage: session.calorieSurplusPercentage ?? null,
        status: "scheduled",
      });
    }
  }

  if (rows.length === 0) return;

  const { error } = await supabaseAdmin
    .from("training_events")
    .upsert(rows, {
      onConflict: "client_id,training_session_id,date",
      ignoreDuplicates: true,
    });

  if (error) throw error;
}

// --- Cancel future events (no regeneration) ---

/**
 * Clear a plan's upcoming calendar without regenerating — the "Delete future
 * sessions" paths, after the plan is archived. Past events (date < fromDate)
 * are untouched history.
 *
 * Two statements, and the split is the point. A future-dated event is not
 * necessarily still `scheduled`: `fromDate` is the client's today, and a
 * client who logged today's session in the morning has a completed event on
 * it when the coach clears the plan in the afternoon. Deleting that row
 * SET-NULLs `session_logs.training_event_id` (migration 097) — the workout
 * survives on the coach's history table but vanishes from the client's app,
 * which reaches its logs through the calendar day, and re-opening that day
 * would overwrite the sets blind. So a logged day is DETACHED from the plan
 * (`training_plan_id` NULL — the same posture as the SET NULL event→plan FK,
 * migration 113) and kept; only still-`scheduled` days are deleted.
 * `status <> 'scheduled'` is the frozen-day predicate `assertSessionUnlogged`
 * and the builder lock already use, and `linkSessionLogToEvent` always writes
 * status with the link, so it covers every logged row without a second rule.
 *
 * Detach runs FIRST. The two writes are not one transaction (CONVENTIONS §2,
 * consistency 13): if the delete then fails, the logged days are already safe
 * and the scheduled rows are still there for the retry the coach's error
 * prompts. The reverse order risks the one outcome this exists to prevent.
 *
 * @param effectiveFrom - Date from which to clear (defaults to today).
 */
export async function cancelFutureEventsForPlan(
  planId: string,
  effectiveFrom?: string
): Promise<void> {
  // UTC fallback only: no clientId in scope to resolve a client-local today,
  // and the live callers pass an explicit (client-local) date.
  const fromDate = effectiveFrom ?? getTodayDateString();

  const { error: detachError } = await supabaseAdmin
    .from("training_events")
    .update({ training_plan_id: null, updated_at: new Date().toISOString() })
    .eq("training_plan_id", planId)
    .gte("date", fromDate)
    .neq("status", "scheduled");

  if (detachError) throw detachError;

  const { error: deleteError } = await supabaseAdmin
    .from("training_events")
    .delete()
    .eq("training_plan_id", planId)
    .gte("date", fromDate)
    .eq("status", "scheduled");

  if (deleteError) throw deleteError;
}

// --- Regenerate future events ---

// --- Next-plan window cap (additive placement) ---

/**
 * The day before the next coexisting plan starts, or null if this is the last
 * plan. Under additive placement, plans own disjoint date windows; this caps
 * event generation so a plan (especially a no-duration one falling back to the
 * 8-week default) never bleeds past the start of a later coexisting plan.
 *
 * Scoped to non-deleted, non-archived rows: the archived filter only matters
 * for pre-migration legacy rows (nothing archives under the new model) but
 * stops a stale archived plan with a later start from over-shortening a live
 * plan's window. Strict `>` is deliberate: two plans sharing the exact same
 * effective_from do NOT cap each other (a degenerate same-day double-placement
 * is a known no-cap case, not a surprise).
 */
export async function getNextPlanStartCap(
  clientId: string,
  planEffectiveFrom: string
): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("training_plans")
    .select("effective_from")
    .eq("client_id", clientId)
    .is("deleted_at", null)
    .neq("status", "archived")
    .gt("effective_from", planEffectiveFrom)
    .order("effective_from", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!data?.effective_from) return null;
  const dayBefore = new Date(data.effective_from + "T00:00:00");
  dayBefore.setDate(dayBefore.getDate() - 1);
  return getDateString(dayBefore);
}

// --- Delete future events ---

// --- Query functions ---

/**
 * Get all events for a client within a date range, ordered by date ascending.
 */
export async function getEventsForDateRange(
  clientId: string,
  startDate: string,
  endDate: string
): Promise<TrainingEvent[]> {
  const { data, error } = await supabaseAdmin
    .from("training_events")
    .select("*")
    .eq("client_id", clientId)
    .gte("date", startDate)
    .lte("date", endDate)
    .order("date", { ascending: true });

  if (error) throw error;
  return (data ?? []).map(mapEventRow);
}

/**
 * Get a single event for a client on a specific date.
 * Returns null if no event exists.
 */
export async function getEventForDate(
  clientId: string,
  date: string
): Promise<TrainingEvent | null> {
  const { data, error } = await supabaseAdmin
    .from("training_events")
    .select("*")
    .eq("client_id", clientId)
    .eq("date", date)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapEventRow(data) : null;
}

/**
 * Map completion quality ("full"/"partial"/"skipped") to event status.
 */
export function mapCompletionQualityToEventStatus(
  quality: SessionCompletionQuality
): "completed" | "partial" | "skipped" {
  if (quality === "full") return "completed";
  if (quality === "partial") return "partial";
  return "skipped";
}

/**
 * Count events for a client within a date range.
 */
export async function countEventsInRange(
  clientId: string,
  startDate: string,
  endDate: string
): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("training_events")
    .select("*", { count: "exact", head: true })
    .eq("client_id", clientId)
    .gte("date", startDate)
    .lte("date", endDate);

  if (error) throw error;
  return count ?? 0;
}

/**
 * Link a session log to an event, writing BOTH directions of the event-keyed
 * relationship (Session 5.2): the event's session_log_id + status, and the
 * session_log's training_event_id back-reference. Sequenced UPDATEs treated as
 * atomic for pre-launch — this is the final step of a log write. Stamping the
 * log side here also heals any legacy row whose training_event_id was null.
 */
export async function linkSessionLogToEvent(
  eventId: string,
  sessionLogId: string,
  status: "completed" | "partial" | "skipped"
): Promise<void> {
  const now = new Date().toISOString();

  const { error: eventErr } = await supabaseAdmin
    .from("training_events")
    .update({
      session_log_id: sessionLogId,
      status,
      updated_at: now,
    })
    .eq("id", eventId);
  if (eventErr) throw eventErr;

  const { error: logErr } = await supabaseAdmin
    .from("session_logs")
    .update({ training_event_id: eventId, updated_at: now })
    .eq("id", sessionLogId);
  if (logErr) throw logErr;
}

// --- Day-summary helper ---

function mapStatusToCompletionQuality(
  status: TrainingEventStatus
): "full" | "partial" | "skipped" | null {
  if (status === "completed") return "full";
  if (status === "partial") return "partial";
  if (status === "skipped") return "skipped";
  return null;
}

/**
 * Lightweight summaries for the client day-summary endpoint.
 * Returns enriched training events with exercise counts and completion quality.
 * At most 3 queries regardless of how many events exist on the day.
 */
export async function getEventSummariesForDate(
  clientId: string,
  date: string
): Promise<TrainingEventSummary[]> {
  const events = await getEventsForDateRange(clientId, date, date);
  if (events.length === 0) return [];

  const sessionLogIds = events
    .map((e) => e.sessionLogId)
    .filter((id): id is string => id !== null);

  // Logged-exercise count per session_log_id, and the PERFORMED session of each
  // linked log (its training_session_id) — for planned-day swaps.
  const loggedCountMap = new Map<string, number>();
  const performedByLogId = new Map<string, string | null>();
  if (sessionLogIds.length > 0) {
    const [logCountsRes, logRowsRes] = await Promise.all([
      supabaseAdmin
        .from("exercise_logs")
        .select("session_log_id")
        .in("session_log_id", sessionLogIds),
      supabaseAdmin
        .from("session_logs")
        .select("id, training_session_id")
        .in("id", sessionLogIds),
    ]);
    if (logCountsRes.error) throw logCountsRes.error;
    if (logRowsRes.error) throw logRowsRes.error;
    for (const row of logCountsRes.data ?? []) {
      loggedCountMap.set(
        row.session_log_id,
        (loggedCountMap.get(row.session_log_id) ?? 0) + 1
      );
    }
    for (const row of logRowsRes.data ?? []) {
      performedByLogId.set(row.id, row.training_session_id);
    }
  }

  // The session to DISPLAY per event = the performed session when the linked log
  // is for a different session (swap), else the prescribed one.
  const displaySessionIdByEvent = new Map<string, string | null>();
  for (const e of events) {
    const performed = e.sessionLogId
      ? performedByLogId.get(e.sessionLogId) ?? null
      : null;
    displaySessionIdByEvent.set(e.id, performed ?? e.trainingSessionId);
  }

  // Prescribed-exercise count + live name keyed on the DISPLAY session id, so a
  // swap's "X/Y" and label reflect the performed session.
  const displaySessionIds = [
    ...new Set(
      [...displaySessionIdByEvent.values()].filter(
        (id): id is string => id !== null
      )
    ),
  ];

  const prescribedCountMap = new Map<string, number>();
  const sessionNameById = new Map<string, string>();
  if (displaySessionIds.length > 0) {
    // Both chunked AND paged: this feeds a prescribed-exercise COUNT per session,
    // so an unpaged read did not just drop rows, it under-reported the count the
    // coach sees. Same truncation class as training-service.ts.
    const [exerciseRows, sessionRows] = await Promise.all([
      fetchAllByChunkedIds(displaySessionIds, (chunk, from, to) =>
        supabaseAdmin
          .from("training_exercises")
          .select("session_id, id")
          .in("session_id", chunk)
          .eq("is_active", true)
          .order("session_id", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
        { errorLabel: "training exercises" },
      ),
      fetchAllByChunkedIds(displaySessionIds, (chunk, from, to) =>
        supabaseAdmin
          .from("training_sessions")
          .select("id, name")
          .in("id", chunk)
          .order("id", { ascending: true })
          .range(from, to),
        { errorLabel: "training sessions" },
      ),
    ]);
    for (const row of exerciseRows) {
      prescribedCountMap.set(
        row.session_id,
        (prescribedCountMap.get(row.session_id) ?? 0) + 1
      );
    }
    for (const row of sessionRows) {
      sessionNameById.set(row.id, row.name);
    }
  }

  return events.map((e) => {
    const displayId = displaySessionIdByEvent.get(e.id) ?? null;
    const isAlternative =
      displayId !== null &&
      e.trainingSessionId !== null &&
      displayId !== e.trainingSessionId;
    return {
      eventId: e.id,
      sessionName:
        (displayId ? sessionNameById.get(displayId) : null) ?? e.sessionName,
      sessionFocus: e.sessionFocus,
      completionQuality: mapStatusToCompletionQuality(e.status),
      isAlternative,
      loggedExerciseCount: e.sessionLogId
        ? (loggedCountMap.get(e.sessionLogId) ?? 0)
        : 0,
      prescribedExerciseCount: displayId
        ? (prescribedCountMap.get(displayId) ?? 0)
        : 0,
    };
  });
}
