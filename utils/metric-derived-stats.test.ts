import { describe, it, expect } from "vitest";
import {
  buildLogRows,
  deriveBest,
  deriveHeroStats,
  deriveWeekComparison,
  deriveWindowChange,
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
    sortKey: `${date}|1|${date}T08:00:00Z|ci-${date}`,
    source: "check_in",
    note: null,
    sourceRecordId: `ci-${date}`,
    ...overrides,
  };
}

function coachPt(
  date: string,
  value: number,
  note: string | null = null
): MetricPoint {
  return {
    metricId: "weight",
    value,
    date,
    sortKey: `${date}|2||e-${date}`,
    source: "coach_entry",
    note,
    sourceRecordId: `e-${date}`,
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

  it("never rates a wellness metric, even with a wide span", () => {
    const stats = deriveHeroStats(
      [pt("2026-07-01", 5), pt("2026-07-15", 8)],
      "wellness",
      "2026-07-20"
    );
    expect(stats!.avgRate).toBeNull();
    expect(stats!.totalChange).toEqual({ delta: 3, sinceDate: "2026-07-01" });
  });

  it("withholds the rate when a body span is under 7 days", () => {
    const stats = deriveHeroStats(
      [pt("2026-07-01", 80), pt("2026-07-05", 79)],
      "body",
      "2026-07-20"
    );
    expect(stats!.avgRate).toBeNull();
    expect(stats!.totalChange).toEqual({ delta: -1, sinceDate: "2026-07-01" });
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

    expect(stats!.totalChange).toEqual({ delta: -5, sinceDate: "2026-03-01", baseline });
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
    expect(stats!.totalChange).toEqual({ delta: -1, sinceDate: today, baseline });
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

describe("deriveWindowChange", () => {
  it("returns null with fewer than 2 points", () => {
    expect(deriveWindowChange([], true)).toBeNull();
    expect(deriveWindowChange([pt("2026-07-01", 80)], true)).toBeNull();
  });

  it("falls back to sinceFirst when history is shorter than 30 days", () => {
    const change = deriveWindowChange(
      [pt("2026-07-01", 80), pt("2026-07-20", 78)],
      true
    );
    expect(change).toEqual({
      kind: "sinceFirst",
      delta: -2,
      sinceDate: "2026-07-01",
      trend: "down",
      tone: "good",
    });
  });

  it("baselines on the point nearest to latest-minus-30-days", () => {
    // latest 07-31 -> target 07-01. 06-28 (3 days off) beats 05-01 and 07-05.
    const change = deriveWindowChange(
      [
        pt("2026-05-01", 90),
        pt("2026-06-28", 85),
        pt("2026-07-05", 82),
        pt("2026-07-31", 80),
      ],
      true
    );
    expect(change).toEqual({
      kind: "30day",
      delta: -5,
      trend: "down",
      tone: "good",
    });
    expect(change!.sinceDate).toBeUndefined();
  });

  it("keeps the EARLIER point on an equidistant tie", () => {
    // target 07-01: 06-29 and 07-03 are both 2 days away -> 06-29 (v 90) wins.
    const change = deriveWindowChange(
      [
        pt("2026-06-01", 100),
        pt("2026-06-29", 90),
        pt("2026-07-03", 70),
        pt("2026-07-31", 80),
      ],
      true
    );
    expect(change!.kind).toBe("30day");
    expect(change!.delta).toBe(-10);
  });

  it("tones a falling non-downIsGood metric (energy) as bad", () => {
    const change = deriveWindowChange(
      [pt("2026-07-01", 10), pt("2026-07-10", 6)],
      false
    );
    expect(change!.trend).toBe("down");
    expect(change!.tone).toBe("bad");
  });

  it("reads a move the size of the number shown - 0.3 kg up is up, not stable", () => {
    // The card prints "+0.3" over the trend word; under the 0.5 cut-off this
    // helper used to apply, that read "Holding steady" in grey.
    const change = deriveWindowChange(
      [pt("2026-07-01", 80), pt("2026-07-10", 80.3)],
      true
    );
    expect(change!.delta).toBeCloseTo(0.3);
    expect(change!.trend).toBe("up");
    expect(change!.tone).toBe("bad"); // downIsGood: rising weight is the wrong way
  });

  it("is stable only when the change rounds to nothing at one decimal", () => {
    const change = deriveWindowChange(
      [pt("2026-07-01", 80), pt("2026-07-10", 80.04)],
      true
    );
    expect(change!.trend).toBe("stable");
    expect(change!.tone).toBe("neutral");
  });
});

describe("deriveWeekComparison", () => {
  const today = "2026-07-20";

  it("averages both 7-day windows when each has points", () => {
    const comparison = deriveWeekComparison(
      [
        pt("2026-07-08", 84),
        pt("2026-07-12", 86),
        pt("2026-07-15", 80),
        pt("2026-07-19", 82),
      ],
      today
    );
    expect(comparison).toEqual({ kind: "weekAvg", currentAvg: 81, prevAvg: 85 });
  });

  it("falls back to the latest point when the previous week is empty", () => {
    const comparison = deriveWeekComparison(
      [pt("2026-07-15", 80), pt("2026-07-19", 82)],
      today
    );
    expect(comparison).toEqual({
      kind: "latest",
      value: 82,
      date: "2026-07-19",
    });
  });

  it("returns null for an empty series", () => {
    expect(deriveWeekComparison([], today)).toBeNull();
  });
});

describe("deriveBest", () => {
  it("returns null for an empty series", () => {
    expect(deriveBest([], true)).toBeNull();
  });

  it("takes the minimum when down is good, earliest tie wins", () => {
    const best = deriveBest(
      [pt("2026-07-01", 80), pt("2026-07-05", 78), pt("2026-07-10", 78)],
      true
    );
    expect(best).toEqual({ value: 78, date: "2026-07-05" });
  });

  it("takes the maximum when up is good, earliest tie wins", () => {
    const best = deriveBest(
      [
        pt("2026-07-01", 5),
        pt("2026-07-05", 9),
        pt("2026-07-08", 9),
        pt("2026-07-10", 7),
      ],
      false
    );
    expect(best).toEqual({ value: 9, date: "2026-07-05" });
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
      ["weight", [pt("2026-07-01", 80), coachPt("2026-07-03", 79, "gym scale")]],
      // check-in point carrying a stray note: it must NOT surface on the row
      ["waist", [pt("2026-07-01", 90.2), pt("2026-07-03", 90, { note: "stray" })]],
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

    // weight -1 with downIsGood -> good; note only on the coach_entry row
    expect(rows[0].change).toEqual({ amount: -1, tone: "good" });
    expect(rows[0].source).toBe("coach_entry");
    expect(rows[0].note).toBe("gym scale");

    // waist -0.2 is toned the way the row prints it: down, and down is good for
    // waist. (A 0.5 deadband used to grey this out under a printed "-0.2".)
    expect(rows[1].change!.amount).toBeCloseTo(-0.2);
    expect(rows[1].change!.tone).toBe("good");
    expect(rows[1].source).toBe("check_in");
    expect(rows[1].note).toBeNull();
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
