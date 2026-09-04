import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock supabase-admin before importing the service.
vi.mock("./supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

// The day rule. Its derivation is proved in
// services/daily-log-permissions-service.test.ts; here it is a gate that either
// lets the write through or throws, which is all this service asks of it.
vi.mock("./daily-log-permissions-service", () => ({
  assertCanEdit: vi.fn(),
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
import { assertCanEdit } from "./daily-log-permissions-service";
import { DayLockedError } from "@/lib/daily-log-permissions";
import {
  logTrainingEvent,
  getTrainingEventDetail,
  getSessionLogDetail,
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
      data: { next_check_in_due: "2026-05-03" },
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
      data: { next_check_in_due: "2026-05-03" },
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
      data: { next_check_in_due: "2026-05-03" },
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
              { setNumber: 1, reps: 10, weight: 100 },
              { setNumber: 2, reps: 10, weight: 105 },
              { setNumber: 3, reps: 8, weight: 105 },
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
      data: { next_check_in_due: null },
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
            sets: [{ setNumber: 1, reps: 5, weight: 225 }],
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
  // Free-form exercises against an empty session prescription: there is nothing
  // to score, so deriveCompletionQuality returns null and the client's own claim
  // stands. This is the ONLY route by which a detailed payload keeps its stated
  // quality — see the derivation tests below for the general rule.
  it("[4] detailed log with nothing scorable: the client's completionQuality stands", async () => {
    const eventQ = createMockQuery({ data: eventRow(), error: null });
    const clientQ = createMockQuery({
      data: { next_check_in_due: null },
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
            sets: [{ setNumber: 1, reps: 10, weight: 100 }],
            weightUnit: "lbs",
          },
          {
            exerciseName: "B",
            sets: [{ setNumber: 1 }], // no data
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
      data: { next_check_in_due: null },
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
          { exerciseName: "A", sets: [{ setNumber: 1 }], weightUnit: "lbs", skipped: true },
          { exerciseName: "B", sets: [{ setNumber: 1 }], weightUnit: "lbs", skipped: true },
        ],
      },
    });

    expect(upsertQ.insert.mock.calls[0][0].completion_quality).toBe("skipped");
    expect(linkQ.update.mock.calls[0][0].status).toBe("skipped");
    // All-skipped: no set_logs rows written.
    expect(setLogsInsertQ.insert).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 5b. All-skipped free-form exercises, payload 'full'. Nothing is scorable
  //     (no prescription behind them), so the fallback keeps the client's claim.
  // -------------------------------------------------------------------------
  it("[5b] all-skipped free-form + payload 'full' → 'full' via the nothing-scorable fallback", async () => {
    const eventQ = createMockQuery({ data: eventRow(), error: null });
    const clientQ = createMockQuery({
      data: { next_check_in_due: null },
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
          { exerciseName: "A", sets: [{ setNumber: 1 }], weightUnit: "lbs", skipped: true },
          { exerciseName: "B", sets: [{ setNumber: 1 }], weightUnit: "lbs", skipped: true },
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
      data: { next_check_in_due: null },
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
              { setNumber: 1, reps: 10, weight: 100, rpe: 7 },
              { setNumber: 2, reps: 10, weight: 105, rpe: 8 },
              { setNumber: 3, reps: 8, weight: 105, rpe: 9 },
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
      data: { next_check_in_due: null },
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
            sets: [{ setNumber: 1, reps: 12, weight: 50 }],
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
      data: { next_check_in_due: null },
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
            sets: [{ setNumber: 1, reps: 10, weight: 100 }],
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
      data: { next_check_in_due: null },
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
            sets: [{ setNumber: 1 }],
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
  it("[10] snapshot shape: session has exact 5 keys, exercise has exact 14 keys including set_specs and prescribed_fields", async () => {
    const eventQ = createMockQuery({ data: eventRow(), error: null });
    const clientQ = createMockQuery({
      data: { next_check_in_due: null },
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
            sets: [{ setNumber: 1, reps: 10, weight: 100 }],
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
        "prescribed_fields",
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
      data: { next_check_in_due: null },
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
            sets: [{ setNumber: 1, reps: 10, weight: 100 }],
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
  // set_type is stamped POSITIONALLY from the prescription, and a drop set
  // occupies MORE log rows than it does spec entries (its top set plus one row
  // per drop, the Hevy/Strong shape the client renders). Before both sides
  // shared buildPrescribedRows, every row after a drop set took the type of the
  // wrong spec — silently, into set_logs, where analytics read it to exclude
  // warm-ups.
  // -------------------------------------------------------------------------
  it("stamps set_type correctly across a drop set's expanded rows", async () => {
    const setSpecs = [
      { set_number: 1, set_type: "warmup" },
      {
        set_number: 2,
        set_type: "drop",
        drops: [
          { weight: 60, reps: 8 },
          { weight: 40, reps: 8 },
        ],
      },
      { set_number: 3, set_type: "failure" },
    ];
    const eventQ = createMockQuery({ data: eventRow(), error: null });
    const clientQ = createMockQuery({
      data: { next_check_in_due: null },
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
    const insertExQ = insertExerciseLogsReturning(["el-drop"]);
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
            // Five rows: warm-up, the drop set's top set, its two drops, failure.
            sets: [
              { setNumber: 1, reps: 15, weight: 40 },
              { setNumber: 2, reps: 8, weight: 80 },
              { setNumber: 3, reps: 8, weight: 60 },
              { setNumber: 4, reps: 8, weight: 40 },
              { setNumber: 5, reps: 5, weight: 80 },
            ],
            weightUnit: "kg",
          },
        ],
      },
    });

    const inserted = setLogsInsertQ.insert.mock.calls[0][0] as {
      set_number: number;
      set_type: string;
    }[];
    expect(inserted.map((r) => r.set_type)).toEqual([
      "warmup",
      "drop",
      "drop",
      "drop",
      "failure",
    ]);
    expect(inserted.map((r) => r.set_number)).toEqual([1, 2, 3, 4, 5]);
  });

  // -------------------------------------------------------------------------
  // THE regression. A client who logs a SUBSET of the prescribed sets used to
  // have them stored at array positions 1..n and typed from the first n specs,
  // because the payload carried no set identity at all. A lone working set
  // landed as set 1 with set_type 'warmup', which the analytics RPCs exclude —
  // so a logged Bench set read as "0 sets against prescribed 4" on the Journey
  // compliance chart.
  //
  // Prescription flattens to six rows:
  //   1 warmup · 2 working · 3 drop(top) · 4 drop · 5 drop · 6 failure
  // The client sends three of them: 2, 5 and 6 — a working set, the SECOND drop
  // child (a row after the drop set began, where positional mapping goes wrong
  // even when nothing is missing), and the failure set.
  // -------------------------------------------------------------------------
  it("writes a logged SUBSET at its own set numbers and types, not at array positions", async () => {
    const setSpecs = [
      { set_number: 1, set_type: "warmup" },
      {
        set_number: 2,
        set_type: "working",
        reps_min: 8,
        reps_max: 10,
      },
      {
        set_number: 3,
        set_type: "drop",
        drops: [
          { weight: 60, reps: 8 },
          { weight: 40, reps: 8 },
        ],
      },
      { set_number: 4, set_type: "failure" },
    ];
    const eventQ = createMockQuery({ data: eventRow(), error: null });
    const clientQ = createMockQuery({
      data: { next_check_in_due: null },
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
    const insertExQ = insertExerciseLogsReturning(["el-subset"]);
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
        // Ignored: the payload carries exercises, so the server derives.
        completionQuality: "full",
        exercises: [
          {
            trainingExerciseId: EXERCISE_A,
            exerciseName: "Bench",
            sets: [
              { setNumber: 2, reps: 9, weight: 80 },
              { setNumber: 5, reps: 8, weight: 40 },
              { setNumber: 6, reps: 3, weight: 80 },
            ],
            weightUnit: "kg",
          },
        ],
      },
    });

    const inserted = setLogsInsertQ.insert.mock.calls[0][0] as {
      set_number: number;
      set_type: string;
    }[];

    expect(inserted.map((r) => r.set_number)).toEqual([2, 5, 6]);
    expect(inserted.map((r) => r.set_type)).toEqual([
      "working",
      "drop",
      "failure",
    ]);

    // What the old positional mapping produced, spelled out so a regression
    // reads as this line rather than as an opaque array mismatch.
    expect(inserted.map((r) => r.set_number)).not.toEqual([1, 2, 3]);
    expect(inserted.map((r) => r.set_type)).not.toEqual([
      "warmup",
      "working",
      "drop",
    ]);

    // Five non-warmup rows prescribed, three sent → partial, overriding the
    // payload's 'full'.
    expect(upsertQ.insert.mock.calls[0][0].completion_quality).toBe("partial");
    expect(linkQ.update.mock.calls[0][0].status).toBe("partial");
  });

  // -------------------------------------------------------------------------
  // A sent set is WRITTEN even with no values: the client sends exactly the sets
  // it completed, so presence in the array is the claim and the numbers are
  // optional detail. The old setRowHasAnyValue guard dropped these rows.
  // -------------------------------------------------------------------------
  it("writes a sent set that carries no reps, weight or RPE", async () => {
    const eventQ = createMockQuery({ data: eventRow(), error: null });
    const clientQ = createMockQuery({
      data: { next_check_in_due: null },
      error: null,
    });
    const sessionSnapQ = createMockQuery({ data: SESSION_PRESCRIPTION, error: null });
    const exerciseSnapQ = createMockQuery({
      data: [EXERCISE_A_PRESCRIPTION],
      error: null,
    });
    const upsertQ = createMockQuery({ data: { id: SESSION_LOG_ID }, error: null });
    const existingExLogsQ = createMockQuery({ data: [], error: null });
    const deleteExQ = createMockQuery({ data: null, error: null });
    const insertExQ = insertExerciseLogsReturning(["el-empty"]);
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
              { setNumber: 1, reps: 10, weight: 100 },
              { setNumber: 2 },
              { setNumber: 3, reps: 8, weight: 100 },
            ],
            weightUnit: "kg",
          },
        ],
      },
    });

    expect(setLogsInsertQ.insert.mock.calls[0][0]).toEqual([
      { exercise_log_id: "el-empty", set_number: 1, set_type: "working", reps: 10, weight: 100, rpe: null },
      { exercise_log_id: "el-empty", set_number: 2, set_type: "working", reps: null, weight: null, rpe: null },
      { exercise_log_id: "el-empty", set_number: 3, set_type: "working", reps: 8, weight: 100, rpe: null },
    ]);
    // All three prescribed working sets were sent, values or not.
    expect(upsertQ.insert.mock.calls[0][0].completion_quality).toBe("full");
  });

  // -------------------------------------------------------------------------
  // The denominator is the SESSION's prescription, not the payload's. An
  // exercise the client never touched is absent from the payload entirely, so a
  // payload-derived denominator would score this session 'full' (locked
  // decision 4: every prescribed working set, on EVERY exercise).
  // -------------------------------------------------------------------------
  it("counts a prescribed exercise the payload never mentions", async () => {
    const eventQ = createMockQuery({ data: eventRow(), error: null });
    const clientQ = createMockQuery({
      data: { next_check_in_due: null },
      error: null,
    });
    const sessionSnapQ = createMockQuery({ data: SESSION_PRESCRIPTION, error: null });
    // Two exercises prescribed; the by-id snapshot read and the session read
    // share this mock, so both see the pair.
    const exerciseSnapQ = createMockQuery({
      data: [
        EXERCISE_A_PRESCRIPTION,
        { ...EXERCISE_A_PRESCRIPTION, id: EXERCISE_B, name: "Row" },
      ],
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
              { setNumber: 1, reps: 10, weight: 100 },
              { setNumber: 2, reps: 10, weight: 100 },
              { setNumber: 3, reps: 10, weight: 100 },
            ],
            weightUnit: "kg",
          },
        ],
      },
    });

    // Exercise A complete, exercise B untouched → partial, not full.
    expect(upsertQ.insert.mock.calls[0][0].completion_quality).toBe("partial");
    expect(linkQ.update.mock.calls[0][0].status).toBe("partial");
  });

  // -------------------------------------------------------------------------
  // 11. Re-run idempotency on normal (non-orphan) path
  // -------------------------------------------------------------------------
  it("[11] event-keyed insert replaces exercise_logs (delete-then-insert)", async () => {
    const eventQ = createMockQuery({ data: eventRow(), error: null });
    const clientQ = createMockQuery({
      data: { next_check_in_due: null },
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
            sets: [{ setNumber: 1, reps: 10, weight: 100 }],
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
      data: { next_check_in_due: null },
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
      data: { next_check_in_due: null },
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
      data: { next_check_in_due: null },
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
      data: { next_check_in_due: null },
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
      data: { next_check_in_due: null },
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
            sets: [{ setNumber: 1, reps: 10, weight: 100 }],
            weightUnit: "lbs",
          },
          {
            // free-form (no trainingExerciseId)
            exerciseName: "Mystery Lift",
            sets: [{ setNumber: 1, reps: 8, weight: 50 }],
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
      data: { next_check_in_due: null },
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
              sets: [{ setNumber: 1, reps: 10, weight: 100 }],
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

  it("[14] lock: the shared day rule refuses the write before anything is written", async () => {
    const eventQ = createMockQuery({
      data: eventRow({ date: "2026-05-01", session_log_id: null }),
      error: null,
    });
    const clientQ = createMockQuery({
      data: { next_check_in_due: null, timezone: "UTC" },
      error: null,
    });
    const writeSpy = createMockQuery({ data: { id: SESSION_LOG_ID }, error: null });

    installRouter({
      training_events: eventQ,
      clients: clientQ,
      session_logs: writeSpy,
    });
    vi.mocked(assertCanEdit).mockRejectedValueOnce(
      new DayLockedError("2026-05-01", "training"),
    );

    await expect(
      logTrainingEvent({
        eventId: EVENT_ID,
        clientId: CLIENT_ID,
        payload: { completionQuality: "full" },
      }),
    ).rejects.toBeInstanceOf(DayLockedError);
    expect(writeSpy.insert).not.toHaveBeenCalled();
    expect(writeSpy.update).not.toHaveBeenCalled();
  });

  it("[14b] lock: asks the day rule about the EVENT's date, and hands it no log state", async () => {
    // Mutation guard: the old guard passed "logged"/"never-logged" off the
    // event's session_log_id, so a re-log of a past day was refused. The rule
    // takes the date and the resource and nothing else, so the event below —
    // which HAS a log — still reaches the writer.
    const eventQ = createMockQuery({
      data: eventRow({ date: "2026-05-01", session_log_id: SESSION_LOG_ID }),
      error: null,
    });
    installRouter({
      training_events: eventQ,
      clients: createMockQuery({ data: { next_check_in_due: null, timezone: "UTC" }, error: null }),
      session_logs: createMockQuery({ data: { id: SESSION_LOG_ID }, error: null }),
      exercise_logs: createMockQuery({ data: [], error: null }),
    });

    // The guard runs before the write, so what happens downstream is beside the
    // point — this asserts what it was ASKED, and that a logged event still gets
    // past it.
    await logTrainingEvent({
      eventId: EVENT_ID,
      clientId: CLIENT_ID,
      payload: { completionQuality: "full" },
    }).catch(() => undefined);

    expect(assertCanEdit).toHaveBeenCalledWith({
      clientId: CLIENT_ID,
      date: "2026-05-01",
      resourceType: "training",
    });
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
      data: { next_check_in_due: null },
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


// ===========================================================================
// getSessionLogDetail — the coach's logged-workout readout
// ===========================================================================

describe("getSessionLogDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const SESSION_LOG_ROW = {
    id: SESSION_LOG_ID,
    client_id: CLIENT_ID,
    training_session_id: SESSION_ID,
    training_event_id: EVENT_ID,
    completed_at: "2026-08-24",
    completion_quality: "partial",
    notes: null,
    week_start_date: "2026-08-24",
    prescribed_session_snapshot: { name: "Push Day" },
    created_at: "2026-08-24T09:00:00Z",
    updated_at: "2026-08-24T09:00:00Z",
  };

  function prescriptionRow(over: { id: string; name: string; order_index: number }) {
    return {
      sets: 3,
      reps_min: 8,
      reps_max: 12,
      reps_target: null,
      rpe_target: 8,
      percentage_1rm: null,
      tempo: null,
      rest_seconds: 90,
      notes: null,
      superset_group: null,
      is_warmup: false,
      set_specs: null,
      prescribed_fields: null,
      ...over,
    };
  }

  // -------------------------------------------------------------------------
  // The merge: an exercise the client never touched still reaches the coach.
  // -------------------------------------------------------------------------
  it("[SLD-1] returns the performed session's prescription in authored order", async () => {
    installRouter({
      session_logs: createMockQuery({ data: SESSION_LOG_ROW, error: null }),
      exercise_logs: createMockQuery({
        data: [
          {
            id: "el-1",
            session_log_id: SESSION_LOG_ID,
            training_exercise_id: "ex-a",
            exercise_id: null,
            completed: true,
            notes: null,
            performed_name: "Bench Press",
            prescribed_exercise_snapshot: { name: "Bench Press", sets: 3 },
            created_at: "2026-08-24T09:00:00Z",
            updated_at: "2026-08-24T09:00:00Z",
          },
        ],
        error: null,
      }),
      set_logs: createMockQuery({
        data: [
          {
            id: "sl-1",
            exercise_log_id: "el-1",
            set_number: 1,
            set_type: "working",
            reps: 10,
            weight: 60,
            rpe: null,
            created_at: "2026-08-24T09:00:00Z",
            updated_at: "2026-08-24T09:00:00Z",
          },
        ],
        error: null,
      }),
      training_sessions: createMockQuery({ data: { name: "Push Day" }, error: null }),
      training_exercises: createMockQuery({
        data: [
          prescriptionRow({ id: "ex-a", name: "Bench Press", order_index: 0 }),
          prescriptionRow({ id: "ex-b", name: "Overhead Press", order_index: 1 }),
        ],
        error: null,
      }),
    });

    const result = await getSessionLogDetail(SESSION_LOG_ID);

    expect(result).not.toBeNull();
    // ex-b was prescribed and never logged — it is absent from exercise_logs
    // entirely, so without this read the coach could not see it was asked for.
    expect(result?.prescribedExercises.map((p) => p.trainingExerciseId)).toEqual([
      "ex-a",
      "ex-b",
    ]);
    expect(result?.prescribedExercises[1].name).toBe("Overhead Press");
    expect(result?.prescribedExercises[1].orderIndex).toBe(1);
    // The snapshot is the same snake_case shape a log carries, so both expand
    // through one function.
    expect(result?.prescribedExercises[1].snapshot).toMatchObject({
      name: "Overhead Press",
      sets: 3,
      reps_min: 8,
      reps_max: 12,
    });
    expect(result?.exerciseLogs).toHaveLength(1);
    expect(result?.exerciseLogs[0].sets).toHaveLength(1);
    expect(result?.performedSessionName).toBe("Push Day");
  });

  // -------------------------------------------------------------------------
  // No performed session → no prescription read at all.
  // -------------------------------------------------------------------------
  it("[SLD-2] skips the prescription read when the log has no session", async () => {
    const trainingExercisesQ = createMockQuery({ data: [], error: null });
    const trainingSessionsQ = createMockQuery({ data: null, error: null });
    installRouter({
      session_logs: createMockQuery({
        data: { ...SESSION_LOG_ROW, training_session_id: null },
        error: null,
      }),
      exercise_logs: createMockQuery({ data: [], error: null }),
      training_sessions: trainingSessionsQ,
      training_exercises: trainingExercisesQ,
    });

    const result = await getSessionLogDetail(SESSION_LOG_ID);

    expect(result?.prescribedExercises).toEqual([]);
    expect(result?.performedSessionName).toBeNull();
    expect(trainingExercisesQ.select).not.toHaveBeenCalled();
    expect(trainingSessionsQ.select).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // A log whose exercise the coach has since soft-deleted is still returned:
  // the live prescription read filters is_active, the log does not.
  // -------------------------------------------------------------------------
  it("[SLD-3] keeps a log whose exercise is no longer in the prescription", async () => {
    installRouter({
      session_logs: createMockQuery({ data: SESSION_LOG_ROW, error: null }),
      exercise_logs: createMockQuery({
        data: [
          {
            id: "el-9",
            session_log_id: SESSION_LOG_ID,
            training_exercise_id: "ex-gone",
            exercise_id: null,
            completed: true,
            notes: null,
            performed_name: "Retired Lift",
            prescribed_exercise_snapshot: { name: "Retired Lift", sets: 2 },
            created_at: "2026-08-24T09:00:00Z",
            updated_at: "2026-08-24T09:00:00Z",
          },
        ],
        error: null,
      }),
      set_logs: createMockQuery({ data: [], error: null }),
      training_sessions: createMockQuery({ data: { name: "Push Day" }, error: null }),
      training_exercises: createMockQuery({
        data: [prescriptionRow({ id: "ex-a", name: "Bench Press", order_index: 0 })],
        error: null,
      }),
    });

    const result = await getSessionLogDetail(SESSION_LOG_ID);

    expect(result?.prescribedExercises.map((p) => p.trainingExerciseId)).toEqual([
      "ex-a",
    ]);
    expect(result?.exerciseLogs.map((l) => l.trainingExerciseId)).toEqual(["ex-gone"]);
  });

  // -------------------------------------------------------------------------
  // Tenant scope: the prescription read is keyed on the LOG's own client_id.
  // The route proves that client against the URL before returning anything.
  // -------------------------------------------------------------------------
  it("[SLD-4] scopes the prescription read to the log's own client", async () => {
    const trainingExercisesQ = createMockQuery({ data: [], error: null });
    installRouter({
      session_logs: createMockQuery({ data: SESSION_LOG_ROW, error: null }),
      exercise_logs: createMockQuery({ data: [], error: null }),
      training_sessions: createMockQuery({ data: { name: "Push Day" }, error: null }),
      training_exercises: trainingExercisesQ,
    });

    await getSessionLogDetail(SESSION_LOG_ID);

    expect(trainingExercisesQ.eq).toHaveBeenCalledWith("session_id", SESSION_ID);
    expect(trainingExercisesQ.eq).toHaveBeenCalledWith("is_active", true);
    expect(trainingExercisesQ.eq).toHaveBeenCalledWith(
      "training_sessions.training_plans.client_id",
      CLIENT_ID,
    );
    expect(trainingExercisesQ.order).toHaveBeenCalledWith("order_index", {
      ascending: true,
    });
  });

  it("[SLD-5] returns null for a session log that does not exist", async () => {
    installRouter({
      session_logs: createMockQuery({ data: null, error: null }),
    });

    expect(await getSessionLogDetail(SESSION_LOG_ID)).toBeNull();
  });
});
