import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

import { usePhysiqueMetrics, useWellnessMetrics } from "./use-merged-metrics";
import type { Client } from "@/types/check-in";
import type { MeasurementSeries, WellnessSeries } from "@/types/coach-overview";

// The two panes over two mocked series: each pane's figures and log come from
// its own series and nothing else — the Wellness pane's from the client's
// daily log, the Physique pane's from the measurement log — and the cards'
// windows end on the client's today, which the series carries.

type SeriesState<T> = { series: T | null; isLoading: boolean; isError: boolean };
type GoalsState = {
  current: {
    type: "lose_weight";
    targetWeight: number | null;
    targetBodyFatPercentage: number | null;
    deadline: null;
    startReadings: { weight: number | null; bodyFat: number | null };
  } | null;
  isLoading: boolean;
  isError: boolean;
};

let wellness: SeriesState<WellnessSeries>;
let measurements: SeriesState<MeasurementSeries>;
let goals: GoalsState;

vi.mock("@/hooks/use-wellness-series", () => ({ useWellnessSeries: () => wellness }));
vi.mock("@/hooks/use-measurement-series", () => ({ useMeasurementSeries: () => measurements }));
vi.mock("@/hooks/use-client-goals", () => ({ useClientGoals: () => goals }));
// Required, not optional: units-context imports auth-context, which constructs
// the browser Supabase client at module load and throws without env vars.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric", isLoading: false, error: null }),
}));
// The device's day. The client's is a day behind it (a coach ahead of their
// client's time zone), so a window counted from the wrong one shows.
vi.mock("@/lib/date-helpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/date-helpers")>()),
  getTodayDateString: () => "2026-09-20",
}));
const CLIENT_TODAY = "2026-09-19";

const CLIENT_ID = "client-1";
const client = { id: CLIENT_ID, startDate: null } as unknown as Client;

const day = (date: string, value: number, id: string) => ({
  date,
  value,
  id,
  recordedAt: `${date}T21:00:00+00:00`,
});

// Three logged days of sleep — one each side of the week boundary and one a
// fortnight back — and mood on the last of them (one row holds a day's scores).
const WELLNESS: WellnessSeries = {
  mood: [day("2026-09-18", 4, "w-3")],
  energy: [],
  sleep: [day("2026-09-05", 6, "w-1"), day("2026-09-12", 8, "w-2"), day("2026-09-18", 3, "w-3")],
  stress: [],
  soreness: [],
  clientToday: CLIENT_TODAY,
};

const weighIn = (date: string, value: number, id: string) => ({
  date,
  value,
  source: "coach_entry" as const,
  note: null,
  id,
  recordedAt: `${date}T08:00:00+00:00`,
});

const MEASUREMENTS: MeasurementSeries = {
  weight: [weighIn("2026-09-18", 83.9, "m-1")],
  bodyFat: [],
  waist: [],
  hips: [],
  chest: [],
  arms: [],
  thighs: [],
  baseline: {},
  startDate: null,
  readings: [
    {
      id: "m-1",
      metricKey: "weight",
      date: "2026-09-18",
      value: 83.9,
      source: "coach_entry",
      sourceId: null,
      note: null,
      recordedAt: "2026-09-18T08:00:00+00:00",
      updatedAt: "2026-09-18T08:00:00+00:00",
      measuredAt: null,
      voided: null,
    },
  ],
  clientToday: CLIENT_TODAY,
};

beforeEach(() => {
  wellness = { series: WELLNESS, isLoading: false, isError: false };
  measurements = { series: MEASUREMENTS, isLoading: false, isError: false };
  goals = { current: null, isLoading: false, isError: false };
});

describe("useWellnessMetrics — the client's daily log, nothing else", () => {
  it("builds each score's figures from its own days", () => {
    const { result } = renderHook(() => useWellnessMetrics(CLIENT_ID));
    const byId = (id: string) => result.current.metrics.find((m) => m.id === id)!;

    const sleep = byId("sleep");
    expect(sleep.points.map((p) => [p.date, p.value])).toEqual([
      ["2026-09-05", 6],
      ["2026-09-12", 8],
      ["2026-09-18", 3],
    ]);
    // The hero's "logged … ago" counts from the device's day, as before
    expect(sleep.latest).toEqual({ value: 3, date: "2026-09-18", daysAgo: 2 });
    expect(sleep.entryCount).toBe(3);
    // The last 30 days, 21 Aug–19 Sep: (6 + 8 + 3) / 3 = 5.67, shown 5.7
    expect(sleep.lastMonth.current).toBe(5.7);
    // The last 7 days, 13–19 Sep, hold one night: a wellness average needs three
    expect(sleep.lastWeek.current).toBeNull();

    expect(byId("mood").points.map((p) => p.value)).toEqual([4]);
    expect(byId("energy").points).toEqual([]);
  });

  it("lists one row per logged day, newest first, with no action and no note", () => {
    const { result } = renderHook(() => useWellnessMetrics(CLIENT_ID));
    const sleepRows = result.current.logRows.filter((row) => row.metricId === "sleep");

    expect(sleepRows.map((row) => [row.date, row.value, row.change?.amount ?? null])).toEqual([
      ["2026-09-18", 3, -5],
      ["2026-09-12", 8, 2],
      ["2026-09-05", 6, null],
    ]);
    expect(result.current.logRows).toHaveLength(4);
    for (const row of result.current.logRows) {
      expect(row).toMatchObject({ isMeasurement: false, note: null, voided: null, beforeStart: false });
    }
  });

  it("never carries a measurement", () => {
    const { result } = renderHook(() => useWellnessMetrics(CLIENT_ID));
    expect(JSON.stringify(result.current)).not.toContain("83.9");
  });

  it("is loading, or failed, exactly when the wellness series is — and has no figures before it lands", () => {
    measurements = { series: null, isLoading: true, isError: true };
    const { result, rerender } = renderHook(() => useWellnessMetrics(CLIENT_ID));
    expect(result.current).toMatchObject({ isLoading: false, isError: false });

    wellness = { series: null, isLoading: true, isError: false };
    rerender();
    expect(result.current).toMatchObject({ isLoading: true, isError: false, metrics: [], logRows: [] });

    wellness = { series: null, isLoading: false, isError: true };
    rerender();
    expect(result.current).toMatchObject({ isLoading: false, isError: true });
  });

  it("ends every window on the client's today, never the device's", () => {
    // Client's today 19 Sep: the last 7 days are 13–19 Sep, the 7 before 6–12
    // Sep. Counted from the device's 20 Sep, 13 Sep would fall in the week
    // before and leave this week two nights — not enough for an average.
    wellness = {
      series: {
        ...WELLNESS,
        sleep: [
          day("2026-09-06", 5, "w-4"),
          day("2026-09-08", 8, "w-5"),
          day("2026-09-10", 6, "w-6"),
          day("2026-09-13", 9, "w-7"),
          day("2026-09-15", 3, "w-8"),
          day("2026-09-17", 10, "w-9"),
        ],
      },
      isLoading: false,
      isError: false,
    };
    const { result } = renderHook(() => useWellnessMetrics(CLIENT_ID));
    const sleep = result.current.metrics.find((m) => m.id === "sleep")!;

    // 22 / 3 = 7.33…, shown 7.3, against 19 / 3 = 6.33…, shown 6.3
    expect(sleep.lastWeek.current).toBe(7.3);
    expect(sleep.lastWeek.previous).toBe(6.3);
    expect(sleep.lastWeek.change).toMatchObject({ amount: 1, trend: "up", tone: "good" });
  });

  it("gives the hero's Total change as the last 7 days against the first week", () => {
    wellness = {
      series: {
        ...WELLNESS,
        sleep: [
          day("2026-09-01", 6, "w-10"),
          day("2026-09-04", 2, "w-11"),
          day("2026-09-07", 9, "w-12"),
          day("2026-09-10", 3, "w-13"),
          day("2026-09-13", 8, "w-14"),
          day("2026-09-16", 5, "w-15"),
          day("2026-09-19", 1, "w-16"),
        ],
      },
      isLoading: false,
      isError: false,
    };
    const { result } = renderHook(() => useWellnessMetrics(CLIENT_ID));
    const sleep = result.current.metrics.find((m) => m.id === "sleep")!;

    // First week 1–7 Sep: 17 / 3, shown 5.7. Last 7 days 13–19 Sep: 14 / 3,
    // shown 4.7. Never the last entry minus the first (1 − 6).
    expect(sleep.totalChange).toEqual({ kind: "firstWeek", delta: -1, firstWeekOf: "2026-09-01" });
  });

  it("makes card 3 the worst score of the last 30 days — the lowest, the highest where down is good", () => {
    wellness = {
      series: {
        ...WELLNESS,
        stress: [day("2026-08-14", 10, "w-7"), day("2026-09-01", 7, "w-8"), day("2026-09-15", 1, "w-9")],
      },
      isLoading: false,
      isError: false,
    };
    const { result } = renderHook(() => useWellnessMetrics(CLIENT_ID));
    const byId = (id: string) => result.current.metrics.find((m) => m.id === id)!;

    expect(byId("sleep").cardThree).toEqual({ kind: "lowest", worst: { value: 3, date: "2026-09-18" } });
    // 14 Aug's 10 is before the window
    expect(byId("stress").cardThree).toEqual({ kind: "highest", worst: { value: 7, date: "2026-09-01" } });
  });
});

describe("usePhysiqueMetrics — the measurement log, nothing else", () => {
  it("builds the weight from the measurement series and never reads a wellness day", () => {
    wellness = { series: null, isLoading: true, isError: true };
    const { result } = renderHook(() => usePhysiqueMetrics(client));

    const weight = result.current.metrics.find((m) => m.id === "weight")!;
    expect(weight.latest).toEqual({ value: 83.9, date: "2026-09-18", daysAgo: 2 });
    // A measurement counts from one reading: a weekly weigh-in is its week's average
    expect(weight.lastWeek.current).toBe(83.9);
    expect(result.current.logRows.map((row) => row.value)).toEqual([83.9]);
    expect(result.current.metrics.map((m) => m.id)).not.toContain("sleep");
    expect(result.current).toMatchObject({ isLoading: false, isError: false });
  });

  it("has no figures before the measurement series lands: its windows end on the client's today it carries", () => {
    measurements = { series: null, isLoading: true, isError: false };
    const { result } = renderHook(() => usePhysiqueMetrics(client));

    expect(result.current).toMatchObject({ isLoading: true, metrics: [], logRows: [] });
  });

  it("makes card 3 the goal on weight and body fat, and the last 90 days on a girth", () => {
    measurements = {
      series: {
        ...MEASUREMENTS,
        waist: [
          weighIn("2026-05-02", 91.4, "m-2"),
          weighIn("2026-07-11", 88.6, "m-3"),
          weighIn("2026-08-29", 87.2, "m-4"),
        ],
      },
      isLoading: false,
      isError: false,
    };
    const { result } = renderHook(() => usePhysiqueMetrics(client));
    const byId = (id: string) => result.current.metrics.find((m) => m.id === id)!;

    expect(byId("weight").cardThree.kind).toBe("goal");
    expect(byId("bodyFat").cardThree.kind).toBe("goal");
    // The last 90 days are 22 Jun–19 Sep, the 90 before them 24 Mar–21 Jun
    expect(byId("waist").cardThree).toEqual({
      kind: "last90",
      comparison: {
        days: 90,
        current: 87.9,
        previous: 91.4,
        change: { amount: -3.5, trend: "down", tone: "good" },
      },
    });
  });

  it("holds the goal card until the goals read settles, and says why it has no target", () => {
    goals = { current: null, isLoading: true, isError: false };
    const { result, rerender } = renderHook(() => usePhysiqueMetrics(client));
    const weightCard = () => result.current.metrics.find((m) => m.id === "weight")!.cardThree;

    expect(weightCard()).toEqual({ kind: "goal", goal: { status: "pending" } });

    goals = { current: null, isLoading: false, isError: true };
    rerender();
    expect(weightCard()).toEqual({ kind: "goal", goal: { status: "failed" } });

    goals = { current: null, isLoading: false, isError: false };
    rerender();
    expect(weightCard()).toEqual({ kind: "goal", goal: { status: "none" } });

    // The goal in force targets weight alone: a cut to 80.5 kg from 86.2
    goals = {
      current: {
        type: "lose_weight",
        targetWeight: 80.5,
        targetBodyFatPercentage: null,
        deadline: null,
        startReadings: { weight: 86.2, bodyFat: null },
      },
      isLoading: false,
      isError: false,
    };
    rerender();
    // Said as the Overview's goal card says it
    expect(weightCard()).toEqual({
      kind: "goal",
      goal: { status: "set", target: 80.5, progress: { text: "3.4 kg to go", tone: "warning" } },
    });
    expect(result.current.metrics.find((m) => m.id === "bodyFat")!.cardThree).toEqual({
      kind: "goal",
      goal: { status: "none" },
    });
    // The chart's goal line reads the same target
    expect(result.current.metrics.find((m) => m.id === "weight")!.goal).toBe(80.5);
  });
});
