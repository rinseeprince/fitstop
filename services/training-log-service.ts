import { supabaseAdmin } from "./supabase-admin";
import {
  findMatchingEvent,
  linkSessionLogToEvent,
  mapCompletionQualityToEventStatus,
} from "./training-event-service";
import {
  getTrainingWeekStart,
  getTrainingWeekEnd,
} from "@/lib/date-helpers";
import { assertCanEditTrainingDay } from "./daily-log-permissions-service";
import type {
  ExerciseLogInsert,
  ExerciseLogRow,
  SessionLogInsert,
  SessionLogRow,
  SessionLogUpdate,
  SetLogInsert,
  SetLogRow,
  TrainingEventRow,
  TrainingExerciseRow,
} from "@/lib/database-helpers";
import type { Json } from "@/types/database";
import type {
  LogSessionForDateInput,
  LogTrainingEventInput,
  SetPerformanceInput,
} from "@/lib/validations/training";
import type {
  ExerciseLog,
  LogTrainingEventResponse,
  ResolvedExercise,
  ResolvedSession,
  SessionLog,
  SetLog,
  TrainingEvent,
  TrainingEventDetail,
  TrainingEventStatus,
  TrainingExercise,
  TrainingSession,
} from "@/types/training";
import type { SessionCompletionQuality } from "@/types/check-in";

// =============================================================================
// Event-keyed training log service.
// Single authoritative entry point for "client logged a training event".
// Owns session_logs, exercise_logs, and training_events.status writes.
// =============================================================================

// --- Detailed-mode helpers ---

function setHasData(set: SetPerformanceInput): boolean {
  return set.reps != null || set.weight != null;
}

function setRowHasAnyValue(set: SetPerformanceInput): boolean {
  return set.reps != null || set.weight != null || set.rpe != null;
}

// --- Snapshot shapes (JSONB-bound) ---

type SessionSnapshot = {
  name: string;
  day_of_week: string | null;
  focus: string | null;
  estimated_duration_minutes: number | null;
  estimated_calories: number | null;
};

type ExerciseSnapshot = {
  name: string;
  sets: number;
  reps_min: number | null;
  reps_max: number | null;
  reps_target: string | null;
  rpe_target: number | null;
  percentage_1rm: number | null;
  tempo: string | null;
  rest_seconds: number | null;
  notes: string | null;
  superset_group: string | null;
  is_warmup: boolean;
};

// --- Row → camelCase mappers ---

function mapSessionLogRow(row: SessionLogRow): SessionLog {
  return {
    id: row.id,
    clientId: row.client_id,
    trainingSessionId: row.training_session_id,
    trainingEventId: row.training_event_id,
    completedAt: row.completed_at,
    completionQuality: (row.completion_quality ?? "full") as SessionCompletionQuality,
    notes: row.notes,
    weekStartDate: row.week_start_date,
    prescribedSessionSnapshot:
      (row.prescribed_session_snapshot as Record<string, unknown> | null) ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapExerciseLogRow(row: ExerciseLogRow): ExerciseLog {
  return {
    id: row.id,
    sessionLogId: row.session_log_id,
    trainingExerciseId: row.training_exercise_id,
    exerciseId: row.exercise_id,
    completed: row.completed ?? false,
    // weight_unit is nullable in the DB schema but writers always send "lbs"|"kg".
    // Default to "lbs" defensively for any historical row that's null.
    weightUnit: ((row.weight_unit as "lbs" | "kg" | null) ?? "lbs"),
    notes: row.notes,
    performedName: row.performed_name,
    prescribedExerciseSnapshot:
      (row.prescribed_exercise_snapshot as Record<string, unknown> | null) ?? null,
    sets: [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSetLogRow(row: SetLogRow): SetLog {
  return {
    id: row.id,
    exerciseLogId: row.exercise_log_id,
    setNumber: row.set_number,
    reps: row.reps,
    weight: row.weight,
    rpe: row.rpe,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Fetches set_logs for the given exercise_logs in one query and attaches them
// to each ExerciseLog under `sets`. Caller passes already-mapped logs.
async function attachSetLogs(logs: ExerciseLog[]): Promise<ExerciseLog[]> {
  if (logs.length === 0) return logs;
  const { data, error } = await supabaseAdmin
    .from("set_logs")
    .select("*")
    .in(
      "exercise_log_id",
      logs.map((l) => l.id),
    )
    .order("set_number", { ascending: true });
  if (error) {
    throw new Error(`Failed to load set logs: ${error.message}`);
  }
  const byExercise = new Map<string, SetLog[]>();
  for (const row of data ?? []) {
    const list = byExercise.get(row.exercise_log_id) ?? [];
    list.push(mapSetLogRow(row));
    byExercise.set(row.exercise_log_id, list);
  }
  return logs.map((log) => ({ ...log, sets: byExercise.get(log.id) ?? [] }));
}

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
    calorieSurplusPercentage: row.calorie_surplus_percentage,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapExerciseRow(row: TrainingExerciseRow): TrainingExercise {
  return {
    id: row.id,
    sessionId: row.session_id,
    exerciseId: row.exercise_id,
    name: row.name,
    orderIndex: row.order_index,
    sets: row.sets,
    repsMin: row.reps_min ?? undefined,
    repsMax: row.reps_max ?? undefined,
    repsTarget: row.reps_target ?? undefined,
    rpeTarget: row.rpe_target ?? undefined,
    percentage1rm: row.percentage_1rm ?? undefined,
    tempo: row.tempo ?? undefined,
    restSeconds: row.rest_seconds ?? undefined,
    notes: row.notes ?? undefined,
    supersetGroup: row.superset_group ?? undefined,
    isWarmup: row.is_warmup ?? false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// =============================================================================
// writeSessionLog (shared internals: event-keyed + event-less logging)
// =============================================================================

/**
 * Core write shared by logTrainingEvent (event-keyed) and
 * logTrainingSessionForDate (event-less). Writes the session_logs row, the
 * detailed-mode exercise_logs/set_logs, and — when an event is linked — both
 * directions of the event link.
 *
 * Identity (Session 5.2): session_logs is keyed by training_event_id. When
 * `existingLogId` is known (the event already has a session_log_id, or the
 * event-less find-or-update matched a row) we UPDATE by id; otherwise we
 * INSERT, stamping training_event_id = eventId. A 23505 on the partial unique
 * index means a log already claims this event (concurrent submit or a
 * half-failed prior link) — recover by updating it, never duplicate.
 *
 * session_logs.training_session_id holds the PERFORMED session
 * (performedSessionId); prescribed_session_snapshot is captured from
 * snapshotSessionId (the prescribed side). completed_at is the attribution date
 * (event.date for event-keyed, the logged date for event-less).
 */
async function writeSessionLog(params: {
  clientId: string;
  eventId: string | null;
  existingLogId: string | null;
  performedSessionId: string | null;
  snapshotSessionId: string | null;
  completedAt: string;
  weekStartDate: string;
  payload: LogTrainingEventInput;
}): Promise<string> {
  const {
    clientId,
    eventId,
    existingLogId,
    performedSessionId,
    snapshotSessionId,
    completedAt,
    weekStartDate,
    payload,
  } = params;

  // 3. Fresh session-prescription snapshot.
  // NOTE: Do NOT filter by is_active here. A coach soft-deleting a session
  // shouldn't cause a client log write to capture a null snapshot (and on the
  // upsert branch, clobber an existing snapshot). The is_active filter belongs
  // on the *read* path (getTrainingEventDetail's "live" classification), not
  // the snapshot-capture path.
  let sessionSnapshot: SessionSnapshot | null = null;
  if (snapshotSessionId !== null) {
    const { data: sessionRow, error: sessionErr } = await supabaseAdmin
      .from("training_sessions")
      .select("name, day_of_week, focus, estimated_duration_minutes, estimated_calories")
      .eq("id", snapshotSessionId)
      .maybeSingle();
    if (sessionErr) {
      throw new Error(
        `Failed to load training session for snapshot: ${sessionErr.message}`,
      );
    }
    if (sessionRow) {
      sessionSnapshot = {
        name: sessionRow.name,
        day_of_week: sessionRow.day_of_week,
        focus: sessionRow.focus,
        estimated_duration_minutes: sessionRow.estimated_duration_minutes,
        estimated_calories: sessionRow.estimated_calories,
      };
    }
  }

  // 4. Mode dispatch + fresh exercise-prescription map (detailed mode only).
  // No is_active filter here either — same rationale as step 3. Soft-deleted
  // exercises must not silently strip the snapshot on first-call detailed logs.
  const isDetailedMode =
    Array.isArray(payload.exercises) && payload.exercises.length > 0;

  const freshExerciseSnapshotMap = new Map<string, ExerciseSnapshot>();
  if (isDetailedMode) {
    const exerciseIds = (payload.exercises ?? [])
      .map((e) => e.trainingExerciseId)
      .filter((id): id is string => typeof id === "string");
    if (exerciseIds.length > 0) {
      const { data: exerciseRows, error: exerciseErr } = await supabaseAdmin
        .from("training_exercises")
        .select(
          "id, name, sets, reps_min, reps_max, reps_target, rpe_target, percentage_1rm, tempo, rest_seconds, notes, superset_group, is_warmup",
        )
        .in("id", exerciseIds);
      if (exerciseErr) {
        throw new Error(
          `Failed to load training exercises for snapshot: ${exerciseErr.message}`,
        );
      }
      for (const row of exerciseRows ?? []) {
        freshExerciseSnapshotMap.set(row.id, {
          name: row.name,
          sets: row.sets,
          reps_min: row.reps_min,
          reps_max: row.reps_max,
          reps_target: row.reps_target,
          rpe_target: row.rpe_target,
          percentage_1rm: row.percentage_1rm,
          tempo: row.tempo,
          rest_seconds: row.rest_seconds,
          notes: row.notes,
          superset_group: row.superset_group,
          is_warmup: row.is_warmup ?? false,
        });
      }
    }
  }

  // 4b. The client's explicit completionQuality is authoritative in both
  // quick and detailed modes. Clients have legitimate reasons to mark a
  // session "complete" with partial set data (only tracking compounds, lost
  // signal mid-workout, etc.), so per-exercise data does not override the tap.
  const derivedQuality: SessionCompletionQuality = payload.completionQuality;

  // 5. Write session_logs (event-keyed, Session 5.2). training_session_id holds
  // the PERFORMED session. completed_at is the attribution date.
  const baseRow = {
    client_id: clientId,
    training_session_id: performedSessionId,
    completed_at: completedAt,
    completion_quality: derivedQuality,
    notes: payload.notes ?? null,
    week_start_date: weekStartDate,
    updated_at: new Date().toISOString(),
  };

  // On UPDATE, omit prescribed_session_snapshot when the fresh value is null so
  // the existing column value is preserved (PG only updates columns in SET).
  const updateRow: SessionLogUpdate =
    sessionSnapshot !== null
      ? { ...baseRow, prescribed_session_snapshot: sessionSnapshot as unknown as Json }
      : { ...baseRow };

  let sessionLogId: string;
  if (existingLogId !== null) {
    // Known target row (event already linked, or the event-less find-or-update
    // matched). UPDATE by id; training_event_id is left untouched (preserved).
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("session_logs")
      .update(updateRow)
      .eq("id", existingLogId)
      .select("id")
      .single();
    if (updateErr || !updated) {
      throw new Error(
        `Failed to update session log: ${updateErr?.message ?? "no row returned"}`,
      );
    }
    sessionLogId = updated.id;
  } else {
    // Fresh INSERT, keyed to the event when present (null = unmatched extra).
    const insertRow: SessionLogInsert = {
      ...baseRow,
      training_event_id: eventId,
      prescribed_session_snapshot: sessionSnapshot as unknown as Json | null,
    };
    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from("session_logs")
      .insert(insertRow)
      .select("id")
      .single();
    if (insertErr || !inserted) {
      // 23505 on session_logs_training_event_id_key: a log already claims this
      // event (concurrent submit, or a half-failed prior link). Recover by
      // updating that row — never write a duplicate / phantom surplus.
      if (eventId !== null && insertErr?.code === "23505") {
        const { data: recovered, error: recErr } = await supabaseAdmin
          .from("session_logs")
          .update(updateRow)
          .eq("training_event_id", eventId)
          .select("id")
          .single();
        if (recErr || !recovered) {
          throw new Error(
            `Failed to recover session log on unique conflict: ${
              recErr?.message ?? "no row returned"
            }`,
          );
        }
        sessionLogId = recovered.id;
      } else {
        throw new Error(
          `Failed to insert session log: ${insertErr?.message ?? "no row returned"}`,
        );
      }
    } else {
      sessionLogId = inserted.id;
    }
  }

  // 6. Reconcile exercise_logs. Every save FULLY REPLACES the log's
  // exercise_logs (and set_logs via FK CASCADE): the DELETE always runs, so a
  // quick re-log (no exercises) clears any prior detailed/swapped rows instead
  // of leaving them stale. The snapshot-preservation SELECT and the INSERT run
  // only when the payload carries exercises.
  // STRICT ORDER: SELECT existing → build map → DELETE → INSERT.
  const existingSnapshotMap = new Map<string, Record<string, unknown>>();
  if (isDetailedMode) {
    // 6a. Snapshot-preservation prefetch (only needed before a re-insert).
    const { data: existingRows, error: existingErr } = await supabaseAdmin
      .from("exercise_logs")
      .select("training_exercise_id, prescribed_exercise_snapshot")
      .eq("session_log_id", sessionLogId);
    if (existingErr) {
      throw new Error(
        `Failed to read existing exercise logs for snapshot preservation: ${existingErr.message}`,
      );
    }
    for (const r of existingRows ?? []) {
      // Free-form rows (NULL training_exercise_id) have no stable cross-write
      // identity; intentionally NOT preserved. See test 12d.
      if (r.training_exercise_id !== null && r.prescribed_exercise_snapshot !== null) {
        existingSnapshotMap.set(
          r.training_exercise_id,
          r.prescribed_exercise_snapshot as Record<string, unknown>,
        );
      }
    }
  }

  // 6b. Delete existing exercise_logs — ALWAYS (full replace). set_logs are
  // removed via FK CASCADE.
  const { error: deleteErr } = await supabaseAdmin
    .from("exercise_logs")
    .delete()
    .eq("session_log_id", sessionLogId);
  if (deleteErr) {
    throw new Error(
      `Failed to clear exercise logs before re-insert: ${deleteErr.message}`,
    );
  }

  if (isDetailedMode) {
    // 6c. Insert with fresh-or-preserved snapshots.
    // For free-form exercises (no trainingExerciseId, no prior snapshot),
    // capture the user-supplied name into prescribed_exercise_snapshot so
    // revisit displays it instead of "Unknown exercise".
    const inserts: ExerciseLogInsert[] = (payload.exercises ?? []).map((ex) => {
      const fresh = ex.trainingExerciseId
        ? freshExerciseSnapshotMap.get(ex.trainingExerciseId) ?? null
        : null;
      const preserved = ex.trainingExerciseId
        ? existingSnapshotMap.get(ex.trainingExerciseId) ?? null
        : null;
      const freeFormSnapshot =
        !fresh && !preserved && !ex.trainingExerciseId
          ? { name: ex.exerciseName }
          : null;
      const completed = ex.skipped !== true && ex.sets.some(setHasData);
      return {
        session_log_id: sessionLogId,
        training_exercise_id: ex.trainingExerciseId ?? null,
        exercise_id: ex.exerciseId ?? null,
        completed,
        weight_unit: ex.weightUnit,
        notes: ex.notes ?? null,
        performed_name: ex.exerciseName,
        prescribed_exercise_snapshot:
          (fresh ?? preserved ?? freeFormSnapshot) as unknown as Json | null,
      };
    });

    let insertedExerciseLogIds: string[] = [];
    if (inserts.length > 0) {
      const { data: insertedRows, error: insertErr } = await supabaseAdmin
        .from("exercise_logs")
        .insert(inserts)
        .select("id");
      if (insertErr || !insertedRows) {
        throw new Error(
          `Failed to insert exercise logs: ${insertErr?.message ?? "no rows returned"}`,
        );
      }
      insertedExerciseLogIds = insertedRows.map((r) => r.id);
    }

    // 6d. Insert set_logs for non-skipped exercises.
    // FK CASCADE on the exercise_logs DELETE in step 6b already removed any
    // stale set_logs, so this is a clean insert.
    const setLogInserts: SetLogInsert[] = [];
    (payload.exercises ?? []).forEach((ex, exIdx) => {
      if (ex.skipped) return;
      const exerciseLogId = insertedExerciseLogIds[exIdx];
      if (!exerciseLogId) return;
      ex.sets.forEach((s, setIdx) => {
        if (!setRowHasAnyValue(s)) return;
        setLogInserts.push({
          exercise_log_id: exerciseLogId,
          set_number: setIdx + 1,
          reps: s.reps ?? null,
          weight: s.weight ?? null,
          rpe: s.rpe ?? null,
        });
      });
    });
    if (setLogInserts.length > 0) {
      const { error: setInsertErr } = await supabaseAdmin
        .from("set_logs")
        .insert(setLogInserts);
      if (setInsertErr) {
        throw new Error(
          `Failed to insert set logs: ${setInsertErr.message}`,
        );
      }
    }
  }

  // 7. Link the event + write its status — only when an event is linked.
  // linkSessionLogToEvent writes both directions (event.session_log_id + status,
  // and session_log.training_event_id).
  if (eventId !== null) {
    const eventStatus = mapCompletionQualityToEventStatus(derivedQuality);
    await linkSessionLogToEvent(eventId, sessionLogId, eventStatus);
  }

  return sessionLogId;
}

// =============================================================================
// getClientCheckInDay (shared)
// =============================================================================

async function getClientCheckInDay(clientId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .select("expected_check_in_day")
    .eq("id", clientId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load client check-in day: ${error.message}`);
  }
  return data?.expected_check_in_day ?? null;
}

// =============================================================================
// logTrainingEvent (event-keyed) + logTrainingSessionForDate (event-less)
// =============================================================================

export async function logTrainingEvent(params: {
  eventId: string;
  clientId: string;
  payload: LogTrainingEventInput;
}): Promise<LogTrainingEventResponse> {
  const { eventId, clientId, payload } = params;

  // Fetch the event, scoped on clientId (collapses missing + wrong-client).
  const { data: eventRow, error: eventErr } = await supabaseAdmin
    .from("training_events")
    .select("id, training_session_id, date, session_log_id")
    .eq("id", eventId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (eventErr) {
    throw new Error(`Failed to load training event: ${eventErr.message}`);
  }
  if (!eventRow) {
    throw new Error(`Training event not found: ${eventId}`);
  }

  // Date-edit lock: today is editable; a past day that already has a log is
  // read-only (throws DayLockedError → 403). loggedStatus comes from the event's
  // existing link — no extra query.
  await assertCanEditTrainingDay(
    clientId,
    eventRow.date,
    eventRow.session_log_id ? "logged" : "never-logged",
  );

  const checkInDay = await getClientCheckInDay(clientId);
  const weekStartDate = getTrainingWeekStart(eventRow.date, checkInDay);

  // Performed session: the swap target when provided, else the prescribed one.
  // Prescribed snapshot is always captured from the event's session.
  const performedSessionId =
    payload.performedSessionId ?? eventRow.training_session_id;

  const sessionLogId = await writeSessionLog({
    clientId,
    eventId: eventRow.id,
    existingLogId: eventRow.session_log_id,
    performedSessionId,
    snapshotSessionId: eventRow.training_session_id,
    completedAt: eventRow.date,
    weekStartDate,
    payload,
  });

  return { sessionLogId };
}

/**
 * Event-less logging (Session 5.3): the client trained on a day with no tapped
 * event (rest-day training / the rest-day picker). The idempotent
 * find-or-update on (client, performed session, date) runs BEFORE the matcher,
 * so a retry or double-tap updates the existing row instead of inserting a
 * duplicate — and the matched-then-retried phantom is killed too (the first
 * call links the matched event; a retry finds the existing log here and never
 * re-runs the matcher).
 */
export async function logTrainingSessionForDate(params: {
  clientId: string;
  date: string;
  payload: LogSessionForDateInput;
}): Promise<LogTrainingEventResponse> {
  const { clientId, date, payload } = params;
  const performedSessionId = payload.performedSessionId;

  const checkInDay = await getClientCheckInDay(clientId);
  const weekStartDate = getTrainingWeekStart(date, checkInDay);
  const weekEndDate = getTrainingWeekEnd(date, checkInDay);

  // One log per rest day: reuse the existing event-less log for this day
  // REGARDLESS of which session was picked, so a second pick EDITS the first
  // instead of inserting a duplicate. completed_at is TIMESTAMPTZ — match the
  // day via the house range pattern.
  const { data: existing, error: existingErr } = await supabaseAdmin
    .from("session_logs")
    .select("id, training_event_id")
    .eq("client_id", clientId)
    .gte("completed_at", `${date}T00:00:00`)
    .lte("completed_at", `${date}T23:59:59`)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existingErr) {
    throw new Error(
      `Failed to look up existing session log: ${existingErr.message}`,
    );
  }

  // Date-edit lock: today is editable; a past day that already has a log is
  // read-only (throws DayLockedError → 403).
  await assertCanEditTrainingDay(
    clientId,
    date,
    existing ? "logged" : "never-logged",
  );

  if (existing) {
    const sessionLogId = await writeSessionLog({
      clientId,
      eventId: existing.training_event_id,
      existingLogId: existing.id,
      performedSessionId,
      snapshotSessionId: performedSessionId,
      completedAt: date,
      weekStartDate,
      payload,
    });
    return { sessionLogId };
  }

  // No existing log — run the matcher to link a prescribed event when possible.
  const match = await findMatchingEvent({
    clientId,
    performedSessionId,
    completedAt: date,
    weekStart: weekStartDate,
    weekEnd: weekEndDate,
  });

  const sessionLogId = await writeSessionLog({
    clientId,
    eventId: match?.id ?? null,
    existingLogId: null,
    performedSessionId,
    snapshotSessionId: match?.trainingSessionId ?? performedSessionId,
    completedAt: date,
    weekStartDate,
    payload,
  });
  return { sessionLogId };
}

// =============================================================================
// getTrainingEventDetail
// =============================================================================

export async function getTrainingEventDetail(
  eventId: string,
  clientId: string,
): Promise<TrainingEventDetail | null> {
  const { data: eventRow, error: eventErr } = await supabaseAdmin
    .from("training_events")
    .select("*")
    .eq("id", eventId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (eventErr) {
    throw new Error(`Failed to load training event: ${eventErr.message}`);
  }
  if (!eventRow) return null;

  const event = mapEventRow(eventRow as TrainingEventRow);

  // Live session (with active exercises).
  // is_active filter IS appropriate here — we don't want a soft-deleted
  // session to surface as "live" in the UI. Snapshot fallback covers it.
  let liveSession: TrainingSession | null = null;
  if (event.trainingSessionId !== null) {
    const { data: sessionData, error: sessionErr } = await supabaseAdmin
      .from("training_sessions")
      .select(
        "id, plan_id, name, day_of_week, order_index, focus, notes, estimated_duration_minutes, estimated_calories, calories_calculated_at, calorie_surplus_percentage, created_at, updated_at, training_exercises(*)",
      )
      .eq("id", event.trainingSessionId)
      .eq("is_active", true)
      .maybeSingle();
    if (sessionErr) {
      throw new Error(
        `Failed to load live training session: ${sessionErr.message}`,
      );
    }
    if (sessionData) {
      const exerciseRows = ((sessionData.training_exercises as
        | (TrainingExerciseRow & { is_active?: boolean })[]
        | null) ?? [])
        .filter((e) => e.is_active !== false)
        .sort((a, b) => a.order_index - b.order_index)
        .map((row) => mapExerciseRow(row as TrainingExerciseRow));
      liveSession = {
        id: sessionData.id,
        planId: sessionData.plan_id,
        name: sessionData.name,
        dayOfWeek: sessionData.day_of_week ?? undefined,
        orderIndex: sessionData.order_index,
        focus: sessionData.focus ?? undefined,
        notes: sessionData.notes ?? undefined,
        estimatedDurationMinutes:
          sessionData.estimated_duration_minutes ?? undefined,
        estimatedCalories: sessionData.estimated_calories ?? undefined,
        caloriesCalculatedAt: sessionData.calories_calculated_at ?? undefined,
        calorieSurplusPercentage: sessionData.calorie_surplus_percentage,
        exercises: exerciseRows,
        createdAt: sessionData.created_at,
        updatedAt: sessionData.updated_at,
      };
    }
  }

  // Resolve session_log directly via event.session_log_id (Session 5.2 made the
  // link the single source of truth — always set after a successful log write,
  // so the old composite-key fallback is gone).
  let sessionLogRow: SessionLogRow | null = null;
  if (event.sessionLogId) {
    const { data, error } = await supabaseAdmin
      .from("session_logs")
      .select("*")
      .eq("id", event.sessionLogId)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to load session log: ${error.message}`);
    }
    sessionLogRow = data;
  }

  const sessionLog = sessionLogRow ? mapSessionLogRow(sessionLogRow) : null;

  // Fetch exercise_logs.
  let exerciseLogRows: ExerciseLogRow[] = [];
  if (sessionLog) {
    const { data, error } = await supabaseAdmin
      .from("exercise_logs")
      .select("*")
      .eq("session_log_id", sessionLog.id)
      .order("created_at", { ascending: true });
    if (error) {
      throw new Error(`Failed to load exercise logs: ${error.message}`);
    }
    exerciseLogRows = data ?? [];
  }
  const exerciseLogs = await attachSetLogs(exerciseLogRows.map(mapExerciseLogRow));

  // Build ResolvedSession.
  const session: ResolvedSession =
    liveSession !== null
      ? { source: "live", session: liveSession }
      : {
          source: "snapshot",
          snapshot: sessionLog?.prescribedSessionSnapshot ?? {},
        };

  // Build ResolvedExercise[].
  // Truly unplanned logs (trainingExerciseId is null) are excluded from this
  // array. They already live in exerciseLogs, and the frontend's
  // seedDefaultValues handles them via its orphan-log path. Including them
  // here would cause each unplanned exercise to render twice (once as
  // "prescribed", once as orphan).
  let exercises: ResolvedExercise[];
  if (liveSession === null) {
    // No live session — reconstruct prescribed exercise blocks from logged
    // snapshots. Exclude unplanned logs (trainingExerciseId is null).
    exercises = exerciseLogs
      .filter((log) => log.trainingExerciseId !== null)
      .map((log) => ({
        source: "snapshot",
        snapshot: log.prescribedExerciseSnapshot ?? {},
      }));
  } else {
    // Live exercises in order_index order.
    const liveIds = new Set(liveSession.exercises.map((e) => e.id));
    exercises = liveSession.exercises.map((exercise) => ({
      source: "live",
      exercise,
    }));
    // Append snapshot blocks for logs of soft-deleted prescribed exercises
    // (trainingExerciseId set but no longer in live). Truly unplanned logs
    // (trainingExerciseId null) are NOT appended — see comment above.
    const deletedOrphans: ResolvedExercise[] = exerciseLogs
      .filter(
        (log) =>
          log.trainingExerciseId !== null &&
          !liveIds.has(log.trainingExerciseId),
      )
      .map((log) => ({
        source: "snapshot",
        snapshot: log.prescribedExerciseSnapshot ?? {},
      }));
    if (deletedOrphans.length > 0) {
      exercises = [...exercises, ...deletedOrphans];
    }
  }

  return {
    event,
    session,
    exercises,
    sessionLog,
    exerciseLogs,
  };
}

// =============================================================================
// getSessionLogDetail
// =============================================================================

export async function getSessionLogDetail(
  sessionLogId: string,
): Promise<{
  sessionLog: SessionLog;
  exerciseLogs: ExerciseLog[];
  performedSessionName: string | null;
} | null> {
  const { data: row, error: logErr } = await supabaseAdmin
    .from("session_logs")
    .select("*")
    .eq("id", sessionLogId)
    .maybeSingle();
  if (logErr) {
    throw new Error(`Failed to load session log: ${logErr.message}`);
  }
  if (!row) return null;

  const { data: exerciseRows, error: exErr } = await supabaseAdmin
    .from("exercise_logs")
    .select("*")
    .eq("session_log_id", sessionLogId)
    .order("created_at", { ascending: true });
  if (exErr) {
    throw new Error(`Failed to load exercise logs: ${exErr.message}`);
  }

  const exerciseLogs = await attachSetLogs(
    (exerciseRows ?? []).map((r) => mapExerciseLogRow(r as ExerciseLogRow)),
  );

  // The live name of the session the client actually PERFORMED (the log's
  // training_session_id). The coach dialog renders a session-level
  // "Prescribed X · Performed Y" line when this differs from the prescribed
  // snapshot name. Null if the performed session was hard-deleted.
  let performedSessionName: string | null = null;
  if (row.training_session_id) {
    const { data: sessionRow, error: sessionErr } = await supabaseAdmin
      .from("training_sessions")
      .select("name")
      .eq("id", row.training_session_id)
      .maybeSingle();
    if (sessionErr) {
      throw new Error(
        `Failed to load performed session name: ${sessionErr.message}`,
      );
    }
    performedSessionName = sessionRow?.name ?? null;
  }

  return {
    sessionLog: mapSessionLogRow(row as SessionLogRow),
    exerciseLogs,
    performedSessionName,
  };
}
