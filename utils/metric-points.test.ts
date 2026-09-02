import { describe, it, expect } from "vitest";
import {
  addDaysToDate,
  buildMetricPoints,
  dayValuesToMetricPoints,
  daysBetween,
  type MetricSeriesDefinition,
} from "./metric-points";
import type { CheckIn } from "@/types/check-in";
import type { MetricEntry } from "@/types/metric-entries";
import type { DayValue } from "@/lib/measurements/day-values";

// Wellness definitions only: the merge is the Wellness pane's. A physique
// metric never enters it — its series is the measurement log's.
const definitions: MetricSeriesDefinition[] = [
  { id: "energy", key: "energy" },
  { id: "mood", key: "mood" },
];

function checkIn(
  id: string,
  createdAt: string,
  fields: Partial<CheckIn> = {}
): CheckIn {
  return {
    id,
    clientId: "client-1",
    status: "reviewed",
    createdAt,
    updatedAt: createdAt,
    ...fields,
  };
}

function entry(
  id: string,
  metricKey: MetricEntry["metricKey"],
  entryDate: string,
  value: number,
  note?: string
): MetricEntry {
  return {
    id,
    clientId: "client-1",
    metricKey,
    value,
    entryDate,
    note,
    createdBy: "coach-1",
    createdAt: `${entryDate}T12:00:00Z`,
    updatedAt: `${entryDate}T12:00:00Z`,
  };
}

describe("buildMetricPoints", () => {
  it("maps check-in values per definition key and skips absent values", () => {
    const points = buildMetricPoints(
      [checkIn("ci-1", "2026-07-01T08:30:00Z", { energy: 7 })], // no mood
      [],
      definitions
    );

    expect(points.get("energy")).toHaveLength(1);
    expect(points.get("energy")![0]).toMatchObject({
      metricId: "energy",
      value: 7,
      source: "check_in",
      note: null,
      sourceRecordId: "ci-1",
    });
    expect(points.get("mood")).toEqual([]);
  });

  it("dates a check-in point by createdAt's date part", () => {
    const points = buildMetricPoints(
      [checkIn("ci-1", "2026-07-01T23:59:59Z", { energy: 7 })],
      [],
      definitions
    );

    expect(points.get("energy")![0].date).toBe("2026-07-01");
  });

  it("appends coach entries with their note", () => {
    const points = buildMetricPoints(
      [],
      [entry("e-1", "energy", "2026-07-02", 6, "flat after travel")],
      definitions
    );

    expect(points.get("energy")).toHaveLength(1);
    expect(points.get("energy")![0]).toMatchObject({
      metricId: "energy",
      value: 6,
      date: "2026-07-02",
      source: "coach_entry",
      note: "flat after travel",
      sourceRecordId: "e-1",
    });
  });

  it("sorts a same-date check-in BEFORE the coach entry (coach entry wins latest)", () => {
    const points = buildMetricPoints(
      [checkIn("ci-1", "2026-07-02T09:00:00Z", { energy: 7 })],
      [entry("e-1", "energy", "2026-07-02", 5)],
      definitions
    );

    const series = points.get("energy")!;
    expect(series.map((p) => p.source)).toEqual(["check_in", "coach_entry"]);
    expect(series[1].value).toBe(5); // the coach's explicit entry is latest
  });

  it("orders multiple same-date check-ins by createdAt, then id", () => {
    const points = buildMetricPoints(
      [
        checkIn("ci-late", "2026-07-02T18:00:00Z", { energy: 8 }),
        checkIn("ci-early", "2026-07-02T06:00:00Z", { energy: 7 }),
        // same createdAt as ci-late — the record id breaks the tie (a < l)
        checkIn("ci-a", "2026-07-02T18:00:00Z", { energy: 9 }),
      ],
      [],
      definitions
    );

    expect(points.get("energy")!.map((p) => p.sourceRecordId)).toEqual([
      "ci-early",
      "ci-a",
      "ci-late",
    ]);
  });

  it("skips coach entries whose metricKey has no definition", () => {
    const points = buildMetricPoints(
      [],
      [entry("e-1", "stress", "2026-07-02", 4)], // no stress definition here
      definitions
    );

    expect(points.has("stress")).toBe(false);
    expect(points.get("energy")).toEqual([]);
  });

  it("returns each series in ascending date order regardless of input order", () => {
    const points = buildMetricPoints(
      [
        checkIn("ci-2", "2026-07-10T08:00:00Z", { energy: 6 }),
        checkIn("ci-1", "2026-07-01T08:00:00Z", { energy: 7 }),
      ],
      [entry("e-1", "energy", "2026-07-05", 5)],
      definitions
    );

    expect(points.get("energy")!.map((p) => p.date)).toEqual([
      "2026-07-01",
      "2026-07-05",
      "2026-07-10",
    ]);
  });
});

describe("daysBetween", () => {
  it("is positive when `to` is later, negative when earlier", () => {
    expect(daysBetween("2026-07-01", "2026-07-08")).toBe(7);
    expect(daysBetween("2026-07-08", "2026-07-01")).toBe(-7);
    expect(daysBetween("2026-07-01", "2026-07-01")).toBe(0);
  });
});

describe("addDaysToDate", () => {
  it("rolls over month and year boundaries", () => {
    expect(addDaysToDate("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDaysToDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDaysToDate("2026-07-15", 0)).toBe("2026-07-15");
  });
});

describe("dayValuesToMetricPoints", () => {
  const dayValue = (overrides: Partial<DayValue> = {}): DayValue => ({
    id: "m-1",
    metricKey: "weight",
    value: 80,
    date: "2026-07-01",
    recordedAt: "2026-07-01T08:00:00+00:00",
    measuredAt: null,
    source: "check_in",
    sourceId: null,
    note: null,
    ...overrides,
  });

  it("maps a day-value to a point keyed `date | recordedAt | id`, carrying its source and note", () => {
    const points = dayValuesToMetricPoints([
      dayValue(),
      dayValue({
        id: "m-2",
        metricKey: "waist",
        value: 84.5,
        date: "2026-07-02",
        recordedAt: "2026-07-02T09:15:00+00:00",
        source: "client_log",
        note: "post-run",
        sourceId: "log-9",
      }),
    ]);

    // No source rank in the key: the log already holds one value per day.
    expect(points).toEqual([
      {
        metricId: "weight",
        value: 80,
        date: "2026-07-01",
        sortKey: "2026-07-01|2026-07-01T08:00:00+00:00|m-1",
        source: "check_in",
        note: null,
        sourceRecordId: "m-1",
      },
      {
        metricId: "waist",
        value: 84.5,
        date: "2026-07-02",
        sortKey: "2026-07-02|2026-07-02T09:15:00+00:00|m-2",
        source: "client_log",
        note: "post-run",
        sourceRecordId: "m-2",
      },
    ]);
  });
});
