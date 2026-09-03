import { describe, it, expect } from "vitest";
import { dayValues, type MeasurementReading } from "./day-values";

// Every fixture value is distinct, so a wrong pick is a wrong number. A
// reading is untouched since it was written unless a test says otherwise.
function reading(
  overrides: Partial<MeasurementReading> & Pick<MeasurementReading, "id" | "value" | "date">
): MeasurementReading {
  const recordedAt = overrides.recordedAt ?? `${overrides.date}T08:00:00+00:00`;
  return {
    metricKey: "weight",
    recordedAt,
    updatedAt: recordedAt,
    measuredAt: null,
    source: "check_in",
    sourceId: null,
    note: null,
    ...overrides,
  };
}

describe("dayValues — rule 2, the day's value is the reading written last (D23)", () => {
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

  it("an edit never moves a reading: an older reading edited after a later add stays behind it", () => {
    const series = dayValues([
      // The check-in's row, written in the morning and edited in the evening.
      reading({
        id: "e",
        value: 81.3,
        date: "2026-05-06",
        recordedAt: "2026-05-06T07:00:00+00:00",
        updatedAt: "2026-05-06T21:00:00+00:00",
        source: "check_in",
        sourceId: "ci-1",
      }),
      // A coach reading added at noon, untouched since — still the day's value.
      reading({ id: "f", value: 81.8, date: "2026-05-06", recordedAt: "2026-05-06T12:00:00+00:00", source: "coach_entry" }),
    ]);
    expect(series.get("weight")?.[0]).toMatchObject({ id: "f", value: 81.8 });
  });

  it("an edit of the reading written last changes the day's value in place", () => {
    const series = dayValues([
      reading({ id: "g", value: 82.2, date: "2026-05-07", recordedAt: "2026-05-07T07:00:00+00:00", source: "coach_entry" }),
      reading({
        id: "h",
        value: 82.7,
        date: "2026-05-07",
        recordedAt: "2026-05-07T15:00:00+00:00",
        updatedAt: "2026-05-08T09:00:00+00:00",
        source: "check_in",
        sourceId: "ci-2",
      }),
    ]);
    expect(series.get("weight")?.[0]).toMatchObject({ id: "h", value: 82.7 });
  });

  it("returns one value per day, ascending by day, whatever the input order", () => {
    const series = dayValues([
      reading({ id: "k", value: 77.7, date: "2026-05-11" }),
      reading({ id: "i", value: 78.3, date: "2026-05-09" }),
      reading({ id: "j", value: 78.0, date: "2026-05-10" }),
    ]);
    expect(series.get("weight")?.map((v) => v.date)).toEqual(["2026-05-09", "2026-05-10", "2026-05-11"]);
  });

  it("groups by metric, so a waist and a weight on one day are two values", () => {
    const series = dayValues([
      reading({ id: "l", value: 76.4, date: "2026-05-12" }),
      reading({ id: "m", value: 83.5, date: "2026-05-12", metricKey: "waist" }),
    ]);
    expect(series.get("weight")?.[0].value).toBe(76.4);
    expect(series.get("waist")?.[0].value).toBe(83.5);
  });

  it("breaks an identical recorded_at deterministically, by id, never by arrival order", () => {
    const first = dayValues([
      reading({ id: "n", value: 75.1, date: "2026-05-13", recordedAt: "2026-05-13T12:00:00+00:00" }),
      reading({ id: "o", value: 75.8, date: "2026-05-13", recordedAt: "2026-05-13T12:00:00+00:00" }),
    ]);
    const reversed = dayValues([
      reading({ id: "o", value: 75.8, date: "2026-05-13", recordedAt: "2026-05-13T12:00:00+00:00" }),
      reading({ id: "n", value: 75.1, date: "2026-05-13", recordedAt: "2026-05-13T12:00:00+00:00" }),
    ]);
    expect(first.get("weight")?.[0].id).toBe("o");
    expect(reversed.get("weight")?.[0].id).toBe("o");
  });

  it("is empty for no readings", () => {
    expect(dayValues([]).size).toBe(0);
  });
});
