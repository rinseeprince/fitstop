import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase-admin before importing the service. The walk + window
// calculator (program-event-walk) and deriveFrequencyPerWeek run REAL against
// this interpreted harness, so the suite covers the resumed date-walk
// end-to-end, not just call wiring.
vi.mock("./supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

vi.mock("./today-service", () => ({
  getClientTodayString: vi.fn(),
}));

vi.mock("./training-event-service", () => ({
  getNextPlanStartCap: vi.fn(),
}));

vi.mock("./library-placement-service", () => ({
  fetchVisibleExerciseIds: vi.fn(),
}));

import { supabaseAdmin } from "./supabase-admin";
import { getClientTodayString } from "./today-service";
import { getNextPlanStartCap } from "./training-event-service";
import { fetchVisibleExerciseIds } from "./library-placement-service";
import {
  getPlacedPlanForBuilder,
  amendPlacedPlanFuture,
  computeAmendmentToken,
  AmendmentConflictError,
  AmendmentValidationError,
  AmendmentEmptyFutureError,
  type AmendSessionInput,
} from "./plan-amendment-service";

const mockFrom = vi.mocked(supabaseAdmin.from);
const mockToday = vi.mocked(getClientTodayString);
const mockNextPlanCap = vi.mocked(getNextPlanStartCap);
const mockVisibleIds = vi.mocked(fetchVisibleExerciseIds);

// =============================================================================
// Interpreted supabase harness: queries filter/mutate an in-memory scenario, so
// the suite can assert both the calls AND the resulting state (compensation).
// =============================================================================

type Filter = [kind: string, colOrExpr: string, value?: unknown];

type Scenario = {
  plans: Record<string, unknown>[];
  sessions: Record<string, unknown>[];
  exercises: Record<string, unknown>[];
  events: Record<string, unknown>[];
  phase: Record<string, unknown> | null;
  freshCounter: number;
  planUpdates: Record<string, unknown>[];
  sessionInserts: Record<string, unknown>[];
  exerciseInserts: Record<string, unknown>[][];
  eventDeletes: { filters: Filter[]; deleted: Record<string, unknown>[] }[];
  eventUpserts: { rows: Record<string, unknown>[]; opts: unknown }[];
  // consumed once each — lets a walk-upsert failure coexist with a succeeding
  // compensation restore on the same table+op
  failures: { table: string; op: string; message: string }[];
};

function rowMatches(row: Record<string, unknown>, filters: Filter[]): boolean {
  for (const [kind, col, val] of filters) {
    if (kind === "eq" && row[col] !== val) return false;
    if (kind === "is" && row[col] !== val) return false;
    if (kind === "gte" && !((row[col] as string) >= (val as string))) return false;
    if (kind === "lte" && !((row[col] as string) <= (val as string))) return false;
    if (kind === "in" && !(val as unknown[]).includes(row[col])) return false;
    if (kind === "or") {
      const m = /^date\.lt\.(.+),status\.neq\.scheduled$/.exec(col);
      if (!m) throw new Error(`Unsupported or() expression in harness: ${col}`);
      if (!((row.date as string) < m[1] || row.status !== "scheduled")) return false;
    }
  }
  return true;
}

function execute(
  state: Scenario,
  q: { _table: string; _op: string; _filters: Filter[]; _payload: unknown; _opts: unknown; _range: [number, number] | null },
  mode: "single" | "maybeSingle" | "many",
): { data: unknown; error: { message: string } | null } {
  const failIdx = state.failures.findIndex((f) => f.table === q._table && f.op === q._op);
  if (failIdx >= 0) {
    const [f] = state.failures.splice(failIdx, 1);
    return { data: null, error: { message: f.message } };
  }

  const slice = (rows: Record<string, unknown>[]) =>
    q._range ? rows.slice(q._range[0], q._range[1] + 1) : rows;

  if (q._table === "training_plans") {
    if (q._op === "select") {
      const row = state.plans.find((r) => rowMatches(r, q._filters)) ?? null;
      return { data: row, error: null };
    }
    if (q._op === "update") {
      state.planUpdates.push(q._payload as Record<string, unknown>);
      state.plans
        .filter((r) => rowMatches(r, q._filters))
        .forEach((r) => Object.assign(r, q._payload));
      return { data: null, error: null };
    }
  }

  if (q._table === "phases") {
    return { data: state.phase, error: null };
  }

  if (q._table === "training_sessions") {
    if (q._op === "select") {
      return { data: slice(state.sessions.filter((r) => rowMatches(r, q._filters))), error: null };
    }
    if (q._op === "insert") {
      const payload = q._payload as Record<string, unknown>;
      const id = `fresh-${state.freshCounter++}`;
      state.sessions.push({
        ...payload,
        id,
        estimated_calories: null,
        created_at: `2026-07-21T12:00:00.${String(state.freshCounter).padStart(3, "0")}Z`,
        updated_at: "2026-07-21T12:00:00Z",
      });
      state.sessionInserts.push(payload);
      return { data: { id }, error: null };
    }
    if (q._op === "update") {
      state.sessions
        .filter((r) => rowMatches(r, q._filters))
        .forEach((r) => Object.assign(r, q._payload));
      return { data: null, error: null };
    }
    if (q._op === "delete") {
      const doomed = state.sessions.filter((r) => rowMatches(r, q._filters));
      state.sessions = state.sessions.filter((r) => !doomed.includes(r));
      return { data: null, error: null };
    }
  }

  if (q._table === "training_exercises") {
    if (q._op === "select") {
      return { data: slice(state.exercises.filter((r) => rowMatches(r, q._filters))), error: null };
    }
    if (q._op === "insert") {
      const payload = q._payload as Record<string, unknown>[];
      state.exerciseInserts.push(payload);
      payload.forEach((row, i) =>
        state.exercises.push({
          ...row,
          id: `exf-${state.freshCounter}-${i}`,
          created_at: "2026-07-21T12:00:00Z",
          updated_at: "2026-07-21T12:00:00Z",
        }),
      );
      return { data: null, error: null };
    }
    if (q._op === "update") {
      state.exercises
        .filter((r) => rowMatches(r, q._filters))
        .forEach((r) => Object.assign(r, q._payload));
      return { data: null, error: null };
    }
    if (q._op === "delete") {
      const doomed = state.exercises.filter((r) => rowMatches(r, q._filters));
      state.exercises = state.exercises.filter((r) => !doomed.includes(r));
      return { data: null, error: null };
    }
  }

  if (q._table === "training_events") {
    if (q._op === "select") {
      return { data: slice(state.events.filter((r) => rowMatches(r, q._filters))), error: null };
    }
    if (q._op === "delete") {
      const doomed = state.events.filter((r) => rowMatches(r, q._filters));
      state.events = state.events.filter((r) => !doomed.includes(r));
      state.eventDeletes.push({ filters: q._filters, deleted: doomed });
      return { data: null, error: null };
    }
    if (q._op === "upsert") {
      const rows = q._payload as Record<string, unknown>[];
      state.eventUpserts.push({ rows, opts: q._opts });
      for (const row of rows) {
        const collides = state.events.some(
          (e) =>
            e.id === row.id ||
            (e.client_id === row.client_id &&
              e.training_session_id === row.training_session_id &&
              e.date === row.date),
        );
        if (!collides) {
          state.events.push({ ...row, id: (row.id as string) ?? `evgen-${state.freshCounter++}` });
        }
      }
      return { data: null, error: null };
    }
  }

  throw new Error(`Unhandled query in harness: ${q._table} ${q._op} (${mode})`);
}

function wireScenario(state: Scenario) {
  mockFrom.mockImplementation(((table: string) => {
    const q = {
      _table: table,
      _op: "select",
      _filters: [] as Filter[],
      _payload: undefined as unknown,
      _opts: undefined as unknown,
      _range: null as [number, number] | null,
      select() {
        return q;
      },
      insert(payload: unknown) {
        q._op = "insert";
        q._payload = payload;
        return q;
      },
      update(payload: unknown) {
        q._op = "update";
        q._payload = payload;
        return q;
      },
      delete() {
        q._op = "delete";
        return q;
      },
      upsert(payload: unknown, opts: unknown) {
        q._op = "upsert";
        q._payload = payload;
        q._opts = opts;
        return q;
      },
      eq(col: string, v: unknown) {
        q._filters.push(["eq", col, v]);
        return q;
      },
      gte(col: string, v: unknown) {
        q._filters.push(["gte", col, v]);
        return q;
      },
      lte(col: string, v: unknown) {
        q._filters.push(["lte", col, v]);
        return q;
      },
      in(col: string, v: unknown) {
        q._filters.push(["in", col, v]);
        return q;
      },
      is(col: string, v: unknown) {
        q._filters.push(["is", col, v]);
        return q;
      },
      or(expr: string) {
        q._filters.push(["or", expr]);
        return q;
      },
      order() {
        return q;
      },
      limit() {
        return q;
      },
      range(from: number, to: number) {
        q._range = [from, to];
        return q;
      },
      single: () => Promise.resolve(execute(state, q, "single")),
      maybeSingle: () => Promise.resolve(execute(state, q, "maybeSingle")),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve()
          .then(() => execute(state, q, "many"))
          .then(resolve, reject),
    };
    return q;
  }) as never);
}

// =============================================================================
// Base scenario: a 2-week placement (14 slots), effective 2026-07-15, training
// on days 1/3/5 of each week, client today 2026-07-22 → floor 07-22, offset 7.
// =============================================================================

const PLAN_ID = "plan-1";
const CLIENT_ID = "client-1";
const COACH_ID = "coach-1";
const EFFECTIVE_FROM = "2026-07-15";
const PLAN_UPDATED_AT = "2026-07-20T00:00:00Z";

const isTrainingPos = (i: number) => i % 7 === 0 || i % 7 === 2 || i % 7 === 4;

function dateAt(position: number): string {
  const d = new Date(EFFECTIVE_FROM + "T00:00:00");
  d.setDate(d.getDate() + position);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function makeScenario(): Scenario {
  const sessions = Array.from({ length: 14 }, (_, i) => ({
    id: `cur-${i}`,
    plan_id: PLAN_ID,
    name: isTrainingPos(i) ? `Session ${i}` : "Rest",
    focus: isTrainingPos(i) ? "strength" : null,
    day_of_week: null,
    order_index: i,
    week_index: Math.floor(i / 7),
    is_rest: !isTrainingPos(i),
    estimated_duration_minutes: isTrainingPos(i) ? 60 : null,
    calorie_surplus_percentage: isTrainingPos(i) ? 10 : null,
    notes: null,
    is_active: true,
    estimated_calories: null,
    created_at: "2026-07-15T00:00:00Z",
    updated_at: "2026-07-15T00:00:00Z",
  }));

  const makeEvent = (
    id: string,
    position: number,
    status: string,
    isModified = false,
    overrides: Record<string, unknown> = {},
  ) => ({
    id,
    client_id: CLIENT_ID,
    training_plan_id: PLAN_ID,
    training_session_id: `cur-${position}`,
    date: dateAt(position),
    session_name: `Session ${position}`,
    session_focus: "strength",
    estimated_calories: null,
    calorie_surplus_percentage: 10,
    status,
    is_modified: isModified,
    session_log_id: null,
    created_at: "2026-07-15T00:00:00Z",
    updated_at: "2026-07-15T00:00:00Z",
    ...overrides,
  });

  return {
    plans: [
      {
        id: PLAN_ID,
        client_id: CLIENT_ID,
        coach_id: COACH_ID,
        name: "PPL Block",
        split_type: "push_pull",
        status: "active",
        frequency_per_week: 3,
        program_duration_weeks: 2,
        effective_from: EFFECTIVE_FROM,
        effective_until: null,
        phase_id: null,
        saved_plan_id: null,
        deleted_at: null,
        created_at: "2026-07-14T00:00:00Z",
        updated_at: PLAN_UPDATED_AT,
      },
    ],
    sessions,
    exercises: [
      {
        id: "ex-cur-0",
        session_id: "cur-0",
        name: "Bench Press",
        exercise_id: "cat-1",
        order_index: 0,
        sets: 4,
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
        video_url: null,
        is_active: true,
        created_at: "2026-07-15T00:00:00Z",
        updated_at: "2026-07-15T00:00:00Z",
      },
      {
        id: "ex-cur-9",
        session_id: "cur-9",
        name: "Row",
        exercise_id: null,
        order_index: 0,
        sets: 3,
        reps_min: 8,
        reps_max: 10,
        reps_target: null,
        rpe_target: null,
        percentage_1rm: null,
        tempo: null,
        rest_seconds: 90,
        notes: null,
        superset_group: null,
        is_warmup: false,
        set_specs: null,
        video_url: null,
        is_active: true,
        created_at: "2026-07-15T00:00:00Z",
        updated_at: "2026-07-15T00:00:00Z",
      },
      // Already soft-deleted before the amendment — compensation must NOT
      // resurrect it.
      {
        id: "ex-cur-9-deleted",
        session_id: "cur-9",
        name: "Old Row",
        exercise_id: null,
        order_index: 1,
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
        set_specs: null,
        video_url: null,
        is_active: false,
        created_at: "2026-07-15T00:00:00Z",
        updated_at: "2026-07-15T00:00:00Z",
      },
    ],
    events: [
      makeEvent("ev-0", 0, "completed"),
      makeEvent("ev-2", 2, "missed"),
      makeEvent("ev-4", 4, "completed"),
      makeEvent("ev-7", 7, "scheduled"),
      // Manually moved future event → delete candidate + pre-save warning.
      makeEvent("ev-9", 9, "scheduled", true),
      // Future event the client logged EARLY → survives (non-scheduled) and its
      // session row must be kept via the event-reference belt.
      makeEvent("ev-11", 11, "completed", true),
      // Plan-scoped scheduled event moved OUT beyond the window → predicate (a).
      makeEvent("ev-out", 12, "scheduled", true, { date: "2026-08-05" }),
      // Another plan's scheduled event inside the window → predicate (b).
      makeEvent("ev-other", 8, "scheduled", false, {
        id: "ev-other",
        training_plan_id: "other-plan",
        training_session_id: "other-sess",
        date: "2026-07-25",
        session_name: "Other Plan Day",
      }),
    ],
    phase: null,
    freshCounter: 0,
    planUpdates: [],
    sessionInserts: [],
    exerciseInserts: [],
    eventDeletes: [],
    eventUpserts: [],
    failures: [],
  };
}

// Canonical amendment grid: N weeks × 7 slots; the mirror of the current plan
// for week 0 and a fresh prescription for later weeks.
function makeGrid(
  weeks: number,
  futureOverrides: (position: number) => Partial<AmendSessionInput> | null = () => null,
): AmendSessionInput[] {
  return Array.from({ length: weeks * 7 }, (_, i) => {
    const base: AmendSessionInput = {
      name: isTrainingPos(i) ? `Session ${i}` : "Rest",
      focus: isTrainingPos(i) ? "strength" : null,
      orderIndex: i,
      weekIndex: Math.floor(i / 7),
      isRest: !isTrainingPos(i),
      estimatedDurationMinutes: isTrainingPos(i) ? 60 : null,
      calorieSurplusPercentage: isTrainingPos(i) ? 10 : null,
      notes: null,
      sessionType: "training",
      exercises: [],
    };
    return { ...base, ...(futureOverrides(i) ?? {}) };
  });
}

async function tokenFor(clientId = CLIENT_ID, planId = PLAN_ID): Promise<string> {
  const read = await getPlacedPlanForBuilder(clientId, planId);
  if (!read) throw new Error("scenario plan missing");
  return read.amendmentToken;
}

describe("plan-amendment-service", () => {
  let state: Scenario;

  beforeEach(() => {
    vi.clearAllMocks();
    state = makeScenario();
    wireScenario(state);
    mockToday.mockResolvedValue("2026-07-22");
    mockNextPlanCap.mockResolvedValue(null);
    mockVisibleIds.mockResolvedValue(new Set(["vis-1"]));
  });

  // ===========================================================================
  // computeAmendmentToken
  // ===========================================================================

  describe("computeAmendmentToken", () => {
    const baseEvents = [
      { id: "e2", date: "2026-07-24", training_session_id: "s2", status: "scheduled", is_modified: false },
      { id: "e1", date: "2026-07-22", training_session_id: "s1", status: "scheduled", is_modified: true },
    ];
    const baseParams = {
      planUpdatedAt: PLAN_UPDATED_AT,
      clientToday: "2026-07-22",
      events: baseEvents,
    };

    it("is stable across event ordering", () => {
      const a = computeAmendmentToken(baseParams);
      const b = computeAmendmentToken({ ...baseParams, events: [...baseEvents].reverse() });
      expect(a).toBe(b);
    });

    it.each([
      ["plan updated_at", { planUpdatedAt: "2026-07-21T00:00:00Z" }],
      ["client today (midnight flip)", { clientToday: "2026-07-23" }],
      ["an event added", { events: [...baseEvents, { id: "e3", date: "2026-07-25", training_session_id: "s3", status: "scheduled", is_modified: false }] }],
      ["an event removed", { events: baseEvents.slice(0, 1) }],
      ["an event date (calendar move)", { events: [baseEvents[0], { ...baseEvents[1], date: "2026-07-23" }] }],
      ["an event status", { events: [baseEvents[0], { ...baseEvents[1], status: "completed" }] }],
      ["an is_modified flip", { events: [{ ...baseEvents[0], is_modified: true }, baseEvents[1]] }],
    ])("invalidates when %s changes", (_label, override) => {
      const a = computeAmendmentToken(baseParams);
      const b = computeAmendmentToken({ ...baseParams, ...override });
      expect(b).not.toBe(a);
    });
  });

  // ===========================================================================
  // getPlacedPlanForBuilder
  // ===========================================================================

  describe("getPlacedPlanForBuilder", () => {
    it("returns canonical slots incl. rest with exercises + event linkage", async () => {
      const read = await getPlacedPlanForBuilder(CLIENT_ID, PLAN_ID);

      expect(read).not.toBeNull();
      expect(read!.plan).toMatchObject({
        id: PLAN_ID,
        name: "PPL Block",
        effectiveFrom: EFFECTIVE_FROM,
        updatedAt: PLAN_UPDATED_AT,
      });
      expect(read!.clientToday).toBe("2026-07-22");
      expect(read!.windowEnd).toBe(dateAt(13)); // 14 slots, one pass
      expect(read!.isFullyPast).toBe(false);
      expect(read!.amendmentToken).toEqual(expect.any(String));

      expect(read!.sessions.map((s) => s.id)).toEqual(
        Array.from({ length: 14 }, (_, i) => `cur-${i}`),
      );
      const slot0 = read!.sessions[0];
      expect(slot0.isRest).toBe(false);
      expect(slot0.sessionType).toBe("training");
      expect(slot0.exercises.map((e) => e.name)).toEqual(["Bench Press"]);
      expect(slot0.events).toEqual([
        { id: "ev-0", date: dateAt(0), status: "completed", isModified: false },
      ]);
      const restSlot = read!.sessions[1];
      expect(restSlot.isRest).toBe(true);
      expect(restSlot.exercises).toEqual([]);
    });

    it("lists only future scheduled modified events as the pre-save warning", async () => {
      const read = await getPlacedPlanForBuilder(CLIENT_ID, PLAN_ID);
      // ev-9 (scheduled+modified) and ev-out (scheduled+modified, moved out)
      // qualify; ev-11 is modified but completed → survives, not listed.
      expect(read!.futureModifiedEvents.map((e) => e.id)).toEqual(["ev-9", "ev-out"]);
    });

    it("orders duplicate-coordinate rows deterministically (created_at tiebreak)", async () => {
      state.sessions.push({
        ...state.sessions[7],
        id: "cur-7-clone",
        created_at: "2026-07-16T00:00:00Z", // later than cur-7's created_at
      });
      const read = await getPlacedPlanForBuilder(CLIENT_ID, PLAN_ID);
      const ids = read!.sessions.map((s) => s.id);
      expect(ids.indexOf("cur-7")).toBeLessThan(ids.indexOf("cur-7-clone"));
    });

    it("reports isFullyPast when the window ended before the client's today", async () => {
      mockToday.mockResolvedValue("2026-09-01");
      const read = await getPlacedPlanForBuilder(CLIENT_ID, PLAN_ID);
      expect(read!.isFullyPast).toBe(true);
    });

    it("returns null for a plan that doesn't belong to the client", async () => {
      expect(await getPlacedPlanForBuilder("other-client", PLAN_ID)).toBeNull();
    });
  });

  // ===========================================================================
  // amendPlacedPlanFuture — guards
  // ===========================================================================

  describe("amendPlacedPlanFuture guards", () => {
    it("409s on token drift", async () => {
      await expect(
        amendPlacedPlanFuture({
          clientId: CLIENT_ID,
          coachId: COACH_ID,
          planId: PLAN_ID,
          sessions: makeGrid(2),
          expectedToken: "stale-token",
        }),
      ).rejects.toBeInstanceOf(AmendmentConflictError);
      expect(state.sessionInserts).toHaveLength(0);
      expect(state.eventDeletes).toHaveLength(0);
    });

    it("422s when the plan has fully ended (no extension of an ended plan)", async () => {
      mockToday.mockResolvedValue("2026-09-01");
      await expect(
        amendPlacedPlanFuture({
          clientId: CLIENT_ID,
          coachId: COACH_ID,
          planId: PLAN_ID,
          sessions: makeGrid(4),
          expectedToken: "anything",
        }),
      ).rejects.toBeInstanceOf(AmendmentEmptyFutureError);
    });

    it("422s when the amendment shrinks below the elapsed days", async () => {
      const token = await tokenFor();
      await expect(
        amendPlacedPlanFuture({
          clientId: CLIENT_ID,
          coachId: COACH_ID,
          planId: PLAN_ID,
          sessions: makeGrid(1), // 7 slots, offset is 7
          expectedToken: token,
        }),
      ).rejects.toBeInstanceOf(AmendmentEmptyFutureError);
    });

    it("rejects a non-canonical grid (orderIndex not weekIndex*7+day)", async () => {
      const token = await tokenFor();
      const grid = makeGrid(2);
      grid[8] = { ...grid[8], orderIndex: 20 };
      await expect(
        amendPlacedPlanFuture({
          clientId: CLIENT_ID,
          coachId: COACH_ID,
          planId: PLAN_ID,
          sessions: grid,
          expectedToken: token,
        }),
      ).rejects.toBeInstanceOf(AmendmentValidationError);
    });

    it("rejects an archived plan", async () => {
      state.plans[0].status = "archived";
      await expect(
        amendPlacedPlanFuture({
          clientId: CLIENT_ID,
          coachId: COACH_ID,
          planId: PLAN_ID,
          sessions: makeGrid(2),
          expectedToken: "anything",
        }),
      ).rejects.toBeInstanceOf(AmendmentValidationError);
    });

    it("404s (Plan not found) for a foreign plan", async () => {
      await expect(
        amendPlacedPlanFuture({
          clientId: "other-client",
          coachId: COACH_ID,
          planId: PLAN_ID,
          sessions: makeGrid(2),
          expectedToken: "anything",
        }),
      ).rejects.toThrow("Plan not found");
    });
  });

  // ===========================================================================
  // amendPlacedPlanFuture — the rewrite
  // ===========================================================================

  // Future half of the grid (positions 7..13): T(+25 w/ exercises), R, T(null
  // surplus), R, R, T(+20), R. Past half carries hostile content the server
  // must ignore.
  function makeAmendedGrid(): AmendSessionInput[] {
    const futureShape: Record<number, Partial<AmendSessionInput>> = {
      7: {
        name: "New Push",
        isRest: false,
        calorieSurplusPercentage: 25,
        exercises: [
          {
            name: "Incline Bench",
            exerciseId: "vis-1",
            orderIndex: 0,
            sets: 3,
            repsMin: 6,
            repsMax: 8,
            setSpecs: [
              { set_number: 1, set_type: "warmup" },
              { set_number: 2, set_type: "working", reps_min: 6, reps_max: 8 },
            ],
            videoUrl: "https://example.com/incline",
          },
          {
            name: "Foreign Move",
            exerciseId: "foreign-1",
            orderIndex: 1,
            sets: 3,
          },
        ],
      },
      8: { isRest: true, name: "Rest" },
      9: { name: "New Pull", isRest: false, calorieSurplusPercentage: null, exercises: [] },
      10: { isRest: true, name: "Rest" },
      11: { isRest: true, name: "Rest" },
      12: { name: "New Legs", isRest: false, calorieSurplusPercentage: 20, exercises: [] },
      13: { isRest: true, name: "Rest" },
    };
    return makeGrid(2, (i) => {
      if (i < 7) return i === 0 ? { name: "HACKED PAST" } : null;
      return futureShape[i] ?? { isRest: true, name: "Rest" };
    });
  }

  it("rewrites the future only: resumed walk, kept past, event-reference belt, both delete predicates", async () => {
    const token = await tokenFor();
    const result = await amendPlacedPlanFuture({
      clientId: CLIENT_ID,
      coachId: COACH_ID,
      planId: PLAN_ID,
      sessions: makeAmendedGrid(),
      expectedToken: token,
    });

    // Boundary math.
    expect(result.floor).toBe("2026-07-22");
    expect(result.offset).toBe(7);

    // Only the 7 future slots were inserted; hostile past content ignored.
    expect(state.sessionInserts).toHaveLength(7);
    expect(state.sessions.find((s) => s.id === "cur-0")!.name).toBe("Session 0");

    // Partition: positions ≥ 7 deactivated EXCEPT cur-11 (referenced by the
    // early-completed ev-11 — the event-reference belt).
    const deactivated = state.sessions
      .filter((s) => (s.id as string).startsWith("cur-") && s.is_active === false)
      .map((s) => s.id)
      .sort();
    expect(deactivated).toEqual(["cur-10", "cur-12", "cur-13", "cur-7", "cur-8", "cur-9"]);
    expect(state.sessions.find((s) => s.id === "cur-11")!.is_active).toBe(true);
    expect(result.deactivatedSessions).toBe(6);

    // Delete predicates, scheduled-only, no is_modified filter: ev-7 + ev-9
    // (modified) + ev-out (plan-scoped beyond the window) + ev-other (another
    // plan inside the window) are gone; completed/missed/past all survive.
    const deletedIds = state.eventDeletes.flatMap((d) => d.deleted.map((e) => e.id)).sort();
    expect(deletedIds).toEqual(["ev-7", "ev-9", "ev-other", "ev-out"]);
    for (const survivor of ["ev-0", "ev-2", "ev-4", "ev-11"]) {
      expect(state.events.some((e) => e.id === survivor)).toBe(true);
    }

    // Resumed walk: first generated date = floor mapping slot 7; rest slots
    // consume dates silently (07-23, 07-25, 07-26, 07-28 emit nothing).
    const walkRows = state.eventUpserts[0].rows;
    expect(walkRows.map((r) => [r.date, r.session_name])).toEqual([
      ["2026-07-22", "New Push"],
      ["2026-07-24", "New Pull"],
      ["2026-07-27", "New Legs"],
    ]);
    expect(result.eventsCreated).toBe(3);
    expect(result.sessionsCreated).toBe(3);

    // INVARIANT: every emitted event carries the surplus key, even when null —
    // absolute semantics (input verbatim, no plan-default inherit).
    for (const row of walkRows) {
      expect(Object.prototype.hasOwnProperty.call(row, "calorie_surplus_percentage")).toBe(true);
      expect(row.status).toBe("scheduled");
      expect(row.is_modified).toBe(false);
    }
    expect(walkRows[0].calorie_surplus_percentage).toBe(25);
    expect(walkRows[1].calorie_surplus_percentage).toBeNull();
    expect(walkRows[2].calorie_surplus_percentage).toBe(20);

    // Exercise splat: set_specs/video_url verbatim; foreign exercise id nulled,
    // visible one kept.
    const inserted = state.exerciseInserts[0];
    expect(inserted[0].set_specs).toEqual([
      { set_number: 1, set_type: "warmup" },
      { set_number: 2, set_type: "working", reps_min: 6, reps_max: 8 },
    ]);
    expect(inserted[0].video_url).toBe("https://example.com/incline");
    expect(inserted[0].exercise_id).toBe("vis-1");
    expect(inserted[1].exercise_id).toBeNull();
  });

  it("updates plan meta (duration, derived frequency, patch, updated_at bump)", async () => {
    const token = await tokenFor();
    await amendPlacedPlanFuture({
      clientId: CLIENT_ID,
      coachId: COACH_ID,
      planId: PLAN_ID,
      sessions: makeAmendedGrid(),
      planPatch: { name: "Renamed Block", splitType: null },
      expectedToken: token,
    });

    expect(state.planUpdates).toHaveLength(1);
    const update = state.planUpdates[0];
    expect(update.program_duration_weeks).toBe(2);
    // Week 0 has 3 training days, amended week 1 has 3 → per-week average 3.
    expect(update.frequency_per_week).toBe(3);
    expect(update.name).toBe("Renamed Block");
    // A nulled focus falls back to the NOT NULL column's placement default.
    expect(update.split_type).toBe("custom");
    expect(update.updated_at).toEqual(expect.any(String));
    expect(update.effective_until).toBeUndefined();
  });

  it("offset 0 for a not-yet-started plan: the whole program is rewritable", async () => {
    mockToday.mockResolvedValue("2026-07-10"); // before effective_from
    const token = await tokenFor();
    const result = await amendPlacedPlanFuture({
      clientId: CLIENT_ID,
      coachId: COACH_ID,
      planId: PLAN_ID,
      sessions: makeAmendedGrid(),
      expectedToken: token,
    });

    expect(result.floor).toBe(EFFECTIVE_FROM); // floored at effective_from
    expect(result.offset).toBe(0);
    expect(state.sessionInserts).toHaveLength(14);
    // Walk starts at slot 0 on effective_from.
    expect(state.eventUpserts[0].rows[0].date).toBe(EFFECTIVE_FROM);
  });

  it("an all-rest future is legal: events deleted, none created", async () => {
    const token = await tokenFor();
    const result = await amendPlacedPlanFuture({
      clientId: CLIENT_ID,
      coachId: COACH_ID,
      planId: PLAN_ID,
      sessions: makeGrid(2, (i) => (i >= 7 ? { isRest: true, name: "Rest", exercises: [] } : null)),
      expectedToken: token,
    });

    expect(result.eventsCreated).toBe(0);
    expect(state.eventUpserts).toHaveLength(0); // walk emitted nothing
    expect(state.events.some((e) => e.id === "ev-7")).toBe(false);
  });

  describe("window recompute", () => {
    it("growth: a longer grid walks past the old window end", async () => {
      const token = await tokenFor();
      await amendPlacedPlanFuture({
        clientId: CLIENT_ID,
        coachId: COACH_ID,
        planId: PLAN_ID,
        sessions: makeGrid(3), // 21 slots → window = eff+20 = 2026-08-04
        expectedToken: token,
      });

      const dates = state.eventUpserts[0].rows.map((r) => r.date);
      // Position 14 (week 2, day 1) is a training slot → 2026-07-29, beyond the
      // old 14-slot window end (2026-07-28).
      expect(dates).toContain("2026-07-29");
      expect(dates).toContain("2026-08-02"); // position 18
      expect(dates.every((d) => (d as string) <= "2026-08-04")).toBe(true);
    });

    it("shrink: predicate (a) clears plan events beyond the new window", async () => {
      mockToday.mockResolvedValue("2026-07-18"); // offset 3
      const token = await tokenFor();
      await amendPlacedPlanFuture({
        clientId: CLIENT_ID,
        coachId: COACH_ID,
        planId: PLAN_ID,
        sessions: makeGrid(1), // 7 slots → window = eff+6 = 2026-07-21
        expectedToken: token,
      });

      // ev-7 (07-22), ev-9 (07-24), ev-out (08-05) all sit beyond the shrunk
      // window but are plan-scoped scheduled → deleted by the unbounded (a).
      const deletedIds = state.eventDeletes.flatMap((d) => d.deleted.map((e) => e.id));
      expect(deletedIds).toEqual(expect.arrayContaining(["ev-7", "ev-9", "ev-out"]));
      // Walk covers 07-18..07-21 = positions 3..6; only position 4 trains.
      expect(state.eventUpserts[0].rows.map((r) => r.date)).toEqual(["2026-07-19"]);
    });

    it("next-plan cap bounds the walk", async () => {
      mockNextPlanCap.mockResolvedValue("2026-07-25");
      const token = await tokenFor();
      await amendPlacedPlanFuture({
        clientId: CLIENT_ID,
        coachId: COACH_ID,
        planId: PLAN_ID,
        sessions: makeAmendedGrid(),
        expectedToken: token,
      });

      const dates = state.eventUpserts[0].rows.map((r) => r.date);
      expect(dates.every((d) => (d as string) <= "2026-07-25")).toBe(true);
      expect(dates).toEqual(["2026-07-22", "2026-07-24"]); // New Legs (07-27) capped away
    });

    it("phase cap bounds the walk", async () => {
      state.plans[0].phase_id = "phase-1";
      state.phase = { end_date: "2026-07-24", start_date: "2026-07-01", duration_weeks: null };
      const token = await tokenFor();
      await amendPlacedPlanFuture({
        clientId: CLIENT_ID,
        coachId: COACH_ID,
        planId: PLAN_ID,
        sessions: makeAmendedGrid(),
        expectedToken: token,
      });

      const dates = state.eventUpserts[0].rows.map((r) => r.date);
      expect(dates.every((d) => (d as string) <= "2026-07-24")).toBe(true);
    });
  });

  // ===========================================================================
  // Compensation
  // ===========================================================================

  it("compensates a mid-flight failure: fresh rows removed, retired rows restored, snapshot re-inserted, root error preserved", async () => {
    const token = await tokenFor();
    // Fail the WALK's event upsert (consumed once — the compensation restore's
    // own upsert succeeds).
    state.failures.push({ table: "training_events", op: "upsert", message: "boom" });

    await expect(
      amendPlacedPlanFuture({
        clientId: CLIENT_ID,
        coachId: COACH_ID,
        planId: PLAN_ID,
        sessions: makeAmendedGrid(),
        expectedToken: token,
      }),
    ).rejects.toThrow(/Failed to generate events: boom/);

    // Root error is NOT shadowed by a compensation-incomplete augmentation.
    await expect(
      (async () => {
        state = makeScenario();
        wireScenario(state);
        state.failures.push({ table: "training_events", op: "upsert", message: "boom" });
        const t = await tokenFor();
        return amendPlacedPlanFuture({
          clientId: CLIENT_ID,
          coachId: COACH_ID,
          planId: PLAN_ID,
          sessions: makeAmendedGrid(),
          expectedToken: t,
        });
      })(),
    ).rejects.not.toThrow(/compensation incomplete/);

    // Fresh rows hard-deleted.
    expect(state.sessions.some((s) => (s.id as string).startsWith("fresh-"))).toBe(false);
    expect(state.exercises.some((e) => (e.id as string).startsWith("exf-"))).toBe(false);

    // Every retired row reactivated…
    for (const s of state.sessions) {
      expect(s.is_active).toBe(true);
    }
    expect(state.exercises.find((e) => e.id === "ex-cur-9")!.is_active).toBe(true);
    // …but a row that was ALREADY soft-deleted before the amendment stays dead.
    expect(state.exercises.find((e) => e.id === "ex-cur-9-deleted")!.is_active).toBe(false);

    // The deleted scheduled events are back.
    for (const id of ["ev-7", "ev-9", "ev-out", "ev-other"]) {
      expect(state.events.some((e) => e.id === id)).toBe(true);
    }
  });
});
