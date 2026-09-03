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

describe("buildMeasurementLogRows", () => {
  it("lists EVERY reading — two rows for a day with a check-in and a coach correction", () => {
    const rows = buildMeasurementLogRows(
      [
        reading("m-ci", "weight", "2026-08-14", 91, { sourceId: "ci-1" }),
        reading("m-coach", "weight", "2026-08-14", 90, {
          source: "coach_entry",
          sourceId: "ci-1",
          recordedAt: "2026-08-14T12:00:00+00:00",
        }),
      ],
      new Map([["weight", [day("m-coach", "2026-08-14", 90)]]]),
      {},
      ORDER,
      DOWN_IS_GOOD
    );

    expect(rows.map((row) => row.id)).toEqual(["m-coach", "m-ci"]);
  });

  it("takes each change against the PREVIOUS DAY's standing value, not the previous row", () => {
    const rows = buildMeasurementLogRows(
      [
        reading("m-ci", "weight", "2026-08-14", 91, { sourceId: "ci-1" }),
        reading("m-coach", "weight", "2026-08-14", 90, {
          source: "coach_entry",
          sourceId: "ci-1",
          recordedAt: "2026-08-14T12:00:00+00:00",
        }),
        reading("m-prev", "weight", "2026-08-07", 92),
      ],
      new Map([
        ["weight", [day("m-prev", "2026-08-07", 92), day("m-coach", "2026-08-14", 90)]],
      ]),
      {},
      ORDER,
      DOWN_IS_GOOD
    );

    const byId = new Map(rows.map((row) => [row.id, row]));
    // Both same-day readings measure against the 7th's 92, and a fall is good.
    expect(byId.get("m-coach")?.change).toEqual({ amount: -2, tone: "good" });
    expect(byId.get("m-ci")?.change).toEqual({ amount: -1, tone: "good" });
    expect(byId.get("m-prev")?.change).toBeNull();
  });

  it("gives a removed reading no change and carries its removal", () => {
    const voided = { at: "2026-09-03T10:00:00+00:00", byName: "Sam" };
    const rows = buildMeasurementLogRows(
      [
        reading("m-gone", "weight", "2026-08-14", 91, { voided }),
        reading("m-prev", "weight", "2026-08-07", 92),
      ],
      new Map([["weight", [day("m-prev", "2026-08-07", 92)]]]),
      {},
      ORDER,
      DOWN_IS_GOOD
    );

    const gone = rows.find((row) => row.id === "m-gone");
    expect(gone?.change).toBeNull();
    expect(gone?.voided).toEqual(voided);
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

  it("a superseded same-day reading is not 'current' — only the day's standing row is", () => {
    const rows = buildMeasurementLogRows(
      [
        reading("m-ci", "weight", "2026-08-14", 91, { sourceId: "ci-1" }),
        reading("m-coach", "weight", "2026-08-14", 90, {
          source: "coach_entry",
          sourceId: "ci-1",
          recordedAt: "2026-08-14T12:00:00+00:00",
        }),
      ],
      new Map([["weight", [day("m-coach", "2026-08-14", 90)]]]),
      {},
      ORDER,
      DOWN_IS_GOOD
    );

    expect(rows.find((row) => row.id === "m-coach")?.isCurrent).toBe(true);
    expect(rows.find((row) => row.id === "m-ci")?.isCurrent).toBe(false);
  });

  it("orders newest day first, then tab order, then the newest write", () => {
    const rows = buildMeasurementLogRows(
      [
        reading("w-old", "weight", "2026-08-07", 92),
        reading("waist-new", "waist", "2026-08-14", 80),
        reading("w-new-a", "weight", "2026-08-14", 91),
        reading("w-new-b", "weight", "2026-08-14", 90, {
          recordedAt: "2026-08-14T12:00:00+00:00",
        }),
      ],
      new Map(),
      {},
      ORDER,
      DOWN_IS_GOOD
    );

    expect(rows.map((row) => row.id)).toEqual(["w-new-b", "w-new-a", "waist-new", "w-old"]);
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
