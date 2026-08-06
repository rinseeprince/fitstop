import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("./body-metrics-service", () => ({
  getLatestBodyMetrics: vi.fn(),
  recordBodyMetrics: vi.fn(),
}));

import { supabaseAdmin } from "./supabase-admin";
import {
  getLatestBodyMetrics,
  recordBodyMetrics,
} from "./body-metrics-service";
import {
  upsertMetricEntry,
  listMetricEntries,
} from "./metric-entries-service";
import type { MetricEntryRow } from "@/types/metric-entries";

const mockEntryRow = (overrides: Partial<MetricEntryRow> = {}): MetricEntryRow => ({
  id: "entry-1",
  client_id: "client-1",
  metric_key: "weight",
  value: 82.5,
  entry_date: "2026-07-20",
  note: null,
  created_by: "coach-1",
  created_at: "2026-07-20T09:00:00.000Z",
  updated_at: "2026-07-20T09:00:00.000Z",
  ...overrides,
});

const upsertQuery = (row: MetricEntryRow) => ({
  upsert: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue({ data: row, error: null }),
});

const listQuery = (result: { data: unknown; error: unknown }) => ({
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  then: (resolve: (value: typeof result) => void) =>
    Promise.resolve(result).then(resolve),
});

// The service no longer reads `clients` at all — migration 141 removed the
// weight_unit lookup — so this only needs to wire the entries table.
const wireFrom = (entries: ReturnType<typeof upsertQuery>) => {
  vi.mocked(supabaseAdmin.from).mockImplementation((() => entries) as never);
  return { entries };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getLatestBodyMetrics).mockResolvedValue(null);
  vi.mocked(recordBodyMetrics).mockResolvedValue({} as never);
});

describe("upsertMetricEntry", () => {
  it("upserts on client_id,metric_key,entry_date with the full payload and no created_at", async () => {
    const row = mockEntryRow({ metric_key: "waist", value: 86.36, note: "am" });
    const { entries } = wireFrom(upsertQuery(row));

    // 34 inches — the unit the coach's Log-measurement dialog still labels the
    // field with — stored as its canonical 86.36 cm (migration 141).
    const result = await upsertMetricEntry("client-1", {
      metricKey: "waist",
      value: 34,
      entryDate: "2026-07-20",
      note: "am",
      coachId: "coach-1",
    });

    expect(entries.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: "client-1",
        metric_key: "waist",
        value: expect.closeTo(34 * 2.54, 6),
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
    const { entries } = wireFrom(upsertQuery(mockEntryRow({ metric_key: "waist" })));

    await upsertMetricEntry("client-1", {
      metricKey: "waist",
      value: 84,
      entryDate: "2026-07-20",
      coachId: "coach-1",
    });

    expect(entries.upsert.mock.calls[0][0]).toEqual(
      expect.objectContaining({ note: null })
    );
  });

  it("dual-writes a current weight entry with updateClientCache: true", async () => {
    const row = mockEntryRow({ id: "entry-w", entry_date: "2026-07-20" });
    wireFrom(upsertQuery(row));
    vi.mocked(getLatestBodyMetrics).mockResolvedValue({
      recordedAt: "2026-07-15T12:00:00.000Z",
    } as never);

    await upsertMetricEntry("client-1", {
      metricKey: "weight",
      value: 82.5,
      entryDate: "2026-07-20",
      coachId: "coach-1",
    });

    expect(getLatestBodyMetrics).toHaveBeenCalledWith("client-1", {
      requireFields: ["weight"],
    });
    expect(recordBodyMetrics).toHaveBeenCalledWith({
      clientId: "client-1",
      weight: 82.5,
      bodyFatPercentage: undefined,
      source: "coach_entry",
      sourceId: "entry-w",
      recordedAt: "2026-07-20T12:00:00.000Z",
      updateClientCache: true,
    });
  });

  it("dual-writes a backdated weight entry with updateClientCache: false", async () => {
    const row = mockEntryRow({ entry_date: "2026-07-10" });
    wireFrom(upsertQuery(row));
    vi.mocked(getLatestBodyMetrics).mockResolvedValue({
      recordedAt: "2026-07-15T12:00:00.000Z",
    } as never);

    await upsertMetricEntry("client-1", {
      metricKey: "weight",
      value: 81,
      entryDate: "2026-07-10",
      coachId: "coach-1",
    });

    expect(recordBodyMetrics).toHaveBeenCalledWith(
      expect.objectContaining({ updateClientCache: false })
    );
  });

  it("treats a weight entry as current when no prior body-metrics events exist", async () => {
    wireFrom(upsertQuery(mockEntryRow()));
    vi.mocked(getLatestBodyMetrics).mockResolvedValue(null);

    await upsertMetricEntry("client-1", {
      metricKey: "weight",
      value: 82.5,
      entryDate: "2026-07-20",
      coachId: "coach-1",
    });

    expect(recordBodyMetrics).toHaveBeenCalledWith(
      expect.objectContaining({ updateClientCache: true })
    );
  });

  it("dual-writes a bodyFat entry as bodyFatPercentage without weight", async () => {
    const row = mockEntryRow({ id: "entry-bf", metric_key: "bodyFat", value: 18.2 });
    wireFrom(upsertQuery(row));

    await upsertMetricEntry("client-1", {
      metricKey: "bodyFat",
      value: 18.2,
      entryDate: "2026-07-20",
      coachId: "coach-1",
    });

    expect(getLatestBodyMetrics).toHaveBeenCalledWith("client-1", {
      requireFields: ["body_fat_percentage"],
    });
    const params = vi.mocked(recordBodyMetrics).mock.calls[0][0];
    expect(params.bodyFatPercentage).toBe(18.2);
    expect(params.weight).toBeUndefined();
    expect(params.sourceId).toBe("entry-bf");
  });

  it("does not dual-write girth or wellness entries", async () => {
    wireFrom(upsertQuery(mockEntryRow({ metric_key: "waist" })));
    await upsertMetricEntry("client-1", {
      metricKey: "waist",
      value: 84,
      entryDate: "2026-07-20",
      coachId: "coach-1",
    });

    wireFrom(upsertQuery(mockEntryRow({ metric_key: "mood", value: 4 })));
    await upsertMetricEntry("client-1", {
      metricKey: "mood",
      value: 4,
      entryDate: "2026-07-20",
      coachId: "coach-1",
    });

    expect(getLatestBodyMetrics).not.toHaveBeenCalled();
    expect(recordBodyMetrics).not.toHaveBeenCalled();
  });

  it("still resolves with the entry when the body-metrics dual-write throws", async () => {
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    wireFrom(upsertQuery(mockEntryRow()));
    vi.mocked(recordBodyMetrics).mockRejectedValue(new Error("dual-write boom"));

    const result = await upsertMetricEntry("client-1", {
      metricKey: "weight",
      value: 82.5,
      entryDate: "2026-07-20",
      coachId: "coach-1",
    });

    expect(result.id).toBe("entry-1");
    expect(result.value).toBe(82.5);
    consoleSpy.mockRestore();
  });
});

describe("listMetricEntries", () => {
  it("filters by client, orders entry_date desc then metric_key asc, and maps rows to camelCase", async () => {
    const rows = [
      mockEntryRow({
        id: "entry-2",
        metric_key: "bodyFat",
        value: 18.2,
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
      metricKey: "bodyFat",
      value: 18.2,
      entryDate: "2026-07-21",
      note: "post-refeed",
      createdBy: "coach-1",
      createdAt: "2026-07-20T09:00:00.000Z",
      updatedAt: "2026-07-20T09:00:00.000Z",
    });
    // null note/created_by map to undefined (omitted) on the camelCase shape.
    expect(result[1].note).toBeUndefined();
  });
});
