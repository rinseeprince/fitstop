import { supabaseAdmin } from "./supabase-admin";
import {
  linkSessionLogToEvent,
  mapCompletionQualityToEventStatus,
} from "./training-event-service";
import { getTodayDateString, getTrainingWeekStart } from "@/lib/date-helpers";
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
    weightUnit: ((row.weight_unit as "lbs" | "kg" | null) ?? "lbs") as "lbs" | "kg",
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
// logTrainingEvent
// =============================================================================

export async function logTrainingEvent(params: {
  eventId: string;
  clientId: string;
  payload: LogTrainingEventInput;
}): Promise<LogTrainingEventResponse> {
  const { eventId, clientId, payload } = params;

  // 1. Fetch event scoped on clientId.
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

  const trainingSessionId = eventRow.training_session_id;
  const eventDate = eventRow.date;
  const existingLogId = eventRow.session_log_id;

  // 2. Resolve weekStartDate from the client's check-in day.
  const { data: clientRow, error: clientErr } = await supabaseAdmin
    .from("clients")
    .select("expected_check_in_day")
    .eq("id", clientId)
    .maybeSingle();
  if (clientErr) {
    throw new Error(`Failed to load client check-in day: ${clientErr.message}`);
  }
  const checkInDay = clientRow?.expected_check_in_day ?? null;
  const weekStartDate = getTrainingWeekStart(eventDate, checkInDay);

  // 3. Fresh session-prescription snapshot.
  // NOTE: Do NOT filter by is_active here. A coach soft-deleting a session
  // shouldn't cause a client log write to capture a null snapshot (and on the
  // upsert branch, clobber an existing snapshot). The is_active filter belongs
  // on the *read* path (getTrainingEventDetail's "live" classification), not
  // the snapshot-capture path.
  let sessionSnapshot: SessionSnapshot | null = null;
  if (trainingSessionId !== null) {
    const { data: sessionRow, error: sessionErr } = await supabaseAdmin
      .from("training_sessions")
      .select("name, day_of_week, focus, estimated_duration_minutes, estimated_calories")
      .eq("id", trainingSessionId)
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

  // 5. Write session_logs. Branch on orphan-event retry vs normal.
  const baseRow = {
    client_id: clientId,
    training_session_id: trainingSessionId,
    completed_at: getTodayDateString(),
    completion_quality: derivedQuality,
    notes: payload.notes ?? null,
    week_start_date: weekStartDate,
    updated_at: new Date().toISOString(),
  };

  let sessionLogId: string;
  if (trainingSessionId === null && existingLogId !== null) {
    // Orphan-event retry. NULL training_session_id means the upsert UNIQUE key
    // (NULL is distinct in PG) won't dedupe — would insert a duplicate row.
    // Target the linked row directly.
    //
    // Snapshot preservation: omit prescribed_session_snapshot from the payload
    // when the fresh value is null, so the existing column value is preserved.
    // (PG only updates columns present in the SET clause.)
    const updateRow: SessionLogUpdate =
      sessionSnapshot !== null
        ? { ...baseRow, prescribed_session_snapshot: sessionSnapshot as unknown as Json }
        : { ...baseRow };

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("session_logs")
      .update(updateRow)
      .eq("id", existingLogId)
      .select("id")
      .single();
    if (updateErr || !updated) {
      throw new Error(
        `Failed to update session log on orphan-event retry: ${
          updateErr?.message ?? "no row returned"
        }`,
      );
    }
    sessionLogId = updated.id;
  } else {
    // Normal path. If we're here, training_session_id is non-null.
    // (Note: a coach soft-deleting the session does NOT null event.training_session_id —
    // only hard delete does that via FK SET NULL. So sessionSnapshot may still be null
    // here if the row was hard-deleted between the fetch in step 1 and the snapshot
    // fetch in step 3, or if the row was soft-deleted. The upsert is the first write,
    // so there's no prior column value to clobber.)
    const upsertRow: SessionLogInsert = {
      ...baseRow,
      prescribed_session_snapshot: sessionSnapshot as unknown as Json | null,
    };
    const { data: upserted, error: upsertErr } = await supabaseAdmin
      .from("session_logs")
      .upsert(upsertRow, {
        onConflict: "client_id,training_session_id,week_start_date",
      })
      .select("id")
      .single();
    if (upsertErr || !upserted) {
      throw new Error(
        `Failed to upsert session log: ${
          upsertErr?.message ?? "no row returned"
        }`,
      );
    }
    sessionLogId = upserted.id;
  }

  // 6. Detailed mode: preserve existing exercise_logs snapshots, then replace.
  // STRICT ORDER: SELECT existing → build map → DELETE → INSERT. Do NOT
  // parallelize the SELECT and DELETE — the SELECT must complete first or
  // the preservation map will be empty when the inserts go in.
  if (isDetailedMode) {
    // 6a. Snapshot-preservation prefetch.
    const { data: existingRows, error: existingErr } = await supabaseAdmin
      .from("exercise_logs")
      .select("training_exercise_id, prescribed_exercise_snapshot")
      .eq("session_log_id", sessionLogId);
    if (existingErr) {
      throw new Error(
        `Failed to read existing exercise logs for snapshot preservation: ${existingErr.message}`,
      );
    }

    const existingSnapshotMap = new Map<string, Record<string, unknown>>();
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

    // 6b. Delete after the preservation map is built.
    const { error: deleteErr } = await supabaseAdmin
      .from("exercise_logs")
      .delete()
      .eq("session_log_id", sessionLogId);
    if (deleteErr) {
      throw new Error(
        `Failed to clear exercise logs before re-insert: ${deleteErr.message}`,
      );
    }

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

  // 7. Update event status — single status writer pattern.
  const eventStatus = mapCompletionQualityToEventStatus(derivedQuality);
  await linkSessionLogToEvent(eventId, sessionLogId, eventStatus);

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

  // Resolve session_log: by event.session_log_id if linked, else composite key.
  // Fallback covers legacy non-blocking link failures from the check-ins route.
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
  } else if (event.trainingSessionId !== null) {
    const { data: clientRow, error: clientErr } = await supabaseAdmin
      .from("clients")
      .select("expected_check_in_day")
      .eq("id", clientId)
      .maybeSingle();
    if (clientErr) {
      throw new Error(
        `Failed to load client check-in day: ${clientErr.message}`,
      );
    }
    const checkInDay = clientRow?.expected_check_in_day ?? null;
    const weekStart = getTrainingWeekStart(event.date, checkInDay);
    const { data, error } = await supabaseAdmin
      .from("session_logs")
      .select("*")
      .eq("client_id", clientId)
      .eq("training_session_id", event.trainingSessionId)
      .eq("week_start_date", weekStart)
      .maybeSingle();
    if (error) {
      throw new Error(
        `Failed to load session log via composite key: ${error.message}`,
      );
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
  let exercises: ResolvedExercise[];
  if (liveSession === null) {
    // No live prescription — every log is snapshot-source, ordered by created_at.
    exercises = exerciseLogs.map((log) => ({
      source: "snapshot",
      snapshot: log.prescribedExerciseSnapshot ?? {},
    }));
  } else {
    // Live exercises in order_index order; orphan logs (training_exercise_id
    // doesn't match any live row, or is null) appended as snapshot-source by
    // created_at.
    const liveIds = new Set(liveSession.exercises.map((e) => e.id));
    const liveResolved: ResolvedExercise[] = liveSession.exercises.map(
      (exercise) => ({ source: "live", exercise }),
    );
    const orphanResolved: ResolvedExercise[] = exerciseLogs
      .filter(
        (log) =>
          log.trainingExerciseId === null || !liveIds.has(log.trainingExerciseId),
      )
      .map((log) => ({
        source: "snapshot",
        snapshot: log.prescribedExerciseSnapshot ?? {},
      }));
    exercises = [...liveResolved, ...orphanResolved];
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
): Promise<{ sessionLog: SessionLog; exerciseLogs: ExerciseLog[] } | null> {
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

  return {
    sessionLog: mapSessionLogRow(row as SessionLogRow),
    exerciseLogs,
  };
}
