import { supabaseAdmin } from "./supabase-admin";
import {
  findMatchingEvent,
  linkSessionLogToEvent,
  mapCompletionQualityToEventStatus,
} from "./training-event-service";
import { dateOfTimestamp,
  getTrainingWeekStart,
  getTrainingWeekEnd,
} from "@/lib/date-helpers";
import { assertCanEditTrainingDay } from "./daily-log-permissions-service";
import { DayLockedError } from "@/lib/daily-log-permissions";
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
import type { SetType } from "@/utils/exercise-set-specs";
import type {
  LogSessionForDateInput,
  LogTrainingEventInput,
} from "@/lib/validations/training";

/**
 * Thrown when a body-supplied performedSessionId / trainingExerciseId does not
 * resolve to a resource owned by the authenticated client (session -> plan ->
 * client_id). Routes map this to 404 so it can't be used as a cross-tenant read
 * primitive or a foreign-FK write.
 */
export class TrainingLogOwnershipError extends Error {
  constructor() {
    super("Referenced session or exercise not found for this client");
    this.name = "TrainingLogOwnershipError";
  }
}
import type {
  ExerciseLog,
  LogTrainingEventResponse,
  ResolvedExercise,
  ResolvedSession,
  SessionLog,
  SessionLogDetail,
  SessionLogPrescribedExercise,
  SetLog,
  TrainingEvent,
  TrainingEventDetail,
  TrainingEventStatus,
  TrainingSession,
} from "@/types/training";
import type { SessionCompletionQuality } from "@/types/check-in";
import { toCanonicalWeightKg } from "@/utils/unit-conversions";
// The shared mapper, deliberately. A local copy of this function lived here and
// silently omitted set_specs and video_url, so every read through
// getTrainingEventDetail lost the per-set prescription — loads, per-set rest and
// set types — while the compact reps/RPE columns still came through and made the
// payload look complete. CONVENTIONS §8: "A reader that ignores set_specs sees a
// truthful but lossy summary."
import { mapExerciseRow } from "@/services/training-mappers";
// The one flattening. The client's log form seeds its rows from this same
// function, so a drop set's expansion cannot differ between what the client
// filled in and what set_type each row is stamped with here.
import { buildPrescribedRows, type PrescribedRow } from "@/utils/set-spec-rows";
// The snapshot -> specs adapter, shared with the coach's session-log dialog so
// the readout of a log can never describe a different prescription from the one
// its set types were stamped against.
import { snapshotToSpecs } from "@/utils/exercise-set-specs";
import {
  deriveCompletionQuality,
  type ScoredExercise,
} from "@/utils/completion-quality";

// =============================================================================
// Event-keyed training log service.
// Single authoritative entry point for "client logged a training event".
// Owns session_logs, exercise_logs, and training_events.status writes.
// =============================================================================

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
  // Per-set prescription (mig 119). Captured so warm-up-aware compliance is
  // correct for historical logs once the Phase 2 builder authors it; null until
  // then. Analytics reads it via countWorkingSets, falling back to `sets`.
  set_specs: Json | null;
  // Which prescription columns the coach uses (mig 149). Captured for the same
  // reason as set_specs: the client tracker falls back to this snapshot when the
  // live session is gone, and without the column it silently widens the grid
  // back to all five and collects data the coach chose not to prescribe.
  prescribed_fields: string[] | null;
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
    // Logged loads are canonical kilograms since migration 141 — a constant, not
    // a column. The old `?? "lbs"` default was the mechanism that mislabelled
    // every seeded and untouched-form row.
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
    setType: (row.set_type as SetType) ?? "working",
    reps: row.reps,
    weight: row.weight,
    rpe: row.rpe,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// --- Prescription reads (detailed mode) ---

// One row of training_exercises, as both prescription reads below select it.
type PrescriptionRow = {
  id: string;
  name: string;
  // Read for the coach's session-log readout, which lists a session's exercises
  // in the order they were authored. Deliberately NOT carried into
  // toExerciseSnapshot: that shape is written to prescribed_exercise_snapshot,
  // and adding a key there would change stored data.
  order_index: number;
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
  is_warmup: boolean | null;
  set_specs: Json | null;
  prescribed_fields: string[] | null;
};

const PRESCRIPTION_COLUMNS =
  "id, name, order_index, sets, reps_min, reps_max, reps_target, rpe_target, " +
  "percentage_1rm, tempo, rest_seconds, notes, superset_group, is_warmup, " +
  "set_specs, prescribed_fields";

// The tenant scope for both reads: exercise -> session -> plan -> client_id.
// `!inner` filters out anything this client does not own, so a body-supplied
// foreign exercise id simply does not come back.
const PRESCRIPTION_SCOPE = ", training_sessions!inner(training_plans!inner(client_id))";

function toExerciseSnapshot(row: PrescriptionRow): ExerciseSnapshot {
  return {
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
    set_specs: row.set_specs ?? null,
    prescribed_fields: row.prescribed_fields ?? null,
  };
}

/**
 * The payload's own exercises, by id, for the prescription snapshot.
 *
 * No is_active filter, deliberately: a coach soft-deleting an exercise must not
 * cause a client's log write to capture a null snapshot (and, on the update
 * branch, clobber an existing one). Chunked so a large owned set is never
 * silently truncated at the PostgREST cap.
 *
 * An id that does not come back is either foreign (scoped out) or legitimately
 * gone (hard-deleted between prescription and log). Both fall back to the
 * preserved snapshot rather than 404 — no cross-tenant data either way.
 */
async function loadExerciseSnapshots(
  clientId: string,
  exerciseIds: string[],
): Promise<PrescriptionRow[]> {
  const rows: PrescriptionRow[] = [];
  for (let i = 0; i < exerciseIds.length; i += 100) {
    const chunk = exerciseIds.slice(i, i + 100);
    const { data, error } = await supabaseAdmin
      .from("training_exercises")
      .select(PRESCRIPTION_COLUMNS + PRESCRIPTION_SCOPE)
      .in("id", chunk)
      .eq("training_sessions.training_plans.client_id", clientId);
    if (error) {
      throw new Error(
        `Failed to load training exercises for snapshot: ${error.message}`,
      );
    }
    for (const row of data ?? []) {
      rows.push(row as unknown as PrescriptionRow);
    }
  }
  return rows;
}

/**
 * Every ACTIVE exercise of the session the client PERFORMED — the denominator
 * for completion_quality.
 *
 * It has to be read rather than inferred from the payload: an exercise the
 * client never touched is absent from the payload entirely, so asking the
 * payload how much was prescribed would let a half-done workout record as
 * `full`. Locked decision 4 is "every prescribed working set, on EVERY
 * exercise".
 *
 * is_active IS filtered here, unlike the snapshot read above: this is what the
 * tracker rendered, so it is what the client can fairly be scored against.
 */
async function loadSessionPrescription(
  clientId: string,
  sessionId: string,
): Promise<PrescriptionRow[]> {
  const { data, error } = await supabaseAdmin
    .from("training_exercises")
    .select(PRESCRIPTION_COLUMNS + PRESCRIPTION_SCOPE)
    .eq("session_id", sessionId)
    .eq("is_active", true)
    .eq("training_sessions.training_plans.client_id", clientId)
    // Authored order, for the coach readout. The completion-quality derivation
    // below reads this through a Map and does not care about order.
    .order("order_index", { ascending: true });
  if (error) {
    throw new Error(
      `Failed to load session prescription: ${error.message}`,
    );
  }
  return (data ?? []).map((row) => row as unknown as PrescriptionRow);
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

  // Ownership: performedSessionId is body-supplied on both the event and
  // event-less paths, is written into session_logs.training_session_id, and
  // (event-less) drives the prescription snapshot below. Validate it resolves
  // to THIS client (session -> plan -> client_id, the cloneSessionForEvent
  // shape) or reject — otherwise a foreign id is a cross-tenant read primitive
  // and a dangling-FK write. eventId + the event's own session are already
  // client-scoped by the caller, so only this free id needs checking.
  if (performedSessionId !== null) {
    const { data: ownedSession, error: ownErr } = await supabaseAdmin
      .from("training_sessions")
      .select("id, training_plans!inner(client_id)")
      .eq("id", performedSessionId)
      .eq("training_plans.client_id", clientId)
      .maybeSingle();
    if (ownErr) {
      throw new Error(
        `Failed to verify performed session ownership: ${ownErr.message}`,
      );
    }
    if (!ownedSession) {
      throw new TrainingLogOwnershipError();
    }
  }

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

  // 4. Mode dispatch + the two prescription reads (detailed mode only).
  const isDetailedMode =
    Array.isArray(payload.exercises) && payload.exercises.length > 0;

  const freshExerciseSnapshotMap = new Map<string, ExerciseSnapshot>();
  const sessionPrescribedRows = new Map<string, PrescribedRow[]>();
  if (isDetailedMode) {
    const distinctExerciseIds = [
      ...new Set(
        (payload.exercises ?? [])
          .map((e) => e.trainingExerciseId)
          .filter((id): id is string => typeof id === "string"),
      ),
    ];
    // Independent reads — issued together so the added denominator read costs
    // no round trip of its own (CONVENTIONS §2, performance 11).
    const [snapshotRows, sessionRows] = await Promise.all([
      distinctExerciseIds.length > 0
        ? loadExerciseSnapshots(clientId, distinctExerciseIds)
        : Promise.resolve<PrescriptionRow[]>([]),
      performedSessionId !== null
        ? loadSessionPrescription(clientId, performedSessionId)
        : Promise.resolve<PrescriptionRow[]>([]),
    ]);
    for (const row of snapshotRows) {
      freshExerciseSnapshotMap.set(row.id, toExerciseSnapshot(row));
    }
    for (const row of sessionRows) {
      sessionPrescribedRows.set(
        row.id,
        buildPrescribedRows(snapshotToSpecs(toExerciseSnapshot(row))),
      );
    }
  }

  // 4b. completion_quality is SERVER-DERIVED whenever the payload carries
  // exercises: the sets the client sent are the claim, and any client-supplied
  // value is ignored. A payload with NO exercises — the quick log, and any
  // future RN quick path — still uses the client's explicit value, because
  // there is nothing to derive from.
  //
  // This reverses the previous rule ("the tap is authoritative"), which let a
  // client who logged one set of six record the session as complete.
  let derivedQuality: SessionCompletionQuality = payload.completionQuality;
  if (isDetailedMode) {
    const completedByExerciseId = new Map<string, number[]>();
    for (const ex of payload.exercises ?? []) {
      // An unplanned exercise has no prescription, so it scores neither half.
      if (!ex.trainingExerciseId) continue;
      const seen = completedByExerciseId.get(ex.trainingExerciseId) ?? [];
      seen.push(...ex.sets.map((set) => set.setNumber));
      completedByExerciseId.set(ex.trainingExerciseId, seen);
    }

    const scored: ScoredExercise[] = [...sessionPrescribedRows].map(
      ([exerciseId, prescribedRows]) => ({
        prescribedRows,
        completedSetNumbers: completedByExerciseId.get(exerciseId) ?? [],
      }),
    );

    // A prescribed exercise the coach has since removed from the session is
    // absent from the read above, but the client still SAW it — getTrainingEvent
    // Detail appends a snapshot block for exactly this case — and logged against
    // it, so it scores. One with no snapshot left at all (hard-deleted) is
    // dropped from BOTH halves, so it can never skew the ratio either way.
    for (const [exerciseId, setNumbers] of completedByExerciseId) {
      if (sessionPrescribedRows.has(exerciseId)) continue;
      const snapshot = freshExerciseSnapshotMap.get(exerciseId);
      if (!snapshot) continue;
      scored.push({
        prescribedRows: buildPrescribedRows(snapshotToSpecs(snapshot)),
        completedSetNumbers: setNumbers,
      });
    }

    derivedQuality = deriveCompletionQuality(scored) ?? payload.completionQuality;
  }

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
      // Vestigial, and kept truthful rather than clever: an exercise reaches
      // this payload only because the client banked at least one of its sets, so
      // it was done. It used to require a set with NUMBERS in it, which recorded
      // "I did all four sets, logged no weights" as incomplete. The `skipped`
      // leg survives for the wire's other callers (React Native), which may
      // still send an explicit skip.
      const completed = ex.skipped !== true && ex.sets.length > 0;
      return {
        session_log_id: sessionLogId,
        training_exercise_id: ex.trainingExerciseId ?? null,
        exercise_id: ex.exerciseId ?? null,
        completed,
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
      // set_type is coach-prescribed: seed it from the prescription snapshot's
      // per-set specs (fresh or preserved), never from the client payload.
      const snapshot = ex.trainingExerciseId
        ? freshExerciseSnapshotMap.get(ex.trainingExerciseId) ??
          existingSnapshotMap.get(ex.trainingExerciseId) ??
          null
        : null;
      const prescribedRows = buildPrescribedRows(snapshotToSpecs(snapshot));
      // Every sent set is written, values or not: the client sends exactly the
      // sets it completed, so a row with nothing in it is a truthful record of
      // "did the set, logged no numbers".
      ex.sets.forEach((s) => {
        setLogInserts.push({
          exercise_log_id: exerciseLogId,
          // The set's own identity, never its position in this array — a client
          // logging sets 3-5 of six must not have them stored as 1-3 and typed
          // from the first three specs.
          set_number: s.setNumber,
          set_type: prescribedRows[s.setNumber - 1]?.setType ?? "working",
          reps: s.reps ?? null,
          // set_logs.weight is canonical kilograms (migration 141) and no longer
          // carries a tag, so the payload's unit is applied HERE and then
          // discarded.
          //
          // The web client now converts before sending and always tags "kg"
          // (log-form-types.ts), so this is an identity for that caller. It is
          // kept because the wire schema still accepts a tag and the React
          // Native client is entitled to send one.
          weight: toCanonicalWeightKg(s.weight ?? undefined, ex.weightUnit) ?? null,
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
    .select(
      "id, training_session_id, date, session_log_id, session_logs!training_events_session_log_id_fkey(completed_at)",
    )
    .eq("id", eventId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (eventErr) {
    throw new Error(`Failed to load training event: ${eventErr.message}`);
  }
  if (!eventRow) {
    throw new Error(`Training event not found: ${eventId}`);
  }

  // Logged on another day: the linked log was performed on a different date
  // (an alternative session the matcher attributed to this prescribed event).
  // It is read-only HERE even on "today" — an update through this event would
  // overwrite the sets and re-stamp completed_at to this date, erasing where
  // it actually happened. Edits belong on the day it was logged, under that
  // day's rules. The embed is absent on a row with no log (and on older test
  // fixtures), which reads as "no lock".
  const linkedLog = eventRow.session_logs as { completed_at: string | null } | null | undefined;
  const loggedOn = linkedLog?.completed_at ? dateOfTimestamp(linkedLog.completed_at) : null;
  if (loggedOn && loggedOn !== eventRow.date) {
    throw new DayLockedError(
      eventRow.date,
      "training",
      `This workout was logged on ${loggedOn}, so it is read-only on ${eventRow.date}.`,
    );
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
): Promise<SessionLogDetail | null> {
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

  // Two reads of the PERFORMED session (the log's training_session_id), issued
  // together because neither depends on the other:
  //
  //  - its live name, for the session-level "Prescribed X · Performed Y" line.
  //    Null if the session was hard-deleted.
  //  - its full active prescription, so an exercise the client never touched
  //    still reaches the coach. Such an exercise is absent from exercise_logs
  //    entirely — the payload omits it — so a readout built from the logs alone
  //    cannot show that it was ever asked for.
  //
  // The prescription read is the same one the completion_quality denominator
  // uses (loadSessionPrescription), keyed on the same session, so the coach's
  // readout and the client's recorded verdict describe one prescription.
  //
  // Scope comes from the log row's own client_id. The route proves the caller
  // owns that client by matching it against the URL before returning anything.
  const [sessionRowResult, prescriptionRows] = await Promise.all([
    row.training_session_id
      ? supabaseAdmin
          .from("training_sessions")
          .select("name")
          .eq("id", row.training_session_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    row.training_session_id
      ? loadSessionPrescription(row.client_id, row.training_session_id)
      : Promise.resolve<PrescriptionRow[]>([]),
  ]);
  if (sessionRowResult.error) {
    throw new Error(
      `Failed to load performed session name: ${sessionRowResult.error.message}`,
    );
  }
  const performedSessionName: string | null = sessionRowResult.data?.name ?? null;

  const prescribedExercises: SessionLogPrescribedExercise[] =
    prescriptionRows.map((prescriptionRow) => ({
      trainingExerciseId: prescriptionRow.id,
      orderIndex: prescriptionRow.order_index,
      name: prescriptionRow.name,
      snapshot: toExerciseSnapshot(prescriptionRow),
    }));

  return {
    sessionLog: mapSessionLogRow(row as SessionLogRow),
    exerciseLogs,
    performedSessionName,
    prescribedExercises,
  };
}
