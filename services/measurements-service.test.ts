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
  appendCorrection,
  appendMeasurements,
  getBaseline,
  getCurrentMeasurements,
  getMeasurementReading,
  getMeasurementReadings,
  getMeasurementSeries,
  getMeasurementsForCheckIns,
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

  it("takes the latest row per (stamp, metric), whatever its source, and maps bodyFat by key", async () => {
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
    expect(read).toContainEqual(["order", ["recorded_at", { ascending: false }]]);
  });
});

describe("getMeasurementSeries", () => {
  it("collapses rows to one value per day and returns every requested key", async () => {
    queue("client_measurements_live", {
      data: [
        liveRow({ id: "1", value: 80.2, recorded_on: "2026-05-04", recorded_at: "2026-05-04T07:00:00+00:00" }),
        liveRow({ id: "2", value: 80.7, recorded_on: "2026-05-04", recorded_at: "2026-05-04T19:00:00+00:00" }),
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

// docs/MEASUREMENT-LOG-PLAN.md commit 4: a correction is a new row carrying
// the original's day and stamp, and its unchanged-check reads the reading's
// STANDING value of any source, not the same-source key.
describe("appendCorrection", () => {
  const original = {
    metricKey: "weight" as const,
    date: "2026-08-14",
    sourceId: "ci-1",
    measuredAt: "2026-08-14T07:30:00+00:00",
  };

  it("reads the standing value in the day-and-stamp scope, of ANY source", async () => {
    queue("client_measurements_live", { data: [liveRow({ id: "ci-row", value: 91, source: "check_in", source_id: "ci-1", recorded_on: "2026-08-14" })], error: null });
    queue("client_measurements", { data: [liveRow({ id: "fix", value: 90, source: "coach_entry", source_id: "ci-1", recorded_on: "2026-08-14" })], error: null });
    queue("client_current_measurements", { data: [], error: null });

    await appendCorrection({ clientId: CLIENT, original, value: 90, actor: "coach-1" });

    const standing = callsTo("client_measurements_live")[0].chain;
    expect(standing).toContainEqual(["eq", ["client_id", CLIENT]]);
    expect(standing).toContainEqual(["eq", ["metric_key", "weight"]]);
    expect(standing).toContainEqual(["eq", ["recorded_on", "2026-08-14"]]);
    expect(standing).toContainEqual(["eq", ["source_id", "ci-1"]]);
    expect(standing).toContainEqual(["limit", [1]]);
    // No source predicate: a check-in's 91 IS the standing value a correction replaces.
    expect(standing.some(([method, args]) => method === "eq" && args[0] === "source")).toBe(false);
  });

  it("scopes an unstamped original to unstamped rows", async () => {
    queue("client_measurements_live", { data: [], error: null });
    queue("client_measurements", { data: [liveRow({ id: "fix", metric_key: "waist", value: 80 })], error: null });

    await appendCorrection({
      clientId: CLIENT,
      original: { metricKey: "waist", date: "2026-08-14", sourceId: null, measuredAt: null },
      value: 80,
      actor: "coach-1",
    });

    expect(callsTo("client_measurements_live")[0].chain).toContainEqual(["is", ["source_id", null]]);
  });

  it("writes nothing when the value equals what already stands, whatever wrote it", async () => {
    queue("client_measurements_live", { data: [liveRow({ id: "ci-row", value: 91, source: "check_in", source_id: "ci-1" })], error: null });

    const result = await appendCorrection({ clientId: CLIENT, original, value: 91, actor: "coach-1" });

    expect(result.inserted).toBe(false);
    expect(result.reading.id).toBe("ci-row");
    expect(callsTo("client_measurements")).toEqual([]);
    expect(state.recalculate).not.toHaveBeenCalled();
  });

  it("inserts a coach_entry row copying the original's metric, day, stamp and moment, by the actor", async () => {
    queue("client_measurements_live", { data: [liveRow({ id: "ci-row", value: 91, source: "check_in", source_id: "ci-1" })], error: null });
    queue("client_measurements", { data: [liveRow({ id: "fix", value: 90, source: "coach_entry", source_id: "ci-1", recorded_on: "2026-08-14" })], error: null });
    queue("client_current_measurements", { data: [{ metric_key: "weight", measurement_id: "fix" }], error: null });

    const result = await appendCorrection({ clientId: CLIENT, original, value: 90, actor: "coach-1" });

    const [, insertArgs] = callsTo("client_measurements")[0].chain.find(([m]) => m === "insert")!;
    expect(insertArgs[0]).toEqual([
      {
        client_id: CLIENT,
        metric_key: "weight",
        value: 90,
        recorded_on: "2026-08-14",
        measured_at: "2026-08-14T07:30:00+00:00",
        source: "coach_entry",
        source_id: "ci-1",
        note: null,
        created_by: "coach-1",
      },
    ]);
    expect(result.inserted).toBe(true);
    expect(result.reading.id).toBe("fix");
    // The correction became the client's newest weight: the pair recomputes.
    expect(result.energy).toBe("recomputed");
    expect(state.recalculate).toHaveBeenCalledWith(CLIENT);
  });

  it("recomputes nothing when the corrected reading is not the client's newest", async () => {
    queue("client_measurements_live", { data: [], error: null });
    queue("client_measurements", { data: [liveRow({ id: "fix", value: 90, source: "coach_entry", source_id: "ci-1" })], error: null });
    queue("client_current_measurements", { data: [{ metric_key: "weight", measurement_id: "later" }], error: null });

    const result = await appendCorrection({ clientId: CLIENT, original, value: 90, actor: "coach-1" });

    expect(result.energy).toBe("not_newest");
    expect(state.recalculate).not.toHaveBeenCalled();
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
