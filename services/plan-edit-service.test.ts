import { describe, it, expect, vi, beforeEach } from "vitest";

// The collaborators are mocked so this file tests Edit plan's own read and
// save. supabaseAdmin answers from fixture tables: each test states the
// client's calendar and reads back what the editor was given, or what the
// save sent to edit_training_plan_atomic.
vi.mock("./supabase-admin", () => ({
  supabaseAdmin: { from: vi.fn(), rpc: vi.fn() },
}));
vi.mock("./today-service", () => ({ getClientTodayString: vi.fn() }));
vi.mock("./event-deletion-floor", () => ({ resolveEventDeletionFloor: vi.fn() }));
vi.mock("./program-event-walk", () => ({ resolveWindowCap: vi.fn() }));
vi.mock("./library-placement-service", () => ({ fetchVisibleExerciseIds: vi.fn() }));

import { supabaseAdmin } from "./supabase-admin";
import { getClientTodayString } from "./today-service";
import { resolveEventDeletionFloor } from "./event-deletion-floor";
import { resolveWindowCap, type WindowCap } from "./program-event-walk";
import { fetchVisibleExerciseIds } from "./library-placement-service";
import {
  getPlanForEditing,
  savePlanEdit,
  PlanEditInvalidError,
  PlanEditNotFoundError,
  PlanEditStaleError,
  PlanEndedError,
  type PlanEditDay,
  type PlanForEditing,
} from "./plan-edit-service";

const mockFrom = vi.mocked(supabaseAdmin.from);
const mockRpc = vi.mocked(supabaseAdmin.rpc);

const CLIENT_ID = "c0000000-0000-4000-8000-000000000001";
const OTHER_CLIENT_ID = "c0000000-0000-4000-8000-000000000002";
const PLAN_ID = "a0000000-0000-4000-8000-000000000001";
const COACH_ID = "coach-1";
const PLAN_UPDATED_AT = "2026-09-01T10:00:00.123456+00:00";
const ROW_UPDATED_AT = "2026-09-02T08:00:00+00:00";

// The plan runs two whole weeks from Monday 7 Sep: position 0 is the 7th,
// position 13 the 20th. The client's today is Thursday the 10th, position 3.
const START = "2026-09-07";
const TODAY = "2026-09-10";

/** The date `position` days after the plan's start. */
function dayAt(position: number): string {
  const date = new Date(`${START}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + position);
  return date.toISOString().slice(0, 10);
}

const eventId = (n: number) => `e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const rowId = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

type Row = Record<string, unknown>;
type QueryResult = { data: Row[] | null; error: { message: string } | null };

const PLAN: Row = {
  id: PLAN_ID,
  client_id: CLIENT_ID,
  name: "Block A",
  split_type: "Strength",
  effective_from: START,
  effective_until: "2026-09-20",
  updated_at: PLAN_UPDATED_AT,
  deleted_at: null,
  status: "active",
};

/** A column's value on a fixture row, following an embed's dotted path. */
function valueAt(row: Row, column: string): unknown {
  return column
    .split(".")
    .reduce<unknown>(
      (value, key) =>
        value !== null && typeof value === "object" ? (value as Row)[key] : undefined,
      row,
    );
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : 1;
}

/**
 * One chainable read over a fixture table. Awaited, or asked for
 * maybeSingle, it applies the filters, order and range the service built.
 */
function tableQuery(rows: Row[]) {
  const q = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(),
  };
  const selected = (): Row[] => {
    const matching = rows.filter(
      (row) =>
        q.eq.mock.calls.every(([column, value]) => valueAt(row, column) === value) &&
        q.neq.mock.calls.every(([column, value]) => valueAt(row, column) !== value) &&
        q.is.mock.calls.every(([column, value]) => (valueAt(row, column) ?? null) === value) &&
        q.in.mock.calls.every(([column, values]) => values.includes(valueAt(row, column))) &&
        q.gte.mock.calls.every(([column, value]) => compare(valueAt(row, column), value) >= 0) &&
        q.lte.mock.calls.every(([column, value]) => compare(valueAt(row, column), value) <= 0),
    );
    const sorted = [...matching].sort((a, b) => {
      for (const [column, options] of q.order.mock.calls) {
        const order = compare(valueAt(a, column), valueAt(b, column));
        if (order !== 0) return options?.ascending === false ? -order : order;
      }
      return 0;
    });
    const [from, to]: number[] = q.range.mock.lastCall ?? [0, sorted.length];
    return sorted.slice(from, to + 1);
  };
  q.maybeSingle.mockImplementation(() =>
    Promise.resolve({ data: selected()[0] ?? null, error: null }),
  );
  Object.defineProperty(q, "then", {
    value: (resolve: (value: QueryResult) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve<QueryResult>({ data: selected(), error: null }).then(resolve, reject),
  });
  return q;
}

type TableQuery = ReturnType<typeof tableQuery>;
const TABLES = [
  "training_plans",
  "training_events",
  "training_sessions",
  "training_exercises",
] as const;
type Table = (typeof TABLES)[number];

function isTable(name: string): name is Table {
  return (TABLES as readonly string[]).includes(name);
}

/**
 * The tables Edit plan reads: the plan row (PLAN unless given), the client's
 * calendar, the session rows its days point at and their exercises. Every
 * from() gets its own query over the fixture; the reads come back per table.
 */
function mockTables(fixture: {
  plans?: Row[];
  events?: Row[];
  sessions?: Row[];
  exercises?: Row[];
}) {
  const rows: Record<Table, Row[]> = {
    training_plans: fixture.plans ?? [PLAN],
    training_events: fixture.events ?? [],
    training_sessions: fixture.sessions ?? [],
    training_exercises: fixture.exercises ?? [],
  };
  const reads: Record<Table, TableQuery[]> = {
    training_plans: [],
    training_events: [],
    training_sessions: [],
    training_exercises: [],
  };
  mockFrom.mockImplementation((table: string) => {
    if (!isTable(table)) throw new Error(`Unexpected from(): ${table}`);
    const query = tableQuery(rows[table]);
    reads[table].push(query);
    return query as never;
  });
  return reads;
}

function event(id: string, position: number, sessionId: string | null, extra: Row = {}): Row {
  return {
    id,
    client_id: CLIENT_ID,
    training_plan_id: PLAN_ID,
    training_session_id: sessionId,
    date: dayAt(position),
    status: "scheduled",
    session_name: "Snapshot",
    session_focus: null,
    calorie_surplus_percentage: null,
    ...extra,
  };
}

function sessionRow(id: string, name: string, extra: Row = {}): Row {
  return {
    id,
    plan_id: PLAN_ID,
    name,
    focus: null,
    estimated_duration_minutes: null,
    notes: null,
    is_active: true,
    updated_at: ROW_UPDATED_AT,
    // The training_plans!inner(client_id) embed the read is scoped through.
    training_plans: { client_id: CLIENT_ID },
    ...extra,
  };
}

function exerciseRow(
  id: string,
  sessionId: string,
  name: string,
  orderIndex: number,
  extra: Row = {},
): Row {
  return {
    id,
    session_id: sessionId,
    exercise_id: null,
    name,
    order_index: orderIndex,
    sets: 3,
    reps_min: 8,
    reps_max: 10,
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
    prescribed_fields: null,
    is_active: true,
    created_at: ROW_UPDATED_AT,
    updated_at: ROW_UPDATED_AT,
    ...extra,
  };
}

async function open(): Promise<PlanForEditing> {
  const result = await getPlanForEditing(CLIENT_ID, PLAN_ID);
  if (!result) throw new Error("Expected the plan to open");
  return result;
}

/** The day, which must hold a session. */
function sessionDay(day: PlanEditDay | undefined) {
  if (!day || day.isRest) throw new Error(`Expected a session day, got ${JSON.stringify(day)}`);
  return day;
}

const decode = (version: string): unknown =>
  JSON.parse(Buffer.from(version, "base64url").toString("utf8"));
const encode = (version: unknown): string =>
  Buffer.from(JSON.stringify(version), "utf8").toString("base64url");

beforeEach(() => {
  vi.clearAllMocks();
  mockFrom.mockReset();
  mockRpc.mockReset();
  mockRpc.mockResolvedValue({ data: null, error: null } as never);
  vi.mocked(getClientTodayString).mockResolvedValue(TODAY);
  vi.mocked(resolveEventDeletionFloor).mockResolvedValue(TODAY);
  vi.mocked(resolveWindowCap).mockResolvedValue({ stretchesToCap: false, cap: null });
  vi.mocked(fetchVisibleExerciseIds).mockImplementation((_coachId, ids) =>
    Promise.resolve(new Set(ids)),
  );
});

describe("getPlanForEditing", () => {
  it("returns null for a plan that is missing, archived, deleted or another client's", async () => {
    for (const plans of [
      [],
      [{ ...PLAN, status: "archived" }],
      [{ ...PLAN, deleted_at: "2026-09-09T12:00:00+00:00" }],
      [{ ...PLAN, client_id: OTHER_CLIENT_ID }],
    ]) {
      const reads = mockTables({ plans });
      expect(await getPlanForEditing(CLIENT_ID, PLAN_ID)).toBeNull();
      expect(reads.training_events).toHaveLength(0);
    }
  });

  it("refuses a plan that ended before the client's today, and opens one on its last day", async () => {
    const reads = mockTables({});
    vi.mocked(getClientTodayString).mockResolvedValue("2026-09-21");

    await expect(getPlanForEditing(CLIENT_ID, PLAN_ID)).rejects.toThrow(PlanEndedError);
    await expect(getPlanForEditing(CLIENT_ID, PLAN_ID)).rejects.toThrow(
      "This plan has ended and can't be edited.",
    );
    expect(reads.training_events).toHaveLength(0);

    vi.mocked(getClientTodayString).mockResolvedValue("2026-09-20");
    vi.mocked(resolveEventDeletionFloor).mockResolvedValue("2026-09-20");
    expect(await open()).toMatchObject({
      clientToday: "2026-09-20",
      firstEditableDate: "2026-09-20",
    });
  });

  it("lays one day per date from the plan's start to the end of its last whole week", async () => {
    const EXTRA = rowId(1);
    const reads = mockTables({
      // Ten days: the last week runs on past the plan's end.
      plans: [{ ...PLAN, effective_until: "2026-09-16" }],
      sessions: [sessionRow(EXTRA, "Extra")],
      events: [event(eventId(1), 12, EXTRA)],
    });

    const result = await open();

    expect(result.plan).toEqual({
      id: PLAN_ID,
      name: "Block A",
      splitType: "Strength",
      effectiveFrom: START,
      effectiveUntil: "2026-09-16",
    });
    expect(result.clientToday).toBe(TODAY);
    expect(result.days.map((day) => day.date)).toEqual(
      Array.from({ length: 14 }, (_, i) => dayAt(i)),
    );
    expect(result.days.filter((day) => !day.isRest).map((day) => day.date)).toEqual([
      dayAt(12),
    ]);
    const calendar = reads.training_events[0];
    expect(calendar.eq).toHaveBeenCalledWith("client_id", CLIENT_ID);
    expect(calendar.gte).toHaveBeenCalledWith("date", START);
    expect(calendar.lte).toHaveBeenCalledWith("date", "2026-09-20");
  });

  it("gives a day its event's session, read through the row the event points at", async () => {
    const PUSH = rowId(1);
    mockTables({
      sessions: [
        sessionRow(PUSH, "Push", {
          focus: "Chest",
          estimated_duration_minutes: 60,
          notes: "Pause the reps",
        }),
      ],
      events: [
        event(eventId(1), 0, PUSH, { session_name: "Push (as placed)", session_focus: "Upper" }),
      ],
      exercises: [
        exerciseRow("x-dips", PUSH, "Dips", 1),
        exerciseRow("x-bench", PUSH, "Bench press", 0, { sets: 5 }),
        exerciseRow("x-flyes", PUSH, "Flyes", 2, { is_active: false }),
      ],
    });

    const push = sessionDay((await open()).days[0]);

    expect(push).toMatchObject({
      date: START,
      name: "Push",
      focus: "Chest",
      estimatedDurationMinutes: 60,
      notes: "Pause the reps",
    });
    expect(push.exercises.map((exercise) => exercise.name)).toEqual(["Bench press", "Dips"]);
    expect(push.exercises[0]).toMatchObject({
      id: "x-bench",
      sessionId: PUSH,
      orderIndex: 0,
      sets: 5,
    });
  });

  it("reads the row a day points at even when that row is retired", async () => {
    const PUSH = rowId(1);
    mockTables({
      sessions: [sessionRow(PUSH, "Push", { is_active: false })],
      events: [event(eventId(1), 0, PUSH)],
      exercises: [exerciseRow("x-bench", PUSH, "Bench press", 0)],
    });

    const push = sessionDay((await open()).days[0]);

    expect(push.name).toBe("Push");
    expect(push.exercises.map((exercise) => exercise.name)).toEqual(["Bench press"]);
  });

  it("takes a day's surplus from its event, never from the row", async () => {
    const PUSH = rowId(1);
    const PULL = rowId(2);
    mockTables({
      sessions: [
        sessionRow(PUSH, "Push", { calorie_surplus_percentage: 5 }),
        sessionRow(PULL, "Pull", { calorie_surplus_percentage: 20 }),
      ],
      events: [
        event(eventId(1), 0, PUSH, { calorie_surplus_percentage: 15 }),
        event(eventId(2), 3, PULL, { calorie_surplus_percentage: null }),
      ],
    });

    const { days } = await open();

    expect(sessionDay(days[0]).calorieSurplusPercentage).toBe(15);
    expect(sessionDay(days[3]).calorieSurplusPercentage).toBeNull();
  });

  it("shows a moved session on its new day only", async () => {
    const PUSH = rowId(1);
    const PULL = rowId(2);
    mockTables({
      sessions: [
        sessionRow(PUSH, "Push", { week_index: 0, order_index: 0 }),
        // Authored on day 2; the coach moved its day to day 3.
        sessionRow(PULL, "Pull", { week_index: 0, order_index: 2 }),
      ],
      events: [event(eventId(1), 0, PUSH), event(eventId(2), 3, PULL)],
    });

    const { days } = await open();

    expect(days[2]).toEqual({ date: dayAt(2), isRest: true });
    expect(sessionDay(days[3]).name).toBe("Pull");
    expect(days.filter((day) => !day.isRest && day.name === "Pull")).toHaveLength(1);
  });

  it("shows a day whose event was deleted as rest", async () => {
    const LEGS = rowId(1);
    mockTables({
      // The row still sits on day 4; the day's event is gone.
      sessions: [sessionRow(LEGS, "Legs", { week_index: 0, order_index: 4 })],
      exercises: [exerciseRow("x-squat", LEGS, "Back squat", 0)],
    });

    const { days } = await open();

    expect(days[4]).toEqual({ date: dayAt(4), isRest: true });
    expect(days.every((day) => day.isRest)).toBe(true);
  });

  it("shows a day edited 'just this day' as the row its event points at", async () => {
    const LEGS = rowId(1);
    const LEGS_THIS_DAY = rowId(2);
    mockTables({
      sessions: [
        sessionRow(LEGS, "Legs", { week_index: 0, order_index: 4 }),
        // The day's own copy, at the same place in the plan.
        sessionRow(LEGS_THIS_DAY, "Legs (lighter)", {
          week_index: 0,
          order_index: 4,
          focus: "Quads",
          estimated_duration_minutes: 45,
          notes: "Go easy",
        }),
      ],
      events: [event(eventId(1), 4, LEGS_THIS_DAY, { session_name: "Legs" })],
      exercises: [
        exerciseRow("x-back", LEGS, "Back squat", 0),
        exerciseRow("x-goblet", LEGS_THIS_DAY, "Goblet squat", 1),
        exerciseRow("x-split", LEGS_THIS_DAY, "Split squat", 0),
        exerciseRow("x-lunge", LEGS_THIS_DAY, "Lunge", 2, { is_active: false }),
      ],
    });

    const { days } = await open();

    const legs = sessionDay(days[4]);
    expect(legs).toMatchObject({
      name: "Legs (lighter)",
      focus: "Quads",
      estimatedDurationMinutes: 45,
      notes: "Go easy",
    });
    expect(legs.exercises.map((exercise) => exercise.name)).toEqual([
      "Split squat",
      "Goblet squat",
    ]);
    expect(days.filter((day) => !day.isRest)).toHaveLength(1);
  });

  it("lays a day whose row is missing from its event's snapshot, with no exercises", async () => {
    const MISSING = rowId(9);
    mockTables({
      events: [
        event(eventId(1), 1, MISSING, {
          session_name: "Upper",
          session_focus: "Chest",
          calorie_surplus_percentage: 10,
        }),
        event(eventId(2), 2, null, { session_name: "Conditioning" }),
      ],
      // Exercise rows still naming the missing row are not the day's.
      exercises: [exerciseRow("x-bench", MISSING, "Bench press", 0)],
    });

    const { days } = await open();

    expect(days[1]).toEqual({
      date: dayAt(1),
      isRest: false,
      name: "Upper",
      focus: "Chest",
      estimatedDurationMinutes: null,
      notes: null,
      calorieSurplusPercentage: 10,
      exercises: [],
    });
    expect(days[2]).toEqual({
      date: dayAt(2),
      isRest: false,
      name: "Conditioning",
      focus: null,
      estimatedDurationMinutes: null,
      notes: null,
      calorieSurplusPercentage: null,
      exercises: [],
    });
  });

  it("never lays another client's row or event", async () => {
    const THEIRS = rowId(1);
    mockTables({
      sessions: [
        sessionRow(THEIRS, "Theirs", { training_plans: { client_id: OTHER_CLIENT_ID } }),
      ],
      events: [
        event(eventId(1), 0, THEIRS, { session_name: "Mine" }),
        event(eventId(2), 1, THEIRS, { client_id: OTHER_CLIENT_ID }),
      ],
      exercises: [exerciseRow("x-theirs", THEIRS, "Their bench", 0)],
    });

    const { days } = await open();

    expect(days[0]).toMatchObject({ name: "Mine", exercises: [] });
    expect(days[1]).toEqual({ date: dayAt(1), isRest: true });
  });

  it("gives a day holding a logged and a scheduled event the scheduled one", async () => {
    const LOGGED = rowId(1);
    const SCHEDULED = rowId(2);
    mockTables({
      sessions: [sessionRow(LOGGED, "Logged"), sessionRow(SCHEDULED, "Scheduled")],
      // The logged event's id sorts first; the day still shows the scheduled one.
      events: [
        event(eventId(1), 1, LOGGED, { status: "completed" }),
        event(eventId(2), 1, SCHEDULED),
      ],
    });

    const { days } = await open();

    expect(sessionDay(days[1]).name).toBe("Scheduled");
  });

  it("lays the days past the plan's limit as rest, even with an event", async () => {
    const cap: WindowCap = { endsOn: "2026-09-17", source: "next_block" };
    vi.mocked(resolveWindowCap).mockResolvedValue({ stretchesToCap: false, cap });
    const THU = rowId(1);
    const FRI = rowId(2);
    mockTables({
      sessions: [sessionRow(THU, "Thursday"), sessionRow(FRI, "Friday")],
      events: [event(eventId(1), 10, THU), event(eventId(2), 11, FRI)],
    });

    const result = await open();

    expect(result.limit).toEqual(cap);
    expect(result.days).toHaveLength(14);
    expect(sessionDay(result.days[10]).name).toBe("Thursday");
    expect(result.days[11]).toEqual({ date: dayAt(11), isRest: true });
  });

  it("opens from the deletion floor: tomorrow once the client has trained today", async () => {
    vi.mocked(resolveEventDeletionFloor).mockResolvedValue("2026-09-11");
    mockTables({});

    const result = await open();

    expect(result.firstEditableDate).toBe("2026-09-11");
    expect(resolveEventDeletionFloor).toHaveBeenCalledWith(CLIENT_ID, TODAY);
    expect(resolveWindowCap).toHaveBeenCalledWith(CLIENT_ID, START);
  });

  it("never opens before the plan's start", async () => {
    mockTables({
      plans: [{ ...PLAN, effective_from: "2026-09-14", effective_until: "2026-09-27" }],
    });

    const result = await open();

    expect(result.firstEditableDate).toBe("2026-09-14");
    expect(resolveWindowCap).toHaveBeenCalledWith(CLIENT_ID, "2026-09-14");
  });

  it("hands back a version of everything the editor was built from", async () => {
    const PAST = rowId(1);
    const NOW = rowId(2);
    const LATER = rowId(3);
    const MISSING = rowId(9);
    mockTables({
      sessions: [
        sessionRow(PAST, "Past", { updated_at: "2026-09-08T07:00:00+00:00" }),
        sessionRow(NOW, "Now", { updated_at: "2026-09-09T07:00:00+00:00" }),
        sessionRow(LATER, "Later", { updated_at: "2026-09-10T07:00:00+00:00" }),
      ],
      events: [
        event(eventId(1), 1, PAST, { status: "completed", calorie_surplus_percentage: 10 }),
        event(eventId(2), 3, NOW, { calorie_surplus_percentage: 12.5 }),
        event(eventId(3), 9, LATER),
        event(eventId(4), 11, MISSING),
        event(eventId(5), 12, null),
      ],
    });

    const { version } = await open();

    expect(version).toMatch(/^[\w-]+$/);
    expect(decode(version)).toEqual({
      plan_updated_at: PLAN_UPDATED_AT,
      from: TODAY,
      through: "2026-09-20",
      limit: null,
      // From the first editable day only: the save never touches history.
      events: [
        {
          id: eventId(2),
          date: TODAY,
          training_session_id: NOW,
          status: "scheduled",
          calorie_surplus_percentage: 12.5,
        },
        {
          id: eventId(3),
          date: dayAt(9),
          training_session_id: LATER,
          status: "scheduled",
          calorie_surplus_percentage: null,
        },
        {
          id: eventId(4),
          date: dayAt(11),
          training_session_id: MISSING,
          status: "scheduled",
          calorie_surplus_percentage: null,
        },
        {
          id: eventId(5),
          date: dayAt(12),
          training_session_id: null,
          status: "scheduled",
          calorie_surplus_percentage: null,
        },
      ],
      sessions: [
        { id: NOW, updated_at: "2026-09-09T07:00:00+00:00" },
        { id: LATER, updated_at: "2026-09-10T07:00:00+00:00" },
      ],
    });
  });

  it("reaches the version through the plan's own days past its limit, which the save clears", async () => {
    vi.mocked(resolveWindowCap).mockResolvedValue({
      stretchesToCap: false,
      cap: { endsOn: "2026-09-17", source: "next_block" },
    });
    const FRI = rowId(1);
    const reads = mockTables({
      sessions: [sessionRow(FRI, "Friday")],
      events: [event(eventId(1), 11, FRI)],
    });

    const { days, version } = await open();

    expect(days[11]).toEqual({ date: dayAt(11), isRest: true });
    expect(decode(version)).toMatchObject({
      from: TODAY,
      through: "2026-09-20",
      limit: "2026-09-17",
      events: [{ id: eventId(1), date: dayAt(11) }],
      sessions: [{ id: FRI, updated_at: ROW_UPDATED_AT }],
    });
    expect(reads.training_events[0].lte).toHaveBeenCalledWith("date", "2026-09-20");
  });

  it("names a limit past the plan's last week, and reads no further than that week", async () => {
    vi.mocked(resolveWindowCap).mockResolvedValue({
      stretchesToCap: false,
      cap: { endsOn: "2026-09-24", source: "next_plan" },
    });
    const reads = mockTables({});

    const { days, version } = await open();

    expect(days).toHaveLength(14);
    expect(decode(version)).toMatchObject({ through: "2026-09-20", limit: "2026-09-24" });
    expect(reads.training_events[0].lte).toHaveBeenCalledWith("date", "2026-09-20");
  });
});

// =============================================================================
// The save
// =============================================================================

type PlanEditSessionInput = Parameters<typeof savePlanEdit>[0]["sessions"][number];
type Exercise = PlanEditSessionInput["exercises"][number];
type SessionFields = Omit<PlanEditSessionInput, "orderIndex" | "weekIndex" | "isRest">;

const session = (name: string, exercises: Exercise[] = []): SessionFields => ({
  name,
  exercises,
});

/** A canonical grid: slot i is the plan's day i, rest unless `sessions` holds it. */
function grid(
  weeks: number,
  sessions: Partial<Record<number, SessionFields>> = {},
): PlanEditSessionInput[] {
  return Array.from({ length: weeks * 7 }, (_, i) => {
    const place = { orderIndex: i, weekIndex: Math.floor(i / 7) };
    const fields = sessions[i];
    return fields
      ? { ...fields, ...place, isRest: false }
      : { name: "Rest", ...place, isRest: true, exercises: [] };
  });
}

/** The version the read hands out for PLAN on TODAY, before encoding. */
function versionFor(overrides: Record<string, unknown> = {}) {
  return {
    plan_updated_at: PLAN_UPDATED_AT,
    from: TODAY,
    through: "2026-09-20",
    limit: null,
    events: [
      {
        id: eventId(1),
        date: TODAY,
        training_session_id: rowId(1),
        status: "scheduled",
        calorie_surplus_percentage: null,
      },
    ],
    sessions: [{ id: rowId(1), updated_at: ROW_UPDATED_AT }],
    ...overrides,
  };
}

function save(sessions: PlanEditSessionInput[], version = encode(versionFor())) {
  return savePlanEdit({
    clientId: CLIENT_ID,
    coachId: COACH_ID,
    planId: PLAN_ID,
    sessions,
    name: "Block A",
    splitType: "Strength",
    version,
  });
}

/** The one call the save made, and what it sent. */
function rpcArgs(): Record<string, unknown> {
  expect(mockRpc).toHaveBeenCalledTimes(1);
  const [fn, args] = mockRpc.mock.calls[0];
  expect(fn).toBe("edit_training_plan_atomic");
  const sent: unknown = args;
  return sent as Record<string, unknown>;
}

type SaveDay = { date: string; is_rest: boolean; [column: string]: unknown };
const rpcDays = (): SaveDay[] => rpcArgs().p_days as SaveDay[];

/** An exercise as the save writes it, every column it isn't given null. */
function writtenExercise(columns: Record<string, unknown>) {
  return {
    exercise_id: null,
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
    prescribed_fields: null,
    ...columns,
  };
}

describe("savePlanEdit", () => {
  describe("refusals before the write", () => {
    it("refuses a version the read did not hand out", async () => {
      mockTables({});

      for (const version of [
        "not a version",
        encode({ from: TODAY }),
        encode(versionFor({ from: "10 Sep" })),
      ]) {
        await expect(save(grid(2), version)).rejects.toThrow(PlanEditInvalidError);
      }
      expect(mockFrom).not.toHaveBeenCalled();
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("refuses a grid that is not whole weeks in order", async () => {
      mockTables({});
      const twoWeeks = grid(2);
      const swapped = twoWeeks.map((slot, i) =>
        i === 3 ? { ...slot, orderIndex: 4 } : i === 4 ? { ...slot, orderIndex: 3 } : slot,
      );
      const misfiled = twoWeeks.map((slot, i) => (i === 7 ? { ...slot, weekIndex: 0 } : slot));

      for (const sessions of [[], twoWeeks.slice(0, 8), swapped, misfiled]) {
        await expect(save(sessions)).rejects.toThrow(PlanEditInvalidError);
      }
      expect(mockFrom).not.toHaveBeenCalled();
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("refuses a plan that is no longer this client's live plan", async () => {
      mockTables({ plans: [] });

      await expect(save(grid(2))).rejects.toThrow(PlanEditNotFoundError);
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("refuses as stale a plan that has ended since the editor opened", async () => {
      vi.mocked(getClientTodayString).mockResolvedValue("2026-09-21");
      vi.mocked(resolveEventDeletionFloor).mockResolvedValue("2026-09-21");
      mockTables({});

      // The first editable day and the limit agree with the version: the end
      // alone refuses it.
      await expect(
        save(grid(3), encode(versionFor({ from: "2026-09-21" }))),
      ).rejects.toThrow(PlanEditStaleError);
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("refuses as stale when the first editable day moved", async () => {
      // The client logged today's workout after the editor opened.
      vi.mocked(resolveEventDeletionFloor).mockResolvedValue("2026-09-11");
      mockTables({});

      await expect(save(grid(2))).rejects.toThrow(PlanEditStaleError);
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("refuses as stale when the plan's limit appeared, moved or went", async () => {
      mockTables({});
      const cases: Array<{ seen: string | null; now: WindowCap | null }> = [
        { seen: null, now: { endsOn: "2026-09-24", source: "next_block" } },
        { seen: "2026-09-24", now: { endsOn: "2026-09-27", source: "next_plan" } },
        { seen: "2026-09-24", now: null },
      ];

      for (const { seen, now } of cases) {
        vi.mocked(resolveWindowCap).mockResolvedValue({ stretchesToCap: false, cap: now });
        await expect(save(grid(2), encode(versionFor({ limit: seen })))).rejects.toThrow(
          PlanEditStaleError,
        );
      }
      expect(mockRpc).not.toHaveBeenCalled();
    });
  });

  describe("the write", () => {
    it("rewrites the days from the first editable day to the grid's end, in one call", async () => {
      mockTables({});
      const sessions = grid(2, {
        0: session("Mon"),
        1: session("Tue"),
        2: session("Wed"),
        3: session("Thu"),
        9: session("Wed 2"),
      });

      const result = await save(sessions);

      expect(result).toEqual({ firstDay: TODAY, lastDay: "2026-09-20", sessionsWritten: 2 });
      expect(rpcArgs()).toMatchObject({
        p_client_id: CLIENT_ID,
        p_plan_id: PLAN_ID,
        p_first_day: TODAY,
        p_last_day: "2026-09-20",
        p_program_duration_weeks: 2,
        // Over the whole plan, history included: five sessions in two weeks.
        p_frequency_per_week: 3,
      });
      // History is never written: the days start at the first editable day.
      expect(rpcDays().map((day) => day.date)).toEqual(
        Array.from({ length: 11 }, (_, i) => dayAt(3 + i)),
      );
      expect(rpcDays().filter((day) => !day.is_rest).map((day) => [day.date, day.name])).toEqual([
        [TODAY, "Thu"],
        [dayAt(9), "Wed 2"],
      ]);
    });

    it("ends the plan the day before the first editable day when the coach removed every week to come", async () => {
      // Monday of week 2 is the first editable day; the coach kept week 1 alone.
      vi.mocked(getClientTodayString).mockResolvedValue("2026-09-14");
      vi.mocked(resolveEventDeletionFloor).mockResolvedValue("2026-09-14");
      mockTables({ plans: [{ ...PLAN, effective_until: "2026-09-27" }] });
      const version = versionFor({
        from: "2026-09-14",
        through: "2026-09-27",
        events: [],
        sessions: [],
      });

      const result = await save(
        grid(1, { 0: session("Push"), 2: session("Pull"), 4: session("Legs") }),
        encode(version),
      );

      expect(rpcArgs()).toEqual({
        p_client_id: CLIENT_ID,
        p_plan_id: PLAN_ID,
        p_first_day: "2026-09-14",
        p_last_day: "2026-09-13",
        p_name: "Block A",
        p_split_type: "Strength",
        p_program_duration_weeks: 1,
        p_frequency_per_week: 3,
        p_days: [],
        p_version: version,
      });
      expect(result).toEqual({
        firstDay: "2026-09-14",
        lastDay: "2026-09-13",
        sessionsWritten: 0,
      });
    });

    it("never ends the plan before the day before the first editable day", async () => {
      // Wednesday of week 2 is the first editable day, yet the grid stops
      // after week 1: its history days stay the plan's.
      vi.mocked(getClientTodayString).mockResolvedValue("2026-09-16");
      vi.mocked(resolveEventDeletionFloor).mockResolvedValue("2026-09-16");
      mockTables({});

      await save(grid(1, { 0: session("Push") }), encode(versionFor({ from: "2026-09-16" })));

      expect(rpcArgs()).toMatchObject({
        p_first_day: "2026-09-16",
        p_last_day: "2026-09-15",
        p_days: [],
      });
    });

    it("caps an extension at the plan's limit", async () => {
      // The next block starts on the 25th; the coach added week 3.
      vi.mocked(resolveWindowCap).mockResolvedValue({
        stretchesToCap: false,
        cap: { endsOn: "2026-09-24", source: "next_block" },
      });
      mockTables({});
      const sessions = grid(3, {
        0: session("Push"),
        3: session("Pull"),
        15: session("Week 3 A"),
        17: session("Week 3 B"),
        // Past the limit: no day from here on is written.
        19: session("Greyed"),
        20: session("Greyed too"),
      });

      const result = await save(sessions, encode(versionFor({ limit: "2026-09-24" })));

      expect(result).toEqual({ firstDay: TODAY, lastDay: "2026-09-24", sessionsWritten: 3 });
      expect(rpcArgs()).toMatchObject({
        p_first_day: TODAY,
        p_last_day: "2026-09-24",
        p_program_duration_weeks: 3,
        // Over the days the plan keeps: four sessions in three weeks.
        p_frequency_per_week: 1,
      });
      expect(rpcDays().map((day) => day.date)).toEqual(
        Array.from({ length: 15 }, (_, i) => dayAt(3 + i)),
      );
      expect(rpcDays().filter((day) => !day.is_rest).map((day) => day.name)).toEqual([
        "Pull",
        "Week 3 A",
        "Week 3 B",
      ]);
    });

    it("counts the weeks the plan keeps when its limit falls inside it", async () => {
      // A block placed after this plan starts on the 18th.
      vi.mocked(resolveWindowCap).mockResolvedValue({
        stretchesToCap: false,
        cap: { endsOn: "2026-09-17", source: "next_block" },
      });
      mockTables({ plans: [{ ...PLAN, effective_until: "2026-09-27" }] });

      await save(
        grid(3, { 0: session("Push"), 3: session("Pull"), 16: session("Beyond") }),
        encode(versionFor({ through: "2026-09-27", limit: "2026-09-17" })),
      );

      expect(rpcArgs()).toMatchObject({
        p_last_day: "2026-09-17",
        p_program_duration_weeks: 2,
        p_frequency_per_week: 1,
      });
      expect(rpcDays()).toHaveLength(8);
    });

    it("writes each day in the function's columns, with a catalog id the coach can't see unlinked", async () => {
      const MINE = "e1000000-0000-4000-8000-000000000001";
      const NOT_MINE = "e2000000-0000-4000-8000-000000000002";
      const IN_HISTORY = "e3000000-0000-4000-8000-000000000003";
      vi.mocked(fetchVisibleExerciseIds).mockResolvedValue(new Set([MINE]));
      mockTables({});
      const specs = [
        {
          set_number: 1,
          set_type: "working" as const,
          reps_min: 6,
          reps_max: 8,
          load_type: "absolute" as const,
          load_value: 80,
        },
      ];
      const sessions = grid(2, {
        0: session("Push", [{ name: "Bench press", exerciseId: IN_HISTORY, orderIndex: 0, sets: 3 }]),
        3: {
          name: "Pull",
          focus: "Back",
          notes: "Brace",
          estimatedDurationMinutes: 50,
          calorieSurplusPercentage: 12.5,
          exercises: [
            {
              name: "Row",
              exerciseId: MINE,
              orderIndex: 1,
              sets: 4,
              repsMin: 6,
              repsMax: 8,
              repsTarget: "6-8",
              rpeTarget: 8,
              percentage1rm: 75,
              tempo: "3010",
              restSeconds: 120,
              notes: "Pause",
              supersetGroup: "A",
              isWarmup: true,
              setSpecs: specs,
              videoUrl: "https://example.com/row",
              prescribedFields: ["reps", "load"],
            },
            { name: "Pull-up", exerciseId: NOT_MINE, orderIndex: 0, sets: 3 },
            { name: "Face pull", orderIndex: 2, sets: 2 },
          ],
        },
        5: session("Legs"),
      });

      await save(sessions);

      const [pull, rest, legs] = rpcDays();
      expect(pull).toEqual({
        date: TODAY,
        is_rest: false,
        name: "Pull",
        focus: "Back",
        notes: "Brace",
        estimated_duration_minutes: 50,
        calorie_surplus_percentage: 12.5,
        // In the grid's order, however the list arrived.
        exercises: [
          writtenExercise({ name: "Pull-up", order_index: 0, sets: 3 }),
          writtenExercise({
            name: "Row",
            exercise_id: MINE,
            order_index: 1,
            sets: 4,
            reps_min: 6,
            reps_max: 8,
            reps_target: "6-8",
            rpe_target: 8,
            percentage_1rm: 75,
            tempo: "3010",
            rest_seconds: 120,
            notes: "Pause",
            superset_group: "A",
            is_warmup: true,
            set_specs: specs,
            video_url: "https://example.com/row",
            prescribed_fields: ["reps", "load"],
          }),
          writtenExercise({ name: "Face pull", order_index: 2, sets: 2 }),
        ],
      });
      expect(rest).toEqual({ date: dayAt(4), is_rest: true });
      expect(legs).toEqual({
        date: dayAt(5),
        is_rest: false,
        name: "Legs",
        focus: null,
        notes: null,
        estimated_duration_minutes: null,
        calorie_surplus_percentage: null,
        exercises: [],
      });
      // Asked of the written days only: history's exercises are not sent.
      expect(fetchVisibleExerciseIds).toHaveBeenCalledWith(COACH_ID, [MINE, NOT_MINE]);
    });

    it("saves the plan's name, and a plan with no focus as custom", async () => {
      mockTables({});

      await savePlanEdit({
        clientId: CLIENT_ID,
        coachId: COACH_ID,
        planId: PLAN_ID,
        sessions: grid(2),
        name: "Block A (edited)",
        splitType: null,
        version: encode(versionFor()),
      });

      expect(rpcArgs()).toMatchObject({ p_name: "Block A (edited)", p_split_type: "custom" });
    });

    it("accepts the version the read handed out, and sends it back as read", async () => {
      const PULL = rowId(2);
      mockTables({
        sessions: [sessionRow(PULL, "Pull")],
        events: [event(eventId(1), 3, PULL)],
      });
      const opened = await open();

      await save(grid(2, { 3: session("Pull") }), opened.version);

      expect(rpcArgs()).toMatchObject({
        p_first_day: opened.firstEditableDate,
        p_version: decode(opened.version),
      });
    });
  });

  describe("the function's refusals", () => {
    it.each([
      ["a stale: refusal", { code: "P0001", message: "stale: the calendar changed since the editor opened" }],
      ["the live-window exclusion", { code: "23P01", message: "conflicting key value violates exclusion constraint" }],
      ["the one-scheduled-per-day index", { code: "23505", message: "duplicate key value violates unique constraint" }],
    ])("maps %s to stale", async (_label, error) => {
      mockTables({});
      mockRpc.mockResolvedValue({ data: null, error } as never);

      await expect(save(grid(2))).rejects.toThrow(PlanEditStaleError);
    });

    it("maps not_found: to not found", async () => {
      mockTables({});
      mockRpc.mockResolvedValue({
        data: null,
        error: { code: "P0001", message: `not_found: plan ${PLAN_ID} is not a live plan of this client` },
      } as never);

      await expect(save(grid(2))).rejects.toThrow(PlanEditNotFoundError);
    });

    it("turns anything else into a plain failure the route does not echo", async () => {
      mockTables({});

      for (const error of [
        { code: "P0001", message: "invalid: p_days must hold each day from 2026-09-10 to 2026-09-20 once" },
        { message: "canceling statement due to statement timeout" },
      ]) {
        mockRpc.mockResolvedValue({ data: null, error } as never);
        const failure: unknown = await save(grid(2)).catch((caught: unknown) => caught);

        expect(failure).toBeInstanceOf(Error);
        for (const mapped of [
          PlanEditStaleError,
          PlanEditNotFoundError,
          PlanEditInvalidError,
          PlanEndedError,
        ]) {
          expect(failure).not.toBeInstanceOf(mapped);
        }
        expect(failure).toHaveProperty("message", `Failed to save the plan: ${error.message}`);
      }
    });
  });
});
