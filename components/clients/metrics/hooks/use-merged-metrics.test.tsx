import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

import { usePhysiqueMetrics, useWellnessMetrics } from "./use-merged-metrics";
import type { Client } from "@/types/check-in";
import type { MeasurementSeries, WellnessSeries } from "@/types/coach-overview";

// The two panes over two mocked series: each pane's figures and log come from
// its own series and nothing else — the Wellness pane's from the client's
// daily log, the Physique pane's from the measurement log.

type SeriesState<T> = { series: T | null; isLoading: boolean; isError: boolean };

let wellness: SeriesState<WellnessSeries>;
let measurements: SeriesState<MeasurementSeries>;

vi.mock("@/hooks/use-wellness-series", () => ({ useWellnessSeries: () => wellness }));
vi.mock("@/hooks/use-measurement-series", () => ({ useMeasurementSeries: () => measurements }));
vi.mock("@/hooks/use-client-goals", () => ({ useClientGoals: () => ({ current: null }) }));
// Required, not optional: units-context imports auth-context, which constructs
// the browser Supabase client at module load and throws without env vars.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric", isLoading: false, error: null }),
}));
vi.mock("@/lib/date-helpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/date-helpers")>()),
  getTodayDateString: () => "2026-09-20",
}));

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
  sleep: [day("2026-09-05", 6, "w-1"), day("2026-09-12", 8, "w-2"), day("2026-09-18", 7, "w-3")],
  stress: [],
  soreness: [],
};

const MEASUREMENTS: MeasurementSeries = {
  weight: [
    { date: "2026-09-18", value: 83.9, source: "coach_entry", note: null, id: "m-1", recordedAt: "2026-09-18T08:00:00+00:00" },
  ],
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
};

beforeEach(() => {
  wellness = { series: WELLNESS, isLoading: false, isError: false };
  measurements = { series: MEASUREMENTS, isLoading: false, isError: false };
});

describe("useWellnessMetrics — the client's daily log, nothing else", () => {
  it("builds each score's figures from its own days", () => {
    const { result } = renderHook(() => useWellnessMetrics(CLIENT_ID));
    const byId = (id: string) => result.current.metrics.find((m) => m.id === id)!;

    const sleep = byId("sleep");
    expect(sleep.points.map((p) => [p.date, p.value])).toEqual([
      ["2026-09-05", 6],
      ["2026-09-12", 8],
      ["2026-09-18", 7],
    ]);
    expect(sleep.latest).toEqual({ value: 7, date: "2026-09-18", daysAgo: 2 });
    expect(sleep.entryCount).toBe(3);
    // The last 7 days against the 7 before, over the days logged in each
    expect(sleep.week).toEqual({ kind: "weekAvg", currentAvg: 7, prevAvg: 8 });

    expect(byId("mood").points.map((p) => p.value)).toEqual([4]);
    expect(byId("energy").points).toEqual([]);
  });

  it("lists one row per logged day, newest first, with no action and no note", () => {
    const { result } = renderHook(() => useWellnessMetrics(CLIENT_ID));
    const sleepRows = result.current.logRows.filter((row) => row.metricId === "sleep");

    expect(sleepRows.map((row) => [row.date, row.value, row.change?.amount ?? null])).toEqual([
      ["2026-09-18", 7, -1],
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

  it("is loading, or failed, exactly when the wellness series is", () => {
    measurements = { series: null, isLoading: true, isError: true };
    const { result, rerender } = renderHook(() => useWellnessMetrics(CLIENT_ID));
    expect(result.current).toMatchObject({ isLoading: false, isError: false });

    wellness = { series: null, isLoading: true, isError: false };
    rerender();
    expect(result.current).toMatchObject({ isLoading: true, isError: false });

    wellness = { series: null, isLoading: false, isError: true };
    rerender();
    expect(result.current).toMatchObject({ isLoading: false, isError: true });
  });
});

describe("usePhysiqueMetrics — the measurement log, nothing else", () => {
  it("builds the weight from the measurement series and never reads a wellness day", () => {
    wellness = { series: null, isLoading: true, isError: true };
    const { result } = renderHook(() => usePhysiqueMetrics(client));

    const weight = result.current.metrics.find((m) => m.id === "weight")!;
    expect(weight.latest).toEqual({ value: 83.9, date: "2026-09-18", daysAgo: 2 });
    expect(result.current.logRows.map((row) => row.value)).toEqual([83.9]);
    expect(result.current.metrics.map((m) => m.id)).not.toContain("sleep");
    expect(result.current).toMatchObject({ isLoading: false, isError: false });
  });
});
