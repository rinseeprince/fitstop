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

// A check-in's reading and a coach's reading logged later the same day: two
// readings, two rows, the coach's the day's value (docs/MEASUREMENT-LOG-PLAN.md
// commit 8, D23).
const CHECK_IN_91 = reading("m-ci", "weight", "2026-08-14", 91, { sourceId: "ci-1" });
const COACH_90 = reading("m-coach", "weight", "2026-08-14", 90, {
  source: "coach_entry",
  recordedAt: "2026-08-14T12:00:00+00:00",
});

describe("buildMeasurementLogRows — one row per reading", () => {
  it("lists two readings of one day as two rows, the most recently written first, nothing beneath either", () => {
    const rows = buildMeasurementLogRows(
      [CHECK_IN_91, COACH_90],
      new Map([["weight", [day("m-coach", "2026-08-14", 90)]]]),
      {},
      ORDER,
      DOWN_IS_GOOD
    );

    expect(rows.map((row) => [row.id, row.value])).toEqual([
      ["m-coach", 90],
      ["m-ci", 91],
    ]);
    expect(rows[0]).not.toHaveProperty("folded");
    expect(rows[1]).toMatchObject({ source: "check_in", sourceId: "ci-1" });
  });

  it("an edited reading is the same row with its new value — an edit adds nothing", () => {
    const rows = buildMeasurementLogRows(
      [reading("m-ci", "weight", "2026-08-14", 89.5, { sourceId: "ci-1" })],
      new Map([["weight", [day("m-ci", "2026-08-14", 89.5)]]]),
      {},
      ORDER,
      DOWN_IS_GOOD
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "m-ci", value: 89.5, sourceId: "ci-1", isCurrent: true });
  });

  it("takes every live row's change against the PREVIOUS DAY's standing value, never against a same-day row", () => {
    const rows = buildMeasurementLogRows(
      [CHECK_IN_91, COACH_90, reading("m-prev", "weight", "2026-08-07", 92)],
      new Map([
        ["weight", [day("m-prev", "2026-08-07", 92), day("m-coach", "2026-08-14", 90)]],
      ]),
      {},
      ORDER,
      DOWN_IS_GOOD
    );

    const byId = new Map(rows.map((row) => [row.id, row]));
    // Both of the 14th's rows measure against the 7th's 92, and a fall is good.
    expect(byId.get("m-coach")?.change).toEqual({ amount: -2, tone: "good" });
    expect(byId.get("m-ci")?.change).toEqual({ amount: -1, tone: "good" });
    expect(byId.get("m-prev")?.change).toBeNull();
  });

  it("lists a removed reading as its own row carrying its removal, with no change, while the live row's stands", () => {
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

    expect(rows.map((row) => row.id)).toEqual(["m-live", "m-gone", "m-prev"]);
    expect(rows[0].change).toEqual({ amount: -2, tone: "good" });
    expect(rows[1]).toMatchObject({ voided, change: null, isCurrent: false });
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

  it("a same-day reading that is not the day's value is not 'current' — only the day's standing row is", () => {
    const rows = buildMeasurementLogRows(
      [CHECK_IN_91, COACH_90],
      new Map([["weight", [day("m-coach", "2026-08-14", 90)]]]),
      {},
      ORDER,
      DOWN_IS_GOOD
    );

    expect(rows.map((row) => [row.id, row.isCurrent])).toEqual([
      ["m-coach", true],
      ["m-ci", false],
    ]);
  });

  it("orders newest day first, then tab order, then the most recently written — one row per reading", () => {
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

    expect(rows.map((row) => row.id)).toEqual(["w-new-b", "w-new-a", "waist-new", "w-old"]);
  });

  it("orders a day's rows by when they were written, never by id — the ids here sort the other way", () => {
    const rows = buildMeasurementLogRows(
      [
        reading("m-b", "weight", "2026-08-14", 91.2, { recordedAt: "2026-08-14T09:00:00+00:00" }),
        reading("m-a", "weight", "2026-08-14", 91.4, { recordedAt: "2026-08-14T11:00:00+00:00" }),
        reading("m-c", "weight", "2026-08-14", 91.6, { recordedAt: "2026-08-14T07:00:00+00:00" }),
      ],
      new Map([["weight", [day("m-a", "2026-08-14", 91.4)]]]),
      {},
      ORDER,
      DOWN_IS_GOOD
    );

    expect(rows.map((row) => row.id)).toEqual(["m-a", "m-b", "m-c"]);
  });

  it("breaks an equal instant by id, so two readers agree on a day's order", () => {
    const rows = buildMeasurementLogRows(
      [
        reading("m-a", "weight", "2026-08-14", 91.2, { recordedAt: "2026-08-14T09:00:00+00:00" }),
        reading("m-b", "weight", "2026-08-14", 91.4, { recordedAt: "2026-08-14T09:00:00+00:00" }),
      ],
      new Map([["weight", [day("m-b", "2026-08-14", 91.4)]]]),
      {},
      ORDER,
      DOWN_IS_GOOD
    );

    expect(rows.map((row) => row.id)).toEqual(["m-b", "m-a"]);
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
