import { describe, it, expect } from "vitest";
import { wellnessDayValues, type WellnessLogDay } from "./day-values";
import { WELLNESS_KEYS, type WellnessKey } from "./keys";

const log = (
  id: string,
  date: string,
  values: Partial<Record<WellnessKey, number>>,
  updatedAt = `${date}T21:00:00+00:00`
): WellnessLogDay => ({
  id,
  date,
  updatedAt,
  mood: null,
  energy: null,
  sleep: null,
  stress: null,
  soreness: null,
  ...values,
});

describe("wellnessDayValues", () => {
  it("emits every one of the five metrics, empty when no row carries a reading of it", () => {
    const series = wellnessDayValues([log("w-1", "2026-05-11", { mood: 3 })]);

    expect([...WELLNESS_KEYS]).toEqual(["mood", "energy", "sleep", "stress", "soreness"]);
    expect([...series.keys()]).toEqual([...WELLNESS_KEYS]);
    expect(series.get("mood")).toHaveLength(1);
    for (const key of WELLNESS_KEYS) {
      if (key !== "mood") expect(series.get(key)).toEqual([]);
    }
    expect([...wellnessDayValues([]).keys()]).toEqual([...WELLNESS_KEYS]);
    expect(wellnessDayValues([]).get("soreness")).toEqual([]);
  });

  it("yields one point per non-null column of a day's row, with the row's id and last write", () => {
    const series = wellnessDayValues([
      log("w-1", "2026-05-11", { mood: 3, energy: 7, sleep: 6, stress: 4 }, "2026-05-11T08:15:00+00:00"),
    ]);

    expect(series.get("mood")).toEqual([
      { metricKey: "mood", date: "2026-05-11", value: 3, id: "w-1", recordedAt: "2026-05-11T08:15:00+00:00" },
    ]);
    expect(series.get("energy")?.[0].value).toBe(7);
    expect(series.get("sleep")?.[0].value).toBe(6);
    expect(series.get("stress")?.[0].value).toBe(4);
    expect(series.get("soreness")).toEqual([]);
  });

  it("a null column is no reading of that metric that day, and the others still stand", () => {
    const series = wellnessDayValues([log("w-1", "2026-05-11", { mood: 4, sleep: 8 })]);

    expect(series.get("soreness")).toEqual([]);
    expect(series.get("energy")).toEqual([]);
    expect(series.get("mood")?.map((p) => p.value)).toEqual([4]);
    expect(series.get("sleep")?.map((p) => p.value)).toEqual([8]);
  });

  it("never lets one metric's value land under another key", () => {
    const series = wellnessDayValues([log("w-1", "2026-05-11", { stress: 9 })]);

    expect(series.get("stress")?.[0].value).toBe(9);
    expect(series.get("mood")).toEqual([]);
    expect(series.get("energy")).toEqual([]);
    expect(series.get("sleep")).toEqual([]);
    expect(series.get("soreness")).toEqual([]);
  });

  it("ascends by day within each metric whatever the input order", () => {
    const series = wellnessDayValues([
      log("w-3", "2026-05-13", { mood: 5 }),
      log("w-1", "2026-05-11", { mood: 3 }),
      log("w-2", "2026-05-12", { mood: 2 }),
    ]);

    expect(series.get("mood")?.map((p) => p.date)).toEqual([
      "2026-05-11",
      "2026-05-12",
      "2026-05-13",
    ]);
  });

  it("an edited or backfilled past day keeps its place and stays one point — the series is by day, never by write time", () => {
    const series = wellnessDayValues([
      // Edited on the 20th: the row's last write is later than every other row's.
      log("w-1", "2026-05-01", { mood: 1 }, "2026-05-20T09:00:00+00:00"),
      log("w-2", "2026-05-02", { mood: 2 }, "2026-05-02T21:00:00+00:00"),
      log("w-3", "2026-05-03", { mood: 3 }, "2026-05-03T21:00:00+00:00"),
      // Backfilled on the 21st, for a day before all of them.
      log("w-0", "2026-04-30", { mood: 4 }, "2026-05-21T09:00:00+00:00"),
    ]);

    expect(series.get("mood")?.map((p) => [p.date, p.value])).toEqual([
      ["2026-04-30", 4],
      ["2026-05-01", 1],
      ["2026-05-02", 2],
      ["2026-05-03", 3],
    ]);
  });

  it("two rows for one day — unreachable from the store — resolve to the later write, deterministically", () => {
    const series = wellnessDayValues([
      log("w-a", "2026-05-11", { mood: 2 }, "2026-05-11T08:00:00+00:00"),
      log("w-b", "2026-05-11", { mood: 3 }, "2026-05-11T09:00:00+00:00"),
    ]);

    expect(series.get("mood")).toHaveLength(1);
    expect(series.get("mood")?.[0]).toMatchObject({ id: "w-b", value: 3 });
  });
});
