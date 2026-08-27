import { describe, expect, it } from "vitest";
import { rollingAverage, weeklyRate, type SeriesPoint } from "./rolling-average";

const p = (date: string, value: number): SeriesPoint => ({ date, value });

// Rounded because a mean of three decimals is not what these tests are about.
const values = (points: SeriesPoint[]) =>
  points.map((point) => Math.round(point.value * 100) / 100);

describe("rollingAverage", () => {
  it("returns an empty series for no points", () => {
    expect(rollingAverage([])).toEqual([]);
  });

  it("returns the raw value for a single point", () => {
    expect(rollingAverage([p("2026-08-01", 90)])).toEqual([p("2026-08-01", 90)]);
  });

  it("averages over calendar days, not sample count", () => {
    // Daily points: the 7-day mean at day 7 covers days 1-7.
    const daily = Array.from({ length: 7 }, (_, i) =>
      p(`2026-08-0${i + 1}`, i + 1)
    );
    const out = rollingAverage(daily, 7);
    expect(values(out)).toEqual([1, 1.5, 2, 2.5, 3, 3.5, 4]);
  });

  it("drops points that fall outside the trailing span", () => {
    // Day 8 averages days 2-8 (mean 5), day 9 averages days 3-9 (mean 6).
    const out = rollingAverage(
      Array.from({ length: 9 }, (_, i) => p(`2026-08-0${i + 1}`, i + 1)),
      7
    );
    expect(values(out).slice(-2)).toEqual([5, 6]);
  });

  it("keeps a point dated exactly span-1 days back", () => {
    // 7-day span is inclusive of today, so Aug 1 is still in Aug 7's window.
    const out = rollingAverage([p("2026-08-01", 10), p("2026-08-07", 20)], 7);
    expect(values(out)).toEqual([10, 15]);
  });

  it("excludes a point one day beyond the span", () => {
    const out = rollingAverage([p("2026-08-01", 10), p("2026-08-08", 20)], 7);
    expect(values(out)).toEqual([10, 20]);
  });

  it("smooths a sparse and a dense series by the same amount of TIME", () => {
    // Both cover Aug 1-8 and end on the same value; a k-samples mean would
    // smooth the dense one far more. A k-days mean treats them alike.
    const sparse = rollingAverage([p("2026-08-01", 100), p("2026-08-08", 90)], 7);
    const dense = rollingAverage(
      [
        p("2026-08-01", 100),
        p("2026-08-02", 100),
        p("2026-08-07", 100),
        p("2026-08-08", 90),
      ],
      7
    );
    // Aug 1 has dropped out of both windows by Aug 8: the sparse series has
    // only Aug 8 left, the dense one still has Aug 2 and Aug 7.
    expect(values(sparse).at(-1)).toBe(90);
    expect(values(dense).at(-1)).toBe(96.67);
  });

  it("emits one mean per input point, index-aligned with the raw dots", () => {
    const raw = [p("2026-08-01", 1), p("2026-08-05", 2), p("2026-08-30", 3)];
    const out = rollingAverage(raw);
    expect(out).toHaveLength(raw.length);
    expect(out.map((point) => point.date)).toEqual(raw.map((point) => point.date));
  });
});

describe("weeklyRate", () => {
  it("returns null below two points", () => {
    expect(weeklyRate([])).toBeNull();
    expect(weeklyRate([p("2026-08-01", 90)])).toBeNull();
  });

  it("returns null when the series spans less than a week", () => {
    // Two readings two days apart would extrapolate to -17.5/week.
    expect(weeklyRate([p("2026-08-01", 95), p("2026-08-03", 90)])).toBeNull();
  });

  it("reports change per week across exactly one week", () => {
    expect(weeklyRate([p("2026-08-01", 90), p("2026-08-08", 89)])).toBeCloseTo(-1, 5);
  });

  it("divides by the span the data covers, not the selected window", () => {
    // Two readings a fortnight apart: -1kg/week, whatever window is selected.
    expect(weeklyRate([p("2026-08-01", 90), p("2026-08-15", 88)])).toBeCloseTo(-1, 5);
  });

  it("is positive for a gaining client", () => {
    expect(weeklyRate([p("2026-08-01", 80), p("2026-08-15", 82)])).toBeCloseTo(1, 5);
  });

  it("reads only the endpoints, so interior noise does not move it", () => {
    const withNoise = [
      p("2026-08-01", 90),
      p("2026-08-04", 97),
      p("2026-08-08", 89),
    ];
    expect(weeklyRate(withNoise)).toBeCloseTo(-1, 5);
  });
});
