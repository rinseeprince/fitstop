import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

// Collaborators are mocked so this file tests THIS service's resolution, not
// theirs. All three also read training_plans, which would otherwise collide with
// the plan query's mock.
vi.mock("./today-service", () => ({
  getClientTodayString: vi.fn(),
}));
vi.mock("./training-service", () => ({
  getNextFutureTrainingPlan: vi.fn(),
}));

import { supabaseAdmin } from "./supabase-admin";
import { getClientTrainingPlan } from "./client-training-plan-service";
import { getClientTodayString } from "./today-service";
import { getNextFutureTrainingPlan } from "./training-service";
import { STRAIGHT_SETS, sessionExercises } from "@/utils/exercise-groups";

const mockFrom = vi.mocked(supabaseAdmin.from);

const CLIENT_ID = "client-1";
const TODAY = "2026-07-27";

type MockResult<T> = { data: T | null; error: { message: string } | null };

function awaitableQuery<T>(result: MockResult<T>) {
  const q: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    // Paged reads (lib/paged-fetch) call .range(); the fetcher stops when a page
    // comes back short, and this mock resolves the same result for any range, so
    // one short page ends the loop.
    range: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  Object.defineProperty(q, "then", {
    value: (resolve: (value: MockResult<T>) => void) =>
      Promise.resolve(result).then(resolve),
  });
  return q;
}

type Row = Record<string, unknown>;

/** A column's value on a fixture row, following an embed's dotted path. */
function valueAt(row: Row, column: string): unknown {
  return column
    .split(".")
    .reduce<unknown>(
      (value, key) =>
        value !== null && typeof value === "object" ? (value as Row)[key] : undefined,
      row
    );
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  return (a as string | number) < (b as string | number) ? -1 : 1;
}

/**
 * A chainable read over fixture rows, one per `from()` call. It applies the
 * filters, order and range the service built when awaited, so a test states
 * the tables and reads back what the service made of them.
 */
function tableQuery(table: string, rows: Row[], log: string[], errorMessage?: string) {
  log.push(`issue ${table}`);
  const q = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
  };
  const selected = (): Row[] => {
    const matching = rows.filter(
      (row) =>
        q.eq.mock.calls.every(([column, value]) => valueAt(row, column) === value) &&
        q.in.mock.calls.every(([column, values]) => values.includes(valueAt(row, column))) &&
        q.gte.mock.calls.every(([column, value]) => compare(valueAt(row, column), value) >= 0) &&
        q.lte.mock.calls.every(([column, value]) => compare(valueAt(row, column), value) <= 0)
    );
    const sorted = [...matching].sort((a, b) => {
      for (const [column, options] of q.order.mock.calls) {
        const order = compare(valueAt(a, column), valueAt(b, column));
        if (order !== 0) return options?.ascending === false ? -order : order;
      }
      return 0;
    });
    const [from, to] = q.range.mock.lastCall ?? [0, sorted.length];
    return sorted.slice(from, to + 1);
  };
  Object.defineProperty(q, "then", {
    value: (resolve: (value: MockResult<Row[]>) => void) => {
      log.push(`read ${table}`);
      return Promise.resolve(
        errorMessage
          ? { data: null, error: { message: errorMessage } }
          : { data: selected(), error: null }
      ).then(resolve);
    },
  });
  return q;
}

type TableQuery = ReturnType<typeof tableQuery>;

describe("client-training-plan-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getClientTodayString).mockResolvedValue(TODAY);
    vi.mocked(getNextFutureTrainingPlan).mockResolvedValue(null);
  });

  /**
   * The plan query, then the tables the program is read from: every `from()`
   * on them gets its own query over the fixture rows.
   */
  function mockTables(opts: {
    plan: unknown;
    events?: Row[];
    sessions?: Row[];
    exercises?: Row[];
    errors?: Partial<Record<string, string>>;
  }) {
    const planQuery = awaitableQuery({ data: opts.plan, error: null });
    const tables: Record<string, Row[]> = {
      training_events: opts.events ?? [],
      training_sessions: opts.sessions ?? [],
      training_exercises: opts.exercises ?? [],
    };
    const reads: Record<string, TableQuery[]> = {
      training_events: [],
      training_sessions: [],
      training_exercises: [],
    };
    const log: string[] = [];
    mockFrom.mockImplementation((table: string) => {
      if (table === "training_plans") return planQuery as never;
      const rows = tables[table];
      if (!rows) throw new Error(`Unexpected from(): ${table}`);
      const query = tableQuery(table, rows, log, opts.errors?.[table]);
      reads[table].push(query);
      return query as never;
    });
    return { planQuery, reads, log };
  }

  it("returns null when no active training plan exists for the client", async () => {
    const planQuery = awaitableQuery({ data: null, error: null });
    mockFrom.mockReturnValue(
      planQuery as unknown as ReturnType<typeof supabaseAdmin.from>
    );

    const result = await getClientTrainingPlan(CLIENT_ID);

    expect(result).toBeNull();
    expect(mockFrom).toHaveBeenCalledWith("training_plans");
  });

  // These pin the RESOLUTION PREDICATE, which nothing covered before: the reader
  // used to take the newest-CREATED active row with no end date, which answered a
  // different question from the coach side and let a queued program title the
  // client's Program tab.
  describe("resolution predicate", () => {
    it("filters by date window and status='active', ordered newest-start first", async () => {
      const { planQuery } = mockTables({ plan: null });

      await getClientTrainingPlan(CLIENT_ID);

      expect(planQuery.eq).toHaveBeenCalledWith("client_id", CLIENT_ID);
      expect(planQuery.eq).toHaveBeenCalledWith("status", "active");
      expect(planQuery.is).toHaveBeenCalledWith("deleted_at", null);
      expect(planQuery.lte).toHaveBeenCalledWith("effective_from", TODAY);
      expect(planQuery.gte).toHaveBeenCalledWith("effective_until", TODAY);
      expect(planQuery.order).toHaveBeenCalledWith("effective_from", { ascending: false });
      expect(planQuery.order).toHaveBeenCalledWith("created_at", { ascending: false });
    });

    it("reads both ends off the row — no open-window arm (migration 167)", async () => {
      const { planQuery } = mockTables({ plan: null });

      await getClientTrainingPlan(CLIENT_ID);

      expect(planQuery.gte).toHaveBeenCalledWith("effective_until", TODAY);
      expect(planQuery.is).not.toHaveBeenCalledWith("effective_until", null);
    });

    it("resolves against the CLIENT's today, not the server's", async () => {
      vi.mocked(getClientTodayString).mockResolvedValue("2026-03-04");
      const { planQuery } = mockTables({ plan: null });

      await getClientTrainingPlan(CLIENT_ID);

      expect(getClientTodayString).toHaveBeenCalledWith(CLIENT_ID);
      expect(planQuery.lte).toHaveBeenCalledWith("effective_from", "2026-03-04");
    });
  });

  describe("lifecycle state", () => {
    const started = {
      id: "plan-1",
      name: "Running",
      effective_from: "2026-07-01",
      effective_until: "2026-08-11",
    };

    it("labels a program whose window covers today as active", async () => {
            mockTables({ plan: { ...started, effective_until: "2026-08-11" } });

      const result = await getClientTrainingPlan(CLIENT_ID);

      expect(result).toMatchObject({
        planId: "plan-1",
        state: "active",
        startsOn: "2026-07-01",
        endsOn: "2026-08-11",
      });
      expect(getNextFutureTrainingPlan).not.toHaveBeenCalled();
    });

    it("labels a program whose last day has passed as ended", async () => {
            mockTables({ plan: { ...started, effective_until: "2026-07-26" } });

      const result = await getClientTrainingPlan(CLIENT_ID);

      expect(result).toMatchObject({ planId: "plan-1", state: "ended", endsOn: "2026-07-26" });
    });

    it("stays active on the program's final day (boundary is inclusive)", async () => {
            mockTables({ plan: { ...started, effective_until: TODAY } });

      const result = await getClientTrainingPlan(CLIENT_ID);

      expect(result!.state).toBe("active");
    });

    it("returns a not-yet-started program as upcoming rather than current", async () => {
      vi.mocked(getNextFutureTrainingPlan).mockResolvedValue({
        id: "plan-2",
        name: "Next block",
        effectiveFrom: "2026-08-17",
        effectiveUntil: "2026-09-13",
        splitType: "ppl",
        frequencyPerWeek: 4,
        programDurationWeeks: 4,
      });
      mockTables({ plan: null });

      const result = await getClientTrainingPlan(CLIENT_ID);

      expect(result).toMatchObject({
        planId: "plan-2",
        state: "upcoming",
        startsOn: "2026-08-17",
        endsOn: "2026-09-13",
      });
    });

    it("prefers a queued program over an ended one — live information beats history", async () => {
      vi.mocked(getNextFutureTrainingPlan).mockResolvedValue({
        id: "plan-2",
        name: "Next block",
        effectiveFrom: "2026-08-17",
        effectiveUntil: "2026-09-13",
        splitType: "ppl",
        frequencyPerWeek: 4,
        programDurationWeeks: 4,
      });
      mockTables({ plan: { ...started, effective_until: "2026-07-20" } });

      const result = await getClientTrainingPlan(CLIENT_ID);

      expect(result).toMatchObject({ planId: "plan-2", state: "upcoming" });
    });

    it("reads the end from the row, never from the slot count", async () => {
      mockTables({
        plan: started,
        sessions: [
          { id: "s0", name: "Push", focus: null, order_index: 0, week_index: 0, is_rest: false, estimated_duration_minutes: null },
          { id: "s1", name: "Rest", focus: null, order_index: 1, week_index: 0, is_rest: true, estimated_duration_minutes: null },
        ],
      });

      const result = await getClientTrainingPlan(CLIENT_ID);

      // Two slot rows would have read as a two-day program under the old
      // derivation; the row says six weeks (migration 167), and the row wins.
      expect(result!.endsOn).toBe("2026-08-11");
    });
  });

  describe("the program as it is on the client's calendar", () => {
    const PLAN_ID = "plan-1";
    // Two weeks: Mon 20 Jul is day 0, Sun 2 Aug is day 13. TODAY is day 7.
    const PLAN = {
      id: PLAN_ID,
      name: "Block A",
      effective_from: "2026-07-20",
      effective_until: "2026-08-02",
    };

    function event(id: string, date: string, sessionId: string | null, extra: Row = {}): Row {
      return {
        id,
        client_id: CLIENT_ID,
        training_plan_id: PLAN_ID,
        training_session_id: sessionId,
        date,
        day_order: 0,
        status: "scheduled",
        session_name: `Event ${id}`,
        session_focus: null,
        ...extra,
      };
    }

    function session(id: string, weekIndex: number, orderIndex: number, extra: Row = {}): Row {
      return {
        id,
        plan_id: PLAN_ID,
        name: `Session ${id}`,
        focus: null,
        week_index: weekIndex,
        order_index: orderIndex,
        is_rest: false,
        is_active: true,
        estimated_duration_minutes: null,
        created_at: "2026-07-01T00:00:00Z",
        // The `training_plans!inner(client_id)` embed the service scopes on.
        training_plans: { client_id: CLIENT_ID },
        ...extra,
      };
    }

    /** A group as the read's exercise_group embed selects it: straight sets unless `settings` says otherwise. */
    function group(id: string, orderIndex: number, settings: Row = {}): Row {
      return {
        id,
        order_index: orderIndex,
        format: "straight_sets",
        rounds: null,
        time_cap_seconds: null,
        interval_seconds: null,
        rest_between_exercises_seconds: null,
        rest_between_rounds_seconds: null,
        notes: null,
        ...settings,
      };
    }

    /** An exercise at `orderIndex` in `inGroup`, read with that group embedded. */
    function groupedExercise(
      id: string,
      sessionId: string,
      inGroup: Row,
      orderIndex: number,
      extra: Row = {}
    ): Row {
      return {
        id,
        session_id: sessionId,
        name: `Exercise ${id}`,
        order_index: orderIndex,
        sets: 3,
        reps_min: 8,
        reps_max: 10,
        reps_target: null,
        rpe_target: null,
        tempo: null,
        rest_seconds: null,
        is_warmup: null,
        set_specs: null,
        video_url: null,
        prescribed_fields: null,
        is_active: true,
        exercise_group: inGroup,
        ...extra,
      };
    }

    /** A lone exercise: alone in its own straight-sets group, that group at `position` in the session. */
    function exercise(id: string, sessionId: string, position: number, extra: Row = {}): Row {
      return groupedExercise(id, sessionId, group(`grp-${id}`, position), 0, extra);
    }

    async function readSessions() {
      const result = await getClientTrainingPlan(CLIENT_ID);
      return result!.sessions;
    }

    it("lists one entry per day of the window: orderIndex is the day, weekIndex the week holding it", async () => {
      // Ten days, so the second week is cut short.
      mockTables({ plan: { ...PLAN, effective_until: "2026-07-29" } });

      const sessions = await readSessions();

      expect(sessions.map((s) => s.orderIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      expect(sessions.map((s) => s.weekIndex)).toEqual([0, 0, 0, 0, 0, 0, 0, 1, 1, 1]);
    });

    it("shows a moved session on its new day only", async () => {
      mockTables({
        plan: PLAN,
        sessions: [
          session("s-push", 0, 0, { name: "Push" }),
          session("s-pull", 0, 2, { name: "Pull" }),
        ],
        events: [
          event("e-push", "2026-07-20", "s-push"),
          // Pull's row sits on day 2; its day was moved to day 3.
          event("e-pull", "2026-07-23", "s-pull"),
        ],
      });

      const sessions = await readSessions();

      expect(sessions.filter((s) => s.name === "Pull").map((s) => s.orderIndex)).toEqual([3]);
      expect(sessions[2]).toMatchObject({ name: "Rest", isRest: true, groups: [] });
      expect(sessions[3]).toMatchObject({ id: "s-pull", name: "Pull", isRest: false });
    });

    it("shows a day once, as the row its event points at, beside another row at the same coordinates", async () => {
      mockTables({
        plan: PLAN,
        sessions: [
          session("s-legs", 0, 4, { name: "Legs" }),
          // A second active row at the same coordinates.
          session("s-legs-copy", 0, 4, {
            name: "Legs (lighter)",
            created_at: "2026-07-23T09:00:00Z",
          }),
        ],
        events: [event("e-legs", "2026-07-24", "s-legs-copy")],
        exercises: [
          exercise("x-squat", "s-legs", 0, { name: "Back squat" }),
          exercise("x-goblet", "s-legs-copy", 0, { name: "Goblet squat" }),
          exercise("x-dropped", "s-legs-copy", 1, { name: "Lunge", is_active: false }),
        ],
      });

      const sessions = await readSessions();

      expect(sessions).toHaveLength(14);
      expect(sessions.filter((s) => !s.isRest)).toHaveLength(1);
      expect(sessions[4]).toMatchObject({ id: "s-legs-copy", name: "Legs (lighter)", orderIndex: 4 });
      expect(sessionExercises(sessions[4]).map((e) => e.name)).toEqual(["Goblet squat"]);
    });

    it("shows a day whose event was deleted as a rest day", async () => {
      mockTables({
        plan: PLAN,
        sessions: [
          session("s-push", 0, 0, { name: "Push", focus: "Chest", estimated_duration_minutes: 60 }),
        ],
        exercises: [exercise("x-bench", "s-push", 0)],
      });

      const sessions = await readSessions();

      // The day's training row is no rest row: the day is named by the plan
      // and its position.
      expect(sessions[0]).toEqual({
        id: "plan-1:0",
        name: "Rest",
        focus: null,
        orderIndex: 0,
        weekIndex: 0,
        isRest: true,
        estimatedDurationMinutes: null,
        groups: [],
      });
    });

    it("identifies a rest day by the plan's rest row at that day, else by the plan and the position", async () => {
      const rest = { name: "Rest", is_rest: true };
      mockTables({
        plan: PLAN,
        sessions: [
          session("r-rest", 0, 1, rest),
          // A training row whose session moved away names no rest day.
          session("r-moved", 0, 2),
          // Two rows at day 5: the earliest written wins, whatever the ids say.
          session("r-b1", 0, 5, { ...rest, created_at: "2026-07-02T00:00:00Z" }),
          session("r-b2", 0, 5, { ...rest, created_at: "2026-07-01T00:00:00Z" }),
          // Written together at day 6: the lower id wins.
          session("r-c2", 0, 6, rest),
          session("r-c1", 0, 6, rest),
          // Placement's second cycle of a one-week program: week 1, authored day 1.
          session("r-cycle", 1, 1, rest),
          // The plan editor's save: week 1, order 9.
          session("r-editor", 1, 9, rest),
          // An inactive row holds no day.
          session("r-gone", 1, 3, { ...rest, is_active: false }),
        ],
      });

      const sessions = await readSessions();

      expect(sessions.map((s) => s.id)).toEqual([
        "plan-1:0",
        "r-rest",
        "plan-1:2",
        "plan-1:3",
        "plan-1:4",
        "r-b2",
        "r-c1",
        "plan-1:7",
        "r-cycle",
        "r-editor",
        "plan-1:10",
        "plan-1:11",
        "plan-1:12",
        "plan-1:13",
      ]);
      expect(sessions.every((s) => s.isRest)).toBe(true);
    });

    it("lays a day whose row cannot be read from its event's snapshot", async () => {
      mockTables({
        plan: PLAN,
        events: [
          event("e-gone", "2026-07-21", "s-missing", { session_name: "Upper", session_focus: "Chest" }),
          event("e-bare", "2026-07-22", null, { session_name: "Conditioning" }),
        ],
      });

      const sessions = await readSessions();

      expect(sessions[1]).toEqual({
        id: "e-gone",
        name: "Upper",
        focus: "Chest",
        orderIndex: 1,
        weekIndex: 0,
        isRest: false,
        estimatedDurationMinutes: null,
        groups: [],
      });
      expect(sessions[2]).toEqual({
        id: "e-bare",
        name: "Conditioning",
        focus: null,
        orderIndex: 2,
        weekIndex: 0,
        isRest: false,
        estimatedDurationMinutes: null,
        groups: [],
      });
    });

    it("never lays another client's row or event", async () => {
      mockTables({
        plan: PLAN,
        sessions: [
          session("s-theirs", 0, 0, { name: "Theirs", training_plans: { client_id: "client-2" } }),
        ],
        events: [
          event("e-mine", "2026-07-20", "s-theirs", { session_name: "Mine" }),
          event("e-theirs", "2026-07-21", "s-theirs", { client_id: "client-2" }),
        ],
        exercises: [exercise("x-theirs", "s-theirs", 0)],
      });

      const sessions = await readSessions();

      expect(sessions[0]).toMatchObject({ id: "e-mine", name: "Mine", groups: [] });
      expect(sessions[1]).toMatchObject({ isRest: true });
    });

    it("shows the row a day points at even when that row is inactive", async () => {
      mockTables({
        plan: PLAN,
        sessions: [session("s-retired", 0, 0, { name: "Push", is_active: false })],
        events: [event("e-push", "2026-07-20", "s-retired")],
        exercises: [exercise("x-bench", "s-retired", 0, { name: "Bench" })],
      });

      const sessions = await readSessions();

      expect(sessions[0]).toMatchObject({ id: "s-retired", name: "Push", isRest: false });
      expect(sessionExercises(sessions[0]).map((e) => e.name)).toEqual(["Bench"]);
    });

    it("lists every session on a day from the calendar, whichever plan wrote it, in the day's order", async () => {
      mockTables({
        plan: PLAN,
        sessions: [
          session("s-now", 0, 3, { name: "Scheduled" }),
          session("s-extra", 0, 3, { name: "Logged extra" }),
          session("s-logged", 0, 5, { name: "Logged earlier" }),
          session("s-later", 0, 5, { name: "Scheduled later" }),
          session("s-drop", 0, 0, { plan_id: "plan-other", name: "Dropped in" }),
        ],
        // Logged or not, every session shows; the day's order decides, never the ids.
        events: [
          event("e-c", "2026-07-23", "s-now", { day_order: 1 }),
          event("e-d", "2026-07-23", "s-extra", { status: "completed", day_order: 0 }),
          event("e-a", "2026-07-25", "s-logged", { status: "completed", day_order: 0 }),
          event("e-b", "2026-07-25", "s-later", { day_order: 1 }),
          event("e-drop", "2026-07-26", "s-drop", { training_plan_id: null }),
        ],
      });

      const sessions = await readSessions();

      // A day holding two sessions gives each its own entry at the day's position.
      expect(sessions.slice(0, 9).map((entry) => [entry.orderIndex, entry.name])).toEqual([
        [0, "Rest"],
        [1, "Rest"],
        [2, "Rest"],
        [3, "Logged extra"],
        [3, "Scheduled"],
        [4, "Rest"],
        [5, "Logged earlier"],
        [5, "Scheduled later"],
        [6, "Dropped in"],
      ]);
      expect(sessions[4]).toMatchObject({ id: "s-now", weekIndex: 0, isRest: false });
      expect(sessions[8]).toMatchObject({ id: "s-drop", name: "Dropped in", isRest: false });
    });

    it("carries the row's active exercises in order, mapped as the client reads them", async () => {
      const specs = [{ set_number: 1, set_type: "working", reps_min: 5, reps_max: 5 }];
      mockTables({
        plan: PLAN,
        sessions: [
          session("s-push", 0, 0, { name: "Push", focus: "Chest", estimated_duration_minutes: 60 }),
        ],
        events: [event("e-push", "2026-07-20", "s-push")],
        exercises: [
          exercise("x-2", "s-push", 1, { name: "Dips", is_warmup: true }),
          exercise("x-1", "s-push", 0, {
            name: "Bench",
            sets: 4,
            rpe_target: 8,
            tempo: "3010",
            rest_seconds: 120,
            set_specs: specs,
            video_url: "https://example.com/bench",
            prescribed_fields: ["reps", "rpe"],
          }),
        ],
      });

      const sessions = await readSessions();

      expect(sessions[0]).toEqual({
        id: "s-push",
        name: "Push",
        focus: "Chest",
        orderIndex: 0,
        weekIndex: 0,
        isRest: false,
        estimatedDurationMinutes: 60,
        groups: [
          {
            id: "grp-x-1",
            orderIndex: 0,
            ...STRAIGHT_SETS,
            exercises: [
              {
                id: "x-1",
                name: "Bench",
                orderIndex: 0,
                sets: 4,
                repsMin: 8,
                repsMax: 10,
                repsTarget: null,
                rpeTarget: 8,
                tempo: "3010",
                restSeconds: 120,
                isWarmup: false,
                setSpecs: specs,
                videoUrl: "https://example.com/bench",
                prescribedFields: ["reps", "rpe"],
              },
            ],
          },
          {
            id: "grp-x-2",
            orderIndex: 1,
            ...STRAIGHT_SETS,
            exercises: [
              {
                id: "x-2",
                name: "Dips",
                orderIndex: 0,
                sets: 3,
                repsMin: 8,
                repsMax: 10,
                repsTarget: null,
                rpeTarget: null,
                tempo: null,
                restSeconds: null,
                isWarmup: true,
                setSpecs: null,
                videoUrl: null,
                prescribedFields: null,
              },
            ],
          },
        ],
      });
      // The library template is never consulted.
      expect(mockFrom).not.toHaveBeenCalledWith("coach_saved_plans");
    });

    it("nests the row's exercises into their groups: groups in order with their settings, each group's exercises in order", async () => {
      // Every id sorts against its position, so only the positions can order them.
      const circuit = group("g-a", 1, {
        format: "circuit",
        rounds: 3,
        time_cap_seconds: 600,
        interval_seconds: null,
        rest_between_exercises_seconds: 15,
        rest_between_rounds_seconds: 90,
        notes: "Back to back",
      });
      mockTables({
        plan: PLAN,
        sessions: [session("s-push", 0, 0, { name: "Push" })],
        events: [event("e-push", "2026-07-20", "s-push")],
        exercises: [
          groupedExercise("x-a", "s-push", circuit, 1, { name: "Push-up" }),
          exercise("x-b", "s-push", 2, { name: "Plank" }),
          groupedExercise("x-c", "s-push", circuit, 0, { name: "Dips" }),
          exercise("x-d", "s-push", 0, { name: "Bench" }),
          groupedExercise("x-e", "s-push", circuit, 2, { name: "Flyes", is_active: false }),
        ],
      });

      const sessions = await readSessions();

      expect(
        sessions[0].groups.map((g) => [g.id, g.orderIndex, g.exercises.map((e) => [e.name, e.orderIndex])])
      ).toEqual([
        ["grp-x-d", 0, [["Bench", 0]]],
        ["g-a", 1, [["Dips", 0], ["Push-up", 1]]],
        ["grp-x-b", 2, [["Plank", 0]]],
      ]);
      expect(sessions[0].groups[1]).toMatchObject({
        format: "circuit",
        rounds: 3,
        timeCapSeconds: 600,
        intervalSeconds: null,
        restBetweenExercisesSeconds: 15,
        restBetweenRoundsSeconds: 90,
        notes: "Back to back",
      });
      expect(sessions[0].groups[0]).toMatchObject(STRAIGHT_SETS);
      expect(sessions[0].groups[2]).toMatchObject(STRAIGHT_SETS);
    });

    it("reads sparse, ordered pages: the window's events for the client, the plan's rows, the days' rows and their exercises", async () => {
      const { reads } = mockTables({
        plan: PLAN,
        sessions: [session("s-push", 0, 0)],
        events: [event("e-push", "2026-07-20", "s-push")],
      });

      await getClientTrainingPlan(CLIENT_ID);

      const [events] = reads.training_events;
      expect(events.select).toHaveBeenCalledWith(
        "id, date, day_order, status, training_session_id, session_name, session_focus"
      );
      expect(events.eq.mock.calls).toEqual([["client_id", CLIENT_ID]]);
      expect(events.gte).toHaveBeenCalledWith("date", "2026-07-20");
      expect(events.lte).toHaveBeenCalledWith("date", "2026-08-02");
      expect(events.order.mock.calls).toEqual([
        ["date", { ascending: true }],
        ["day_order", { ascending: true }],
        ["id", { ascending: true }],
      ]);
      expect(events.range).toHaveBeenCalledWith(0, 999);

      const planRows = reads.training_sessions.find((q) => q.in.mock.calls.length === 0)!;
      expect(planRows.select).toHaveBeenCalledWith("id, week_index, order_index");
      expect(planRows.eq.mock.calls).toEqual([
        ["plan_id", PLAN_ID],
        ["is_active", true],
        ["is_rest", true],
      ]);
      expect(planRows.order.mock.calls).toEqual([
        ["created_at", { ascending: true }],
        ["id", { ascending: true }],
      ]);

      const dayRows = reads.training_sessions.find((q) => q.in.mock.calls.length > 0)!;
      expect(dayRows.select).toHaveBeenCalledWith(
        "id, name, focus, estimated_duration_minutes, training_plans!inner(client_id)"
      );
      expect(dayRows.in).toHaveBeenCalledWith("id", ["s-push"]);
      // Whatever row a day points at is what the day holds: no is_active filter.
      expect(dayRows.eq.mock.calls).toEqual([["training_plans.client_id", CLIENT_ID]]);
      expect(dayRows.order.mock.calls).toEqual([["id", { ascending: true }]]);

      const [exercises] = reads.training_exercises;
      expect(exercises.select).toHaveBeenCalledWith(
        "id, session_id, name, order_index, sets, reps_min, reps_max, reps_target, rpe_target, tempo, rest_seconds, is_warmup, set_specs, video_url, prescribed_fields, exercise_group:training_exercise_groups!training_exercises_group_fkey(id, order_index, format, rounds, time_cap_seconds, interval_seconds, rest_between_exercises_seconds, rest_between_rounds_seconds, notes)"
      );
      expect(exercises.in).toHaveBeenCalledWith("session_id", ["s-push"]);
      expect(exercises.eq.mock.calls).toEqual([["is_active", true]]);
      // A stable page walk only: the groups and their exercises are put in
      // order by their positions once read (the nesting test above).
      expect(exercises.order.mock.calls).toEqual([
        ["session_id", { ascending: true }],
        ["id", { ascending: true }],
      ]);
    });

    it("issues its reads two at a time: the events beside the plan's rows, then the days' rows beside their exercises", async () => {
      const { log } = mockTables({
        plan: PLAN,
        sessions: [session("s-push", 0, 0)],
        events: [event("e-push", "2026-07-20", "s-push")],
      });

      await getClientTrainingPlan(CLIENT_ID);

      expect(log).toEqual([
        "issue training_events",
        "issue training_sessions",
        "read training_events",
        "read training_sessions",
        "issue training_sessions",
        "issue training_exercises",
        "read training_sessions",
        "read training_exercises",
      ]);
    });

    it("lays an upcoming program over its own window", async () => {
      vi.mocked(getNextFutureTrainingPlan).mockResolvedValue({
        id: "plan-2",
        name: "Next block",
        effectiveFrom: "2026-08-17",
        effectiveUntil: "2026-08-30",
        splitType: "ppl",
        frequencyPerWeek: 4,
        programDurationWeeks: 2,
      });
      const { reads } = mockTables({
        plan: null,
        sessions: [session("s-open", 0, 0, { plan_id: "plan-2", name: "Opener" })],
        events: [event("e-open", "2026-08-17", "s-open", { training_plan_id: "plan-2" })],
      });

      const result = await getClientTrainingPlan(CLIENT_ID);

      expect(result).toMatchObject({ planId: "plan-2", state: "upcoming", startsOn: "2026-08-17" });
      expect(result!.sessions).toHaveLength(14);
      expect(result!.sessions[0]).toMatchObject({ id: "s-open", name: "Opener", orderIndex: 0 });
      expect(result!.sessions[1]).toMatchObject({ id: "plan-2:1", isRest: true });
      expect(reads.training_events[0].gte).toHaveBeenCalledWith("date", "2026-08-17");
      expect(reads.training_events[0].lte).toHaveBeenCalledWith("date", "2026-08-30");
    });

    it.each([
      ["training_events", "Failed to fetch training events: connection reset"],
      ["training_exercises", "Failed to fetch training exercises: connection reset"],
    ])("throws when the %s read fails", async (table, message) => {
      mockTables({
        plan: PLAN,
        sessions: [session("s-push", 0, 0)],
        events: [event("e-push", "2026-07-20", "s-push")],
        errors: { [table]: "connection reset" },
      });

      await expect(getClientTrainingPlan(CLIENT_ID)).rejects.toThrow(message);
    });
  });
});
