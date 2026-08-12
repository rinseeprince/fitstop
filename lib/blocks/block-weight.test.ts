import { describe, expect, it } from "vitest";
import { deriveBlockWeightFacts } from "./block-weight";
import type { MetricPoint } from "@/utils/metric-points";

const point = (date: string, value: number): MetricPoint => ({
  metricId: "weight",
  value,
  date,
  sortKey: `${date}|2||${date}`,
  source: "coach_entry",
  note: null,
  sourceRecordId: date,
});

// Ascending, like the merged series contract.
const POINTS = [
  point("2026-05-20", 84.0),
  point("2026-06-01", 83.2), // exactly on a block start
  point("2026-06-10", 82.5),
  point("2026-06-27", 81.9),
  point("2026-07-15", 81.0),
];

describe("deriveBlockWeightFacts", () => {
  it("past block: start = latest at-or-before startsOn, end = latest inside the window", () => {
    const facts = deriveBlockWeightFacts(POINTS, {
      startsOn: "2026-06-01",
      endsOn: "2026-06-28",
      state: "past",
    });
    expect(facts.start).toEqual({ value: 83.2, date: "2026-06-01" });
    expect(facts.end).toEqual({ value: 81.9, date: "2026-06-27" });
    expect(facts.change).toBeCloseTo(-1.3);
  });

  it("current block: end is the latest entry overall", () => {
    const facts = deriveBlockWeightFacts(POINTS, {
      startsOn: "2026-06-29",
      endsOn: "2026-08-23",
      state: "current",
    });
    expect(facts.start).toEqual({ value: 81.9, date: "2026-06-27" });
    expect(facts.end).toEqual({ value: 81.0, date: "2026-07-15" });
  });

  it("future block: everything null — nothing has happened yet", () => {
    expect(
      deriveBlockWeightFacts(POINTS, {
        startsOn: "2026-09-01",
        endsOn: "2026-09-28",
        state: "future",
      })
    ).toEqual({ start: null, end: null, change: null });
  });

  it("no entry at or before the start: start and change null, never a fabricated zero", () => {
    const facts = deriveBlockWeightFacts(POINTS.slice(2), {
      startsOn: "2026-06-01",
      endsOn: "2026-06-28",
      state: "past",
    });
    expect(facts.start).toBeNull();
    expect(facts.end).toEqual({ value: 81.9, date: "2026-06-27" });
    expect(facts.change).toBeNull();
  });

  it("empty series: all null", () => {
    expect(
      deriveBlockWeightFacts([], {
        startsOn: "2026-06-01",
        endsOn: "2026-06-28",
        state: "current",
      })
    ).toEqual({ start: null, end: null, change: null });
  });

  it("accepts bare {date, value} pairs — the server feeds these", () => {
    const facts = deriveBlockWeightFacts(
      [
        { date: "2026-06-01", value: 83.2 },
        { date: "2026-06-27", value: 81.9 },
      ],
      { startsOn: "2026-06-01", endsOn: "2026-06-28", state: "past" }
    );
    expect(facts.change).toBeCloseTo(-1.3);
  });
});
