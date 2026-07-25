import { describe, it, expect } from "vitest";
import {
  buildLogRows,
  deriveBest,
  deriveFrequencyLabel,
  deriveHeroStats,
  deriveWeekComparison,
  deriveWindowChange,
} from "./metric-derived-stats";
import {
  addDaysToDate,
  type MetricPoint,
  type MetricSeriesDefinition,
} from "./metric-points";

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

function series(...dates: string[]): MetricPoint[] {
  return dates.map((d) => pt(d, 1));
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

describe("deriveFrequencyLabel", () => {
  it("returns null with fewer than 2 distinct dates", () => {
    expect(deriveFrequencyLabel([])).toBeNull();
    expect(deriveFrequencyLabel(series("2026-07-01"))).toBeNull();
  });

  it("collapses duplicate dates (check-in + coach entry on one day)", () => {
    // Two points, one logging day — still not enough for a gap.
    expect(
      deriveFrequencyLabel([pt("2026-07-01", 80), coachPt("2026-07-01", 79)])
    ).toBeNull();
  });

  it("labels a median gap of exactly 1.5 as daily", () => {
    // gaps [1, 2] -> median 1.5
    expect(
      deriveFrequencyLabel(series("2026-07-01", "2026-07-02", "2026-07-04"))
    ).toBe("daily");
  });

  it("labels a 2-day gap as 4x/week (round(7/2) = 4)", () => {
    expect(
      deriveFrequencyLabel(series("2026-07-01", "2026-07-03", "2026-07-05"))
    ).toBe("4x/week");
  });

  it("labels a 3-day gap as 2x/week (round(7/3) = 2)", () => {
    expect(
      deriveFrequencyLabel(series("2026-07-01", "2026-07-04", "2026-07-07"))
    ).toBe("2x/week");
  });

  it("takes the mean of the middle two gaps on an even count: [4, 5] -> 4.5 -> 2x/week", () => {
    expect(
      deriveFrequencyLabel(series("2026-07-01", "2026-07-05", "2026-07-10"))
    ).toBe("2x/week");
  });

  it("labels a 7-day gap as weekly", () => {
    expect(
      deriveFrequencyLabel(series("2026-07-01", "2026-07-08", "2026-07-15"))
    ).toBe("weekly");
  });

  it("labels a 15-day gap as fortnightly", () => {
    expect(
      deriveFrequencyLabel(series("2026-07-01", "2026-07-16", "2026-07-31"))
    ).toBe("fortnightly");
  });

  it("labels a 30-day gap as monthly", () => {
    expect(
      deriveFrequencyLabel(series("2026-01-01", "2026-01-31", "2026-03-02"))
    ).toBe("monthly");
  });

  it("labels a 60-day gap as occasional", () => {
    expect(
      deriveFrequencyLabel(series("2026-01-01", "2026-03-02", "2026-05-01"))
    ).toBe("occasional");
  });

  it("considers only the most recent 12 gaps", () => {
    // 13 gaps chronologically: [2, 7x6, 30x6]. All 13 -> median 7 (weekly);
    // the last 12 -> median (7+30)/2 = 18.5 (fortnightly). The label proves
    // the earliest gap was dropped.
    const gapSeq = [2, 7, 7, 7, 7, 7, 7, 30, 30, 30, 30, 30, 30];
    const dates = ["2026-01-01"];
    for (const gap of gapSeq) {
      dates.push(addDaysToDate(dates[dates.length - 1], gap));
    }
    expect(deriveFrequencyLabel(series(...dates))).toBe("fortnightly");
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

  it("treats |delta| < 0.5 as stable / neutral", () => {
    const change = deriveWindowChange(
      [pt("2026-07-01", 80), pt("2026-07-10", 80.3)],
      true
    );
    expect(change!.delta).toBeCloseTo(0.3);
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
  const definitions: MetricSeriesDefinition[] = [
    { id: "weight", key: "weight", category: "body" },
    { id: "waist", key: "waist", category: "body" },
    { id: "stress", key: "stress", category: "wellness" },
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

    // waist -0.2 falls inside the 0.5 deadband -> neutral; check-in note hidden
    expect(rows[1].change!.amount).toBeCloseTo(-0.2);
    expect(rows[1].change!.tone).toBe("neutral");
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
