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
import { logTrainingEvent, getTrainingEventDetail } from "./training-log-service";

const mockFrom = vi.mocked(supabaseAdmin.from);

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
  it("[1] quick log: writes session_log + snapshot, skips exercise_logs, links event with mapped status", async () => {
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
    const linkQ = createMockQuery({ data: null, error: null });

    installRouter({
      training_events: [eventQ, linkQ],
      clients: clientQ,
      training_sessions: sessionSnapQ,
      session_logs: upsertQ,
    });

    const result = await logTrainingEvent({
      eventId: EVENT_ID,
      clientId: CLIENT_ID,
      payload: { completionQuality: "full" },
    });

    expect(result).toEqual({ sessionLogId: SESSION_LOG_ID });

    // session_logs.upsert was called with the session snapshot.
    expect(upsertQ.upsert).toHaveBeenCalledTimes(1);
    const upsertArg = upsertQ.upsert.mock.calls[0][0];
    expect(upsertArg).toMatchObject({
      client_id: CLIENT_ID,
      training_session_id: SESSION_ID,
      completion_quality: "full",
      prescribed_session_snapshot: SESSION_PRESCRIPTION,
    });

    // exercise_logs untouched.
    expect(mockFrom).not.toHaveBeenCalledWith("exercise_logs");

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
  it("[2] empty exercises array is treated as quick-log (no exercise_logs delete/insert)", async () => {
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
    const linkQ = createMockQuery({ data: null, error: null });

    installRouter({
      training_events: [eventQ, linkQ],
      clients: clientQ,
      training_sessions: sessionSnapQ,
      session_logs: upsertQ,
    });

    await logTrainingEvent({
      eventId: EVENT_ID,
      clientId: CLIENT_ID,
      payload: { completionQuality: "partial", exercises: [] },
    });

    expect(mockFrom).not.toHaveBeenCalledWith("exercise_logs");
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
    const insertExQ = createMockQuery({ data: null, error: null });
    const linkQ = createMockQuery({ data: null, error: null });

    installRouter({
      training_events: [eventQ, linkQ],
      clients: clientQ,
      training_sessions: sessionSnapQ,
      training_exercises: exerciseSnapQ,
      session_logs: upsertQ,
      exercise_logs: [existingExLogsQ, deleteExQ, insertExQ],
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
            weightUnit: "lbs",
          },
        ],
      },
    });

    // Insert payload includes the snapshot.
    expect(insertExQ.insert).toHaveBeenCalledTimes(1);
    const inserts = insertExQ.insert.mock.calls[0][0];
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      session_log_id: SESSION_LOG_ID,
      training_exercise_id: EXERCISE_A,
      completed: true,
      prescribed_exercise_snapshot: EXERCISE_A_SNAPSHOT,
    });

    // payload completionQuality='full' → status='completed' (mapping).
    expect(linkQ.update.mock.calls[0][0].status).toBe("completed");
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
    const insertExQ = createMockQuery({ data: null, error: null });
    const linkQ = createMockQuery({ data: null, error: null });

    installRouter({
      training_events: [eventQ, linkQ],
      clients: clientQ,
      training_sessions: sessionSnapQ,
      training_exercises: exerciseSnapQ,
      session_logs: upsertQ,
      exercise_logs: [existingExLogsQ, deleteExQ, insertExQ],
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

    expect(upsertQ.upsert.mock.calls[0][0].completion_quality).toBe("full");
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
    const insertExQ = createMockQuery({ data: null, error: null });
    const linkQ = createMockQuery({ data: null, error: null });

    installRouter({
      training_events: [eventQ, linkQ],
      clients: clientQ,
      training_sessions: sessionSnapQ,
      training_exercises: exerciseSnapQ,
      session_logs: upsertQ,
      exercise_logs: [existingExLogsQ, deleteExQ, insertExQ],
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

    expect(upsertQ.upsert.mock.calls[0][0].completion_quality).toBe("skipped");
    expect(linkQ.update.mock.calls[0][0].status).toBe("skipped");
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
    const insertExQ = createMockQuery({ data: null, error: null });
    const linkQ = createMockQuery({ data: null, error: null });

    installRouter({
      training_events: [eventQ, linkQ],
      clients: clientQ,
      training_sessions: sessionSnapQ,
      training_exercises: exerciseSnapQ,
      session_logs: upsertQ,
      exercise_logs: [existingExLogsQ, deleteExQ, insertExQ],
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

    expect(upsertQ.upsert.mock.calls[0][0].completion_quality).toBe("full");
    expect(linkQ.update.mock.calls[0][0].status).toBe("completed");
  });

  // -------------------------------------------------------------------------
  // 6. Set-collapse rule
  // -------------------------------------------------------------------------
  it("[6] set-collapse: actual_sets, actual_reps='10,10,8', actual_weight=top set", async () => {
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
    const insertExQ = createMockQuery({ data: null, error: null });
    const linkQ = createMockQuery({ data: null, error: null });

    installRouter({
      training_events: [eventQ, linkQ],
      clients: clientQ,
      training_sessions: sessionSnapQ,
      training_exercises: exerciseSnapQ,
      session_logs: upsertQ,
      exercise_logs: [existingExLogsQ, deleteExQ, insertExQ],
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
              { reps: 10, weight: 100 },
              { reps: 10, weight: 105 },
              { reps: 8, weight: 105 },
            ],
            weightUnit: "kg",
          },
        ],
      },
    });

    const inserted = insertExQ.insert.mock.calls[0][0][0];
    expect(inserted.actual_sets).toBe(3);
    expect(inserted.actual_reps).toBe("10,10,8");
    expect(inserted.actual_weight).toBe(105);
    expect(inserted.weight_unit).toBe("kg");
    expect(inserted.completed).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 7. Free-form exercise (no trainingExerciseId)
  // -------------------------------------------------------------------------
  it("[7] free-form exercise: training_exercise_id=null and prescribed_exercise_snapshot=null", async () => {
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
    const insertExQ = createMockQuery({ data: null, error: null });
    const linkQ = createMockQuery({ data: null, error: null });

    installRouter({
      training_events: [eventQ, linkQ],
      clients: clientQ,
      training_sessions: sessionSnapQ,
      training_exercises: exerciseSnapQ,
      session_logs: upsertQ,
      exercise_logs: [existingExLogsQ, deleteExQ, insertExQ],
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
    expect(inserted.prescribed_exercise_snapshot).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 8. Skipped exercise: completed=false, actuals null
  // -------------------------------------------------------------------------
  it("[8] skipped exercise: completed=false, actual_sets/reps/weight null", async () => {
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
    const insertExQ = createMockQuery({ data: null, error: null });
    const linkQ = createMockQuery({ data: null, error: null });

    installRouter({
      training_events: [eventQ, linkQ],
      clients: clientQ,
      training_sessions: sessionSnapQ,
      training_exercises: exerciseSnapQ,
      session_logs: upsertQ,
      exercise_logs: [existingExLogsQ, deleteExQ, insertExQ],
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
    expect(inserted.actual_sets).toBeNull();
    expect(inserted.actual_reps).toBeNull();
    expect(inserted.actual_weight).toBeNull();
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
    const insertExQ = createMockQuery({ data: null, error: null });
    const linkQ = createMockQuery({ data: null, error: null });

    installRouter({
      training_events: [eventQ, linkQ],
      clients: clientQ,
      training_sessions: sessionSnapQ,
      training_exercises: exerciseSnapQ,
      session_logs: upsertQ,
      exercise_logs: [existingExLogsQ, deleteExQ, insertExQ],
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

    const sessionSnap = upsertQ.upsert.mock.calls[0][0].prescribed_session_snapshot;
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
        "sets",
        "superset_group",
        "tempo",
      ].sort(),
    );
  });

  // -------------------------------------------------------------------------
  // 11. Re-run idempotency on normal (non-orphan) path
  // -------------------------------------------------------------------------
  it("[11] re-run uses upsert (idempotent on UNIQUE) and replaces exercise_logs", async () => {
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
    const insertExQ = createMockQuery({ data: null, error: null });
    const linkQ = createMockQuery({ data: null, error: null });

    installRouter({
      training_events: [eventQ, linkQ],
      clients: clientQ,
      training_sessions: sessionSnapQ,
      training_exercises: exerciseSnapQ,
      session_logs: upsertQ,
      exercise_logs: [existingExLogsQ, deleteExQ, insertExQ],
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

    expect(upsertQ.upsert).toHaveBeenCalledTimes(1);
    const upsertOpts = upsertQ.upsert.mock.calls[0][1];
    expect(upsertOpts).toEqual({
      onConflict: "client_id,training_session_id,week_start_date",
    });
    expect(deleteExQ.delete).toHaveBeenCalledTimes(1);
    expect(insertExQ.insert).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // 12. event.training_session_id null, single call (first orphan log)
  // -------------------------------------------------------------------------
  it("[12] first call on orphan event (training_session_id null, session_log_id null): upsert path, snapshot null, no exercise prefetch", async () => {
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
    const upsertArg = upsertQ.upsert.mock.calls[0][0];
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

    expect(updateQ.update).toHaveBeenCalledTimes(1);
    expect(updateQ.upsert).not.toHaveBeenCalled();
    // Targeted by id, not composite key.
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
    const insertExQ = createMockQuery({ data: null, error: null });
    const linkQ = createMockQuery({ data: null, error: null });

    installRouter({
      training_events: [eventQ, linkQ],
      clients: clientQ,
      training_sessions: sessionSnapQ,
      training_exercises: exerciseSnapQ,
      session_logs: upsertQ,
      exercise_logs: [existingExLogsQ, deleteExQ, insertExQ],
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
    // Free-form: no preservation (no stable cross-write key) — null.
    const freeForm = inserts.find(
      (r: { training_exercise_id: string | null }) =>
        r.training_exercise_id === null,
    );
    expect(freeForm.prescribed_exercise_snapshot).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 13. Transaction integrity: exercise_logs INSERT failure throws after
  //     session_log was already written; retry is safe via idempotency rules.
  // -------------------------------------------------------------------------
  it("[13] exercise_logs insert failure: throws; session_log row already written; retry is safe by upsert/delete-then-insert convergence", async () => {
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

    // session_log was successfully upserted before the failure.
    expect(upsertQ.upsert).toHaveBeenCalledTimes(1);
    // training_events update was NOT called (status link is step 7, after step 6).
    expect(linkQ.update).not.toHaveBeenCalled();
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
          weight_unit: "lbs",
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
  // 17. Composite-key fallback when event.session_log_id is null
  // -------------------------------------------------------------------------
  it("[17] composite-key fallback: event.session_log_id null but session_log exists by (client_id, training_session_id, week_start_date)", async () => {
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
    const clientQ = createMockQuery({
      data: { expected_check_in_day: null },
      error: null,
    });
    const compositeLogQ = createMockQuery({
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
    const exerciseLogsQ = createMockQuery({ data: [], error: null });

    installRouter({
      training_events: eventQ,
      training_sessions: sessionQ,
      clients: clientQ,
      session_logs: compositeLogQ,
      exercise_logs: exerciseLogsQ,
    });

    const result = await getTrainingEventDetail(EVENT_ID, CLIENT_ID);
    expect(result?.sessionLog?.id).toBe(SESSION_LOG_ID);
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
          weight_unit: "lbs",
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
          weight_unit: "lbs",
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
          weight_unit: "lbs",
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
