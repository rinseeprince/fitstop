import { describe, it, expect } from "vitest";
import {
  chainPhases,
  getPhaseForDate,
  isConformingChain,
  isPhaseElapsed,
  lastPhaseEnd,
  weeksBetween,
} from "./phase-chain";

const block = (name: string, weeks: number, ratePerWeekKg = -0.5) => ({
  name,
  weeks,
  ratePerWeekKg,
});

describe("chainPhases", () => {
  it("lays blocks end to end with no gap and no overlap", () => {
    const chained = chainPhases("2026-08-03", [
      block("Cut 1", 8),
      block("Diet break", 2, 0),
      block("Cut 2", 6),
    ]);

    expect(chained.map((c) => [c.startsOn, c.endsOn])).toEqual([
      ["2026-08-03", "2026-09-27"],
      ["2026-09-28", "2026-10-11"],
      ["2026-10-12", "2026-11-22"],
    ]);

    // The structural guarantee invariant 6 rests on: each block begins the day
    // after the previous one ends, so overlaps and gaps cannot be expressed.
    for (let i = 1; i < chained.length; i++) {
      const prevEnd = new Date(chained[i - 1].endsOn + "T00:00:00Z");
      prevEnd.setUTCDate(prevEnd.getUTCDate() + 1);
      expect(chained[i].startsOn).toBe(prevEnd.toISOString().slice(0, 10));
    }
  });

  it("treats the end date as inclusive — a 1-week block spans 7 days", () => {
    const [only] = chainPhases("2026-08-03", [block("Week", 1)]);
    expect(only.startsOn).toBe("2026-08-03");
    expect(only.endsOn).toBe("2026-08-09");
  });

  it("carries name, rate and id through untouched", () => {
    const [only] = chainPhases("2026-08-03", [
      { id: "abc", name: "Cut 1", weeks: 4, ratePerWeekKg: -0.75 },
    ]);
    expect(only).toMatchObject({ id: "abc", name: "Cut 1", ratePerWeekKg: -0.75 });
  });

  it("returns an empty chain for an empty list", () => {
    expect(chainPhases("2026-08-03", [])).toEqual([]);
  });

  it("crosses a month and a year boundary correctly", () => {
    const [only] = chainPhases("2026-12-28", [block("Cut", 2)]);
    expect(only.endsOn).toBe("2027-01-10");
  });
});

describe("getPhaseForDate", () => {
  const phases = chainPhases("2026-08-03", [
    block("Cut 1", 8),
    block("Diet break", 2, 0),
  ]);

  it("finds the covering block", () => {
    expect(getPhaseForDate(phases, "2026-09-01")?.name).toBe("Cut 1");
    expect(getPhaseForDate(phases, "2026-10-01")?.name).toBe("Diet break");
  });

  it("includes both boundary days", () => {
    expect(getPhaseForDate(phases, "2026-08-03")?.name).toBe("Cut 1");
    expect(getPhaseForDate(phases, "2026-09-27")?.name).toBe("Cut 1");
    expect(getPhaseForDate(phases, "2026-09-28")?.name).toBe("Diet break");
    expect(getPhaseForDate(phases, "2026-10-11")?.name).toBe("Diet break");
  });

  it("returns null before the chain, after it, and when there are no blocks", () => {
    expect(getPhaseForDate(phases, "2026-08-02")).toBeNull();
    expect(getPhaseForDate(phases, "2026-10-12")).toBeNull();
    expect(getPhaseForDate([], "2026-09-01")).toBeNull();
  });
});

describe("isPhaseElapsed", () => {
  const phase = { startsOn: "2026-08-03", endsOn: "2026-09-27" };

  it("is elapsed only once today is past the last day", () => {
    expect(isPhaseElapsed(phase, "2026-09-27")).toBe(false);
    expect(isPhaseElapsed(phase, "2026-09-28")).toBe(true);
    expect(isPhaseElapsed(phase, "2026-08-01")).toBe(false);
  });
});

describe("weeksBetween", () => {
  // The property the coach's panel depends on: it seeds each stored row's
  // `weeks` from the row's dates, and the server re-chains from those weeks. If
  // this is not the exact inverse of chainPhases, every save silently re-dates
  // the chain (or 422s on an elapsed block).
  it("round-trips chainPhases for every length up to a year", () => {
    for (let weeks = 1; weeks <= 52; weeks += 1) {
      const [only] = chainPhases("2026-08-03", [block("Cut", weeks)]);
      expect(weeksBetween(only.startsOn, only.endsOn)).toBe(weeks);
    }
  });

  it("round-trips every block of a multi-block chain, across a year boundary", () => {
    const input = [block("Cut 1", 8), block("Diet break", 2, 0), block("Cut 2", 6)];
    const chained = chainPhases("2026-12-07", input);
    expect(chained.map((c) => weeksBetween(c.startsOn, c.endsOn))).toEqual([8, 2, 6]);
  });

  // The round trip above cannot pin the INCLUSIVE half: Math.round absorbs it
  // for any whole-week window, since round((7n-1)/7) and round(7n/7) both give
  // n. Only a non-conforming window separates them — 4 days is 1 week rounded,
  // not 0. Worth pinning even though `isConformingChain` refuses such data at
  // the UI, because `deleteClientPhase` calls this on stored rows unconditionally
  // and feeds the result straight into a re-chaining write.
  it("counts the window inclusively — a 4-day span is 1 week, never 0", () => {
    expect(weeksBetween("2026-08-03", "2026-08-06")).toBe(1);
  });

  // The rounding `isConformingChain` exists to guard, documented as behaviour:
  // 10 days collapses DOWN to 1 week, 11 grows UP to 2.
  it("rounds a non-conforming window to the nearest week, in both directions", () => {
    expect(weeksBetween("2026-08-03", "2026-08-12")).toBe(1);
    expect(weeksBetween("2026-08-03", "2026-08-13")).toBe(2);
  });
});

describe("isConformingChain", () => {
  it("accepts anything chainPhases produced, including an empty list", () => {
    expect(
      isConformingChain(
        chainPhases("2026-08-03", [block("Cut 1", 8), block("Diet break", 2, 0)])
      )
    ).toBe(true);
    expect(isConformingChain([])).toBe(true);
  });

  // 10 days rounds DOWN to 1 week (re-chaining would shorten it by 3 days);
  // 11 days rounds UP to 2 (re-chaining would grow it). The drift is
  // bidirectional, which is why the shape is refused rather than normalized.
  it("rejects a span that is not a whole number of weeks, in both directions", () => {
    expect(isConformingChain([{ startsOn: "2026-08-03", endsOn: "2026-08-12" }])).toBe(false);
    expect(isConformingChain([{ startsOn: "2026-08-03", endsOn: "2026-08-13" }])).toBe(false);
  });

  it("rejects a gap — an uncovered date falls back to the plan grid, so closing it changes what the client eats", () => {
    expect(
      isConformingChain([
        { startsOn: "2026-08-03", endsOn: "2026-08-09" },
        { startsOn: "2026-08-17", endsOn: "2026-08-23" },
      ])
    ).toBe(false);
  });

  it("rejects an overlap and an inverted window", () => {
    expect(
      isConformingChain([
        { startsOn: "2026-08-03", endsOn: "2026-08-16" },
        { startsOn: "2026-08-10", endsOn: "2026-08-23" },
      ])
    ).toBe(false);
    expect(isConformingChain([{ startsOn: "2026-08-10", endsOn: "2026-08-03" }])).toBe(false);
  });
});

describe("lastPhaseEnd", () => {
  it("returns the furthest end date, and null with no blocks", () => {
    expect(
      lastPhaseEnd([
        { startsOn: "2026-08-03", endsOn: "2026-09-27" },
        { startsOn: "2026-09-28", endsOn: "2026-10-11" },
      ])
    ).toBe("2026-10-11");
    expect(lastPhaseEnd([])).toBeNull();
  });
});
