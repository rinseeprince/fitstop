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
import {
  upsertMetricEntry,
  listMetricEntries,
} from "./metric-entries-service";
import type { MetricEntryRow } from "@/types/metric-entries";
import type { MeasurementReading } from "@/lib/measurements/day-values";

type AppendMeasurementsResult = Awaited<ReturnType<typeof appendMeasurements>>;

const mockEntryRow = (overrides: Partial<MetricEntryRow> = {}): MetricEntryRow => ({
  id: "entry-1",
  client_id: "client-1",
  metric_key: "mood",
  value: 4,
  entry_date: "2026-07-20",
  note: null,
  created_by: "coach-1",
  created_at: "2026-07-20T09:00:00.000Z",
  updated_at: "2026-07-20T09:00:00.000Z",
  ...overrides,
});

/** The row the measurement log reports standing for a key after an append. */
const mockReading = (overrides: Partial<MeasurementReading> = {}): MeasurementReading => ({
  id: "m-1",
  metricKey: "waist",
  value: 80,
  date: "2026-07-20",
  recordedAt: "2026-07-20T09:00:00.000Z",
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

const upsertQuery = (row: MetricEntryRow) => ({
  upsert: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue({ data: row, error: null }),
});

const listQuery = (result: { data: unknown; error: unknown }) => ({
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  range: vi.fn().mockReturnThis(),
  then: (resolve: (value: typeof result) => void) =>
    Promise.resolve(result).then(resolve),
});

// One page per await: fetchAllPages re-builds the query each iteration, so the
// thenable serves pages in sequence.
const pagedListQuery = (pages: MetricEntryRow[][]) => {
  let call = 0;
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    then: (resolve: (value: { data: MetricEntryRow[]; error: null }) => void) =>
      Promise.resolve({
        data: pages[Math.min(call++, pages.length - 1)],
        error: null,
      }).then(resolve),
  };
};

// The only table this module still touches is the wellness entries one.
const wireFrom = (entries: ReturnType<typeof upsertQuery>) => {
  vi.mocked(supabaseAdmin.from).mockImplementation((() => entries) as never);
  return { entries };
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
    // One response shape for both stores: the log's row in MetricEntry clothing,
    // dated the day it belongs to and stamped when it was recorded.
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

describe("upsertMetricEntry — a wellness key keeps its replace-per-day row", () => {
  it("upserts on client_id,metric_key,entry_date with the full payload and no created_at", async () => {
    const row = mockEntryRow({ metric_key: "mood", value: 4, note: "am" });
    const { entries } = wireFrom(upsertQuery(row));

    const result = await upsertMetricEntry("client-1", {
      metricKey: "mood",
      value: 4,
      entryDate: "2026-07-20",
      note: "am",
      coachId: "coach-1",
    });

    expect(supabaseAdmin.from).toHaveBeenCalledWith("client_metric_entries");
    expect(entries.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: "client-1",
        metric_key: "mood",
        value: 4,
        entry_date: "2026-07-20",
        note: "am",
        created_by: "coach-1",
        updated_at: expect.any(String),
      }),
      { onConflict: "client_id,metric_key,entry_date" }
    );
    // created_at intentionally absent: insert default applies, conflict-update never touches it.
    expect(entries.upsert.mock.calls[0][0]).not.toHaveProperty("created_at");
    expect(result.id).toBe("entry-1");
    expect(result.note).toBe("am");
  });

  it("writes note: null when note is omitted", async () => {
    const { entries } = wireFrom(upsertQuery(mockEntryRow({ metric_key: "sleep", value: 7 })));

    await upsertMetricEntry("client-1", {
      metricKey: "sleep",
      value: 7,
      entryDate: "2026-07-20",
      coachId: "coach-1",
    });

    expect(entries.upsert.mock.calls[0][0]).toEqual(
      expect.objectContaining({ note: null })
    );
  });

  it("never reaches the measurement log", async () => {
    wireFrom(upsertQuery(mockEntryRow({ metric_key: "mood", value: 4 })));

    await upsertMetricEntry("client-1", {
      metricKey: "mood",
      value: 4,
      entryDate: "2026-07-20",
      coachId: "coach-1",
    });

    expect(appendMeasurements).not.toHaveBeenCalled();
  });
});

describe("listMetricEntries", () => {
  it("filters by client, orders entry_date desc then metric_key asc, and maps rows to camelCase", async () => {
    const rows = [
      mockEntryRow({
        id: "entry-2",
        metric_key: "energy",
        value: 8,
        entry_date: "2026-07-21",
        note: "post-refeed",
      }),
      mockEntryRow(),
    ];
    const query = listQuery({ data: rows, error: null });
    vi.mocked(supabaseAdmin.from).mockReturnValue(query as never);

    const result = await listMetricEntries("client-1");

    expect(supabaseAdmin.from).toHaveBeenCalledWith("client_metric_entries");
    expect(query.eq).toHaveBeenCalledWith("client_id", "client-1");
    expect(query.order).toHaveBeenNthCalledWith(1, "entry_date", {
      ascending: false,
    });
    expect(query.order).toHaveBeenNthCalledWith(2, "metric_key", {
      ascending: true,
    });
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: "entry-2",
      clientId: "client-1",
      metricKey: "energy",
      value: 8,
      entryDate: "2026-07-21",
      note: "post-refeed",
      createdBy: "coach-1",
      createdAt: "2026-07-20T09:00:00.000Z",
      updatedAt: "2026-07-20T09:00:00.000Z",
    });
    // null note/created_by map to undefined (omitted) on the camelCase shape.
    expect(result[1].note).toBeUndefined();
    // A short first page terminates the paged read after one range.
    expect(query.range).toHaveBeenCalledTimes(1);
    expect(query.range).toHaveBeenCalledWith(0, 999);
  });

  it("pages past the ~1000-row PostgREST cap and returns the union", async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) =>
      mockEntryRow({ id: `entry-${i}`, entry_date: "2026-07-01" })
    );
    const shortPage = [mockEntryRow({ id: "entry-tail", entry_date: "2026-06-30" })];
    const query = pagedListQuery([fullPage, shortPage]);
    vi.mocked(supabaseAdmin.from).mockReturnValue(query as never);

    const result = await listMetricEntries("client-1");

    expect(result).toHaveLength(1001);
    expect(result[1000].id).toBe("entry-tail");
    expect(query.range).toHaveBeenNthCalledWith(1, 0, 999);
    expect(query.range).toHaveBeenNthCalledWith(2, 1000, 1999);
  });
});
