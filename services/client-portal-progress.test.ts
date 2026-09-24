import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./client-portal-service", () => ({ createPortalClient: vi.fn() }));
// The goal is not on the client row: it is the goal in force on the client's
// today, with the readings on its start day, read through the goals service.
vi.mock("./client-goals-service", () => ({
  getGoalsOverview: vi.fn().mockResolvedValue({ current: null, planned: [], clientToday: "2026-09-24" }),
}));
// The series' window counts back from the client's today.
vi.mock("./today-service", () => ({ getClientTodayString: vi.fn().mockResolvedValue("2026-09-24") }));
// The module reads CLIENT_MEASUREMENT_EMBEDS from the real measurements
// service, whose supabase-admin import needs env at load. Stub that client and
// the energy helper rather than the service, so the embed string the clients
// select is asserted against below is the real one, not a copy that could drift.
vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("./client-energy-service", () => ({ recalculateClientEnergy: vi.fn() }));

import { getClientProgressData } from "./client-portal-progress";
import type { ClientMetricSeries } from "./client-portal-progress";
import { createPortalClient } from "./client-portal-service";
import { getGoalsOverview } from "./client-goals-service";
import { getClientTodayString } from "./today-service";
import { supabaseAdmin } from "./supabase-admin";
import type { CurrentGoal } from "@/types/client-goals";
import type { WellnessKey } from "@/lib/wellness/keys";

/** A `client_measurements_live` row as the portal's select returns it. */
type LiveRow = {
  id: string;
  metric_key: string;
  value: number;
  recorded_on: string;
  recorded_at: string;
  updated_at: string;
  measured_at: string | null;
  source: string;
  source_id: string | null;
  note: string | null;
};

const reading = (
  id: string,
  metricKey: string,
  value: number,
  recordedOn: string,
  recordedAt = `${recordedOn}T08:00:00+00:00`,
  overrides: Partial<LiveRow> = {}
): LiveRow => ({
  id,
  metric_key: metricKey,
  value,
  recorded_on: recordedOn,
  recorded_at: recordedAt,
  // Untouched since it was written, unless a test says otherwise.
  updated_at: recordedAt,
  measured_at: null,
  source: "check_in",
  source_id: null,
  note: null,
  ...overrides,
});

/** A `wellness_logs` row as the portal's select returns it. */
type LogRow = { id: string; date: string; updated_at: string } & Record<WellnessKey, number | null>;

const logRow = (id: string, date: string, values: Partial<Record<WellnessKey, number>>): LogRow => ({
  id,
  date,
  updated_at: `${date}T21:00:00+00:00`,
  mood: null,
  energy: null,
  sleep: null,
  stress: null,
  soreness: null,
  ...values,
});

// Minimal fake of the four supabase chains getClientProgressData uses:
//   check_ins:                .select(columns, { count, head }).eq().gte()     (awaited: a count)
//   client_measurements_live: .select().eq().gte().order()×3.range(from, to)    (awaited, paged)
//   wellness_logs:            .select().eq().gte().order()×2.range(from, to)    (awaited, paged)
//   clients:                  .select().eq().single()                           (awaited)
function fakeSupabase(opts: {
  checkInCount?: number;
  checkInError?: { message: string } | null;
  // What a check-in in the window carries. The read counts check-ins and
  // takes none of their columns, so only a read that went back to their
  // figures would ever see these rows.
  checkIns?: unknown[];
  readings?: LiveRow[];
  wellness?: LogRow[];
  wellnessError?: { message: string } | null;
  client?: Record<string, unknown> | null;
  clientError?: { message: string } | null;
}) {
  // Captured select strings: the chains ignore their arguments, so fixture
  // columns flow back regardless of what the query asked for. Asserting on
  // these is the only way a test can catch a column (or an embed) missing
  // from the real .select() list.
  const selects: Record<string, string[]> = {
    check_ins: [],
    client_measurements_live: [],
    wellness_logs: [],
    clients: [],
  };
  const checkInSelectOptions: unknown[] = [];
  // Each log read's lower bound, as [column, value].
  const bounds: Record<string, Array<[string, string]>> = {
    client_measurements_live: [],
    wellness_logs: [],
  };
  const rangeCalls: Array<[number, number]> = [];
  const wellnessRead = {
    scope: [] as Array<[string, string]>,
    orders: [] as Array<[string, unknown]>,
    rangeCalls: [] as Array<[number, number]>,
  };
  // PostgREST answers a failed count with no count.
  const checkInResult = () => ({
    count: opts.checkInError ? null : opts.checkInCount ?? 0,
    data: opts.checkIns ?? [],
    error: opts.checkInError ?? null,
  });
  const checkInChain = {
    select: (columns: string, options?: unknown) => {
      selects.check_ins.push(columns);
      checkInSelectOptions.push(options);
      return checkInChain;
    },
    eq: () => checkInChain,
    // Awaited as the count; `.order()` is there for a read of the rows.
    gte: () =>
      Object.assign(Promise.resolve(checkInResult()), {
        order: () => Promise.resolve(checkInResult()),
      }),
  };
  const readingChain = {
    select: (columns: string) => {
      selects.client_measurements_live.push(columns);
      return readingChain;
    },
    eq: () => readingChain,
    gte: (column: string, value: string) => {
      bounds.client_measurements_live.push([column, value]);
      return readingChain;
    },
    order: () => readingChain,
    // Fewer rows than a page come back, so fetchAllPages stops after one call.
    range: (from: number, to: number) => {
      rangeCalls.push([from, to]);
      return Promise.resolve({ data: opts.readings ?? [], error: null });
    },
  };
  const wellnessChain = {
    select: (columns: string) => {
      selects.wellness_logs.push(columns);
      return wellnessChain;
    },
    eq: (column: string, value: string) => {
      wellnessRead.scope.push([column, value]);
      return wellnessChain;
    },
    gte: (column: string, value: string) => {
      bounds.wellness_logs.push([column, value]);
      return wellnessChain;
    },
    order: (column: string, options: unknown) => {
      wellnessRead.orders.push([column, options]);
      return wellnessChain;
    },
    range: (from: number, to: number) => {
      wellnessRead.rangeCalls.push([from, to]);
      return Promise.resolve(
        opts.wellnessError
          ? { data: null, error: opts.wellnessError }
          : { data: opts.wellness ?? [], error: null }
      );
    },
  };
  const clientChain = {
    select: (columns: string) => {
      selects.clients.push(columns);
      return clientChain;
    },
    eq: () => clientChain,
    single: () =>
      Promise.resolve({ data: opts.client ?? null, error: opts.clientError ?? null }),
  };
  return {
    from: (table: string) => {
      if (table === "check_ins") return checkInChain;
      if (table === "client_measurements_live") return readingChain;
      if (table === "wellness_logs") return wellnessChain;
      if (table === "clients") return clientChain;
      throw new Error(`unexpected read of ${table}`);
    },
    selects,
    checkInSelectOptions,
    bounds,
    rangeCalls,
    wellnessRead,
  };
}

/** The goal in force on the client's today, as the goals service returns it. */
const goalNow = (overrides: Partial<CurrentGoal> = {}) => ({
  current: {
    id: "goal-now",
    clientId: "c1",
    name: "Lose weight",
    type: "lose_weight" as const,
    targetWeight: null,
    targetBodyFatPercentage: null,
    description: null,
    startsOn: "2026-04-06",
    source: "coach" as const,
    setBy: "coach-1",
    createdAt: "2026-04-06T09:00:00+00:00",
    updatedAt: "2026-04-06T09:00:00+00:00",
    deadline: null,
    startReadings: { weight: null, bodyFat: null },
    ...overrides,
  },
  planned: [],
  clientToday: "2026-09-24",
});
const NO_GOAL = { current: null, planned: [], clientToday: "2026-09-24" };

function findSeries(series: ClientMetricSeries[], id: string): ClientMetricSeries {
  const found = series.find((s) => s.id === id);
  if (!found) throw new Error(`series ${id} not found`);
  return found;
}

describe("getClientProgressData — the client row", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGoalsOverview).mockResolvedValue(NO_GOAL);
  });

  it("returns canonical kg + cm and surfaces goals/streak", async () => {
    vi.mocked(createPortalClient).mockResolvedValue(
      fakeSupabase({
        client: {
          current_streak: 6,
          check_in_adherence_rate: 92,
        },
      }) as never,
    );
    vi.mocked(getGoalsOverview).mockResolvedValue(goalNow({ targetWeight: 78 }));

    const result = await getClientProgressData("c1");

    // The payload carries NO unit at all now: values are canonical kg/cm and
    // the label is resolved at the render boundary from the viewer's preference.
    expect(result.client).not.toHaveProperty("weightUnit");
    expect(result.client).not.toHaveProperty("measurementUnit");
    expect(result.currentStreak).toBe(6);
    expect(result.adherenceRate).toBe(92);
    expect(result.client.goalWeight).toBe(78);
  });

  // GET /api/client/progress is the React Native contract: `client.goalWeight`
  // and `client.goalBodyFatPercentage` keep their names, their places and their
  // units, and now come from the goal in force on the client's today; the
  // goal's type and its start readings are added after them (commit 8d4).
  it("takes the goal's targets from the goal in force on the client's today, in their places", async () => {
    vi.mocked(createPortalClient).mockResolvedValue(fakeSupabase({ client: {} }) as never);
    vi.mocked(getGoalsOverview).mockResolvedValue(
      goalNow({ targetWeight: 71.6, targetBodyFatPercentage: 14.5 })
    );

    const result = await getClientProgressData("c1");

    expect(getGoalsOverview).toHaveBeenCalledWith("c1");
    expect(result.client.goalWeight).toBe(71.6);
    expect(result.client.goalBodyFatPercentage).toBe(14.5);
    expect(Object.keys(result.client)).toEqual([
      "goalWeight",
      "goalBodyFatPercentage",
      "startingWeight",
      "startingBodyFatPercentage",
      "currentWeight",
      "currentBodyFatPercentage",
      "goalType",
      "goalStartWeight",
      "goalStartBodyFatPercentage",
    ]);
  });

  it("carries the goal's type and the client's readings on its start day — which way it points", async () => {
    vi.mocked(createPortalClient).mockResolvedValue(fakeSupabase({ client: {} }) as never);
    vi.mocked(getGoalsOverview).mockResolvedValue(
      goalNow({ type: "build_muscle", targetWeight: 83.7, startReadings: { weight: 76.9, bodyFat: 18.2 } })
    );

    const result = await getClientProgressData("c1");

    expect(result.client.goalType).toBe("build_muscle");
    expect(result.client.goalStartWeight).toBe(76.9);
    expect(result.client.goalStartBodyFatPercentage).toBe(18.2);
  });

  it("omits a target the goal does not set, and everything when no goal is in force", async () => {
    vi.mocked(createPortalClient).mockResolvedValue(fakeSupabase({ client: {} }) as never);
    vi.mocked(getGoalsOverview).mockResolvedValue(
      goalNow({ type: "recomposition", targetBodyFatPercentage: 13.5 })
    );

    const bodyFatOnly = await getClientProgressData("c1");
    expect(bodyFatOnly.client.goalWeight).toBeUndefined();
    expect(bodyFatOnly.client.goalBodyFatPercentage).toBe(13.5);
    // No reading on the goal's start day: none on the wire.
    expect(bodyFatOnly.client.goalStartBodyFatPercentage).toBeUndefined();

    vi.mocked(getGoalsOverview).mockResolvedValue(NO_GOAL);
    const none = await getClientProgressData("c1");
    expect(none.client.goalWeight).toBeUndefined();
    expect(none.client.goalBodyFatPercentage).toBeUndefined();
    expect(none.client.goalType).toBeUndefined();
  });

  // Replaces the old "returns lbs + in for an imperial client". Since migration
  // 141 these labels describe what is STORED, not what the viewer prefers, so an
  // imperial client must still get kg/cm here — Phase 3 converts at render. If a
  // preference ever leaks back into the stored-unit label, this fails.
  it("returns kg + cm even for an imperial client (preference never leaks)", async () => {
    vi.mocked(createPortalClient).mockResolvedValue(
      fakeSupabase({ client: { unit_preference: "imperial" } }) as never,
    );

    const result = await getClientProgressData("c1");

    expect(result.client).not.toHaveProperty("weightUnit");
    expect(result.client).not.toHaveProperty("measurementUnit");
  });

  it("reads 'now' and the baseline from the two embedded views — no weight column on clients", async () => {
    const fake = fakeSupabase({
      client: {
        client_current_measurements: [
          { metric_key: "weight", value: 79.3, recorded_on: "2026-05-08", source: "check_in", measurement_id: "m-9" },
          { metric_key: "bodyFat", value: 18.5, recorded_on: "2026-05-08", source: "check_in", measurement_id: "m-10" },
        ],
        client_baseline_measurements: [
          { metric_key: "weight", value: 84, recorded_on: "2026-01-05", source: "intake", measurement_id: "m-1" },
        ],
      },
    });
    vi.mocked(createPortalClient).mockResolvedValue(fake as never);

    const result = await getClientProgressData("c1");

    expect(result.client.currentWeight).toBe(79.3);
    expect(result.client.currentBodyFatPercentage).toBe(18.5);
    expect(result.client.startingWeight).toBe(84);
    // No baseline body fat: absent, never 0 or the current reading.
    expect(result.client.startingBodyFatPercentage).toBeUndefined();
    // The fake ignores select strings, so the wire query is only guarded here:
    // both views ride in on the clients read, and the dropped columns stay gone.
    const clientSelect = fake.selects.clients[0];
    expect(clientSelect).toContain("client_current_measurements(");
    expect(clientSelect).toContain("client_baseline_measurements(");
    expect(clientSelect).not.toContain("current_weight");
    expect(clientSelect).not.toContain("starting_weight");
    // The profile carries no goal: a goal column named here is a PostgREST 400.
    expect(clientSelect).not.toContain("goal_");
  });

  // The historic bug: this query selected a column that does not exist, PostgREST
  // rejected the whole thing, clientData came back null and every metric client
  // silently fell back to lbs/in. The request must still surface the error.
  it("logs and does not throw when the client query errors (no silent fallback bug)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(createPortalClient).mockResolvedValue(
      fakeSupabase({ client: null, clientError: { message: "boom" } }) as never,
    );

    await getClientProgressData("c1");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("getClientProgressData — physique histories come from the measurement log", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a weight row on a day reaches weightHistory dated that day; the series' current value is the last day-value", async () => {
    vi.mocked(createPortalClient).mockResolvedValue(
      fakeSupabase({
        readings: [
          reading("m-1", "weight", 80, "2026-05-01"),
          reading("m-2", "weight", 79, "2026-05-08"),
        ],
        client: null,
      }) as never,
    );

    const result = await getClientProgressData("c1");

    expect(result.weightHistory).toEqual([
      { date: "2026-05-01", weight: 80 },
      { date: "2026-05-08", weight: 79 },
    ]);
    const weight = result.bodyMetrics[0];
    expect(weight.id).toBe("weight");
    expect(weight.name).toBe("Weight");
    expect(weight.currentValue).toBe(79); // the last day-value
    // (79 - 80) / 80 * 100 = -1.25, rounded to 1dp by the helper -> -1.3
    expect(weight.percentChange).toBe(-1.3);
    expect(weight.trend).toBe("down");
    // Raw ISO date (YYYY-MM-DD), NOT a "MMM d" render label.
    expect(weight.chartData).toEqual([
      { date: "2026-05-01", value: 80 },
      { date: "2026-05-08", value: 79 },
    ]);
  });

  it("two rows on one day collapse to ONE point carrying the value of the row written last — an edit never moves a reading", async () => {
    // Rule 2 (D23): the reading written last wins. The check-in's row was
    // written first and edited last; its id sorts higher and the arrival order
    // puts it last — a fallback to updated_at, to id order or to arrival order
    // would each pick 80.6.
    vi.mocked(createPortalClient).mockResolvedValue(
      fakeSupabase({
        readings: [
          reading("m-1", "weight", 80.2, "2026-05-01", "2026-05-01T18:00:00+00:00", {
            source: "coach_entry",
          }),
          reading("m-2", "weight", 80.6, "2026-05-01", "2026-05-01T07:00:00+00:00", {
            updated_at: "2026-05-01T20:00:00+00:00",
          }),
        ],
        client: null,
      }) as never,
    );

    const result = await getClientProgressData("c1");

    expect(result.weightHistory).toEqual([{ date: "2026-05-01", weight: 80.2 }]);
    expect(result.bodyMetrics[0].currentValue).toBe(80.2);
    expect(result.bodyMetrics[0].chartData).toHaveLength(1);
  });

  it("routes each physique key to its own history under the wire's field name", async () => {
    vi.mocked(createPortalClient).mockResolvedValue(
      fakeSupabase({
        readings: [
          reading("m-1", "bodyFat", 18, "2026-05-01"),
          reading("m-2", "waist", 90, "2026-05-01"),
          reading("m-3", "hips", 98, "2026-05-01"),
          reading("m-4", "chest", 101, "2026-05-01"),
          reading("m-5", "arms", 36, "2026-05-01"),
          reading("m-6", "thighs", 58, "2026-05-01"),
        ],
        client: null,
      }) as never,
    );

    const result = await getClientProgressData("c1");

    expect(result.weightHistory).toEqual([]);
    expect(result.bodyFatHistory).toEqual([{ date: "2026-05-01", bodyFatPercentage: 18 }]);
    expect(result.bodyMeasurements).toEqual({
      waistHistory: [{ date: "2026-05-01", waist: 90 }],
      hipsHistory: [{ date: "2026-05-01", hips: 98 }],
      chestHistory: [{ date: "2026-05-01", chest: 101 }],
      armsHistory: [{ date: "2026-05-01", arms: 36 }],
      thighsHistory: [{ date: "2026-05-01", thighs: 58 }],
    });
    expect(findSeries(result.bodyMetrics, "bodyFat").currentValue).toBe(18);
    expect(findSeries(result.bodyMetrics, "thighs").currentValue).toBe(58);
    // The payload carries no unit at all — that is what stops a preference
    // leaking into stored-value territory. Values stay canonical.
    expect(result.bodyMetrics[0]).not.toHaveProperty("unit");
  });

  it("reads the log paged, with every column the day rule needs", async () => {
    const fake = fakeSupabase({ readings: [reading("m-1", "weight", 80, "2026-05-01")], client: null });
    vi.mocked(createPortalClient).mockResolvedValue(fake as never);

    await getClientProgressData("c1");

    // A series feeds an aggregate, so it must be complete past PostgREST's cap.
    expect(fake.rangeCalls).toEqual([[0, 999]]);
    const select = fake.selects.client_measurements_live[0];
    for (const column of ["id", "metric_key", "value", "recorded_on", "recorded_at", "updated_at", "source"]) {
      expect(select).toContain(column);
    }
  });
});

describe("getClientProgressData — wellness histories come from the client's daily log", () => {
  beforeEach(() => vi.clearAllMocks());

  it("each wellness series is the log, one point per logged day — a check-in in the window is counted, never charted", async () => {
    const fake = fakeSupabase({
      checkInCount: 1,
      // The week's figures a check-in in the window carries — on no chart.
      checkIns: [{ created_at: "2026-05-10T08:00:00+00:00", weight: 80, mood: 4, sleep: 7 }],
      wellness: [
        // Arrival order is not date order.
        logRow("w-2", "2026-05-12", { mood: 5, sleep: 9 }),
        logRow("w-1", "2026-05-11", { mood: 2 }),
      ],
      client: null,
    });
    vi.mocked(createPortalClient).mockResolvedValue(fake as never);

    const result = await getClientProgressData("c1");

    const mood = findSeries(result.wellnessMetrics, "mood");
    expect(mood.chartData).toEqual([
      { date: "2026-05-11", value: 2 },
      { date: "2026-05-12", value: 5 },
    ]);
    // The card: the last logged day, against the logged day before it.
    expect(mood.currentValue).toBe(5);
    expect(mood.percentChange).toBe(150);
    expect(mood.trend).toBe("up");
    expect(findSeries(result.wellnessMetrics, "sleep").chartData).toEqual([{ date: "2026-05-12", value: 9 }]);
    // The check-in is counted; neither its scores nor its weight are charted.
    expect(result.checkInCount).toBe(1);
    const charted = result.wellnessMetrics.flatMap((series) => series.chartData.map((point) => point.value));
    expect(charted).not.toContain(4);
    expect(charted).not.toContain(7);
    expect(result.weightHistory).toEqual([]);
    // The check-in read counts rows and takes none of their columns.
    expect(fake.selects.check_ins).toEqual(["id"]);
    expect(fake.checkInSelectOptions).toEqual([{ count: "exact", head: true }]);
  });

  it("a day without a score is no point of that score — the day's other scores stand", async () => {
    vi.mocked(createPortalClient).mockResolvedValue(
      fakeSupabase({
        wellness: [
          logRow("w-3", "2026-05-13", { sleep: 8, stress: 3 }),
          logRow("w-4", "2026-05-14", { mood: 1, soreness: 6 }),
        ],
        client: null,
      }) as never,
    );

    const result = await getClientProgressData("c1");

    expect(findSeries(result.wellnessMetrics, "mood").chartData).toEqual([{ date: "2026-05-14", value: 1 }]);
    expect(findSeries(result.wellnessMetrics, "sleep").chartData).toEqual([{ date: "2026-05-13", value: 8 }]);
    expect(findSeries(result.wellnessMetrics, "stress").chartData).toEqual([{ date: "2026-05-13", value: 3 }]);
    expect(findSeries(result.wellnessMetrics, "soreness").chartData).toEqual([{ date: "2026-05-14", value: 6 }]);
    const energy = findSeries(result.wellnessMetrics, "energy");
    expect(energy.chartData).toEqual([]);
    expect(energy.currentValue).toBeNull();
  });

  it("the window is on the client's calendar — the log and the measurements start on the same day, `days` before the client's today", async () => {
    const fake = fakeSupabase({ client: null });
    vi.mocked(createPortalClient).mockResolvedValue(fake as never);
    // Late on the 24th by the server's clock; the client, east of UTC, is on
    // the 25th already.
    vi.mocked(getClientTodayString).mockResolvedValueOnce("2026-09-25");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-24T23:30:00Z"));

    try {
      await getClientProgressData("c1", 30);
    } finally {
      vi.useRealTimers();
    }

    expect(getClientTodayString).toHaveBeenCalledWith("c1");
    expect(fake.bounds.wellness_logs).toEqual([["date", "2026-08-26"]]);
    expect(fake.bounds.client_measurements_live).toEqual([["recorded_on", "2026-08-26"]]);
  });

  it("reads the log under the client's own session: every score's column, this client's rows, in date order, paged", async () => {
    const fake = fakeSupabase({ wellness: [logRow("w-5", "2026-05-15", { energy: 10 })], client: null });
    vi.mocked(createPortalClient).mockResolvedValue(fake as never);

    const result = await getClientProgressData("c1");

    // The session client, never the service role: the client reads their own
    // rows through clients_select_own_wellness_logs.
    expect(fake.selects.wellness_logs).toHaveLength(1);
    expect(supabaseAdmin.from).not.toHaveBeenCalledWith("wellness_logs");
    expect(fake.selects.wellness_logs[0].split(",").map((column) => column.trim())).toEqual(
      expect.arrayContaining(["id", "date", "mood", "energy", "sleep", "stress", "soreness", "updated_at"])
    );
    expect(fake.wellnessRead.scope).toEqual([["client_id", "c1"]]);
    expect(fake.wellnessRead.orders).toEqual([
      ["date", { ascending: true }],
      ["id", { ascending: true }],
    ]);
    // A series feeds an aggregate, so it must be complete past PostgREST's cap.
    expect(fake.wellnessRead.rangeCalls).toEqual([[0, 999]]);
    expect(findSeries(result.wellnessMetrics, "energy").currentValue).toBe(10);
  });

  it("a failed log read fails the request rather than drawing empty charts", async () => {
    vi.mocked(createPortalClient).mockResolvedValue(
      fakeSupabase({ wellnessError: { message: "connection reset" }, client: null }) as never,
    );

    await expect(getClientProgressData("c1")).rejects.toThrow(
      "Failed to fetch wellness logs: connection reset"
    );
  });

  it("a failed check-in count is logged, and the tile reads 0", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(createPortalClient).mockResolvedValue(
      fakeSupabase({ checkInCount: 3, checkInError: { message: "count timed out" }, client: null }) as never,
    );

    const result = await getClientProgressData("c1");

    expect(result.checkInCount).toBe(0);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("check-ins"), "count timed out");
    spy.mockRestore();
  });
});

describe("getClientProgressData — render-ready series", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns every series present with empty defaults when there is no history", async () => {
    vi.mocked(createPortalClient).mockResolvedValue(
      fakeSupabase({ readings: [], wellness: [], client: { unit_preference: "imperial" } }) as never,
    );

    const result = await getClientProgressData("c1");

    expect(result.bodyMetrics.map((s) => s.id)).toEqual([
      "weight",
      "bodyFat",
      "waist",
      "hips",
      "chest",
      "arms",
      "thighs",
    ]);
    expect(result.wellnessMetrics.map((s) => s.id)).toEqual([
      "mood",
      "energy",
      "sleep",
      "stress",
      "soreness",
    ]);
    for (const s of [...result.bodyMetrics, ...result.wellnessMetrics]) {
      expect(s.currentValue).toBeNull();
      expect(s.chartData).toEqual([]);
      expect(s.trend).toBe("stable");
      expect(s.percentChange).toBeNull();
    }
  });

  // The wellness unit labels (mood /5, the rest /10) moved to the render
  // boundary with everything else — metrics-hub.tsx owns them now, so the
  // service only has to name and shape the series.
  it("names every wellness series without attaching a unit", async () => {
    vi.mocked(createPortalClient).mockResolvedValue(
      fakeSupabase({ client: null }) as never,
    );

    const result = await getClientProgressData("c1");

    const ids = result.wellnessMetrics.map((m) => m.id).sort();
    expect(ids).toEqual(["energy", "mood", "sleep", "soreness", "stress"]);
    expect(result.wellnessMetrics.every((m) => !("unit" in m))).toBe(true);
  });
});
