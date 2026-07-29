import { describe, it, expect } from "vitest";
import {
  chainPhases,
  getPhaseForDate,
  isPhaseElapsed,
  lastPhaseEnd,
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
