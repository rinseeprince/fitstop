import { describe, it, expect } from "vitest";
import { dayValues, type MeasurementReading } from "./day-values";

// Every fixture value is distinct, so a wrong pick is a wrong number.
function reading(
  overrides: Partial<MeasurementReading> & Pick<MeasurementReading, "id" | "value" | "date">
): MeasurementReading {
  return {
    metricKey: "weight",
    recordedAt: `${overrides.date}T08:00:00+00:00`,
    measuredAt: null,
    source: "check_in",
    sourceId: null,
    note: null,
    ...overrides,
  };
}

describe("dayValues — rule 2, the value for a day is the latest row by recorded_at", () => {
  it("keeps the later write when two rows share a day, whatever their sources", () => {
    const series = dayValues([
      reading({ id: "a", value: 80.1, date: "2026-05-04", recordedAt: "2026-05-04T10:00:00+00:00", source: "coach_entry" }),
      reading({ id: "b", value: 80.6, date: "2026-05-04", recordedAt: "2026-05-04T07:00:00+00:00", source: "check_in" }),
    ]);
    expect(series.get("weight")?.map((v) => v.value)).toEqual([80.1]);
  });

  it("does not rank sources: a check-in written after a coach entry wins the day", () => {
    const series = dayValues([
      reading({ id: "c", value: 79.2, date: "2026-05-05", recordedAt: "2026-05-05T09:00:00+00:00", source: "coach_entry" }),
      reading({ id: "d", value: 79.9, date: "2026-05-05", recordedAt: "2026-05-05T21:00:00+00:00", source: "check_in" }),
    ]);
    expect(series.get("weight")?.[0].id).toBe("d");
  });

  it("returns one value per day, ascending by day, whatever the input order", () => {
    const series = dayValues([
      reading({ id: "g", value: 77.7, date: "2026-05-09" }),
      reading({ id: "e", value: 78.3, date: "2026-05-07" }),
      reading({ id: "f", value: 78.0, date: "2026-05-08" }),
    ]);
    expect(series.get("weight")?.map((v) => v.date)).toEqual(["2026-05-07", "2026-05-08", "2026-05-09"]);
  });

  it("groups by metric, so a waist and a weight on one day are two values", () => {
    const series = dayValues([
      reading({ id: "h", value: 76.4, date: "2026-05-10" }),
      reading({ id: "i", value: 81.5, date: "2026-05-10", metricKey: "waist" }),
    ]);
    expect(series.get("weight")?.[0].value).toBe(76.4);
    expect(series.get("waist")?.[0].value).toBe(81.5);
  });

  it("breaks an identical recorded_at deterministically, by id, never by arrival order", () => {
    const first = dayValues([
      reading({ id: "j", value: 75.1, date: "2026-05-11", recordedAt: "2026-05-11T12:00:00+00:00" }),
      reading({ id: "k", value: 75.8, date: "2026-05-11", recordedAt: "2026-05-11T12:00:00+00:00" }),
    ]);
    const reversed = dayValues([
      reading({ id: "k", value: 75.8, date: "2026-05-11", recordedAt: "2026-05-11T12:00:00+00:00" }),
      reading({ id: "j", value: 75.1, date: "2026-05-11", recordedAt: "2026-05-11T12:00:00+00:00" }),
    ]);
    expect(first.get("weight")?.[0].id).toBe("k");
    expect(reversed.get("weight")?.[0].id).toBe("k");
  });

  it("is empty for no readings", () => {
    expect(dayValues([]).size).toBe(0);
  });
});
