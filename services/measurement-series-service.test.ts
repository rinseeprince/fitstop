import { describe, it, expect, vi } from "vitest";

vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("./today-service", () => ({ getClientTodayString: vi.fn() }));

import { buildMeasurementSeries } from "./measurement-series-service";

const checkIn = (id: string, createdAt: string, weight?: number, bodyFat?: number) => ({
  id,
  created_at: createdAt,
  weight: weight ?? null,
  body_fat_percentage: bodyFat ?? null,
});

const entry = (id: string, date: string, key: string, value: number) => ({
  id,
  entry_date: date,
  metric_key: key,
  value,
  note: null,
});

describe("buildMeasurementSeries", () => {
  it("merges check-ins and coach entries into one ascending series per metric", () => {
    const series = buildMeasurementSeries(
      [
        checkIn("ci-1", "2026-07-20T09:00:00Z", 90.4, 24),
        checkIn("ci-2", "2026-07-27T09:00:00Z", 89.1, 23.4),
      ],
      [entry("e-1", "2026-07-24", "weight", 89.8)]
    );

    expect(series.weight).toEqual([
      { date: "2026-07-20", value: 90.4 },
      { date: "2026-07-24", value: 89.8 },
      { date: "2026-07-27", value: 89.1 },
    ]);
    expect(series.bodyFat).toEqual([
      { date: "2026-07-20", value: 24 },
      { date: "2026-07-27", value: 23.4 },
    ]);
  });

  it("sorts a coach entry AFTER that day's check-in, so it wins the tie for latest", () => {
    // The whole reason this shares buildMetricPoints rather than re-merging:
    // the tie-break is `date | source rank | timestamp | id`, and re-writing it
    // here is how this chart and the Physique chart start disagreeing about
    // which value is current on a day both sources touched.
    const series = buildMeasurementSeries(
      [checkIn("ci-1", "2026-07-20T23:00:00Z", 90.4)],
      [entry("e-1", "2026-07-20", "weight", 89.0)]
    );

    expect(series.weight.map((p) => p.value)).toEqual([90.4, 89.0]);
  });

  it("keeps both readings on a shared date rather than collapsing them", () => {
    const series = buildMeasurementSeries(
      [checkIn("ci-1", "2026-07-20T09:00:00Z", 90.4)],
      [entry("e-1", "2026-07-20", "weight", 89.0)]
    );

    expect(series.weight).toHaveLength(2);
  });

  it("skips a check-in that recorded neither metric", () => {
    const series = buildMeasurementSeries(
      [checkIn("ci-1", "2026-07-20T09:00:00Z"), checkIn("ci-2", "2026-07-21T09:00:00Z", 88)],
      []
    );

    expect(series.weight).toEqual([{ date: "2026-07-21", value: 88 }]);
    expect(series.bodyFat).toEqual([]);
  });

  it("ignores an entry whose metric this chart does not offer", () => {
    const series = buildMeasurementSeries([], [entry("e-1", "2026-07-20", "waist", 82)]);

    expect(series.weight).toEqual([]);
    expect(series.bodyFat).toEqual([]);
  });

  it("returns empty series rather than throwing when the window holds nothing", () => {
    expect(buildMeasurementSeries([], [])).toEqual({ weight: [], bodyFat: [] });
  });
});
