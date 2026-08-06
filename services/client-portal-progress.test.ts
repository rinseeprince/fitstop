import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./client-portal-service", () => ({ createPortalClient: vi.fn() }));

import { getClientProgressData } from "./client-portal-progress";
import type { ClientMetricSeries } from "./client-portal-progress";
import { createPortalClient } from "./client-portal-service";

// Minimal fake of the supabase chains getClientProgressData uses:
//   check_ins: .select().eq().gte().order()  (awaited)
//   clients:   .select().eq().single()       (awaited)
function fakeSupabase(opts: {
  checkIns?: unknown[];
  client?: Record<string, unknown> | null;
  clientError?: { message: string } | null;
}) {
  // Captured select strings: the chain ignores its arguments, so fixture columns flow
  // back regardless of what the query asked for. Asserting on these is the only way a
  // test can catch a column missing from the real .select() list.
  const checkInSelects: string[] = [];
  const checkInChain = {
    select: (columns: string) => {
      checkInSelects.push(columns);
      return checkInChain;
    },
    eq: () => checkInChain,
    gte: () => checkInChain,
    order: () => Promise.resolve({ data: opts.checkIns ?? [], error: null }),
  };
  const clientChain = {
    select: () => clientChain,
    eq: () => clientChain,
    single: () =>
      Promise.resolve({ data: opts.client ?? null, error: opts.clientError ?? null }),
  };
  return {
    from: (table: string) => (table === "check_ins" ? checkInChain : clientChain),
    checkInSelects,
  };
}

describe("getClientProgressData unit resolution", () => {
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

    expect(result.client.weightUnit).toBe("kg");
    expect(result.client.measurementUnit).toBe("cm");
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

    expect(result.client.weightUnit).toBe("kg");
    expect(result.client.measurementUnit).toBe("cm");
  });

  // The historic bug: this query selected a column that does not exist, PostgREST
  // rejected the whole thing, clientData came back null and every metric client
  // silently fell back to lbs/in. The request must still surface the error.
  it("logs and does not throw when the client query errors (no silent fallback bug)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(createPortalClient).mockResolvedValue(
      fakeSupabase({ client: null, clientError: { message: "boom" } }) as never,
    );

    const result = await getClientProgressData("c1");

    expect(result.client.weightUnit).toBe("kg");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

// Two check-ins a week apart with weight + mood, so the Weight series has a
// computed percentChange/trend and the date column can be asserted as raw ISO.
const TWO_WEIGHT_CHECK_INS = [
  { created_at: "2026-05-01T08:00:00+00:00", weight: 80, mood: 4 },
  { created_at: "2026-05-08T08:00:00+00:00", weight: 79, mood: 3 },
];

describe("getClientProgressData render-ready series", () => {
  beforeEach(() => vi.clearAllMocks());

  function findSeries(
    series: ClientMetricSeries[],
    id: string,
  ): ClientMetricSeries {
    const found = series.find((s) => s.id === id);
    if (!found) throw new Error(`series ${id} not found`);
    return found;
  }

  it("builds a Weight series: current = last point, computed change/trend, ISO chartData dates", async () => {
    vi.mocked(createPortalClient).mockResolvedValue(
      fakeSupabase({
        checkIns: TWO_WEIGHT_CHECK_INS,
        client: { unit_preference: "imperial" },
      }) as never,
    );

    const result = await getClientProgressData("c1");
    const weight = findSeries(result.bodyMetrics, "weight");

    expect(weight.name).toBe("Weight");
    expect(weight.unit).toBe("kg");
    expect(weight.currentValue).toBe(79); // last point
    // (79 - 80) / 80 * 100 = -1.25, rounded to 1dp by the helper -> -1.3
    expect(weight.percentChange).toBe(-1.3);
    expect(weight.trend).toBe("down");
    expect(weight.chartData).toHaveLength(2);
    // Raw ISO date (YYYY-MM-DD), NOT a "MMM d" render label.
    expect(weight.chartData[1].date).toBe("2026-05-08");
    expect(weight.chartData[0]).toEqual({ date: "2026-05-01", value: 80 });
  });

  it("labels Weight 'kg' and measurement series 'cm' (canonical storage)", async () => {
    vi.mocked(createPortalClient).mockResolvedValue(
      fakeSupabase({
        checkIns: [
          { created_at: "2026-05-01T08:00:00+00:00", weight: 80, waist: 90 },
        ],
        client: { unit_preference: "metric" },
      }) as never,
    );

    const result = await getClientProgressData("c1");

    expect(findSeries(result.bodyMetrics, "weight").unit).toBe("kg");
    expect(findSeries(result.bodyMetrics, "waist").unit).toBe("cm");
  });

  it("returns every series present with empty defaults when there is no history", async () => {
    vi.mocked(createPortalClient).mockResolvedValue(
      fakeSupabase({ checkIns: [], client: { unit_preference: "imperial" } }) as never,
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

  it("assigns the wellness units the hook used (mood /5, the rest /10)", async () => {
    vi.mocked(createPortalClient).mockResolvedValue(
      fakeSupabase({ checkIns: [], client: null }) as never,
    );

    const result = await getClientProgressData("c1");

    expect(findSeries(result.wellnessMetrics, "mood").unit).toBe("/5");
    expect(findSeries(result.wellnessMetrics, "energy").unit).toBe("/10");
    expect(findSeries(result.wellnessMetrics, "sleep").unit).toBe("/10");
    expect(findSeries(result.wellnessMetrics, "stress").unit).toBe("/10");
    expect(findSeries(result.wellnessMetrics, "soreness").unit).toBe("/10");
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
    expect(fake.checkInSelects.some((columns) => columns.includes("soreness"))).toBe(true);

    const soreness = findSeries(result.wellnessMetrics, "soreness");
    expect(soreness.currentValue).toBe(4);
    expect(soreness.trend).toBe("down");
    expect(soreness.chartData).toEqual([
      { date: "2026-05-01", value: 7 },
      { date: "2026-05-08", value: 4 },
    ]);
  });
});
