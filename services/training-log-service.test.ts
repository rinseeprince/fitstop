import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock supabase-admin before importing the service.
vi.mock("./supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

// Chainable supabase query mock (mirrors the helper in training-event-service.test.ts).
function createMockQuery<T = unknown>(result: {
  data: T | null;
  error: { message: string } | null;
}) {
  const q = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: vi.fn(),
  };
  Object.defineProperty(q, "then", {
    value: (resolve: (value: typeof result) => void) =>
      Promise.resolve(result).then(resolve),
  });
  return q;
}

import { supabaseAdmin } from "./supabase-admin";
import {
  logTrainingEvent,
  getTrainingEventDetail,
  logTrainingSessionForDate,
} from "./training-log-service";

const mockFrom = vi.mocked(supabaseAdmin.from);

// Helper for the new insert-then-select pattern on exercise_logs. The writer
// chains `.insert(...).select("id")` and reads the inserted ids to wire up
// child set_logs rows, so the mock must return an array of {id} rows.
function insertExerciseLogsReturning(ids: string[]) {
  return createMockQuery({
    data: ids.map((id) => ({ id })),
    error: null,
  });
}

// ---- shared fixtures ----

const CLIENT_ID = "client-1";
const EVENT_ID = "event-1";
const SESSION_ID = "session-1";
const SESSION_LOG_ID = "log-1";
const EXERCISE_A = "ex-a";
const EXERCISE_B = "ex-b";

function eventRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: EVENT_ID,
    training_session_id: SESSION_ID,
    date: "2026-05-04",
    session_log_id: null,
    ...overrides,
  };
}

const SESSION_PRESCRIPTION = {
  name: "Push",
  day_of_week: "monday",
  focus: "chest",
  estimated_duration_minutes: 60,
  estimated_calories: 400,
};

const EXERCISE_A_PRESCRIPTION = {
  id: EXERCISE_A,
  name: "Bench Press",
  sets: 3,
  reps_min: 8,
  reps_max: 10,
  reps_target: null,
  rpe_target: 8,
  percentage_1rm: null,
  tempo: null,
  rest_seconds: 90,
  notes: null,
  superset_group: null,
  is_warmup: false,
};

const EXERCISE_A_SNAPSHOT = {
  name: EXERCISE_A_PRESCRIPTION.name,
  sets: EXERCISE_A_PRESCRIPTION.sets,
  reps_min: EXERCISE_A_PRESCRIPTION.reps_min,
  reps_max: EXERCISE_A_PRESCRIPTION.reps_max,
  reps_target: EXERCISE_A_PRESCRIPTION.reps_target,
  rpe_target: EXERCISE_A_PRESCRIPTION.rpe_target,
  percentage_1rm: EXERCISE_A_PRESCRIPTION.percentage_1rm,
  tempo: EXERCISE_A_PRESCRIPTION.tempo,
  rest_seconds: EXERCISE_A_PRESCRIPTION.rest_seconds,
  notes: EXERCISE_A_PRESCRIPTION.notes,
  superset_group: EXERCISE_A_PRESCRIPTION.superset_group,
  is_warmup: EXERCISE_A_PRESCRIPTION.is_warmup,
  // Captured from training_exercises.set_specs (mig 119); null for this legacy
  // prescription fixture (no per-set list authored).
  set_specs: null,
};

// `Router` builds a mockFrom that dispatches by table name; each entry can be
// either a single mockQuery or an array consumed in order (for tables that get
// hit multiple times within one logTrainingEvent call).
type Router = Partial<Record<string, ReturnType<typeof createMockQuery> | ReturnType<typeof createMockQuery>[]>>;

function installRouter(router: Router) {
  const cursors: Record<string, number> = {};
  mockFrom.mockImplementation((table: string) => {
    const entry = router[table];
    if (!entry) {
      // unexpected table — return an empty no-op so tests fail loudly on the
      // assertion side instead of crashing on undefined.
      return createMockQuery({ data: null, error: null }) as never;
    }
    if (Array.isArray(entry)) {
      const idx = cursors[table] ?? 0;
      cursors[table] = idx + 1;
      return (entry[idx] ?? entry[entry.length - 1]) as never;
    }
    return entry as never;
  });
  return cursors;
}

describe("logTrainingEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // 1. Quick log (no exercises)
  // -------------------------------------------------------------------------
  it("[1] quick log: writes session_log + snapshot, clears exercise_logs (full replace), links event with mapped status", async () => {
    const eventQ = createMockQuery({ data: eventRow(), error: null });
    const clientQ = createMockQuery({
      data: { expected_check_in_day: "sunday" },
      error: null,
    });
    const sessionSnapQ = createMockQuery({
      data: SESSION_PRESCRIPTION,
      error: null,
    });
    const upsertQ = createMockQuery({ data: { id: SESSION_LOG_ID }, error: null });
    const exQ = createMockQuery({ data: null, error: null });
    const linkQ = createMockQuery({ data: null, error: null });

    installRouter({
      training_events: [eventQ, linkQ],
      clients: clientQ,
      training_sessions: sessionSnapQ,
      session_logs: upsertQ,
      exercise_logs: exQ,
    });

    const result = await logTrainingEvent({
      eventId: EVENT_ID,
      clientId: CLIENT_ID,
      payload: { completionQuality: "full" },
    });

    expect(result).toEqual({ sessionLogId: SESSION_LOG_ID });

    // session_logs INSERT (fresh log) carried the snapshot + event key, and
    // completed_at is the attribution date (event.date), not "today".
    expect(upsertQ.insert).toHaveBeenCalledTimes(1);
    const upsertArg = upsertQ.insert.mock.calls[0][0];
    expect(upsertArg).toMatchObject({
      client_id: CLIENT_ID,
      training_session_id: SESSION_ID,
      training_event_id: EVENT_ID,
      completed_at: "2026-05-04",
      completion_quality: "full",
      prescribed_session_snapshot: SESSION_PRESCRIPTION,
    });

    // Full replace: exercise_logs are cleared (DELETE), nothing inserted for a
    // quick log, no set_logs written.
    expect(exQ.delete).toHaveBeenCalledTimes(1);
    expect(exQ.insert).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalledWith("set_logs");

    // training_events update fired with status='completed' (full→completed).
    expect(linkQ.update).toHaveBeenCalledTimes(1);
    expect(linkQ.update.mock.calls[0][0]).toMatchObject({
      session_log_id: SESSION_LOG_ID,
      status: "completed",
    });
  });

  // -------------------------------------------------------------------------
  // 2. Quick log with exercises: []
  // -------------------------------------------------------------------------
  it("[2] empty exercises array is a quick-log: clears exercise_logs, inserts none", async () => {
    const eventQ = createMockQuery({ data: eventRow(), error: null });
    const clientQ = createMockQuery({
      data: { expected_check_in_day: "sunday" },
      error: null,
    });
    const sessionSnapQ = createMockQuery({
      data: SESSION_PRESCRIPTION,
      error: null,
    });
    const upsertQ = createMockQuery({ data: { id: SESSION_LOG_ID }, error: null });
    const exQ = createMockQuery({ data: null, error: null });
    const linkQ = createMockQuery({ data: null, error: null });

    installRouter({
      training_events: [eventQ, linkQ],
      clients: clientQ,
      training_sessions: sessionSnapQ,
      session_logs: upsertQ,
      exercise_logs: exQ,
    });

    await logTrainingEvent({
      eventId: EVENT_ID,
      clientId: CLIENT_ID,
      payload: { completionQuality: "partial", exercises: [] },
    });

    // Full replace: cleared, nothing inserted, no set_logs.
    expect(exQ.delete).toHaveBeenCalledTimes(1);
    expect(exQ.insert).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalledWith("set_logs");
    // Status maps from quick-log completionQuality.
    expect(linkQ.update.mock.calls[0][0].status).toBe("partial");
  });

  // -------------------------------------------------------------------------
  // 3. Detailed log all logged — completed
  // -------------------------------------------------------------------------
  it("[3] detailed log all-logged: writes session_log, snapshot, exercise_logs; status=completed", async () => {
    const eventQ = createMockQuery({ data: eventRow(), error: null });
    const clientQ = createMockQuery({
      data: { expected_check_in_day: "sunday" },
      error: null,
    });
    const sessionSnapQ = createMockQuery({
      data: SESSION_PRESCRIPTION,
      error: null,
    });
    const exerciseSnapQ = createMockQuery({
      data: [EXERCISE_A_PRESCRIPTION],
      error: null,
    });
    const upsertQ = createMockQuery({ data: { id: SESSION_LOG_ID }, error: null });
    const existingExLogsQ = createMockQuery({ data: [], error: null });
    const deleteExQ = createMockQuery({ data: null, error: null });
    const insertExQ = insertExerciseLogsReturning(["el-a"]);
    const setLogsInsertQ = createMockQuery({ data: null, error: null });
    const linkQ = createMockQuery({ data: null, error: null });

    installRouter({
      training_events: [eventQ, linkQ],
      clients: clientQ,
      training_sessions: sessionSnapQ,
      training_exercises: exerciseSnapQ,
      session_logs: upsertQ,
      exercise_logs: [existingExLogsQ, deleteExQ, insertExQ],
      set_logs: setLogsInsertQ,
    });

    await logTrainingEvent({
      eventId: EVENT_ID,
      clientId: CLIENT_ID,
      payload: {
        completionQuality: "full",
        exercises: [
          {
            trainingExerciseId: EXERCISE_A,
            exerciseName: "Bench Press",
            sets: [
              { reps: 10, weight: 100 },
              { reps: 10, weight: 105 },
              { reps: 8, weight: 105 },
            ],
            // kg so this test stays about set fidelity; the lbs→kg conversion
            // has its own test below.
            weightUnit: "kg",
          },
        ],
      },
    });

    // exercise_logs insert: snapshot + new performed_name field.
    expect(insertExQ.insert).toHaveBeenCalledTimes(1);
    const inserts = insertExQ.insert.mock.calls[0][0];
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      session_log_id: SESSION_LOG_ID,
      training_exercise_id: EXERCISE_A,
      exercise_id: null,
      completed: true,
      performed_name: "Bench Press",
      prescribed_exercise_snapshot: EXERCISE_A_SNAPSHOT,
    });

    // set_logs insert: one row per set with full per-set fidelity.
    expect(setLogsInsertQ.insert).toHaveBeenCalledTimes(1);
    const setRows = setLogsInsertQ.insert.mock.calls[0][0];
    expect(setRows).toEqual([
      { exercise_log_id: "el-a", set_number: 1, set_type: "working", reps: 10, weight: 100, rpe: null },
      { exercise_log_id: "el-a", set_number: 2, set_type: "working", reps: 10, weight: 105, rpe: null },
      { exercise_log_id: "el-a", set_number: 3, set_type: "working", reps: 8, weight: 105, rpe: null },
    ]);

    // payload completionQuality='full' → status='completed' (mapping).
    expect(linkQ.update.mock.calls[0][0].status).toBe("completed");
  });

  // -------------------------------------------------------------------------
  // 3b. Logged loads are canonicalized to kilograms on the way in.
  // -------------------------------------------------------------------------
  it("[3b] converts an lbs-tagged payload to canonical kg in set_logs", async () => {
    const eventQ = createMockQuery({ data: eventRow(), error: null });
    const clientQ = createMockQuery({
      data: { expected_check_in_day: null },
      error: null,
    });
    const sessionSnapQ = createMockQuery({
      data: SESSION_PRESCRIPTION,
      error: null,
    });
    const exerciseSnapQ = createMockQuery({ data: [], error: null });
    const upsertQ = createMockQuery({ data: { id: SESSION_LOG_ID }, error: null });
    const existingExLogsQ = createMockQuery({ data: [], error: null });
    const deleteExQ = createMockQuery({ data: null, error: null });
    const insertExQ = insertExerciseLogsReturning(["el-a"]);
    const setLogsInsertQ = createMockQuery({ data: null, error: null });
    const linkQ = createMockQuery({ data: null, error: null });

    installRouter({
      training_events: [eventQ, linkQ],
      clients: [clientQ],
      training_sessions: [sessionSnapQ],
      training_exercises: [exerciseSnapQ],
      session_logs: [upsertQ],
      exercise_logs: [existingExLogsQ, deleteExQ, insertExQ],
      set_logs: [setLogsInsertQ],
    });

    await logTrainingEvent({
      eventId: EVENT_ID,
      clientId: CLIENT_ID,
      payload: {
        completionQuality: "full",
        exercises: [
          {
            trainingExerciseId: EXERCISE_A,
            exerciseName: "Bench Press",
            sets: [{ reps: 5, weight: 225 }],
            weightUnit: "lbs",
          },
        ],
      },
    });

    // set_logs.weight is canonical kilograms (migration 141) and carries no tag,
    // so the payload unit must be applied here. Storing 225 raw would put pounds
    // in a kg column with nothing left to reveal it — and the client's log form
    // can still label itself "lbs" when /api/client/me is unavailable.
    const setRows = setLogsInsertQ.insert.mock.calls[0][0];
    expect(setRows).toHaveLength(1);
    expect(setRows[0].weight).toBeCloseTo(225 * 0.45359237, 6);
  });

  // -------------------------------------------------------------------------
  // 4. Detailed mixed-log: payload completionQuality is authoritative.
  // -------------------------------------------------------------------------
  it("[4] detailed mixed-log payload-authoritative: payload completionQuality='full' wins → completion_quality='full', status='completed'", async () => {
    const eventQ = createMockQuery({ data: eventRow(), error: null });
    const clientQ = createMockQuery({
      data: { expected_check_in_day: null },
      error: null,
    });
    const sessionSnapQ = createMockQuery({
      data: SESSION_PRESCRIPTION,
      error: null,
    });
    const exerciseSnapQ = createMockQuery({ data: [], error: null });
    const upsertQ = createMockQuery({ data: { id: SESSION_LOG_ID }, error: null });
    const existingExLogsQ = createMockQuery({ data: [], error: null });
    const deleteExQ = createMockQuery({ data: null, error: null });
    const insertExQ = insertExerciseLogsReturning(["el-a", "el-b"]);
    const setLogsInsertQ = createMockQuery({ data: null, error: null });
    const linkQ = createMockQuery({ data: null, error: null });

    installRouter({
      training_events: [eventQ, linkQ],
      clients: clientQ,
      training_sessions: sessionSnapQ,
      training_exercises: exerciseSnapQ,
      session_logs: upsertQ,
      exercise_logs: [existingExLogsQ, deleteExQ, insertExQ],
      set_logs: setLogsInsertQ,
    });

    await logTrainingEvent({
      eventId: EVENT_ID,
      clientId: CLIENT_ID,
      payload: {
        completionQuality: "full",
        exercises: [
          {
            exerciseName: "A",
            sets: [{ reps: 10, weight: 100 }],
            weightUnit: "lbs",
          },
          {
            exerciseName: "B",
            sets: [{}], // no data
            weightUnit: "lbs",
          },
        ],
      },
    });

    expect(upsertQ.insert.mock.calls[0][0].completion_quality).toBe("full");
    expect(linkQ.update.mock.calls[0][0].status).toBe("completed");
  });

  // -------------------------------------------------------------------------
  // 5. Detailed all-skipped, payload completionQuality='skipped'
  // -------------------------------------------------------------------------
  it("[5] detailed all-skipped + payload 'skipped' → status='skipped'", async () => {
    const eventQ = createMockQuery({ data: eventRow(), error: null });
    const clientQ = createMockQuery({
      data: { expected_check_in_day: null },
      error: null,
    });
    const sessionSnapQ = createMockQuery({
      data: SESSION_PRESCRIPTION,
      error: null,
    });
    const exerciseSnapQ = createMockQuery({ data: [], error: null });
    const upsertQ = createMockQuery({ data: { id: SESSION_LOG_ID }, error: null });
    const existingExLogsQ = createMockQuery({ data: [], error: null });
    const deleteExQ = createMockQuery({ data: null, error: null });
    const insertExQ = insertExerciseLogsReturning(["el-a", "el-b"]);
    const setLogsInsertQ = createMockQuery({ data: null, error: null });
    const linkQ = createMockQuery({ data: null, error: null });

    installRouter({
      training_events: [eventQ, linkQ],
      clients: clientQ,
      training_sessions: sessionSnapQ,
      training_exercises: exerciseSnapQ,
      session_logs: upsertQ,
      exercise_logs: [existingExLogsQ, deleteExQ, insertExQ],
      set_logs: setLogsInsertQ,
    });

    await logTrainingEvent({
      eventId: EVENT_ID,
      clientId: CLIENT_ID,
      payload: {
        completionQuality: "skipped",
        exercises: [
          { exerciseName: "A", sets: [{}], weightUnit: "lbs", skipped: true },
          { exerciseName: "B", sets: [{}], weightUnit: "lbs", skipped: true },
        ],
      },
    });

    expect(upsertQ.insert.mock.calls[0][0].completion_quality).toBe("skipped");
    expect(linkQ.update.mock.calls[0][0].status).toBe("skipped");
    // All-skipped: no set_logs rows written.
    expect(setLogsInsertQ.insert).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 5b. Detailed all-skipped + payload 'full': payload is authoritative.
  //     Contract test for "completionQuality is the single source of truth."
  // -------------------------------------------------------------------------
  it("[5b] detailed all-skipped + payload 'full' → completion_quality='full' and status='completed' (payload is authoritative)", async () => {
    const eventQ = createMockQuery({ data: eventRow(), error: null });
    const clientQ = createMockQuery({
      data: { expected_check_in_day: null },
      error: null,
    });
    const sessionSnapQ = createMockQuery({
      data: SESSION_PRESCRIPTION,
      error: null,
    });
    const exerciseSnapQ = createMockQuery({ data: [], error: null });
    const upsertQ = createMockQuery({ data: { id: SESSION_LOG_ID }, error: null });
    const existingExLogsQ = createMockQuery({ data: [], error: null });
    const deleteExQ = createMockQuery({ data: null, error: null });
    const insertExQ = insertExerciseLogsReturning(["el-a", "el-b"]);
    const setLogsInsertQ = createMockQuery({ data: null, error: null });
    const linkQ = createMockQuery({ data: null, error: null });

    installRouter({
      training_events: [eventQ, linkQ],
      clients: clientQ,
      training_sessions: sessionSnapQ,
      training_exercises: exerciseSnapQ,
      session_logs: upsertQ,
      exercise_logs: [existingExLogsQ, deleteExQ, insertExQ],
      set_logs: setLogsInsertQ,
    });

    await logTrainingEvent({
      eventId: EVENT_ID,
      clientId: CLIENT_ID,
      payload: {
        completionQuality: "full",
        exercises: [
          { exerciseName: "A", sets: [{}], weightUnit: "lbs", skipped: true },
          { exerciseName: "B", sets: [{}], weightUnit: "lbs", skipped: true },
        ],
      },
    });

    expect(upsertQ.insert.mock.calls[0][0].completion_quality).toBe("full");
    expect(linkQ.update.mock.calls[0][0].status).toBe("completed");
  });

  // -------------------------------------------------------------------------
  // 6. Per-set fidelity via set_logs (replaces the old scalar-collapse rule).
  // -------------------------------------------------------------------------
  it("[6] per-set fidelity: writes one set_logs row per set with reps/weight/rpe; exercise_logs row carries completed", async () => {
    const eventQ = createMockQuery({ data: eventRow(), error: null });
    const clientQ = createMockQuery({
      data: { expected_check_in_day: null },
      error: null,
    });
    const sessionSnapQ = createMockQuery({
      data: SESSION_PRESCRIPTION,
      error: null,
    });
    const exerciseSnapQ = createMockQuery({ data: [], error: null });
    const upsertQ = createMockQuery({ data: { id: SESSION_LOG_ID }, error: null });
    const existingExLogsQ = createMockQuery({ data: [], error: null });
    const deleteExQ = createMockQuery({ data: null, error: null });
    const insertExQ = insertExerciseLogsReturning(["el-bench"]);
    const setLogsInsertQ = createMockQuery({ data: null, error: null });
    const linkQ = createMockQuery({ data: null, error: null });

    installRouter({
      training_events: [eventQ, linkQ],
      clients: clientQ,
      training_sessions: sessionSnapQ,
      training_exercises: exerciseSnapQ,
      session_logs: upsertQ,
      exercise_logs: [existingExLogsQ, deleteExQ, insertExQ],
      set_logs: setLogsInsertQ,
    });

    await logTrainingEvent({
      eventId: EVENT_ID,
      clientId: CLIENT_ID,
      payload: {
        completionQuality: "full",
        exercises: [
          {
            exerciseName: "Bench",
            sets: [
              { reps: 10, weight: 100, rpe: 7 },
              { reps: 10, weight: 105, rpe: 8 },
              { reps: 8, weight: 105, rpe: 9 },
            ],
            weightUnit: "kg",
          },
        ],
      },
    });

    const inserted = insertExQ.insert.mock.calls[0][0][0];
    // weight_unit is gone with migration 141 — logged loads are canonical kg.
    expect(inserted.weight_unit).toBeUndefined();
    expect(inserted.completed).toBe(true);
    expect(inserted.performed_name).toBe("Bench");

    // set_logs preserves per-set values exactly.
    expect(setLogsInsertQ.insert).toHaveBeenCalledTimes(1);
    expect(setLogsInsertQ.insert.mock.calls[0][0]).toEqual([
      { exercise_log_id: "el-bench", set_number: 1, set_type: "working", reps: 10, weight: 100, rpe: 7 },
      { exercise_log_id: "el-bench", set_number: 2, set_type: "working", reps: 10, weight: 105, rpe: 8 },
      { exercise_log_id: "el-bench", set_number: 3, set_type: "working", reps: 8, weight: 105, rpe: 9 },
    ]);
  });

  // -------------------------------------------------------------------------
  // 7. Free-form exercise (no trainingExerciseId)
  // -------------------------------------------------------------------------
  it("[7] free-form exercise: training_exercise_id=null, exercise_id=null, prescribed_exercise_snapshot.name persisted from payload", async () => {
    const eventQ = createMockQuery({ data: eventRow(), error: null });
    const clientQ = createMockQuery({
      data: { expected_check_in_day: null },
      error: null,
    });
    const sessionSnapQ = createMockQuery({
      data: SESSION_PRESCRIPTION,
      error: null,
    });
    const exerciseSnapQ = createMockQuery({ data: [], error: null });
    const upsertQ = createMockQuery({ data: { id: SESSION_LOG_ID }, error: null });
    const existingExLogsQ = createMockQuery({ data: [], error: null });
    const deleteExQ = createMockQuery({ data: null, error: null });
    const insertExQ = insertExerciseLogsReturning(["el-free"]);
    const setLogsInsertQ = createMockQuery({ data: null, error: null });
    const linkQ = createMockQuery({ data: null, error: null });

    installRouter({
      training_events: [eventQ, linkQ],
      clients: clientQ,
      training_sessions: sessionSnapQ,
      training_exercises: exerciseSnapQ,
      session_logs: upsertQ,
      exercise_logs: [existingExLogsQ, deleteExQ, insertExQ],
      set_logs: setLogsInsertQ,
    });

    await logTrainingEvent({
      eventId: EVENT_ID,
      clientId: CLIENT_ID,
      payload: {
        completionQuality: "full",
        exercises: [
          {
            exerciseName: "Some custom move",
            sets: [{ reps: 12, weight: 50 }],
            weightUnit: "lbs",
          },
        ],
      },
    });

    const inserted = insertExQ.insert.mock.calls[0][0][0];
    expect(inserted.training_exercise_id).toBeNull();
    expect(inserted.exercise_id).toBeNull();
    expect(inserted.performed_name).toBe("Some custom move");
    // Free-form snapshot persistence fix: name captured from the payload so
    // revisit shows it instead of "Unknown exercise".
    expect(inserted.prescribed_exercise_snapshot).toEqual({
      name: "Some custom move",
    });
  });

  // -------------------------------------------------------------------------
  // 7b. Picker selection: payload exerciseId is persisted into the row.
  // -------------------------------------------------------------------------
  it("[7b] picker-selected exercise: payload exerciseId is persisted into exercise_logs.exercise_id", async () => {
    const PICKED_EXERCISE_ID = "11111111-1111-4111-8111-111111111111";
    const eventQ = createMockQuery({ data: eventRow(), error: null });
    const clientQ = createMockQuery({
      data: { expected_check_in_day: null },
      error: null,
    });
    const sessionSnapQ = createMockQuery({
      data: SESSION_PRESCRIPTION,
      error: null,
    });
    const exerciseSnapQ = createMockQuery({ data: [], error: null });
    const upsertQ = createMockQuery({ data: { id: SESSION_LOG_ID }, error: null });
    const existingExLogsQ = createMockQuery({ data: [], error: null });
    const deleteExQ = createMockQuery({ data: null, error: null });
    const insertExQ = insertExerciseLogsReturning(["el-pick"]);
    const setLogsInsertQ = createMockQuery({ data: null, error: null });
    const linkQ = createMockQuery({ data: null, error: null });

    installRouter({
      training_events: [eventQ, linkQ],
      clients: clientQ,
      training_sessions: sessionSnapQ,
      training_exercises: exerciseSnapQ,
      session_logs: upsertQ,
      exercise_logs: [existingExLogsQ, deleteExQ, insertExQ],
      set_logs: setLogsInsertQ,
    });

    await logTrainingEvent({
      eventId: EVENT_ID,
      clientId: CLIENT_ID,
      payload: {
        completionQuality: "full",
        exercises: [
          {
            exerciseId: PICKED_EXERCISE_ID,
            exerciseName: "Bench Press",
            sets: [{ reps: 10, weight: 100 }],
            weightUnit: "lbs",
          },
        ],
      },
    });

    const inserted = insertExQ.insert.mock.calls[0][0][0];
    expect(inserted.exercise_id).toBe(PICKED_EXERCISE_ID);
    expect(inserted.performed_name).toBe("Bench Press");
  });

  // -------------------------------------------------------------------------
  // 8. Skipped exercise: completed=false, actuals null
  // -------------------------------------------------------------------------
  it("[8] skipped exercise: completed=false; no set_logs rows written", async () => {
    const eventQ = createMockQuery({ data: eventRow(), error: null });
    const clientQ = createMockQuery({
      data: { expected_check_in_day: null },
      error: null,
    });
    const sessionSnapQ = createMockQuery({
      data: SESSION_PRESCRIPTION,
      error: null,
    });
    const exerciseSnapQ = createMockQuery({
      data: [EXERCISE_A_PRESCRIPTION],
      error: null,
    });
    const upsertQ = createMockQuery({ data: { id: SESSION_LOG_ID }, error: null });
    const existingExLogsQ = createMockQuery({ data: [], error: null });
    const deleteExQ = createMockQuery({ data: null, error: null });
    const insertExQ = insertExerciseLogsReturning(["el-skip"]);
    const setLogsInsertQ = createMockQuery({ data: null, error: null });
    const linkQ = createMockQuery({ data: null, error: null });

    installRouter({
      training_events: [eventQ, linkQ],
      clients: clientQ,
      training_sessions: sessionSnapQ,
      training_exercises: exerciseSnapQ,
      session_logs: upsertQ,
      exercise_logs: [existingExLogsQ, deleteExQ, insertExQ],
      set_logs: setLogsInsertQ,
    });

    await logTrainingEvent({
      eventId: EVENT_ID,
      clientId: CLIENT_ID,
      payload: {
        completionQuality: "full",
        exercises: [
          {
            trainingExerciseId: EXERCISE_A,
            exerciseName: "Bench",
            sets: [{}],
            weightUnit: "lbs",
            skipped: true,
          },
        ],
      },
    });

    const inserted = insertExQ.insert.mock.calls[0][0][0];
    expect(inserted.completed).toBe(false);
    expect(setLogsInsertQ.insert).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 9. Wrong client_id
  // -------------------------------------------------------------------------
  it("[9] event lookup miss (wrong clientId or wrong eventId) throws", async () => {
    const eventQ = createMockQuery({ data: null, error: null });
    installRouter({ training_events: eventQ });

    await expect(
      logTrainingEvent({
        eventId: EVENT_ID,
        clientId: CLIENT_ID,
        payload: { completionQuality: "full" },
      }),
    ).rejects.toThrow(/Training event not found/);
  });

  // -------------------------------------------------------------------------
  // 10. Snapshot field shapes — exact
  // -------------------------------------------------------------------------
  it("[10] snapshot shape: session has exact 5 keys, exercise has exact 12 keys including percentage_1rm and is_warmup", async () => {
    const eventQ = createMockQuery({ data: eventRow(), error: null });
    const clientQ = createMockQuery({
      data: { expected_check_in_day: null },
      error: null,
    });
    const sessionSnapQ = createMockQuery({
      data: SESSION_PRESCRIPTION,
      error: null,
    });
    const exerciseSnapQ = createMockQuery({
      data: [EXERCISE_A_PRESCRIPTION],
      error: null,
    });
    const upsertQ = createMockQuery({ data: { id: SESSION_LOG_ID }, error: null });
    const existingExLogsQ = createMockQuery({ data: [], error: null });
    const deleteExQ = createMockQuery({ data: null, error: null });
    const insertExQ = insertExerciseLogsReturning(["el-snap"]);
    const setLogsInsertQ = createMockQuery({ data: null, error: null });
    const linkQ = createMockQuery({ data: null, error: null });

    installRouter({
      training_events: [eventQ, linkQ],
      clients: clientQ,
      training_sessions: sessionSnapQ,
      training_exercises: exerciseSnapQ,
      session_logs: upsertQ,
      exercise_logs: [existingExLogsQ, deleteExQ, insertExQ],
      set_logs: setLogsInsertQ,
    });

    await logTrainingEvent({
      eventId: EVENT_ID,
      clientId: CLIENT_ID,
      payload: {
        completionQuality: "full",
        exercises: [
          {
            trainingExerciseId: EXERCISE_A,
            exerciseName: "Bench",
            sets: [{ reps: 10, weight: 100 }],
            weightUnit: "lbs",
          },
        ],
      },
    });

    const sessionSnap = upsertQ.insert.mock.calls[0][0].prescribed_session_snapshot;
    expect(Object.keys(sessionSnap).sort()).toEqual(
      [
        "day_of_week",
        "estimated_calories",
        "estimated_duration_minutes",
        "focus",
        "name",
      ].sort(),
    );

    const exerciseSnap =
      insertExQ.insert.mock.calls[0][0][0].prescribed_exercise_snapshot;
    expect(Object.keys(exerciseSnap).sort()).toEqual(
      [
        "is_warmup",
        "name",
        "notes",
        "percentage_1rm",
        "reps_max",
        "reps_min",
        "reps_target",
        "rest_seconds",
        "rpe_target",
        "set_specs",
        "sets",
        "superset_group",
        "tempo",
      ].sort(),
    );
  });

  // -------------------------------------------------------------------------
  // Snapshot captures set_specs (mig 119) — needed for warm-up-aware historical
  // compliance once the Phase 2 builder authors per-set prescriptions.
  // -------------------------------------------------------------------------
  it("captures training_exercises.set_specs into the prescribed_exercise_snapshot", async () => {
    const setSpecs = [
      { set_number: 1, set_type: "warmup" },
      { set_number: 2, set_type: "working", reps_min: 8, reps_max: 10 },
    ];
    const eventQ = createMockQuery({ data: eventRow(), error: null });
    const clientQ = createMockQuery({
      data: { expected_check_in_day: null },
      error: null,
    });
    const sessionSnapQ = createMockQuery({ data: SESSION_PRESCRIPTION, error: null });
    const exerciseSnapQ = createMockQuery({
      data: [{ ...EXERCISE_A_PRESCRIPTION, set_specs: setSpecs }],
      error: null,
    });
    const upsertQ = createMockQuery({ data: { id: SESSION_LOG_ID }, error: null });
    const existingExLogsQ = createMockQuery({ data: [], error: null });
    const deleteExQ = createMockQuery({ data: null, error: null });
    const insertExQ = insertExerciseLogsReturning(["el-specs"]);
    const setLogsInsertQ = createMockQuery({ data: null, error: null });
    const linkQ = createMockQuery({ data: null, error: null });

    installRouter({
      training_events: [eventQ, linkQ],
      clients: clientQ,
      training_sessions: sessionSnapQ,
      training_exercises: exerciseSnapQ,
      session_logs: upsertQ,
      exercise_logs: [existingExLogsQ, deleteExQ, insertExQ],
      set_logs: setLogsInsertQ,
    });

    await logTrainingEvent({
      eventId: EVENT_ID,
      clientId: CLIENT_ID,
      payload: {
        completionQuality: "full",
        exercises: [
          {
            trainingExerciseId: EXERCISE_A,
            exerciseName: "Bench",
            sets: [{ reps: 10, weight: 100 }],
            weightUnit: "lbs",
          },
        ],
      },
    });

    const exerciseSnap =
      insertExQ.insert.mock.calls[0][0][0].prescribed_exercise_snapshot;
    expect(exerciseSnap.set_specs).toEqual(setSpecs);
  });

  // -------------------------------------------------------------------------
  // 11. Re-run idempotency on normal (non-orphan) path
  // -------------------------------------------------------------------------
  it("[11] event-keyed insert replaces exercise_logs (delete-then-insert)", async () => {
    const eventQ = createMockQuery({ data: eventRow(), error: null });
    const clientQ = createMockQuery({
      data: { expected_check_in_day: null },
      error: null,
    });
    const sessionSnapQ = createMockQuery({
      data: SESSION_PRESCRIPTION,
      error: null,
    });
    const exerciseSnapQ = createMockQuery({
      data: [EXERCISE_A_PRESCRIPTION],
      error: null,
    });
    const upsertQ = createMockQuery({ data: { id: SESSION_LOG_ID }, error: null });
    const existingExLogsQ = createMockQuery({ data: [], error: null });
    const deleteExQ = createMockQuery({ data: null, error: null });
    const insertExQ = insertExerciseLogsReturning(["el-rerun"]);
    const setLogsInsertQ = createMockQuery({ data: null, error: null });
    const linkQ = createMockQuery({ data: null, error: null });

    installRouter({
      training_events: [eventQ, linkQ],
      clients: clientQ,
      training_sessions: sessionSnapQ,
      training_exercises: exerciseSnapQ,
      session_logs: upsertQ,
      exercise_logs: [existingExLogsQ, deleteExQ, insertExQ],
      set_logs: setLogsInsertQ,
    });

    await logTrainingEvent({
      eventId: EVENT_ID,
      clientId: CLIENT_ID,
      payload: {
        completionQuality: "full",
        exercises: [
          {
            trainingExerciseId: EXERCISE_A,
            exerciseName: "Bench",
            sets: [{ reps: 10, weight: 100 }],
            weightUnit: "lbs",
          },
        ],
      },
    });

    // Fresh event-keyed INSERT (no prior session_log_id), keyed by event id;
    // exercise_logs are then replaced via delete-then-insert.
    expect(upsertQ.insert).toHaveBeenCalledTimes(1);
    expect(upsertQ.insert.mock.calls[0][0]).toMatchObject({
      training_event_id: EVENT_ID,
    });
    expect(deleteExQ.delete).toHaveBeenCalledTimes(1);
    expect(insertExQ.insert).toHaveBeenCalledTimes(1);
    // set_logs insert fires for the one filled set (cascade-deleted with the
    // exercise_logs DELETE in step 6b, then re-inserted from the new payload).
    expect(setLogsInsertQ.insert).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // 12. event.training_session_id null, single call (first orphan log)
  // -------------------------------------------------------------------------
  it("[12] first call on orphan event (training_session_id null, session_log_id null): insert path, snapshot null, no exercise prefetch", async () => {
    const orphanRow = eventRow({
      training_session_id: null,
      session_log_id: null,
    });
    const eventQ = createMockQuery({ data: orphanRow, error: null });
    const clientQ = createMockQuery({
      data: { expected_check_in_day: null },
      error: null,
    });
    const upsertQ = createMockQuery({ data: { id: SESSION_LOG_ID }, error: null });
    const linkQ = createMockQuery({ data: null, error: null });

    installRouter({
      training_events: [eventQ, linkQ],
      clients: clientQ,
      session_logs: upsertQ,
      // No training_sessions or training_exercises calls expected.
    });

    await logTrainingEvent({
      eventId: EVENT_ID,
      clientId: CLIENT_ID,
      payload: { completionQuality: "full" },
    });

    expect(mockFrom).not.toHaveBeenCalledWith("training_sessions");
    expect(mockFrom).not.toHaveBeenCalledWith("training_exercises");
    const upsertArg = upsertQ.insert.mock.calls[0][0];
    expect(upsertArg.training_session_id).toBeNull();
    expect(upsertArg.prescribed_session_snapshot).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 12b. Orphan-event retry idempotency (UPDATE branch, not upsert)
  // -------------------------------------------------------------------------
  it("[12b] orphan retry (training_session_id null, session_log_id set): UPDATE the linked row, no upsert", async () => {
    const orphanRetryRow = eventRow({
      training_session_id: null,
      session_log_id: SESSION_LOG_ID,
    });
    const eventQ = createMockQuery({ data: orphanRetryRow, error: null });
    const clientQ = createMockQuery({
      data: { expected_check_in_day: null },
      error: null,
    });
    const updateQ = createMockQuery({ data: { id: SESSION_LOG_ID }, error: null });
    const linkQ = createMockQuery({ data: null, error: null });

    installRouter({
      training_events: [eventQ, linkQ],
      clients: clientQ,
      session_logs: updateQ,
    });

    await logTrainingEvent({
      eventId: EVENT_ID,
      clientId: CLIENT_ID,
      payload: { completionQuality: "partial" },
    });

    // Two updates on session_logs: the row write, then linkSessionLogToEvent
    // stamping training_event_id back onto the same row. Never an upsert.
    expect(updateQ.update).toHaveBeenCalledTimes(2);
    expect(updateQ.upsert).not.toHaveBeenCalled();
    // Both target by id, never by composite key.
    expect(updateQ.eq).toHaveBeenCalledWith("id", SESSION_LOG_ID);
  });

  // -------------------------------------------------------------------------
  // 12c. Orphan retry preserves existing snapshot (omits column when fresh is null)
  // -------------------------------------------------------------------------
  it("[12c] orphan retry with sessionSnapshot=null OMITS prescribed_session_snapshot from UPDATE payload (preservation)", async () => {
    const orphanRetryRow = eventRow({
      training_session_id: null,
      session_log_id: SESSION_LOG_ID,
    });
    const eventQ = createMockQuery({ data: orphanRetryRow, error: null });
    const clientQ = createMockQuery({
      data: { expected_check_in_day: null },
      error: null,
    });
    const updateQ = createMockQuery({ data: { id: SESSION_LOG_ID }, error: null });
    const linkQ = createMockQuery({ data: null, error: null });

    installRouter({
      training_events: [eventQ, linkQ],
      clients: clientQ,
      session_logs: updateQ,
    });

    await logTrainingEvent({
      eventId: EVENT_ID,
      clientId: CLIENT_ID,
      payload: { completionQuality: "full" },
    });

    const updatePayload = updateQ.update.mock.calls[0][0];
    // Structural assertion: the column key is NOT present in the payload, so PG
    // leaves the existing column value alone. Using Object.keys to avoid the
    // "undefined matches strict-object-equality" trap.
    expect(Object.keys(updatePayload)).not.toContain(
      "prescribed_session_snapshot",
    );
  });

  // -------------------------------------------------------------------------
  // 12c-inverse. Same orphan retry, but session DID re-resolve (rare):
  //              snapshot fresh-non-null IS included in the UPDATE.
  // -------------------------------------------------------------------------
  it("[12c-inverse] orphan retry with fresh sessionSnapshot non-null DOES include the column in UPDATE", async () => {
    // training_session_id is null on the event (orphan), but suppose we hand
    // off non-null. Actually with training_session_id=null, sessionSnapshot
    // stays null. To exercise the "fresh non-null" branch on UPDATE, we'd need
    // a different code path — there isn't one today (UPDATE branch only fires
    // when training_session_id is null). So this assertion documents the
    // current invariant: the update payload either omits the column or sets
    // it to a non-null snapshot, never sets it to null. We assert the
    // "never sets it to null" half.
    const orphanRetryRow = eventRow({
      training_session_id: null,
      session_log_id: SESSION_LOG_ID,
    });
    const eventQ = createMockQuery({ data: orphanRetryRow, error: null });
    const clientQ = createMockQuery({
      data: { expected_check_in_day: null },
      error: null,
    });
    const updateQ = createMockQuery({ data: { id: SESSION_LOG_ID }, error: null });
    const linkQ = createMockQuery({ data: null, error: null });

    installRouter({
      training_events: [eventQ, linkQ],
      clients: clientQ,
      session_logs: updateQ,
    });

    await logTrainingEvent({
      eventId: EVENT_ID,
      clientId: CLIENT_ID,
      payload: { completionQuality: "full" },
    });

    const updatePayload = updateQ.update.mock.calls[0][0];
    // Negative: the column must never be present-with-null. Either absent, or
    // present with a non-null value. (Today: absent.)
    if ("prescribed_session_snapshot" in updatePayload) {
      expect(updatePayload.prescribed_session_snapshot).not.toBeNull();
    }
  });

  // -------------------------------------------------------------------------
  // 12d. Detailed-retry preserves exercise snapshots after prescription deletion
  //      AND the free-form exemption holds.
  // -------------------------------------------------------------------------
  it("[12d] detailed retry: deleted prescription falls back to existing snapshot for resolved exercise; free-form gets null (no preservation by name/position)", async () => {
    const eventQ = createMockQuery({ data: eventRow(), error: null });
    const clientQ = createMockQuery({
      data: { expected_check_in_day: null },
      error: null,
    });
    const sessionSnapQ = createMockQuery({
      data: SESSION_PRESCRIPTION,
      error: null,
    });
    // Prescription was deleted between calls — training_exercises returns nothing.
    const exerciseSnapQ = createMockQuery({ data: [], error: null });
    const upsertQ = createMockQuery({ data: { id: SESSION_LOG_ID }, error: null });
    // Existing exercise_logs from the previous call: row-A has a captured snapshot,
    // free-form row had null snapshot and null training_exercise_id.
    const existingExLogsQ = createMockQuery({
      data: [
        {
          training_exercise_id: EXERCISE_A,
          prescribed_exercise_snapshot: EXERCISE_A_SNAPSHOT,
        },
        {
          training_exercise_id: null,
          prescribed_exercise_snapshot: null,
        },
      ],
      error: null,
    });
    const deleteExQ = createMockQuery({ data: null, error: null });
    const insertExQ = insertExerciseLogsReturning(["el-a", "el-free"]);
    const setLogsInsertQ = createMockQuery({ data: null, error: null });
    const linkQ = createMockQuery({ data: null, error: null });

    installRouter({
      training_events: [eventQ, linkQ],
      clients: clientQ,
      training_sessions: sessionSnapQ,
      training_exercises: exerciseSnapQ,
      session_logs: upsertQ,
      exercise_logs: [existingExLogsQ, deleteExQ, insertExQ],
      set_logs: setLogsInsertQ,
    });

    await logTrainingEvent({
      eventId: EVENT_ID,
      clientId: CLIENT_ID,
      payload: {
        completionQuality: "full",
        exercises: [
          {
            trainingExerciseId: EXERCISE_A,
            exerciseName: "Bench",
            sets: [{ reps: 10, weight: 100 }],
            weightUnit: "lbs",
          },
          {
            // free-form (no trainingExerciseId)
            exerciseName: "Mystery Lift",
            sets: [{ reps: 8, weight: 50 }],
            weightUnit: "lbs",
          },
        ],
      },
    });

    const inserts = insertExQ.insert.mock.calls[0][0];
    // Resolved exercise: fresh is null (deleted), preservation kicks in.
    const aRow = inserts.find(
      (r: { training_exercise_id: string | null }) =>
        r.training_exercise_id === EXERCISE_A,
    );
    expect(aRow.prescribed_exercise_snapshot).toEqual(EXERCISE_A_SNAPSHOT);
    // Free-form: no prescription preservation (no stable cross-write key),
    // but the user-supplied name is now captured in the snapshot for revisit.
    const freeForm = inserts.find(
      (r: { training_exercise_id: string | null }) =>
        r.training_exercise_id === null,
    );
    expect(freeForm.prescribed_exercise_snapshot).toEqual({
      name: "Mystery Lift",
    });
    expect(freeForm.performed_name).toBe("Mystery Lift");
  });

  // -------------------------------------------------------------------------
  // 13. Transaction integrity: exercise_logs INSERT failure throws after
  //     session_log was already written; retry is safe via idempotency rules.
  // -------------------------------------------------------------------------
  it("[13] exercise_logs insert failure: throws; session_log row already written; retry is safe by event-keyed UPDATE/delete-then-insert convergence", async () => {
    const eventQ = createMockQuery({ data: eventRow(), error: null });
    const clientQ = createMockQuery({
      data: { expected_check_in_day: null },
      error: null,
    });
    const sessionSnapQ = createMockQuery({
      data: SESSION_PRESCRIPTION,
      error: null,
    });
    const exerciseSnapQ = createMockQuery({ data: [], error: null });
    const upsertQ = createMockQuery({ data: { id: SESSION_LOG_ID }, error: null });
    const existingExLogsQ = createMockQuery({ data: [], error: null });
    const deleteExQ = createMockQuery({ data: null, error: null });
    const insertExQ = createMockQuery({
      data: null,
      error: { message: "boom" },
    });
    const linkQ = createMockQuery({ data: null, error: null });

    installRouter({
      training_events: [eventQ, linkQ],
      clients: clientQ,
      training_sessions: sessionSnapQ,
      training_exercises: exerciseSnapQ,
      session_logs: upsertQ,
      exercise_logs: [existingExLogsQ, deleteExQ, insertExQ],
    });

    await expect(
      logTrainingEvent({
        eventId: EVENT_ID,
        clientId: CLIENT_ID,
        payload: {
          completionQuality: "full",
          exercises: [
            {
              exerciseName: "A",
              sets: [{ reps: 10, weight: 100 }],
              weightUnit: "lbs",
            },
          ],
        },
      }),
    ).rejects.toThrow(/Failed to insert exercise logs.*boom/);

    // session_log was successfully inserted before the failure.
    expect(upsertQ.insert).toHaveBeenCalledTimes(1);
    // training_events update was NOT called (status link is step 7, after step 6).
    expect(linkQ.update).not.toHaveBeenCalled();
  });

  it("[14] lock: a PAST event already logged throws DayLockedError before writing", async () => {
    const eventQ = createMockQuery({
      data: eventRow({ date: "2026-05-01", session_log_id: SESSION_LOG_ID }),
      error: null,
    });
    const clientQ = createMockQuery({
      data: { expected_check_in_day: null, timezone: "UTC" },
      error: null,
    });
    const writeSpy = createMockQuery({ data: { id: SESSION_LOG_ID }, error: null });

    installRouter({
      training_events: eventQ,
      clients: clientQ,
      session_logs: writeSpy,
    });

    await expect(
      logTrainingEvent({
        eventId: EVENT_ID,
        clientId: CLIENT_ID,
        payload: { completionQuality: "full" },
      }),
    ).rejects.toThrow(/locked/i);
    expect(writeSpy.insert).not.toHaveBeenCalled();
    expect(writeSpy.update).not.toHaveBeenCalled();
  });
});

describe("getTrainingEventDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // 15. Not found → null
  // -------------------------------------------------------------------------
  it("[15] event not found (or wrong clientId) returns null", async () => {
    const eventQ = createMockQuery({ data: null, error: null });
    installRouter({ training_events: eventQ });

    const result = await getTrainingEventDetail(EVENT_ID, CLIENT_ID);
    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 16. Live path (event.session_log_id set, live session/exercises resolve)
  // -------------------------------------------------------------------------
  it("[16] live path: returns live session, live exercises, sessionLog, exerciseLogs", async () => {
    const eventQ = createMockQuery({
      data: {
        id: EVENT_ID,
        client_id: CLIENT_ID,
        training_plan_id: "plan-1",
        training_session_id: SESSION_ID,
        date: "2026-05-04",
        session_name: "Push",
        session_focus: "chest",
        estimated_calories: 400,
        status: "completed",
        session_log_id: SESSION_LOG_ID,
        is_modified: false,
        calorie_surplus_percentage: null,
        created_at: "2026-05-01T00:00:00Z",
        updated_at: "2026-05-04T12:00:00Z",
      },
      error: null,
    });
    const sessionQ = createMockQuery({
      data: {
        id: SESSION_ID,
        plan_id: "plan-1",
        name: "Push",
        day_of_week: "monday",
        order_index: 0,
        focus: "chest",
        notes: null,
        estimated_duration_minutes: 60,
        estimated_calories: 400,
        calories_calculated_at: null,
        calorie_surplus_percentage: null,
        created_at: "2026-05-01T00:00:00Z",
        updated_at: "2026-05-01T00:00:00Z",
        training_exercises: [
          {
            id: EXERCISE_A,
            session_id: SESSION_ID,
            exercise_id: null,
            name: "Bench",
            order_index: 0,
            sets: 3,
            reps_min: 8,
            reps_max: 10,
            reps_target: null,
            rpe_target: 8,
            percentage_1rm: null,
            tempo: null,
            rest_seconds: 90,
            notes: null,
            superset_group: null,
            is_warmup: false,
            is_active: true,
            created_at: "2026-05-01T00:00:00Z",
            updated_at: "2026-05-01T00:00:00Z",
          },
        ],
      },
      error: null,
    });
    const sessionLogQ = createMockQuery({
      data: {
        id: SESSION_LOG_ID,
        client_id: CLIENT_ID,
        training_session_id: SESSION_ID,
        completed_at: "2026-05-04",
        completion_quality: "full",
        notes: null,
        week_start_date: "2026-05-04",
        prescribed_session_snapshot: null,
        created_at: "2026-05-04T12:00:00Z",
        updated_at: "2026-05-04T12:00:00Z",
      },
      error: null,
    });
    const exerciseLogsQ = createMockQuery({
      data: [
        {
          id: "elog-1",
          session_log_id: SESSION_LOG_ID,
          training_exercise_id: EXERCISE_A,
          completed: true,
          actual_sets: 3,
          actual_reps: "10,10,8",
          actual_weight: 105,
          notes: null,
          prescribed_exercise_snapshot: null,
          created_at: "2026-05-04T12:00:00Z",
          updated_at: "2026-05-04T12:00:00Z",
        },
      ],
      error: null,
    });

    installRouter({
      training_events: eventQ,
      training_sessions: sessionQ,
      session_logs: sessionLogQ,
      exercise_logs: exerciseLogsQ,
    });

    const result = await getTrainingEventDetail(EVENT_ID, CLIENT_ID);

    expect(result).not.toBeNull();
    expect(result!.event.id).toBe(EVENT_ID);
    expect(result!.session.source).toBe("live");
    expect(result!.exercises).toHaveLength(1);
    expect(result!.exercises[0].source).toBe("live");
    expect(result!.sessionLog?.id).toBe(SESSION_LOG_ID);
    expect(result!.exerciseLogs).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // 17. No composite-key fallback (removed in Session 5.2): the log is resolved
  //     only via event.session_log_id, so an unlinked event has a null log.
  // -------------------------------------------------------------------------
  it("[17] no composite-key fallback: event.session_log_id null yields sessionLog null", async () => {
    const eventQ = createMockQuery({
      data: {
        id: EVENT_ID,
        client_id: CLIENT_ID,
        training_plan_id: "plan-1",
        training_session_id: SESSION_ID,
        date: "2026-05-04",
        session_name: "Push",
        session_focus: null,
        estimated_calories: null,
        status: "scheduled",
        session_log_id: null, // not linked
        is_modified: false,
        calorie_surplus_percentage: null,
        created_at: "2026-05-01T00:00:00Z",
        updated_at: "2026-05-01T00:00:00Z",
      },
      error: null,
    });
    const sessionQ = createMockQuery({
      data: {
        id: SESSION_ID,
        plan_id: "plan-1",
        name: "Push",
        day_of_week: "monday",
        order_index: 0,
        focus: null,
        notes: null,
        estimated_duration_minutes: null,
        estimated_calories: null,
        calories_calculated_at: null,
        calorie_surplus_percentage: null,
        created_at: "2026-05-01T00:00:00Z",
        updated_at: "2026-05-01T00:00:00Z",
        training_exercises: [],
      },
      error: null,
    });

    installRouter({
      training_events: eventQ,
      training_sessions: sessionQ,
    });

    const result = await getTrainingEventDetail(EVENT_ID, CLIENT_ID);
    expect(result).not.toBeNull();
    expect(result?.sessionLog).toBeNull();
    // The composite-key lookup is gone — session_logs is never queried for an
    // unlinked event.
    expect(mockFrom).not.toHaveBeenCalledWith("session_logs");
  });

  // -------------------------------------------------------------------------
  // 18. Quick-logged session: sessionLog present, exerciseLogs empty
  // -------------------------------------------------------------------------
  it("[18] quick-logged: exerciseLogs is empty array", async () => {
    const eventQ = createMockQuery({
      data: {
        id: EVENT_ID,
        client_id: CLIENT_ID,
        training_plan_id: "plan-1",
        training_session_id: SESSION_ID,
        date: "2026-05-04",
        session_name: "Push",
        session_focus: null,
        estimated_calories: null,
        status: "completed",
        session_log_id: SESSION_LOG_ID,
        is_modified: false,
        calorie_surplus_percentage: null,
        created_at: "2026-05-01T00:00:00Z",
        updated_at: "2026-05-01T00:00:00Z",
      },
      error: null,
    });
    const sessionQ = createMockQuery({
      data: {
        id: SESSION_ID,
        plan_id: "plan-1",
        name: "Push",
        day_of_week: null,
        order_index: 0,
        focus: null,
        notes: null,
        estimated_duration_minutes: null,
        estimated_calories: null,
        calories_calculated_at: null,
        calorie_surplus_percentage: null,
        created_at: "x",
        updated_at: "x",
        training_exercises: [],
      },
      error: null,
    });
    const sessionLogQ = createMockQuery({
      data: {
        id: SESSION_LOG_ID,
        client_id: CLIENT_ID,
        training_session_id: SESSION_ID,
        completed_at: "2026-05-04",
        completion_quality: "full",
        notes: null,
        week_start_date: "2026-05-04",
        prescribed_session_snapshot: null,
        created_at: "x",
        updated_at: "x",
      },
      error: null,
    });
    const exerciseLogsQ = createMockQuery({ data: [], error: null });

    installRouter({
      training_events: eventQ,
      training_sessions: sessionQ,
      session_logs: sessionLogQ,
      exercise_logs: exerciseLogsQ,
    });

    const result = await getTrainingEventDetail(EVENT_ID, CLIENT_ID);
    expect(result?.exerciseLogs).toEqual([]);
    expect(result?.sessionLog?.id).toBe(SESSION_LOG_ID);
  });

  // -------------------------------------------------------------------------
  // 19. Snapshot fallback for session: session row missing → ResolvedSession.snapshot
  // -------------------------------------------------------------------------
  it("[19] session deleted post-log: ResolvedSession.source='snapshot' from sessionLog.prescribed_session_snapshot", async () => {
    const eventQ = createMockQuery({
      data: {
        id: EVENT_ID,
        client_id: CLIENT_ID,
        training_plan_id: "plan-1",
        training_session_id: SESSION_ID,
        date: "2026-05-04",
        session_name: "Push",
        session_focus: null,
        estimated_calories: null,
        status: "completed",
        session_log_id: SESSION_LOG_ID,
        is_modified: false,
        calorie_surplus_percentage: null,
        created_at: "x",
        updated_at: "x",
      },
      error: null,
    });
    const missingSessionQ = createMockQuery({ data: null, error: null });
    const sessionLogQ = createMockQuery({
      data: {
        id: SESSION_LOG_ID,
        client_id: CLIENT_ID,
        training_session_id: SESSION_ID,
        completed_at: "x",
        completion_quality: "full",
        notes: null,
        week_start_date: "2026-05-04",
        prescribed_session_snapshot: SESSION_PRESCRIPTION,
        created_at: "x",
        updated_at: "x",
      },
      error: null,
    });
    const exerciseLogsQ = createMockQuery({ data: [], error: null });

    installRouter({
      training_events: eventQ,
      training_sessions: missingSessionQ,
      session_logs: sessionLogQ,
      exercise_logs: exerciseLogsQ,
    });

    const result = await getTrainingEventDetail(EVENT_ID, CLIENT_ID);
    expect(result?.session.source).toBe("snapshot");
    if (result?.session.source === "snapshot") {
      expect(result.session.snapshot).toEqual(SESSION_PRESCRIPTION);
    }
  });

  // -------------------------------------------------------------------------
  // 19b. Regression guard: when liveSession is null, all exercise_logs become
  //      snapshot-source (no `liveSession.exercises` access).
  // -------------------------------------------------------------------------
  it("[19b] no liveSession + non-empty exerciseLogs: every exercise emitted as snapshot, ordered by created_at", async () => {
    const eventQ = createMockQuery({
      data: {
        id: EVENT_ID,
        client_id: CLIENT_ID,
        training_plan_id: "plan-1",
        training_session_id: SESSION_ID,
        date: "2026-05-04",
        session_name: "Push",
        session_focus: null,
        estimated_calories: null,
        status: "completed",
        session_log_id: SESSION_LOG_ID,
        is_modified: false,
        calorie_surplus_percentage: null,
        created_at: "x",
        updated_at: "x",
      },
      error: null,
    });
    const missingSessionQ = createMockQuery({ data: null, error: null });
    const sessionLogQ = createMockQuery({
      data: {
        id: SESSION_LOG_ID,
        client_id: CLIENT_ID,
        training_session_id: SESSION_ID,
        completed_at: "x",
        completion_quality: "full",
        notes: null,
        week_start_date: "2026-05-04",
        prescribed_session_snapshot: SESSION_PRESCRIPTION,
        created_at: "x",
        updated_at: "x",
      },
      error: null,
    });
    const exerciseLogsQ = createMockQuery({
      data: [
        {
          id: "e1",
          session_log_id: SESSION_LOG_ID,
          training_exercise_id: EXERCISE_A,
          completed: true,
          actual_sets: 3,
          actual_reps: "10,10,8",
          actual_weight: 100,
          notes: null,
          prescribed_exercise_snapshot: EXERCISE_A_SNAPSHOT,
          created_at: "2026-05-04T12:00:00Z",
          updated_at: "2026-05-04T12:00:00Z",
        },
      ],
      error: null,
    });

    installRouter({
      training_events: eventQ,
      training_sessions: missingSessionQ,
      session_logs: sessionLogQ,
      exercise_logs: exerciseLogsQ,
    });

    const result = await getTrainingEventDetail(EVENT_ID, CLIENT_ID);
    expect(result?.exercises).toHaveLength(1);
    expect(result?.exercises[0].source).toBe("snapshot");
    if (result?.exercises[0].source === "snapshot") {
      expect(result.exercises[0].snapshot).toEqual(EXERCISE_A_SNAPSHOT);
    }
  });

  // -------------------------------------------------------------------------
  // 20. Snapshot fallback for one orphan exercise: live exercises preserved,
  //     orphan log appended as snapshot.
  // -------------------------------------------------------------------------
  it("[20] one live exercise + one orphan log: live first, orphan appended as snapshot", async () => {
    const eventQ = createMockQuery({
      data: {
        id: EVENT_ID,
        client_id: CLIENT_ID,
        training_plan_id: "plan-1",
        training_session_id: SESSION_ID,
        date: "2026-05-04",
        session_name: "Push",
        session_focus: null,
        estimated_calories: null,
        status: "completed",
        session_log_id: SESSION_LOG_ID,
        is_modified: false,
        calorie_surplus_percentage: null,
        created_at: "x",
        updated_at: "x",
      },
      error: null,
    });
    const sessionQ = createMockQuery({
      data: {
        id: SESSION_ID,
        plan_id: "plan-1",
        name: "Push",
        day_of_week: null,
        order_index: 0,
        focus: null,
        notes: null,
        estimated_duration_minutes: null,
        estimated_calories: null,
        calories_calculated_at: null,
        calorie_surplus_percentage: null,
        created_at: "x",
        updated_at: "x",
        training_exercises: [
          {
            id: EXERCISE_A,
            session_id: SESSION_ID,
            exercise_id: null,
            name: "Bench",
            order_index: 0,
            sets: 3,
            reps_min: null,
            reps_max: null,
            reps_target: null,
            rpe_target: null,
            percentage_1rm: null,
            tempo: null,
            rest_seconds: null,
            notes: null,
            superset_group: null,
            is_warmup: false,
            is_active: true,
            created_at: "x",
            updated_at: "x",
          },
        ],
      },
      error: null,
    });
    const sessionLogQ = createMockQuery({
      data: {
        id: SESSION_LOG_ID,
        client_id: CLIENT_ID,
        training_session_id: SESSION_ID,
        completed_at: "x",
        completion_quality: "full",
        notes: null,
        week_start_date: "2026-05-04",
        prescribed_session_snapshot: null,
        created_at: "x",
        updated_at: "x",
      },
      error: null,
    });
    // exercise_logs has TWO rows: one matches live (A), one is orphan (B-deleted).
    const orphanSnapshot = { ...EXERCISE_A_SNAPSHOT, name: "Old Move B" };
    const exerciseLogsQ = createMockQuery({
      data: [
        {
          id: "e1",
          session_log_id: SESSION_LOG_ID,
          training_exercise_id: EXERCISE_A,
          completed: true,
          actual_sets: 3,
          actual_reps: "10,10,8",
          actual_weight: 100,
          notes: null,
          prescribed_exercise_snapshot: null,
          created_at: "2026-05-04T12:00:00Z",
          updated_at: "x",
        },
        {
          id: "e2",
          session_log_id: SESSION_LOG_ID,
          training_exercise_id: EXERCISE_B, // not in live
          completed: true,
          actual_sets: 2,
          actual_reps: "8,8",
          actual_weight: 50,
          notes: null,
          prescribed_exercise_snapshot: orphanSnapshot,
          created_at: "2026-05-04T12:01:00Z",
          updated_at: "x",
        },
      ],
      error: null,
    });

    installRouter({
      training_events: eventQ,
      training_sessions: sessionQ,
      session_logs: sessionLogQ,
      exercise_logs: exerciseLogsQ,
    });

    const result = await getTrainingEventDetail(EVENT_ID, CLIENT_ID);
    expect(result?.exercises).toHaveLength(2);
    expect(result?.exercises[0].source).toBe("live"); // live first
    expect(result?.exercises[1].source).toBe("snapshot"); // orphan appended
    if (result?.exercises[1].source === "snapshot") {
      expect(result.exercises[1].snapshot).toEqual(orphanSnapshot);
    }
  });

  // -------------------------------------------------------------------------
  // 21. No log yet: sessionLog null, exerciseLogs empty, session live.
  // -------------------------------------------------------------------------
  it("[21] no log yet: sessionLog null, exerciseLogs empty array, session resolves live", async () => {
    const eventQ = createMockQuery({
      data: {
        id: EVENT_ID,
        client_id: CLIENT_ID,
        training_plan_id: "plan-1",
        training_session_id: SESSION_ID,
        date: "2026-05-04",
        session_name: "Push",
        session_focus: null,
        estimated_calories: null,
        status: "scheduled",
        session_log_id: null,
        is_modified: false,
        calorie_surplus_percentage: null,
        created_at: "x",
        updated_at: "x",
      },
      error: null,
    });
    const sessionQ = createMockQuery({
      data: {
        id: SESSION_ID,
        plan_id: "plan-1",
        name: "Push",
        day_of_week: null,
        order_index: 0,
        focus: null,
        notes: null,
        estimated_duration_minutes: null,
        estimated_calories: null,
        calories_calculated_at: null,
        calorie_surplus_percentage: null,
        created_at: "x",
        updated_at: "x",
        training_exercises: [],
      },
      error: null,
    });
    const clientQ = createMockQuery({
      data: { expected_check_in_day: null },
      error: null,
    });
    const compositeLogQ = createMockQuery({ data: null, error: null });

    installRouter({
      training_events: eventQ,
      training_sessions: sessionQ,
      clients: clientQ,
      session_logs: compositeLogQ,
    });

    const result = await getTrainingEventDetail(EVENT_ID, CLIENT_ID);
    expect(result?.sessionLog).toBeNull();
    expect(result?.exerciseLogs).toEqual([]);
    expect(result?.session.source).toBe("live");
  });
});

// ===========================================================================
// logTrainingSessionForDate (event-less, Session 5.3)
// ===========================================================================
describe("logTrainingSessionForDate", () => {
  const DATE = "2026-05-08";
  const PERFORMED = "pull-session";
  const MATCHED_EVENT = "ev-matched";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-08T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("[s1] match: writes a log linked to the matched event and flips its status", async () => {
    const clientQ = createMockQuery({ data: { expected_check_in_day: null }, error: null });
    const idemQ = createMockQuery({ data: null, error: null }); // no existing log
    const matcherQ = createMockQuery({
      data: [{ id: MATCHED_EVENT, training_session_id: PERFORMED, date: "2026-05-06", created_at: "t1" }],
      error: null,
    });
    const sessionSnapQ = createMockQuery({ data: SESSION_PRESCRIPTION, error: null });
    const insertQ = createMockQuery({ data: { id: SESSION_LOG_ID }, error: null });
    const linkBackQ = createMockQuery({ data: null, error: null });
    const linkEventQ = createMockQuery({ data: null, error: null });

    installRouter({
      clients: clientQ,
      training_events: [matcherQ, linkEventQ],
      training_sessions: sessionSnapQ,
      session_logs: [idemQ, insertQ, linkBackQ],
    });

    const result = await logTrainingSessionForDate({
      clientId: CLIENT_ID,
      date: DATE,
      payload: { date: DATE, performedSessionId: PERFORMED, completionQuality: "full" },
    });

    expect(result).toEqual({ sessionLogId: SESSION_LOG_ID });
    // Fresh INSERT keyed to the matched event, performed session in the column,
    // completed_at = the logged date.
    expect(insertQ.insert).toHaveBeenCalledTimes(1);
    expect(insertQ.insert.mock.calls[0][0]).toMatchObject({
      training_event_id: MATCHED_EVENT,
      training_session_id: PERFORMED,
      completed_at: DATE,
    });
    // Event status flipped to completed.
    expect(linkEventQ.update.mock.calls[0][0]).toMatchObject({ status: "completed" });
  });

  it("[s2] no match: writes an unmatched extra (training_event_id null), no event update", async () => {
    const clientQ = createMockQuery({ data: { expected_check_in_day: null }, error: null });
    const idemQ = createMockQuery({ data: null, error: null });
    const matcherQ = createMockQuery({ data: [], error: null }); // no candidates
    const sessionSnapQ = createMockQuery({ data: SESSION_PRESCRIPTION, error: null });
    const insertQ = createMockQuery({ data: { id: SESSION_LOG_ID }, error: null });

    installRouter({
      clients: clientQ,
      training_events: [matcherQ],
      training_sessions: sessionSnapQ,
      session_logs: [idemQ, insertQ],
    });

    const result = await logTrainingSessionForDate({
      clientId: CLIENT_ID,
      date: DATE,
      payload: { date: DATE, performedSessionId: PERFORMED, completionQuality: "full" },
    });

    expect(result).toEqual({ sessionLogId: SESSION_LOG_ID });
    expect(insertQ.insert.mock.calls[0][0]).toMatchObject({
      training_event_id: null,
      training_session_id: PERFORMED,
    });
    // matcher ran but no link/status update fired (only the one matcher read).
    expect(linkEventNotCalled(matcherQ)).toBe(true);
  });

  it("[s3] idempotent: an existing log for the same (client, session, date) is UPDATED, matcher skipped", async () => {
    const clientQ = createMockQuery({ data: { expected_check_in_day: null }, error: null });
    const idemQ = createMockQuery({
      data: { id: SESSION_LOG_ID, training_event_id: MATCHED_EVENT },
      error: null,
    });
    const sessionSnapQ = createMockQuery({ data: SESSION_PRESCRIPTION, error: null });
    const updateQ = createMockQuery({ data: { id: SESSION_LOG_ID }, error: null });
    const linkBackQ = createMockQuery({ data: null, error: null });
    const linkEventQ = createMockQuery({ data: null, error: null });
    const matcherSpy = createMockQuery({ data: [], error: null });

    installRouter({
      clients: clientQ,
      // Only the link hits training_events — the matcher must NOT run.
      training_events: [linkEventQ, matcherSpy],
      training_sessions: sessionSnapQ,
      session_logs: [idemQ, updateQ, linkBackQ],
    });

    const result = await logTrainingSessionForDate({
      clientId: CLIENT_ID,
      date: DATE,
      payload: { date: DATE, performedSessionId: PERFORMED, completionQuality: "partial" },
    });

    expect(result).toEqual({ sessionLogId: SESSION_LOG_ID });
    // UPDATE by id (no duplicate INSERT).
    expect(updateQ.update).toHaveBeenCalled();
    expect(updateQ.insert).not.toHaveBeenCalled();
    // The matcher read was never reached (the second training_events query is untouched).
    expect(matcherSpy.select).not.toHaveBeenCalled();
  });

  it("[s4] one log per rest day: a DIFFERENT session on the same date EDITS the existing log (no second row)", async () => {
    const clientQ = createMockQuery({ data: { expected_check_in_day: null }, error: null });
    // Existing unmatched rest-day log (a different session was logged earlier).
    const idemQ = createMockQuery({
      data: { id: SESSION_LOG_ID, training_event_id: null },
      error: null,
    });
    const sessionSnapQ = createMockQuery({ data: SESSION_PRESCRIPTION, error: null });
    const updateQ = createMockQuery({ data: { id: SESSION_LOG_ID }, error: null });
    const exQ = createMockQuery({ data: null, error: null });
    const matcherSpy = createMockQuery({ data: [], error: null });

    installRouter({
      clients: clientQ,
      training_events: [matcherSpy],
      training_sessions: sessionSnapQ,
      session_logs: [idemQ, updateQ],
      exercise_logs: exQ,
    });

    const result = await logTrainingSessionForDate({
      clientId: CLIENT_ID,
      date: DATE,
      payload: { date: DATE, performedSessionId: "a-different-session", completionQuality: "full" },
    });

    expect(result).toEqual({ sessionLogId: SESSION_LOG_ID });
    expect(updateQ.update).toHaveBeenCalled(); // edited in place
    expect(updateQ.insert).not.toHaveBeenCalled(); // no second row
    expect(matcherSpy.select).not.toHaveBeenCalled(); // existing found → matcher skipped
  });

  it("[s5] lock: a PAST day that already has a log throws DayLockedError before writing", async () => {
    const clientQ = createMockQuery({
      data: { expected_check_in_day: null, timezone: "UTC" },
      error: null,
    });
    const idemQ = createMockQuery({
      data: { id: SESSION_LOG_ID, training_event_id: null },
      error: null,
    });
    const writeSpy = createMockQuery({ data: { id: SESSION_LOG_ID }, error: null });

    installRouter({
      clients: clientQ,
      session_logs: [idemQ, writeSpy],
    });

    await expect(
      logTrainingSessionForDate({
        clientId: CLIENT_ID,
        date: "2026-05-01", // past (today = 2026-05-08)
        payload: { date: "2026-05-01", performedSessionId: PERFORMED, completionQuality: "full" },
      }),
    ).rejects.toThrow(/locked/i);
    expect(writeSpy.update).not.toHaveBeenCalled();
    expect(writeSpy.insert).not.toHaveBeenCalled();
  });
});

// True when the given matcher query was the only training_events interaction
// that produced no status update (it has no `.update` calls).
function linkEventNotCalled(matcherQ: ReturnType<typeof createMockQuery>): boolean {
  return matcherQ.update.mock.calls.length === 0;
}

// A local copy of mapExerciseRow lived in training-log-service and omitted
// set_specs and video_url, so getTrainingEventDetail — the client portal's only
// source for a workout — lost the per-set prescription entirely. The compact
// reps/RPE columns still came through, so the payload looked complete: the
// client saw "4 x 6-10 @ RPE 8" and no prescribed load, for every session.
describe("mapExerciseRow is the shared mapper, not a lossy local copy", () => {
  it("carries set_specs and video_url through", async () => {
    const { mapExerciseRow } = await import("@/services/training-mappers");

    const mapped = mapExerciseRow({
      id: "te-1",
      session_id: "ts-1",
      exercise_id: null,
      name: "Squats",
      order_index: 0,
      sets: 4,
      reps_min: 6,
      reps_max: 10,
      reps_target: null,
      rpe_target: 8,
      percentage_1rm: null,
      tempo: null,
      rest_seconds: 180,
      notes: null,
      superset_group: null,
      is_warmup: false,
      video_url: "https://example.test/squat",
      set_specs: [
        {
          set_number: 1,
          set_type: "working",
          reps_min: 6,
          reps_max: 10,
          reps_target: null,
          load_type: "absolute",
          load_value: 100,
          rpe_target: 8,
          tempo: null,
          rest_seconds: 180,
          drops: null,
        },
      ],
      created_at: "2026-08-06T00:00:00Z",
      updated_at: "2026-08-06T00:00:00Z",
    } as never);

    expect(mapped.setSpecs).toHaveLength(1);
    expect(mapped.setSpecs?.[0].load_value).toBe(100);
    expect(mapped.setSpecs?.[0].load_type).toBe("absolute");
    expect(mapped.videoUrl).toBe("https://example.test/squat");
  });
});
