import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("./measurements-service", () => ({
  getMeasurementSeries: vi.fn(),
  getBaseline: vi.fn(),
}));

import { supabaseAdmin } from "./supabase-admin";
import {
  getBaseline,
  getMeasurementSeries,
  type StandingReading,
} from "./measurements-service";
import {
  getMeasurementSeriesPayload,
  toMeasurementSeries,
} from "./measurement-series-service";
import {
  MEASUREMENT_KEYS,
  type MeasurementKey,
  type MeasurementSource,
} from "@/lib/measurements/keys";
import type { DayValue } from "@/lib/measurements/day-values";

const dayValue = (
  id: string,
  metricKey: MeasurementKey,
  date: string,
  value: number,
  extra: Partial<DayValue> = {}
): DayValue => ({
  id,
  metricKey,
  value,
  date,
  recordedAt: `${date}T08:00:00+00:00`,
  measuredAt: null,
  source: "check_in",
  sourceId: null,
  note: null,
  ...extra,
});

const standing = (
  id: string,
  metricKey: MeasurementKey,
  date: string,
  value: number,
  source: MeasurementSource = "intake"
): StandingReading => ({ id, metricKey, value, date, source });

describe("toMeasurementSeries", () => {
  it("emits every one of the seven metrics, empty when the log holds no reading for it", () => {
    const series = toMeasurementSeries(
      new Map<MeasurementKey, DayValue[]>([
        ["weight", [dayValue("m-1", "weight", "2026-07-06", 90)]],
      ]),
      {},
      "2026-03-01"
    );

    for (const key of MEASUREMENT_KEYS) {
      expect(Array.isArray(series[key])).toBe(true);
    }
    expect(series.weight).toHaveLength(1);
    expect(series.bodyFat).toEqual([]);
    expect(series.thighs).toEqual([]);
    // Nothing else rides along: the seven series, the baseline, the start date.
    expect(Object.keys(series).sort()).toEqual(
      [...MEASUREMENT_KEYS, "baseline", "startDate"].sort()
    );
  });

  it("maps each day-value to the point shape — date, value, source, note, id, recordedAt — in the order given", () => {
    const series = toMeasurementSeries(
      new Map<MeasurementKey, DayValue[]>([
        [
          "waist",
          [
            dayValue("m-1", "waist", "2026-07-06", 84.5, {
              source: "client_log",
              note: "post-run",
              measuredAt: "2026-07-06T06:30:00+00:00",
              sourceId: "log-9",
            }),
            dayValue("m-2", "waist", "2026-07-13", 84),
          ],
        ],
      ]),
      {},
      null
    );

    expect(series.waist).toEqual([
      {
        date: "2026-07-06",
        value: 84.5,
        source: "client_log",
        note: "post-run",
        id: "m-1",
        recordedAt: "2026-07-06T08:00:00+00:00",
      },
      {
        date: "2026-07-13",
        value: 84,
        source: "check_in",
        note: null,
        id: "m-2",
        recordedAt: "2026-07-13T08:00:00+00:00",
      },
    ]);
  });

  it("carries the baseline per metric — value, date, source, id — and nothing for a metric without one", () => {
    const series = toMeasurementSeries(
      new Map(),
      {
        weight: standing("m-0", "weight", "2026-02-20", 92),
        waist: standing("m-3", "waist", "2026-03-01", 86, "check_in"),
      },
      "2026-03-01"
    );

    expect(series.baseline).toEqual({
      weight: { value: 92, date: "2026-02-20", source: "intake", id: "m-0" },
      waist: { value: 86, date: "2026-03-01", source: "check_in", id: "m-3" },
    });
    expect(series.baseline.bodyFat).toBeUndefined();
  });

  it("carries the start date through, null included", () => {
    expect(toMeasurementSeries(new Map(), {}, "2026-03-01").startDate).toBe("2026-03-01");
    expect(toMeasurementSeries(new Map(), {}, null).startDate).toBeNull();
  });
});

/** A `clients` builder whose `.maybeSingle()` resolves to `row`. */
function wireStartDateRead(
  row: { start_date: string | null } | null,
  error: unknown = null
) {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.maybeSingle = vi.fn().mockResolvedValue({ data: row, error });
  vi.mocked(supabaseAdmin.from).mockReturnValue(builder as never);
  return builder;
}

describe("getMeasurementSeriesPayload", () => {
  beforeEach(() => {
    vi.mocked(getMeasurementSeries).mockReset();
    vi.mocked(getBaseline).mockReset();
    vi.mocked(supabaseAdmin.from).mockReset();
  });

  it("reads the series, the baseline and the start date for the one client, and assembles them", async () => {
    vi.mocked(getMeasurementSeries).mockResolvedValue(
      new Map<MeasurementKey, DayValue[]>([
        ["weight", [dayValue("m-1", "weight", "2026-07-06", 90)]],
      ])
    );
    vi.mocked(getBaseline).mockResolvedValue({
      weight: standing("m-0", "weight", "2026-02-20", 92),
    });
    const builder = wireStartDateRead({ start_date: "2026-03-01" });

    const payload = await getMeasurementSeriesPayload("client-1");

    expect(getMeasurementSeries).toHaveBeenCalledWith("client-1");
    expect(getBaseline).toHaveBeenCalledWith("client-1");
    expect(supabaseAdmin.from).toHaveBeenCalledWith("clients");
    expect(builder.select).toHaveBeenCalledWith("start_date");
    expect(builder.eq).toHaveBeenCalledWith("id", "client-1");

    expect(payload.startDate).toBe("2026-03-01");
    expect(payload.weight.map((point) => point.value)).toEqual([90]);
    expect(payload.baseline.weight).toEqual({
      value: 92,
      date: "2026-02-20",
      source: "intake",
      id: "m-0",
    });
  });

  it("reads a client without a start date as null", async () => {
    vi.mocked(getMeasurementSeries).mockResolvedValue(new Map());
    vi.mocked(getBaseline).mockResolvedValue({});
    wireStartDateRead({ start_date: null });

    expect((await getMeasurementSeriesPayload("client-1")).startDate).toBeNull();
  });

  it("throws when the start-date read errors, rather than assembling a journey with no start", async () => {
    vi.mocked(getMeasurementSeries).mockResolvedValue(new Map());
    vi.mocked(getBaseline).mockResolvedValue({});
    wireStartDateRead(null, { message: "connection reset" });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(getMeasurementSeriesPayload("client-1")).rejects.toThrow(
      "Failed to read measurement data"
    );
    consoleError.mockRestore();
  });
});
