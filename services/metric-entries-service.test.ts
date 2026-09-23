import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("./measurements-service", () => ({ appendMeasurements: vi.fn() }));
// Mocked so a recompute issued from THIS module would be visible: the energy
// pair follows the measurement log's append (when the row is the client's
// newest), and nothing here may trigger a second one.
vi.mock("./client-energy-service", () => ({
  recalculateClientEnergy: vi.fn().mockResolvedValue({ status: "written" }),
}));

import { supabaseAdmin } from "./supabase-admin";
import { appendMeasurements } from "./measurements-service";
import { recalculateClientEnergy } from "./client-energy-service";
import { upsertMetricEntry } from "./metric-entries-service";
import type { MeasurementReading } from "@/lib/measurements/day-values";

type AppendMeasurementsResult = Awaited<ReturnType<typeof appendMeasurements>>;

/** The row the measurement log reports standing for a key after an append. */
const mockReading = (overrides: Partial<MeasurementReading> = {}): MeasurementReading => ({
  id: "m-1",
  metricKey: "waist",
  value: 80,
  date: "2026-07-20",
  recordedAt: "2026-07-20T09:00:00.000Z",
  updatedAt: "2026-07-20T09:00:00.000Z",
  measuredAt: null,
  source: "coach_entry",
  sourceId: null,
  note: null,
  ...overrides,
});

const appended = (reading: MeasurementReading): AppendMeasurementsResult => {
  const rows: AppendMeasurementsResult["rows"] = {};
  rows[reading.metricKey] = reading;
  return { rows, inserted: [reading.metricKey], unchanged: [], energy: "not_newest" };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(appendMeasurements).mockReset();
});

describe("upsertMetricEntry — a physique key appends to the measurement log", () => {
  it("appends the value as a coach entry dated the entry day and returns the standing row", async () => {
    vi.mocked(appendMeasurements).mockResolvedValue(
      appended(mockReading({ id: "m-waist", metricKey: "waist", value: 80, note: "am" }))
    );

    // 80 in, 80 out. The Log-measurement dialog converts from the viewer's
    // unit BEFORE sending (CONVENTIONS §20); this module used to multiply a
    // girth by 2.54 on top, and a value that reaches the log as 203.2 is the
    // regression this pins against.
    const result = await upsertMetricEntry("client-1", {
      metricKey: "waist",
      value: 80,
      entryDate: "2026-07-20",
      note: "am",
      coachId: "coach-1",
    });

    expect(appendMeasurements).toHaveBeenCalledWith({
      clientId: "client-1",
      source: "coach_entry",
      recordedOn: "2026-07-20",
      values: { waist: 80 },
      note: "am",
      createdBy: "coach-1",
    });
    // The log's row in the entry shape, dated the day it belongs to and
    // stamped when it was recorded.
    expect(result).toEqual({
      id: "m-waist",
      clientId: "client-1",
      metricKey: "waist",
      value: 80,
      entryDate: "2026-07-20",
      note: "am",
      createdBy: "coach-1",
      createdAt: "2026-07-20T09:00:00.000Z",
      updatedAt: "2026-07-20T09:00:00.000Z",
    });
  });

  it("writes note: null and createdBy: null when neither is supplied", async () => {
    vi.mocked(appendMeasurements).mockResolvedValue(
      appended(mockReading({ metricKey: "weight", value: 82.5 }))
    );

    await upsertMetricEntry("client-1", {
      metricKey: "weight",
      value: 82.5,
      entryDate: "2026-07-20",
    });

    expect(appendMeasurements).toHaveBeenCalledWith(
      expect.objectContaining({ values: { weight: 82.5 }, note: null, createdBy: null })
    );
  });

  it("touches no table and recomputes no energy of its own — the log owns both", async () => {
    // No dual-write: the seven physique keys have ONE store. The energy pair
    // recomputes inside the append when the row is the client's newest, so a
    // second trigger here could only disagree with it.
    vi.mocked(appendMeasurements).mockResolvedValue(
      appended(mockReading({ metricKey: "weight", value: 82.5 }))
    );

    await upsertMetricEntry("client-1", {
      metricKey: "weight",
      value: 82.5,
      entryDate: "2026-07-20",
      coachId: "coach-1",
    });

    expect(supabaseAdmin.from).not.toHaveBeenCalled();
    expect(recalculateClientEnergy).not.toHaveBeenCalled();
  });

  it("surfaces a failed append rather than reporting a saved entry", async () => {
    vi.mocked(appendMeasurements).mockRejectedValueOnce(
      new Error("Failed to record measurements: boom")
    );

    await expect(
      upsertMetricEntry("client-1", {
        metricKey: "weight",
        value: 82.5,
        entryDate: "2026-07-20",
        coachId: "coach-1",
      })
    ).rejects.toThrow("Failed to record measurements: boom");
  });

  it("throws when the log reports no row standing for the key", async () => {
    vi.mocked(appendMeasurements).mockResolvedValue({
      rows: {},
      inserted: [],
      unchanged: [],
      energy: "nothing_inserted",
    });

    await expect(
      upsertMetricEntry("client-1", {
        metricKey: "weight",
        value: 82.5,
        entryDate: "2026-07-20",
        coachId: "coach-1",
      })
    ).rejects.toThrow("Failed to save measurement");
  });
});
