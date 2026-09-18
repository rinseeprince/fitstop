import { supabaseAdmin } from "./supabase-admin";
import type {
  TrainingEvent,
  TrainingEventLog,
  TrainingEventStatus,
  TrainingEventSummary,
} from "@/types/training";
import type { TrainingEventRow, TrainingEventInsert } from "@/lib/database-helpers";
import { getTodayDateString, getDateString, DAY_NUM } from "@/lib/date-helpers";
import { fetchAllByChunkedIds, chunkIds } from "@/lib/paged-fetch";
import { eventWorkoutRead, loggedDisplayQuality } from "@/lib/training-display-state";

// --- Row mapper ---

/**
 * The columns every read of calendar workouts selects: the event row and the
 * workout's log, through the NAMED foreign key. Naming it is not style — two
 * relationships exist between `training_events` and `session_logs` (the event's
 * link and the log's back-reference), so an unnamed embed is a PGRST201.
 *
 * The log rides along on every read because every screen that shows how a
 * workout went reads its quality here, and a read that forgot the embed would
 * quietly show a partial workout as a full one.
 */
export const EVENT_WITH_LOG_COLUMNS =
  "*, session_log:session_logs!training_events_session_log_id_fkey(id, completion_quality, training_session_id, notes)";

/** The embedded half of `EVENT_WITH_LOG_COLUMNS` — one row, or null when nothing is linked. */
export type EmbeddedSessionLogRow = {
  id: string;
  completion_quality: string | null;
  training_session_id: string | null;
  notes: string | null;
} | null;

/** A `training_events` row read with `EVENT_WITH_LOG_COLUMNS`. */
export type TrainingEventWithLogRow = TrainingEventRow & {
  session_log: EmbeddedSessionLogRow;
};

/** The workout's log as the calendar carries it. */
function mapEventLogRow(row: EmbeddedSessionLogRow): TrainingEventLog | null {
  if (!row) return null;
  return {
    id: row.id,
    // The column is nullable; a log row that never recorded one is a full workout,
    // which is what the log writer's own default has always meant.
    completionQuality: (row.completion_quality ??
      "full") as TrainingEventLog["completionQuality"],
    performedSessionId: row.training_session_id,
    notes: row.notes,
  };
}

/**
 * The ONE event-row mapper. A second copy lived in `training-log-service.ts`
 * and drifted from this one; the row type now requires the log embed, so no
 * caller can read an event without the quality its screens need.
 */
export function mapEventRow(row: TrainingEventWithLogRow): TrainingEvent {
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
    log: mapEventLogRow(row.session_log),
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
    sessionsForDay.forEach((session, dayOrder) => {
      rows.push({
        client_id: clientId,
        training_plan_id: planId,
        training_session_id: session.id,
        date: dateStr,
        day_order: dayOrder,
        session_name: session.name,
        session_focus: session.focus ?? null,
        estimated_calories: session.estimatedCalories ?? null,
        calorie_surplus_percentage: session.calorieSurplusPercentage ?? null,
        status: "scheduled",
      });
    });
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
 * Nutrition needs nothing from this: a day's target is computed from the
 * session on it, so every day this clears is a rest day the moment the
 * delete lands, however far the program reached.
 *
 * The live callers now pass the deletion floor (`resolveEventDeletionFloor`),
 * which already excludes a today the client has trained on — so on those paths the
 * detach below has nothing left to catch. It stays: this function's own default
 * is a UTC today, and the detach is what makes an earlier `effectiveFrom` safe
 * for any future caller.
 *
 * @param effectiveFrom - Date from which to clear (defaults to today).
 */
export async function cancelFutureEventsForPlan(
  planId: string,
  effectiveFrom?: string
): Promise<void> {
  // UTC fallback only: no clientId in scope to resolve a client-local today,
  // and the live callers pass an explicit (client-local) date.
  await cancelFutureEventsForPlans([planId], effectiveFrom ?? getTodayDateString());
}

/**
 * The set form of `cancelFutureEventsForPlan`: the same two statements, in the
 * same order, over every plan in `planIds` at once, chunked so the id list
 * stays under the request-line ceiling. A placement supersedes every earlier
 * program of the client from its start day (migration 167), and a client
 * re-placed monthly for a year has a dozen of them — two round trips per plan
 * would make placement scale with the client's history (CONVENTIONS §2,
 * performance 7).
 *
 * Returns the session rows the removed days pointed at, for the one caller
 * that retires them with their days (a block trim).
 */
export async function cancelFutureEventsForPlans(
  planIds: string[],
  fromDate: string
): Promise<string[]> {
  const removedSessionIds: string[] = [];
  for (const chunk of chunkIds(planIds)) {
    const { error: detachError } = await supabaseAdmin
      .from("training_events")
      .update({ training_plan_id: null, updated_at: new Date().toISOString() })
      .in("training_plan_id", chunk)
      .gte("date", fromDate)
      .neq("status", "scheduled");

    if (detachError) throw detachError;

    const { data: removed, error: deleteError } = await supabaseAdmin
      .from("training_events")
      .delete()
      .in("training_plan_id", chunk)
      .gte("date", fromDate)
      .eq("status", "scheduled")
      .select("training_session_id");

    if (deleteError) throw deleteError;
    for (const row of removed ?? []) {
      if (row.training_session_id) removedSessionIds.push(row.training_session_id);
    }
  }
  return removedSessionIds;
}

// --- Regenerate future events ---

// --- Next-plan window cap (additive placement) ---

/**
 * The day before the next coexisting plan starts, or null if this is the last
 * plan. Under additive placement, plans own disjoint date windows; this caps
 * event generation so a plan (especially a no-duration one falling back to the
 * 8-week default) never bleeds past the start of a later coexisting plan.
 *
 * Scoped to non-deleted, non-archived rows: a deleted program is archived, a
 * program superseded on its own start day is archived by the placement RPC
 * (migration 167), and neither may shorten a live plan's window. Strict `>`
 * is deliberate: it keeps a plan from capping itself, and since 167 no two
 * LIVE plans of a client share a start.
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
 * Get all events for a client within a date range, in calendar order: by date,
 * and a day's sessions in the day's order (`day_order`, migration 179).
 */
export async function getEventsForDateRange(
  clientId: string,
  startDate: string,
  endDate: string
): Promise<TrainingEvent[]> {
  const { data, error } = await supabaseAdmin
    .from("training_events")
    .select(EVENT_WITH_LOG_COLUMNS)
    .eq("client_id", clientId)
    .gte("date", startDate)
    .lte("date", endDate)
    .order("date", { ascending: true })
    .order("day_order", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw error;
  return ((data ?? []) as unknown as TrainingEventWithLogRow[]).map(mapEventRow);
}

/**
 * The first session of a client's day, in the day's order, or null when the
 * day holds none. A day can hold several sessions; this answers for the day as
 * a whole where one answer is wanted (a log's plan stamp).
 */
export async function getFirstEventForDate(
  clientId: string,
  date: string
): Promise<TrainingEvent | null> {
  const { data, error } = await supabaseAdmin
    .from("training_events")
    .select(EVENT_WITH_LOG_COLUMNS)
    .eq("client_id", clientId)
    .eq("date", date)
    .order("day_order", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapEventRow(data as unknown as TrainingEventWithLogRow) : null;
}

/**
 * Link a session log to an event, writing BOTH directions of the event-keyed
 * relationship (Session 5.2): the event's session_log_id + status, and the
 * session_log's training_event_id back-reference. Sequenced UPDATEs treated as
 * atomic for pre-launch — this is the final step of a log write. Stamping the
 * log side here also heals any legacy row whose training_event_id was null.
 *
 * The status is always `completed`, in the same statement as the link, so the
 * two can never disagree: the column says the client logged the workout and
 * nothing else, and how it went stays on the log alone (migration 182). There
 * is no quality to map — the mapping is what made a partial workout read as
 * not-done on half the product.
 */
export async function linkSessionLogToEvent(
  eventId: string,
  sessionLogId: string
): Promise<void> {
  const now = new Date().toISOString();

  const { error: eventErr } = await supabaseAdmin
    .from("training_events")
    .update({
      session_log_id: sessionLogId,
      status: "completed",
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

  // Logged-exercise count per session_log_id. The log's own facts — its quality
  // and the session it was performed against — came with the event read.
  const loggedCountMap = new Map<string, number>();
  if (sessionLogIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from("exercise_logs")
      .select("session_log_id")
      .in("session_log_id", sessionLogIds);
    if (error) throw error;
    for (const row of data ?? []) {
      loggedCountMap.set(
        row.session_log_id,
        (loggedCountMap.get(row.session_log_id) ?? 0) + 1
      );
    }
  }

  // The session to DISPLAY per event = the performed session when the linked log
  // is for a different session (swap), else the prescribed one.
  const displaySessionIdByEvent = new Map<string, string | null>();
  for (const e of events) {
    displaySessionIdByEvent.set(
      e.id,
      e.log?.performedSessionId ?? e.trainingSessionId
    );
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
      // How the workout went comes off its log, never off the status word.
      completionQuality: loggedDisplayQuality(eventWorkoutRead(e)),
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
