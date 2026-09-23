import { describe, it, expect } from "vitest";
import {
  averageInWindow,
  buildLogRows,
  compareLastDays,
  deriveFirstWeekChange,
  deriveHeroStats,
  worstOfLastDays,
  type LogRowDefinition,
} from "./metric-derived-stats";
import type { MetricPoint } from "./metric-points";

function pt(
  date: string,
  value: number,
  overrides: Partial<MetricPoint> = {}
): MetricPoint {
  return {
    metricId: "weight",
    value,
    date,
    sortKey: `${date}|${date}T08:00:00Z|m-${date}`,
    sourceRecordId: `m-${date}`,
    ...overrides,
  };
}

describe("deriveHeroStats", () => {
  it("returns null for an empty series", () => {
    expect(deriveHeroStats([], "body", "2026-07-20")).toBeNull();
  });

  it("shows current only for a single point (no change, no rate)", () => {
    const stats = deriveHeroStats([pt("2026-07-15", 80)], "body", "2026-07-20");
    expect(stats).not.toBeNull();
    expect(stats!.current).toEqual({
      value: 80,
      date: "2026-07-15",
      daysAgo: 5,
    });
    expect(stats!.totalChange).toBeNull();
    expect(stats!.avgRate).toBeNull();
    expect(stats!.entries).toEqual({ count: 1, sinceDate: "2026-07-15" });
  });

  it("never rates a wellness metric, even with a wide span, and leaves its total change to the first week", () => {
    const stats = deriveHeroStats(
      [pt("2026-07-01", 5), pt("2026-07-15", 8)],
      "wellness",
      "2026-07-20"
    );
    expect(stats!.avgRate).toBeNull();
    // Without a journey there is no since-start figure: a wellness score's
    // Total change is `deriveFirstWeekChange`'s.
    expect(stats!.totalChange).toBeNull();
  });

  it("withholds the rate when a body span is under 7 days", () => {
    const stats = deriveHeroStats(
      [pt("2026-07-01", 80), pt("2026-07-05", 79)],
      "body",
      "2026-07-20"
    );
    expect(stats!.avgRate).toBeNull();
  });

  it("rates a body metric with 2 points 14 days apart: perWeek = delta / 2", () => {
    const stats = deriveHeroStats(
      [pt("2026-07-01", 80), pt("2026-07-15", 78)],
      "body",
      "2026-07-20"
    );
    expect(stats!.avgRate).toEqual({ perWeek: -1, weeks: 2 });
    expect(stats!.current.daysAgo).toBe(5);
  });
});

// A physique hero is anchored on the JOURNEY (docs/MEASUREMENT-LOG-PLAN.md D4):
// "current" is the newest reading of any date, and every since-start figure
// reads the baseline — the reading as of the start date — never the first
// point. Wellness passes no journey and keeps the first-point anchor above.
describe("deriveHeroStats — a physique journey", () => {
  const today = "2026-08-28";
  const baseline = { value: 92, date: "2026-02-20", source: "intake" as const };

  it("measures total change from the BASELINE, not the first journey point", () => {
    const points = [pt("2026-07-06", 90), pt("2026-07-27", 87)];
    const stats = deriveHeroStats(points, "body", today, {
      current: points[1],
      baseline,
      startDate: "2026-03-01",
    });

    expect(stats!.totalChange).toEqual({
      kind: "sinceStart",
      delta: -5,
      sinceDate: "2026-03-01",
      baseline,
    });
    expect(stats!.startsOn).toBeNull();
    // The rate and the entry count are the journey's own: two readings, three
    // weeks apart — the baseline is not a point of it.
    expect(stats!.avgRate).toEqual({ perWeek: -1, weeks: 3 });
    expect(stats!.entries).toEqual({ count: 2, sinceDate: "2026-07-06" });
  });

  it("reads `Starts …` and no total change while the start date is ahead", () => {
    const points = [pt("2026-07-06", 90), pt("2026-07-27", 87)];
    const stats = deriveHeroStats(points, "body", today, {
      current: points[1],
      baseline,
      startDate: "2026-09-15",
    });

    expect(stats!.startsOn).toBe("2026-09-15");
    expect(stats!.totalChange).toBeNull();
    // "Current" never waits for the start.
    expect(stats!.current).toEqual({ value: 87, date: "2026-07-27", daysAgo: 32 });
  });

  it("counts the start date itself as started", () => {
    const points = [pt(today, 91)];
    const stats = deriveHeroStats(points, "body", today, {
      current: points[0],
      baseline,
      startDate: today,
    });

    expect(stats!.startsOn).toBeNull();
    expect(stats!.totalChange).toEqual({ kind: "sinceStart", delta: -1, sinceDate: today, baseline });
  });

  it("anchors 'current' on the journey's newest reading even when the journey has no points", () => {
    // The only reading predates the start: no points, yet the client has a "now".
    const stats = deriveHeroStats([], "body", today, {
      current: pt("2026-02-20", 92),
      baseline: null,
      startDate: "2026-03-01",
    });

    expect(stats).not.toBeNull();
    expect(stats!.current).toEqual({ value: 92, date: "2026-02-20", daysAgo: 189 });
    expect(stats!.totalChange).toBeNull();
    expect(stats!.avgRate).toBeNull();
    expect(stats!.entries).toEqual({ count: 0, sinceDate: "2026-02-20" });
  });

  it("returns null only when there is no current reading at all", () => {
    expect(
      deriveHeroStats([], "body", today, { current: null, baseline, startDate: "2026-03-01" })
    ).toBeNull();
  });
});

// The windows the Journey's cards read: fixed windows of days ending the
// client's today, averaged, and compared average against average.
describe("averageInWindow", () => {
  it("counts an entry on either end of the window, and none outside it", () => {
    const points = [
      pt("2026-07-09", 6.3),
      pt("2026-07-10", 7.4),
      pt("2026-07-13", 8.2),
      pt("2026-07-16", 5.9),
      pt("2026-07-17", 9.1),
    ];

    // (7.4 + 8.2 + 5.9) / 3 = 7.1666… — shown, and so returned, as 7.2
    expect(averageInWindow(points, "2026-07-10", "2026-07-16")).toBe(7.2);
  });

  it("gives an empty window no average, never a zero", () => {
    const points = [pt("2026-07-01", 4.6), pt("2026-07-30", 5.2)];

    expect(averageInWindow(points, "2026-07-10", "2026-07-16")).toBeNull();
  });

  it("gives no average below the minimum — a wellness score needs three entries", () => {
    const two = [pt("2026-07-11", 6.1), pt("2026-07-14", 7.9)];

    expect(averageInWindow(two, "2026-07-10", "2026-07-16", 3)).toBeNull();
    // (6.1 + 7.9 + 8.6) / 3 = 7.53…
    expect(averageInWindow([...two, pt("2026-07-15", 8.6)], "2026-07-10", "2026-07-16", 3)).toBe(7.5);
    // A measurement's one reading is its average
    expect(averageInWindow(two.slice(0, 1), "2026-07-10", "2026-07-16")).toBe(6.1);
  });
});

describe("compareLastDays", () => {
  const today = "2026-07-20";
  // The last 7 days are 14–20 Jul; the 7 before them 7–13 Jul.
  const points = [
    pt("2026-07-06", 8.8),
    pt("2026-07-07", 4.5),
    pt("2026-07-13", 5.5),
    pt("2026-07-14", 3.5),
    pt("2026-07-17", 4.0),
    pt("2026-07-20", 5.25),
    pt("2026-07-21", 2.7),
  ];

  it("takes the change between the averages as shown: 4.3 against 5.0 is -0.7", () => {
    const comparison = compareLastDays(points, today, 7, false);

    // 12.75 / 3 = 4.25, shown as 4.3; 10 / 2 = 5.0
    expect(comparison.current).toBe(4.3);
    expect(comparison.previous).toBe(5);
    expect(comparison.change).toEqual({ amount: -0.7, trend: "down", tone: "bad" });
    expect(comparison.days).toBe(7);
  });

  it("rounds each average before the change, never the change alone: 4.3 against 5.0 is -0.7, not the -0.8 of 4.26 against 5.04", () => {
    const comparison = compareLastDays(
      [pt("2026-07-08", 4.8), pt("2026-07-11", 5.28), pt("2026-07-15", 3.9), pt("2026-07-19", 4.62)],
      today,
      7,
      false
    );

    expect(comparison.current).toBe(4.3);
    expect(comparison.previous).toBe(5);
    expect(comparison.change?.amount).toBe(-0.7);
  });

  it("tones the change by the metric's good direction", () => {
    expect(compareLastDays(points, today, 7, true).change?.tone).toBe("good");
  });

  it("has no change when the window before is empty — the average stands alone", () => {
    const comparison = compareLastDays(points.slice(3), today, 7, false);

    expect(comparison.current).toBe(4.3);
    expect(comparison.previous).toBeNull();
    expect(comparison.change).toBeNull();
  });

  it("holds both windows to the minimum: three entries this week, two the week before, no change", () => {
    const comparison = compareLastDays(points, today, 7, false, 3);

    expect(comparison.current).toBe(4.3);
    expect(comparison.previous).toBeNull();
    expect(comparison.change).toBeNull();
  });
});

describe("worstOfLastDays", () => {
  const today = "2026-07-20";
  // The last 30 days are 21 Jun–20 Jul.

  it("takes the lowest entry of the window, and the day it was logged", () => {
    const points = [
      pt("2026-06-20", 2),
      pt("2026-06-21", 6),
      pt("2026-07-02", 3),
      pt("2026-07-09", 8),
      pt("2026-07-20", 5),
      pt("2026-07-21", 1),
    ];

    expect(worstOfLastDays(points, today, 30, false)).toEqual({ value: 3, date: "2026-07-02" });
  });

  it("takes the highest where down is good", () => {
    const points = [
      pt("2026-06-20", 10),
      pt("2026-06-22", 3),
      pt("2026-07-04", 9),
      pt("2026-07-12", 6),
      pt("2026-07-20", 2),
    ];

    expect(worstOfLastDays(points, today, 30, true)).toEqual({ value: 9, date: "2026-07-04" });
  });

  it("shows the latest day a score reached on several days was logged", () => {
    const points = [pt("2026-07-03", 4), pt("2026-07-11", 4), pt("2026-07-15", 7)];

    expect(worstOfLastDays(points, today, 30, false)).toEqual({ value: 4, date: "2026-07-11" });
  });

  it("is null when the window holds no entry", () => {
    expect(worstOfLastDays([pt("2026-06-01", 5)], today, 30, false)).toBeNull();
  });
});

describe("deriveFirstWeekChange", () => {
  const today = "2026-07-20";
  // The Wellness hero's minimum: three entries in each week
  const MIN = 3;

  it("compares the last 7 days' average with the client's first week of entries", () => {
    const points = [
      // The first week: 1–7 Jun, the first entry's day and the 6 after
      pt("2026-06-01", 3),
      pt("2026-06-03", 5),
      pt("2026-06-07", 8),
      pt("2026-06-08", 10),
      pt("2026-06-20", 9),
      pt("2026-07-01", 2),
      pt("2026-07-13", 1),
      // The last 7 days: 14–20 Jul
      pt("2026-07-14", 6),
      pt("2026-07-16", 4),
      pt("2026-07-19", 7),
    ];

    // 16 / 3 = 5.33…, shown 5.3; 17 / 3 = 5.67…, shown 5.7 — never the last entry minus the first (7 − 3)
    expect(deriveFirstWeekChange(points, today, MIN)).toEqual({
      kind: "firstWeek",
      delta: 0.4,
      firstWeekOf: "2026-06-01",
    });
  });

  it("is too soon to compare while the first week and the last 7 days share a day", () => {
    // First entry 8 Jul, 12 days before today: its week, 8–14 Jul, ends on
    // the last week's first day. From 7 Jul, 13 days back, the weeks part.
    const recent = [pt("2026-07-15", 6), pt("2026-07-17", 2), pt("2026-07-18", 9)];

    expect(deriveFirstWeekChange([pt("2026-07-08", 4), ...recent], today, MIN)).toEqual({
      kind: "tooSoon",
    });
    // (4 + 3 + 8) / 3 = 5.0 against (6 + 2 + 9) / 3 = 5.67…, shown 5.7
    expect(
      deriveFirstWeekChange(
        [pt("2026-07-07", 4), pt("2026-07-10", 3), pt("2026-07-12", 8), ...recent],
        today,
        MIN
      )
    ).toEqual({ kind: "firstWeek", delta: 0.7, firstWeekOf: "2026-07-07" });
  });

  it("has not enough entries when the last 7 days hold fewer than three", () => {
    expect(deriveFirstWeekChange([pt("2026-06-01", 3), pt("2026-07-13", 1)], today, MIN)).toEqual({
      kind: "notEnoughEntries",
    });
    // Said the same way for a client whose first entry is recent
    expect(deriveFirstWeekChange([pt("2026-07-10", 2)], today, MIN)).toEqual({
      kind: "notEnoughEntries",
    });
    const firstWeek = [pt("2026-06-01", 3), pt("2026-06-02", 5), pt("2026-06-04", 8)];
    expect(
      deriveFirstWeekChange([...firstWeek, pt("2026-07-15", 6), pt("2026-07-18", 9)], today, MIN)
    ).toEqual({ kind: "notEnoughEntries" });
  });

  it("has not enough entries for good when the first week held fewer than three", () => {
    const lastWeek = [pt("2026-07-15", 6), pt("2026-07-17", 2), pt("2026-07-18", 9)];

    expect(
      deriveFirstWeekChange([pt("2026-06-01", 3), pt("2026-06-05", 5), ...lastWeek], today, MIN)
    ).toEqual({ kind: "notEnoughEntries" });
  });

  it("is null with no entry at all", () => {
    expect(deriveFirstWeekChange([], today, MIN)).toBeNull();
  });
});

describe("buildLogRows", () => {
  const definitions: LogRowDefinition[] = [
    { id: "weight", category: "body" },
    { id: "waist", category: "body" },
    { id: "stress", category: "wellness" },
  ];
  const downIsGood: ReadonlySet<string> = new Set(["weight", "waist", "stress"]);

  it("orders newest-first by date, then definition order; deltas are per-metric", () => {
    const points = new Map<string, MetricPoint[]>([
      ["weight", [pt("2026-07-01", 80), pt("2026-07-03", 79)]],
      ["waist", [pt("2026-07-01", 90.2), pt("2026-07-03", 90)]],
      ["stress", [pt("2026-07-02", 7)]],
    ]);

    const rows = buildLogRows(points, definitions, "body", downIsGood);

    expect(rows.map((r) => [r.metricId, r.date])).toEqual([
      ["weight", "2026-07-03"],
      ["waist", "2026-07-03"],
      ["weight", "2026-07-01"],
      ["waist", "2026-07-01"],
    ]);

    // first entry of each metric has no change
    expect(rows[2].change).toBeNull();
    expect(rows[3].change).toBeNull();

    // weight -1 with downIsGood -> good
    expect(rows[0].change).toEqual({ amount: -1, tone: "good" });

    // waist -0.2 is toned the way the row prints it: down, and down is good for
    // waist. (A 0.5 deadband used to grey this out under a printed "-0.2".)
    expect(rows[1].change!.amount).toBeCloseTo(-0.2);
    expect(rows[1].change!.tone).toBe("good");
  });

  it("emits rows only for the requested category, with stress drops toned good", () => {
    const points = new Map<string, MetricPoint[]>([
      ["weight", [pt("2026-07-01", 80), pt("2026-07-02", 79)]],
      ["stress", [pt("2026-07-01", 8), pt("2026-07-02", 5)]],
    ]);

    const rows = buildLogRows(points, definitions, "wellness", downIsGood);

    expect(rows.map((r) => r.metricId)).toEqual(["stress", "stress"]);
    expect(rows[0]).toMatchObject({
      date: "2026-07-02",
      value: 5,
      change: { amount: -3, tone: "good" }, // inverted: falling stress is good
    });
    expect(rows[1].change).toBeNull();
  });
});
