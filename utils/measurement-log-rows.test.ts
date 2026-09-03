import { describe, it, expect } from "vitest";
import {
  buildMeasurementLogRows,
  type MeasurementDayValueInput,
  type MeasurementLogReadingInput,
} from "./measurement-log-rows";
import type { MeasurementKey } from "@/lib/measurements/keys";

const DOWN_IS_GOOD = new Set(["weight", "waist"]);
const ORDER: MeasurementKey[] = ["weight", "bodyFat", "waist"];

function reading(
  id: string,
  metricKey: MeasurementKey,
  date: string,
  value: number,
  over: Partial<MeasurementLogReadingInput> = {}
): MeasurementLogReadingInput {
  return {
    id,
    metricKey,
    date,
    value,
    canonicalValue: value,
    source: "check_in",
    sourceId: null,
    note: null,
    recordedAt: `${date}T08:00:00+00:00`,
    voided: null,
    ...over,
  };
}

const day = (id: string, date: string, value: number): MeasurementDayValueInput => ({
  id,
  date,
  value,
});

// The coach's correction of a check-in's reading: the correction carries the
// check-in's stamp (docs/MEASUREMENT-LOG-PLAN.md D9), written later.
const CHECK_IN_91 = reading("m-ci", "weight", "2026-08-14", 91, { sourceId: "ci-1" });
const CORRECTION_90 = reading("m-coach", "weight", "2026-08-14", 90, {
  source: "coach_entry",
  sourceId: "ci-1",
  recordedAt: "2026-08-14T12:00:00+00:00",
});

describe("buildMeasurementLogRows — one row per day, the day's other readings folded", () => {
  it("lists a corrected check-in reading as ONE row reading 90, with the 91 folded beneath it as corrected", () => {
    const rows = buildMeasurementLogRows(
      [CHECK_IN_91, CORRECTION_90],
      new Map([["weight", [day("m-coach", "2026-08-14", 90)]]]),
      {},
      ORDER,
      DOWN_IS_GOOD
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "m-coach", value: 90, source: "coach_entry" });
    expect(rows[0].folded).toEqual([
      expect.objectContaining({ id: "m-ci", value: 91, source: "check_in", kind: "corrected", change: null }),
    ]);
  });

  it("folds two genuine readings of one day as also logged — the coach's clinic reading over the client's home one", () => {
    const rows = buildMeasurementLogRows(
      [
        reading("m-client", "weight", "2026-08-14", 80.4, {
          source: "client_log",
          recordedAt: "2026-08-14T07:12:00+00:00",
        }),
        reading("m-clinic", "weight", "2026-08-14", 79.8, {
          source: "coach_entry",
          recordedAt: "2026-08-14T12:00:00+00:00",
        }),
      ],
      new Map([["weight", [day("m-clinic", "2026-08-14", 79.8)]]]),
      {},
      ORDER,
      DOWN_IS_GOOD
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("m-clinic");
    expect(rows[0].folded).toEqual([
      expect.objectContaining({ id: "m-client", value: 80.4, kind: "also" }),
    ]);
  });

  it("reads a coach's edit of their own unstamped entry as also logged — the store cannot tell it from a second reading (D21)", () => {
    const rows = buildMeasurementLogRows(
      [
        reading("m-first", "waist", "2026-08-14", 84.3, { source: "coach_entry" }),
        reading("m-second", "waist", "2026-08-14", 83.6, {
          source: "coach_entry",
          recordedAt: "2026-08-14T08:05:00+00:00",
        }),
      ],
      new Map([["waist", [day("m-second", "2026-08-14", 83.6)]]]),
      {},
      ORDER,
      DOWN_IS_GOOD
    );

    expect(rows[0].id).toBe("m-second");
    expect(rows[0].folded[0]).toMatchObject({ id: "m-first", kind: "also" });
  });

  it("takes the day's change against the PREVIOUS DAY's standing value, never against a folded reading", () => {
    const rows = buildMeasurementLogRows(
      [CHECK_IN_91, CORRECTION_90, reading("m-prev", "weight", "2026-08-07", 92)],
      new Map([
        ["weight", [day("m-prev", "2026-08-07", 92), day("m-coach", "2026-08-14", 90)]],
      ]),
      {},
      ORDER,
      DOWN_IS_GOOD
    );

    const byId = new Map(rows.map((row) => [row.id, row]));
    // The 14th's row measures against the 7th's 92, and a fall is good.
    expect(byId.get("m-coach")?.change).toEqual({ amount: -2, tone: "good" });
    expect(byId.get("m-coach")?.folded[0].change).toBeNull();
    expect(byId.get("m-prev")?.change).toBeNull();
  });

  it("folds a removed reading beneath the day's standing row, carrying its removal, and the row's change stands", () => {
    const voided = { at: "2026-09-03T10:00:00+00:00", byName: "Sam" };
    const rows = buildMeasurementLogRows(
      [
        reading("m-gone", "weight", "2026-08-14", 91, { voided }),
        reading("m-live", "weight", "2026-08-14", 90, {
          source: "coach_entry",
          recordedAt: "2026-08-14T12:00:00+00:00",
        }),
        reading("m-prev", "weight", "2026-08-07", 92),
      ],
      new Map([
        ["weight", [day("m-prev", "2026-08-07", 92), day("m-live", "2026-08-14", 90)]],
      ]),
      {},
      ORDER,
      DOWN_IS_GOOD
    );

    const row = rows.find((r) => r.id === "m-live");
    expect(row?.change).toEqual({ amount: -2, tone: "good" });
    expect(row?.folded).toEqual([
      expect.objectContaining({ id: "m-gone", kind: "removed", voided, change: null }),
    ]);
  });

  it("leads a day whose readings are all removed with its newest removed reading, the rest folded", () => {
    const voidedA = { at: "2026-09-03T10:00:00+00:00", byName: "Sam" };
    const voidedB = { at: "2026-09-03T10:05:00+00:00", byName: "Sam" };
    const rows = buildMeasurementLogRows(
      [
        reading("m-gone-a", "weight", "2026-08-14", 91, { voided: voidedA }),
        reading("m-gone-b", "weight", "2026-08-14", 90, {
          recordedAt: "2026-08-14T12:00:00+00:00",
          voided: voidedB,
        }),
        reading("m-prev", "weight", "2026-08-07", 92),
      ],
      new Map([["weight", [day("m-prev", "2026-08-07", 92)]]]),
      {},
      ORDER,
      DOWN_IS_GOOD
    );

    const row = rows.find((r) => r.date === "2026-08-14");
    expect(row).toMatchObject({ id: "m-gone-b", voided: voidedB, change: null });
    expect(row?.folded).toEqual([expect.objectContaining({ id: "m-gone-a", kind: "removed" })]);
  });

  it("folds newest write first", () => {
    const rows = buildMeasurementLogRows(
      [
        reading("m-a", "weight", "2026-08-14", 91.2, { recordedAt: "2026-08-14T07:00:00+00:00" }),
        reading("m-b", "weight", "2026-08-14", 91.4, { recordedAt: "2026-08-14T09:00:00+00:00" }),
        reading("m-c", "weight", "2026-08-14", 91.6, { recordedAt: "2026-08-14T11:00:00+00:00" }),
      ],
      new Map([["weight", [day("m-c", "2026-08-14", 91.6)]]]),
      {},
      ORDER,
      DOWN_IS_GOOD
    );

    expect(rows[0].id).toBe("m-c");
    expect(rows[0].folded.map((r) => r.id)).toEqual(["m-b", "m-a"]);
  });

  it("flags the reading every 'now' figure uses and the reading the since-start figures use", () => {
    const rows = buildMeasurementLogRows(
      [
        reading("m-3", "weight", "2026-08-21", 89),
        reading("m-2", "weight", "2026-08-14", 90),
        reading("m-1", "weight", "2026-03-01", 95),
      ],
      new Map([
        [
          "weight",
          [day("m-1", "2026-03-01", 95), day("m-2", "2026-08-14", 90), day("m-3", "2026-08-21", 89)],
        ],
      ]),
      { weight: "m-1" },
      ORDER,
      DOWN_IS_GOOD
    );

    const flags = Object.fromEntries(rows.map((row) => [row.id, [row.isCurrent, row.isBaseline]]));
    expect(flags).toEqual({ "m-3": [true, false], "m-2": [false, false], "m-1": [false, true] });
  });

  it("a folded same-day reading is not 'current' — only the day's standing row is", () => {
    const rows = buildMeasurementLogRows(
      [CHECK_IN_91, CORRECTION_90],
      new Map([["weight", [day("m-coach", "2026-08-14", 90)]]]),
      {},
      ORDER,
      DOWN_IS_GOOD
    );

    expect(rows[0].isCurrent).toBe(true);
    expect(rows[0].folded[0].isCurrent).toBe(false);
  });

  it("orders newest day first, then tab order — one row per day per metric", () => {
    const rows = buildMeasurementLogRows(
      [
        reading("w-old", "weight", "2026-08-07", 92),
        reading("waist-new", "waist", "2026-08-14", 80),
        reading("w-new-a", "weight", "2026-08-14", 91),
        reading("w-new-b", "weight", "2026-08-14", 90, {
          recordedAt: "2026-08-14T12:00:00+00:00",
        }),
      ],
      new Map([
        ["weight", [day("w-old", "2026-08-07", 92), day("w-new-b", "2026-08-14", 90)]],
        ["waist", [day("waist-new", "2026-08-14", 80)]],
      ]),
      {},
      ORDER,
      DOWN_IS_GOOD
    );

    expect(rows.map((row) => row.id)).toEqual(["w-new-b", "waist-new", "w-old"]);
    expect(rows[0].folded.map((row) => row.id)).toEqual(["w-new-a"]);
  });

  it("shows a coach's note and never a client's", () => {
    const rows = buildMeasurementLogRows(
      [
        reading("m-coach", "waist", "2026-08-14", 80, { source: "coach_entry", note: "post-run" }),
        reading("m-client", "waist", "2026-08-07", 81, { source: "client_log", note: "mine" }),
      ],
      new Map(),
      {},
      ORDER,
      DOWN_IS_GOOD
    );

    expect(rows.find((row) => row.id === "m-coach")?.note).toBe("post-run");
    expect(rows.find((row) => row.id === "m-client")?.note).toBeNull();
  });
});
