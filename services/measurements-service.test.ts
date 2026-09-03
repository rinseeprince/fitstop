import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The measurement log's writer and readers, over a scripted supabaseAdmin:
 * each `from(table)` call takes the next queued result for that table, and
 * every builder method records itself so a test can assert the predicate as
 * well as the outcome. The rule-2 kernel has its own pure test
 * (`lib/measurements/day-values.test.ts`); this file covers rule 3, the
 * energy trigger, the check-in fold and the two view readers.
 */
type Result = { data: unknown; error: { message: string } | null };
type Call = [method: string, args: unknown[]];

const state = vi.hoisted(() => ({
  queues: new Map<string, Result[]>(),
  calls: [] as Array<{ table: string; chain: Call[] }>,
  recalculate: vi.fn(),
}));

function chain(table: string, result: Result) {
  const record = { table, chain: [] as Call[] };
  state.calls.push(record);
  const q: Record<string, unknown> = {};
  for (const method of [
    "select", "eq", "in", "is", "order", "range", "gte", "lte", "insert", "limit",
    "maybeSingle", "overrideTypes",
  ]) {
    q[method] = (...args: unknown[]) => {
      record.chain.push([method, args]);
      return q;
    };
  }
  q.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return q;
}

vi.mock("./supabase-admin", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const next = state.queues.get(table)?.shift();
      if (!next) throw new Error(`no scripted result for ${table}`);
      return chain(table, next);
    },
  },
}));

vi.mock("./client-energy-service", () => ({
  recalculateClientEnergy: (...args: unknown[]) => state.recalculate(...args),
}));

import {
  appendMeasurements,
  getBaseline,
  getCurrentMeasurements,
  getMeasurementReading,
  getMeasurementReadings,
  getMeasurementSeries,
  getMeasurementsForCheckIns,
  getReadingsAsOf,
} from "./measurements-service";

const CLIENT = "11111111-1111-4111-8111-111111111111";

function queue(table: string, ...results: Result[]) {
  state.queues.set(table, [...(state.queues.get(table) ?? []), ...results]);
}

function liveRow(over: Record<string, unknown>) {
  return {
    id: "row-1",
    metric_key: "weight",
    value: 80.2,
    recorded_on: "2026-05-04",
    recorded_at: "2026-05-04T08:00:00+00:00",
    updated_at: "2026-05-04T08:00:00+00:00",
    measured_at: null,
    source: "coach_entry",
    source_id: null,
    note: null,
    ...over,
  };
}

function callsTo(table: string) {
  return state.calls.filter((c) => c.table === table);
}

beforeEach(() => {
  state.queues.clear();
  state.calls.length = 0;
  state.recalculate.mockReset();
  state.recalculate.mockResolvedValue({ status: "written" });
});

describe("appendMeasurements", () => {
  it("writes nothing and reads nothing for an input with no readings", async () => {
    const result = await appendMeasurements({
      clientId: CLIENT,
      source: "coach_entry",
      recordedOn: "2026-05-04",
      values: { weight: undefined },
    });
    expect(result.energy).toBe("nothing_inserted");
    expect(state.calls).toEqual([]);
  });

  it("rule 3: a value equal to the day's standing value for the same source is not written", async () => {
    queue("client_measurements_live", { data: [liveRow({ value: 80.2 })], error: null });

    const result = await appendMeasurements({
      clientId: CLIENT,
      source: "coach_entry",
      recordedOn: "2026-05-04",
      values: { weight: 80.2 },
    });

    expect(result.unchanged).toEqual(["weight"]);
    expect(result.inserted).toEqual([]);
    expect(result.rows.weight?.id).toBe("row-1");
    expect(callsTo("client_measurements")).toEqual([]);
    expect(state.recalculate).not.toHaveBeenCalled();
  });

  it("keys the standing read on the source AND the stamp — a check-in stamp is `eq`, no stamp is `is null`", async () => {
    queue("client_measurements_live", { data: [], error: null });
    queue("client_measurements", {
      data: [liveRow({ id: "new-1", value: 81.3, source: "check_in", source_id: "ci-9" })],
      error: null,
    });
    queue("client_current_measurements", { data: [{ metric_key: "weight", measurement_id: "old" }], error: null });

    await appendMeasurements({
      clientId: CLIENT,
      source: "check_in",
      sourceId: "ci-9",
      recordedOn: "2026-05-04",
      values: { weight: 81.3 },
    });
    const stamped = callsTo("client_measurements_live")[0].chain;
    expect(stamped).toContainEqual(["eq", ["source", "check_in"]]);
    expect(stamped).toContainEqual(["eq", ["source_id", "ci-9"]]);

    queue("client_measurements_live", { data: [], error: null });
    queue("client_measurements", { data: [liveRow({ id: "new-2", value: 81.4 })], error: null });
    queue("client_current_measurements", { data: [], error: null });
    await appendMeasurements({
      clientId: CLIENT,
      source: "coach_entry",
      recordedOn: "2026-05-04",
      values: { weight: 81.4 },
    });
    const unstamped = callsTo("client_measurements_live")[1].chain;
    expect(unstamped).toContainEqual(["is", ["source_id", null]]);
  });

  it("inserts every changed key in ONE statement, canonical values verbatim", async () => {
    queue("client_measurements_live", { data: [liveRow({ metric_key: "waist", value: 88.8 })], error: null });
    queue("client_measurements", {
      data: [
        liveRow({ id: "w", metric_key: "weight", value: 79.9, source: "check_in", source_id: "ci-1" }),
        liveRow({ id: "h", metric_key: "hips", value: 97.7, source: "check_in", source_id: "ci-1" }),
      ],
      error: null,
    });
    queue("client_current_measurements", { data: [], error: null });

    const result = await appendMeasurements({
      clientId: CLIENT,
      source: "check_in",
      sourceId: "ci-1",
      recordedOn: "2026-05-04",
      measuredAt: "2026-05-04T09:30:00.000Z",
      values: { weight: 79.9, waist: 88.8, hips: 97.7 },
    });

    const inserts = callsTo("client_measurements");
    expect(inserts).toHaveLength(1);
    const [, [rows]] = inserts[0].chain.find(([m]) => m === "insert")!;
    expect(rows).toEqual([
      expect.objectContaining({ metric_key: "weight", value: 79.9, source: "check_in", source_id: "ci-1", recorded_on: "2026-05-04", measured_at: "2026-05-04T09:30:00.000Z" }),
      expect.objectContaining({ metric_key: "hips", value: 97.7 }),
    ]);
    expect(result.inserted).toEqual(["weight", "hips"]);
    expect(result.unchanged).toEqual(["waist"]);
  });

  it("recomputes the energy pair only when an inserted row is the client's newest weight or body fat", async () => {
    queue("client_measurements_live", { data: [], error: null });
    queue("client_measurements", { data: [liveRow({ id: "back-1", value: 70.5, recorded_on: "2026-03-01" })], error: null });
    queue("client_current_measurements", { data: [{ metric_key: "weight", measurement_id: "someone-newer" }], error: null });
    const backdated = await appendMeasurements({
      clientId: CLIENT,
      source: "coach_entry",
      recordedOn: "2026-03-01",
      values: { weight: 70.5 },
    });
    expect(backdated.energy).toBe("not_newest");
    expect(state.recalculate).not.toHaveBeenCalled();

    queue("client_measurements_live", { data: [], error: null });
    queue("client_measurements", { data: [liveRow({ id: "fresh-1", value: 74.6, recorded_on: "2026-05-04" })], error: null });
    queue("client_current_measurements", { data: [{ metric_key: "weight", measurement_id: "fresh-1" }], error: null });
    const newest = await appendMeasurements({
      clientId: CLIENT,
      source: "coach_entry",
      recordedOn: "2026-05-04",
      values: { weight: 74.6 },
    });
    expect(newest.energy).toBe("recomputed");
    expect(state.recalculate).toHaveBeenCalledWith(CLIENT);
  });

  it("never consults the current view for a girth — girths feed no formula", async () => {
    queue("client_measurements_live", { data: [], error: null });
    queue("client_measurements", { data: [liveRow({ id: "g-1", metric_key: "arms", value: 33.3 })], error: null });

    const result = await appendMeasurements({
      clientId: CLIENT,
      source: "coach_entry",
      recordedOn: "2026-05-04",
      values: { arms: 33.3 },
    });
    expect(result.energy).toBe("not_newest");
    expect(callsTo("client_current_measurements")).toEqual([]);
    expect(state.recalculate).not.toHaveBeenCalled();
  });

  it("throws on a failed insert rather than returning a reading nobody stored", async () => {
    queue("client_measurements_live", { data: [], error: null });
    queue("client_measurements", { data: null, error: { message: "boom" } });
    await expect(
      appendMeasurements({ clientId: CLIENT, source: "intake", recordedOn: "2026-05-04", values: { weight: 66.6 } })
    ).rejects.toThrow("Failed to record measurements: boom");
  });
});

describe("getMeasurementsForCheckIns", () => {
  it("costs no query for an empty list", async () => {
    const out = await getMeasurementsForCheckIns([]);
    expect(out.size).toBe(0);
    expect(state.calls).toEqual([]);
  });

  it("takes the row written last per (stamp, metric) — the read orders by recorded_at, never by updated_at — and maps bodyFat by key", async () => {
    queue("client_measurements_live", {
      data: [
        { id: "c", metric_key: "weight", value: 78.1, source_id: "ci-1", recorded_at: "2026-05-05T10:00:00+00:00" },
        { id: "a", metric_key: "weight", value: 79.9, source_id: "ci-1", recorded_at: "2026-05-04T08:00:00+00:00" },
        { id: "b", metric_key: "bodyFat", value: 18.4, source_id: "ci-1", recorded_at: "2026-05-04T08:00:00+00:00" },
        { id: "d", metric_key: "waist", value: 82.5, source_id: "ci-2", recorded_at: "2026-04-27T08:00:00+00:00" },
      ],
      error: null,
    });

    const out = await getMeasurementsForCheckIns(["ci-1", "ci-2"]);
    expect(out.get("ci-1")).toEqual({ weight: 78.1, bodyFat: 18.4 });
    expect(out.get("ci-2")).toEqual({ waist: 82.5 });
    const read = callsTo("client_measurements_live")[0].chain;
    expect(read).toContainEqual(["in", ["source_id", ["ci-1", "ci-2"]]]);
    expect(read).toContainEqual(["select", ["id, metric_key, value, source_id, recorded_at"]]);
    expect(read).toContainEqual(["order", ["recorded_at", { ascending: false }]]);
    expect(read.some(([method, args]) => method === "order" && args[0] === "updated_at")).toBe(false);
  });
});

describe("getMeasurementSeries", () => {
  it("collapses rows to one value per day — the reading written last — and returns every requested key", async () => {
    queue("client_measurements_live", {
      data: [
        // Edited after the later row was written: the edit does not move it,
        // and the later write keeps the day.
        liveRow({ id: "1", value: 80.2, recorded_on: "2026-05-04", recorded_at: "2026-05-04T07:00:00+00:00", updated_at: "2026-05-04T21:00:00+00:00" }),
        liveRow({ id: "2", value: 80.7, recorded_on: "2026-05-04", recorded_at: "2026-05-04T19:00:00+00:00", updated_at: "2026-05-04T19:00:00+00:00" }),
        liveRow({ id: "3", value: 79.3, recorded_on: "2026-05-06" }),
      ],
      error: null,
    });

    const series = await getMeasurementSeries(CLIENT, { metricKeys: ["weight", "waist"], from: "2026-05-01" });
    expect(series.get("weight")?.map((v) => [v.date, v.value])).toEqual([
      ["2026-05-04", 80.7],
      ["2026-05-06", 79.3],
    ]);
    expect(series.get("waist")).toEqual([]);
    const read = callsTo("client_measurements_live")[0].chain;
    expect(read).toContainEqual(["gte", ["recorded_on", "2026-05-01"]]);
    expect(read).toContainEqual(["in", ["metric_key", ["weight", "waist"]]]);
    expect(read).toContainEqual(["order", ["recorded_at", { ascending: true }]]);
    expect(read.some(([method, args]) => method === "order" && args[0] === "updated_at")).toBe(false);
  });
});

describe("the two view readers", () => {
  it("map the current view and skip a row the view could not fill", async () => {
    queue("client_current_measurements", {
      data: [
        { measurement_id: "m1", metric_key: "weight", value: 76.0, recorded_on: "2026-08-29", source: "coach_entry", recorded_at: "x", measured_at: null, client_id: CLIENT },
        { measurement_id: null, metric_key: "waist", value: 80, recorded_on: "2026-08-29", source: "coach_entry", recorded_at: "x", measured_at: null, client_id: CLIENT },
      ],
      error: null,
    });
    const current = await getCurrentMeasurements(CLIENT);
    expect(current.weight).toEqual({ id: "m1", metricKey: "weight", value: 76.0, date: "2026-08-29", source: "coach_entry" });
    expect(current.waist).toBeUndefined();
  });

  it("read the baseline from its view, scoped by client", async () => {
    queue("client_baseline_measurements", {
      data: [{ measurement_id: "b1", metric_key: "bodyFat", value: 26, recorded_on: "2026-04-01", source: "intake", recorded_at: "x", client_id: CLIENT }],
      error: null,
    });
    const baseline = await getBaseline(CLIENT);
    expect(baseline.bodyFat?.value).toBe(26);
    expect(callsTo("client_baseline_measurements")[0].chain).toContainEqual(["eq", ["client_id", CLIENT]]);
  });
});

function logRow(over: Record<string, unknown>) {
  return {
    ...liveRow({}),
    voided_at: null,
    void_reason: null,
    voided_by_coach: null,
    ...over,
  };
}

// The coach's list is the ONE reader of the table: a removed row is listed,
// with who removed it and when.
describe("getMeasurementReadings", () => {
  it("reads the TABLE, newest first, and carries a removal with the remover's name", async () => {
    queue("client_measurements", {
      data: [
        logRow({ id: "gone", recorded_on: "2026-08-14", voided_at: "2026-09-03T10:00:00+00:00", void_reason: "typo", voided_by_coach: { name: "Sam Kalepa" } }),
        logRow({ id: "live", recorded_on: "2026-08-07" }),
      ],
      error: null,
    });

    const readings = await getMeasurementReadings(CLIENT);

    expect(readings.map((r) => r.id)).toEqual(["gone", "live"]);
    expect(readings[0].voided).toEqual({ at: "2026-09-03T10:00:00+00:00", byName: "Sam Kalepa", reason: "typo" });
    expect(readings[1].voided).toBeNull();
    const read = callsTo("client_measurements")[0].chain;
    expect(read).toContainEqual(["eq", ["client_id", CLIENT]]);
    expect(read).toContainEqual(["order", ["recorded_on", { ascending: false }]]);
    expect(read).toContainEqual(["order", ["recorded_at", { ascending: false }]]);
    expect(read.some(([method, args]) => method === "order" && args[0] === "updated_at")).toBe(false);
    expect(callsTo("client_measurements_live")).toEqual([]);
  });

  it("names nobody when the remover's coach row is gone", async () => {
    queue("client_measurements", {
      data: [logRow({ id: "gone", voided_at: "2026-09-03T10:00:00+00:00", voided_by_coach: null })],
      error: null,
    });

    const [reading] = await getMeasurementReadings(CLIENT);
    expect(reading.voided).toEqual({ at: "2026-09-03T10:00:00+00:00", byName: null, reason: null });
  });
});

describe("getMeasurementReading", () => {
  it("reads one row by id AND client — a foreign id is not found", async () => {
    queue("client_measurements", { data: null, error: null });

    expect(await getMeasurementReading(CLIENT, "row-9")).toBeNull();
    const read = callsTo("client_measurements")[0].chain;
    expect(read).toContainEqual(["eq", ["client_id", CLIENT]]);
    expect(read).toContainEqual(["eq", ["id", "row-9"]]);
  });

  it("finds a removed row, and says so", async () => {
    queue("client_measurements", {
      data: logRow({ id: "gone", voided_at: "2026-09-03T10:00:00+00:00", voided_by_coach: { name: "Sam" } }),
      error: null,
    });

    const reading = await getMeasurementReading(CLIENT, "gone");
    expect(reading?.voided?.byName).toBe("Sam");
  });
});

describe("getReadingsAsOf — the readings a check-in's review judges its goals against", () => {
  const DAY = "2026-05-31";
  const STAMP = "ci-31";

  it("takes the check-in's own stamped row over a same-day reading logged later", async () => {
    // Three reads of the live view, issued together: the stamped rows, then
    // the newest row on or before the day for weight and for body fat.
    queue(
      "client_measurements_live",
      {
        data: [
          liveRow({
            id: "stamped-w", value: 80, recorded_on: DAY,
            recorded_at: "2026-05-31T12:00:00+00:00", source: "check_in", source_id: STAMP,
          }),
        ],
        error: null,
      },
      {
        data: [liveRow({ id: "coach-w", value: 72, recorded_on: DAY, recorded_at: "2026-09-03T15:14:54+00:00" })],
        error: null,
      },
      { data: [], error: null },
    );

    const readings = await getReadingsAsOf(CLIENT, DAY, STAMP);

    expect(readings.weight).toEqual({ id: "stamped-w", metricKey: "weight", value: 80, date: DAY, source: "check_in" });
    expect(readings.bodyFat).toBeUndefined();

    const [stamped, weightBefore, bodyFatBefore] = callsTo("client_measurements_live").map((c) => c.chain);
    expect(stamped).toContainEqual(["eq", ["client_id", CLIENT]]);
    expect(stamped).toContainEqual(["eq", ["source_id", STAMP]]);
    expect(weightBefore).toContainEqual(["eq", ["client_id", CLIENT]]);
    expect(weightBefore).toContainEqual(["eq", ["metric_key", "weight"]]);
    expect(weightBefore).toContainEqual(["lte", ["recorded_on", DAY]]);
    expect(weightBefore).toContainEqual(["limit", [1]]);
    expect(bodyFatBefore).toContainEqual(["eq", ["metric_key", "bodyFat"]]);
    expect(bodyFatBefore).toContainEqual(["lte", ["recorded_on", DAY]]);
    // The live view, never the table: a removed reading is not a reading.
    expect(callsTo("client_measurements")).toEqual([]);
  });

  it("falls back to the newest reading on or before the day when the check-in carried none", async () => {
    queue(
      "client_measurements_live",
      { data: [], error: null },
      { data: [liveRow({ id: "before-w", value: 78.6, recorded_on: "2026-05-30", source: "client_log" })], error: null },
      {
        data: [
          liveRow({
            id: "before-bf", metric_key: "bodyFat", value: 17.4, recorded_on: "2026-05-24",
            source: "check_in", source_id: "ci-24",
          }),
        ],
        error: null,
      },
    );

    const readings = await getReadingsAsOf(CLIENT, DAY, STAMP);

    expect(readings.weight).toMatchObject({ id: "before-w", value: 78.6, date: "2026-05-30", source: "client_log" });
    expect(readings.bodyFat).toMatchObject({ id: "before-bf", value: 17.4, date: "2026-05-24" });
    for (const call of callsTo("client_measurements_live").slice(1)) {
      expect(call.chain).toContainEqual(["lte", ["recorded_on", DAY]]);
    }
  });

  it("throws when any of the three reads fails, rather than answering with a partial day", async () => {
    queue(
      "client_measurements_live",
      { data: [], error: null },
      { data: null, error: { message: "boom" } },
      { data: [], error: null },
    );

    await expect(getReadingsAsOf(CLIENT, DAY, STAMP)).rejects.toThrow(/boom/);
  });
});
