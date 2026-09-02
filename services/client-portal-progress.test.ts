import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./client-portal-service", () => ({ createPortalClient: vi.fn() }));
// The module reads CLIENT_MEASUREMENT_EMBEDS from the real measurements
// service, whose supabase-admin import needs env at load. Stub that client and
// the energy helper rather than the service, so the embed string the clients
// select is asserted against below is the real one, not a copy that could drift.
vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("./client-energy-service", () => ({ recalculateClientEnergy: vi.fn() }));

import { getClientProgressData } from "./client-portal-progress";
import type { ClientMetricSeries } from "./client-portal-progress";
import { createPortalClient } from "./client-portal-service";

/** A `client_measurements_live` row as the portal's select returns it. */
type LiveRow = {
  id: string;
  metric_key: string;
  value: number;
  recorded_on: string;
  recorded_at: string;
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
  measured_at: null,
  source: "check_in",
  source_id: null,
  note: null,
  ...overrides,
});

// Minimal fake of the three supabase chains getClientProgressData uses:
//   check_ins:                .select().eq().gte().order()                     (awaited)
//   client_measurements_live: .select().eq().gte().order()×3.range(from, to)    (awaited, paged)
//   clients:                  .select().eq().single()                           (awaited)
function fakeSupabase(opts: {
  checkIns?: unknown[];
  readings?: LiveRow[];
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
    clients: [],
  };
  const rangeCalls: Array<[number, number]> = [];
  const checkInChain = {
    select: (columns: string) => {
      selects.check_ins.push(columns);
      return checkInChain;
    },
    eq: () => checkInChain,
    gte: () => checkInChain,
    order: () => Promise.resolve({ data: opts.checkIns ?? [], error: null }),
  };
  const readingChain = {
    select: (columns: string) => {
      selects.client_measurements_live.push(columns);
      return readingChain;
    },
    eq: () => readingChain,
    gte: () => readingChain,
    order: () => readingChain,
    // Fewer rows than a page come back, so fetchAllPages stops after one call.
    range: (from: number, to: number) => {
      rangeCalls.push([from, to]);
      return Promise.resolve({ data: opts.readings ?? [], error: null });
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
      if (table === "clients") return clientChain;
      throw new Error(`unexpected read of ${table}`);
    },
    selects,
    rangeCalls,
  };
}

function findSeries(series: ClientMetricSeries[], id: string): ClientMetricSeries {
  const found = series.find((s) => s.id === id);
  if (!found) throw new Error(`series ${id} not found`);
  return found;
}

describe("getClientProgressData — the client row", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns canonical kg + cm and surfaces goals/streak", async () => {
    vi.mocked(createPortalClient).mockResolvedValue(
      fakeSupabase({
        client: {
          current_streak: 6,
          check_in_adherence_rate: 92,
          goal_weight: 78,
        },
      }) as never,
    );

    const result = await getClientProgressData("c1");

    // The payload carries NO unit at all now: values are canonical kg/cm and
    // the label is resolved at the render boundary from the viewer's preference.
    expect(result.client).not.toHaveProperty("weightUnit");
    expect(result.client).not.toHaveProperty("measurementUnit");
    expect(result.currentStreak).toBe(6);
    expect(result.adherenceRate).toBe(92);
    expect(result.client.goalWeight).toBe(78);
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
        goal_weight: 78,
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

  it("two rows on one day collapse to ONE point carrying the later recorded_at's value", async () => {
    // Rule 2: the coach correcting after the check-in wins. The ids are chosen
    // so the EARLIER row sorts last by id — a fallback to id order, or to
    // arrival order, would pick 80.6.
    vi.mocked(createPortalClient).mockResolvedValue(
      fakeSupabase({
        readings: [
          reading("m-2", "weight", 80.6, "2026-05-01", "2026-05-01T07:00:00+00:00"),
          reading("m-1", "weight", 80.2, "2026-05-01", "2026-05-01T18:00:00+00:00", {
            source: "coach_entry",
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
    for (const column of ["id", "metric_key", "value", "recorded_on", "recorded_at", "source"]) {
      expect(select).toContain(column);
    }
  });

  it("a check-in's own columns never feed a physique series — only the log does; wellness still comes from check-ins", async () => {
    vi.mocked(createPortalClient).mockResolvedValue(
      fakeSupabase({
        checkIns: [{ created_at: "2026-05-01T08:00:00+00:00", weight: 80, mood: 4 }],
        readings: [],
        client: null,
      }) as never,
    );

    const result = await getClientProgressData("c1");

    expect(result.weightHistory).toEqual([]);
    expect(findSeries(result.bodyMetrics, "weight").currentValue).toBeNull();
    expect(findSeries(result.wellnessMetrics, "mood").currentValue).toBe(4);
    expect(result.checkInCount).toBe(1);
  });
});

describe("getClientProgressData — render-ready series", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns every series present with empty defaults when there is no history", async () => {
    vi.mocked(createPortalClient).mockResolvedValue(
      fakeSupabase({ checkIns: [], readings: [], client: { unit_preference: "imperial" } }) as never,
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
      fakeSupabase({ checkIns: [], client: null }) as never,
    );

    const result = await getClientProgressData("c1");

    const ids = result.wellnessMetrics.map((m) => m.id).sort();
    expect(ids).toEqual(["energy", "mood", "sleep", "soreness", "stress"]);
    expect(result.wellnessMetrics.every((m) => !("unit" in m))).toBe(true);
  });

  it("selects soreness from check_ins and builds its series from the rows", async () => {
    const fake = fakeSupabase({
      checkIns: [
        { created_at: "2026-05-01T08:00:00+00:00", soreness: 7 },
        { created_at: "2026-05-08T08:00:00+00:00", soreness: 4 },
      ],
      client: null,
    });
    vi.mocked(createPortalClient).mockResolvedValue(fake as never);

    const result = await getClientProgressData("c1");

    // The fake ignores select strings, so the wire query is only guarded here.
    expect(fake.selects.check_ins.some((columns) => columns.includes("soreness"))).toBe(true);

    const soreness = findSeries(result.wellnessMetrics, "soreness");
    expect(soreness.currentValue).toBe(4);
    expect(soreness.trend).toBe("down");
    expect(soreness.chartData).toEqual([
      { date: "2026-05-01", value: 7 },
      { date: "2026-05-08", value: 4 },
    ]);
  });
});
