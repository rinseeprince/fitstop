import { describe, it, expect } from "vitest";
import { addDaysToDate, dayValuesToMetricPoints, daysBetween } from "./metric-points";
import type { DayValue } from "@/lib/measurements/day-values";

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
    updatedAt: "2026-07-01T08:00:00+00:00",
    measuredAt: null,
    source: "check_in",
    sourceId: null,
    note: null,
    ...overrides,
  });

  it("maps a day-value to a point keyed `date | recordedAt | id`", () => {
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
        sourceRecordId: "m-1",
      },
      {
        metricId: "waist",
        value: 84.5,
        date: "2026-07-02",
        sortKey: "2026-07-02|2026-07-02T09:15:00+00:00|m-2",
        sourceRecordId: "m-2",
      },
    ]);
  });
});
