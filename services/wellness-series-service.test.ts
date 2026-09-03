import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));

import { supabaseAdmin } from "./supabase-admin";
import { getWellnessSeriesPayload, toWellnessSeries } from "./wellness-series-service";
import { WELLNESS_KEYS, type WellnessKey } from "@/lib/wellness/keys";
import type { WellnessDayValue } from "@/lib/wellness/day-values";

type LogRow = {
  id: string;
  date: string;
  mood: number | null;
  energy: number | null;
  sleep: number | null;
  stress: number | null;
  soreness: number | null;
  updated_at: string;
};

const logRow = (
  id: string,
  date: string,
  values: Partial<Record<WellnessKey, number>> = {},
  updatedAt = `${date}T21:00:00+00:00`
): LogRow => ({
  id,
  date,
  updated_at: updatedAt,
  mood: null,
  energy: null,
  sleep: null,
  stress: null,
  soreness: null,
  ...values,
});

const dayValue = (
  id: string,
  metricKey: WellnessKey,
  date: string,
  value: number
): WellnessDayValue => ({ id, metricKey, date, value, recordedAt: `${date}T21:00:00+00:00` });

/** A `wellness_logs` builder whose `.range()` resolves each page in turn. */
function wireWellnessLogsRead(
  pages: Array<{ data: LogRow[] | null; error?: { message: string } | null }>
) {
  const builder: Record<string, unknown> = {};
  let call = 0;
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.range = vi.fn(() => {
    const page = pages[Math.min(call, pages.length - 1)];
    call += 1;
    return Promise.resolve({ data: page.data, error: page.error ?? null });
  });
  vi.mocked(supabaseAdmin.from).mockReturnValue(builder as never);
  return builder;
}

describe("toWellnessSeries", () => {
  it("emits every one of the five metrics, empty when the log holds no reading of it, and nothing else", () => {
    const series = toWellnessSeries(
      new Map<WellnessKey, WellnessDayValue[]>([
        ["mood", [dayValue("w-1", "mood", "2026-05-11", 3)]],
      ])
    );

    expect(Object.keys(series).sort()).toEqual([...WELLNESS_KEYS].sort());
    expect(series.mood).toHaveLength(1);
    expect(series.energy).toEqual([]);
    expect(series.soreness).toEqual([]);
  });

  it("maps each day-value to the point shape — date, value, id, recordedAt — in the order given", () => {
    const series = toWellnessSeries(
      new Map<WellnessKey, WellnessDayValue[]>([
        [
          "sleep",
          [dayValue("w-1", "sleep", "2026-05-11", 6), dayValue("w-2", "sleep", "2026-05-12", 8)],
        ],
      ])
    );

    expect(series.sleep).toEqual([
      { date: "2026-05-11", value: 6, id: "w-1", recordedAt: "2026-05-11T21:00:00+00:00" },
      { date: "2026-05-12", value: 8, id: "w-2", recordedAt: "2026-05-12T21:00:00+00:00" },
    ]);
  });
});

describe("getWellnessSeriesPayload", () => {
  beforeEach(() => {
    vi.mocked(supabaseAdmin.from).mockReset();
  });

  it("reads the client's wellness log — the eight columns, scoped, ordered by day then id — and assembles day-values", async () => {
    const builder = wireWellnessLogsRead([
      {
        data: [
          logRow("w-2", "2026-05-12", { mood: 2, stress: 9 }),
          logRow("w-1", "2026-05-11", { mood: 3, energy: 7 }),
        ],
      },
    ]);

    const payload = await getWellnessSeriesPayload("client-1");

    expect(supabaseAdmin.from).toHaveBeenCalledWith("wellness_logs");
    expect(builder.select).toHaveBeenCalledWith(
      "id, date, mood, energy, sleep, stress, soreness, updated_at"
    );
    expect(builder.eq).toHaveBeenCalledWith("client_id", "client-1");
    expect(builder.order).toHaveBeenNthCalledWith(1, "date", { ascending: true });
    expect(builder.order).toHaveBeenNthCalledWith(2, "id", { ascending: true });
    expect(payload.mood.map((p) => [p.date, p.value])).toEqual([
      ["2026-05-11", 3],
      ["2026-05-12", 2],
    ]);
    expect(payload.energy.map((p) => p.value)).toEqual([7]);
    expect(payload.stress.map((p) => p.value)).toEqual([9]);
    expect(payload.sleep).toEqual([]);
    expect(payload.soreness).toEqual([]);
  });

  it("reads past PostgREST's row cap — a second page is fetched and folded in", async () => {
    const first = Array.from({ length: 1000 }, (_, i) => {
      const date = new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10);
      return logRow(`w-${i}`, date, { mood: (i % 5) + 1 });
    });
    const second = [logRow("w-last", "2026-05-11", { mood: 4 })];
    const builder = wireWellnessLogsRead([{ data: first }, { data: second }]);

    const payload = await getWellnessSeriesPayload("client-1");

    expect(builder.range).toHaveBeenCalledTimes(2);
    expect(builder.range).toHaveBeenNthCalledWith(1, 0, 999);
    expect(builder.range).toHaveBeenNthCalledWith(2, 1000, 1999);
    expect(payload.mood).toHaveLength(1001);
    expect(payload.mood[1000]).toMatchObject({ date: "2026-05-11", value: 4 });
  });

  it("throws when the read errors, rather than assembling an empty series", async () => {
    wireWellnessLogsRead([{ data: null, error: { message: "connection reset" } }]);

    await expect(getWellnessSeriesPayload("client-1")).rejects.toThrow(
      "Failed to fetch wellness logs: connection reset"
    );
  });
});
