import { describe, it, expect } from "vitest";
import {
  computeBlockChainFromEnds,
  computeDeleteShift,
  inclusiveDays,
  weeksSpanned,
} from "./block-chain";
import { addDaysToDateString } from "@/lib/date-helpers";
import type { ClientBlock } from "@/types/client-blocks";

// All math is UTC string arithmetic, so these exact-date assertions hold under
// any server timezone — including the DST-straddling chains below, which is
// what a server-local `new Date(x + "T00:00:00")` walk would get wrong.

const block = (
  id: string,
  startsOn: string,
  endsOn: string,
  name = `Block ${id}`
): ClientBlock => ({
  id,
  name,
  focus: null,
  targetWeightKg: null,
  startsOn,
  endsOn,
});

const TODAY = "2026-08-11";

describe("computeBlockChainFromEnds", () => {
  it("derives a contiguous chain — no overlaps, no gaps — for 1 to 12 blocks", () => {
    for (let count = 1; count <= 12; count++) {
      // Day-granular lengths (not whole weeks) — ends built cumulatively.
      const lengths = Array.from({ length: count }, (_, i) => (i % 4) * 9 + 5);
      const ends: string[] = [];
      let cursor = "2026-08-11";
      for (const length of lengths) {
        const endsOn = addDaysToDateString(cursor, length - 1);
        ends.push(endsOn);
        cursor = addDaysToDateString(endsOn, 1);
      }

      const windows = computeBlockChainFromEnds("2026-08-11", ends);

      expect(windows).toHaveLength(count);
      expect(windows[0].startsOn).toBe("2026-08-11");
      for (let i = 0; i < count; i++) {
        expect(windows[i].endsOn).toBe(ends[i]);
        expect(inclusiveDays(windows[i].startsOn, windows[i].endsOn)).toBe(
          lengths[i]
        );
        if (i > 0) {
          // Contiguity: each block starts the day after the previous ends.
          expect(inclusiveDays(windows[i - 1].endsOn, windows[i].startsOn)).toBe(2);
        }
      }
    }
  });

  it("computes exact derived starts", () => {
    expect(
      computeBlockChainFromEnds("2026-08-11", ["2026-09-07", "2026-10-19"])
    ).toEqual([
      { startsOn: "2026-08-11", endsOn: "2026-09-07" },
      { startsOn: "2026-09-08", endsOn: "2026-10-19" },
    ]);
  });

  it("does not skip or duplicate a date across the US spring-forward boundary", () => {
    expect(
      computeBlockChainFromEnds("2026-03-02", ["2026-03-08", "2026-03-15"])
    ).toEqual([
      { startsOn: "2026-03-02", endsOn: "2026-03-08" },
      { startsOn: "2026-03-09", endsOn: "2026-03-15" },
    ]);
  });

  it("does not skip or duplicate a date across the US fall-back boundary", () => {
    expect(computeBlockChainFromEnds("2026-10-26", ["2026-11-08"])).toEqual([
      { startsOn: "2026-10-26", endsOn: "2026-11-08" },
    ]);
  });

  it("passes an inverted window through untouched — validation is the service's", () => {
    expect(computeBlockChainFromEnds("2026-08-11", ["2026-08-01"])).toEqual([
      { startsOn: "2026-08-11", endsOn: "2026-08-01" },
    ]);
  });
});

describe("weeksSpanned", () => {
  it("equals the authored count for whole-week windows", () => {
    expect(weeksSpanned("2026-08-11", "2026-09-21")).toBe(6);
    expect(weeksSpanned("2026-08-11", "2026-08-17")).toBe(1);
  });

  it("reports the week a truncated block reached (ceil)", () => {
    // 29 days — a 6-week block truncated in its fifth week.
    expect(inclusiveDays("2026-07-13", "2026-08-10")).toBe(29);
    expect(weeksSpanned("2026-07-13", "2026-08-10")).toBe(5);
  });
});

describe("computeDeleteShift", () => {
  // Contiguous fixture: A is current on TODAY, B and C are future.
  const A = block("a", "2026-08-01", "2026-09-11");
  const B = block("b", "2026-09-12", "2026-10-23");
  const C = block("c", "2026-10-24", "2026-12-04");

  it("returns null for an id not in the chain", () => {
    expect(computeDeleteShift([A, B], "zz", TODAY)).toBeNull();
  });

  it("refuses an elapsed block", () => {
    const elapsed = block("e", "2026-06-20", "2026-07-31");
    expect(computeDeleteShift([elapsed, A], "e", TODAY)).toEqual({
      kind: "elapsed",
    });
  });

  it("removes a future block and shifts what follows back by its full duration", () => {
    const outcome = computeDeleteShift([A, B, C], "b", TODAY);
    expect(outcome).toEqual({
      kind: "removed",
      changes: [
        {
          id: "c",
          name: "Block c",
          previous: { startsOn: "2026-10-24", endsOn: "2026-12-04" },
          // C takes B's exact old window: equal durations, full-duration shift.
          next: { startsOn: "2026-09-12", endsOn: "2026-10-23" },
        },
      ],
    });
  });

  it("truncates the current block at yesterday; the next block starts today", () => {
    const outcome = computeDeleteShift([A, B, C], "a", TODAY);
    expect(outcome).toEqual({
      kind: "truncated",
      changes: [
        {
          id: "a",
          name: "Block a",
          previous: { startsOn: "2026-08-01", endsOn: "2026-09-11" },
          next: { startsOn: "2026-08-01", endsOn: "2026-08-10" },
        },
        {
          id: "b",
          name: "Block b",
          previous: { startsOn: "2026-09-12", endsOn: "2026-10-23" },
          next: { startsOn: "2026-08-11", endsOn: "2026-09-21" },
        },
        {
          id: "c",
          name: "Block c",
          previous: { startsOn: "2026-10-24", endsOn: "2026-12-04" },
          next: { startsOn: "2026-09-22", endsOn: "2026-11-02" },
        },
      ],
    });
  });

  it("removes (never truncates) a current block on its own first day", () => {
    const dayOne = block("d", TODAY, "2026-09-21");
    const following = block("f", "2026-09-22", "2026-10-19");
    const outcome = computeDeleteShift([dayOne, following], "d", TODAY);
    expect(outcome).toEqual({
      kind: "removed",
      changes: [
        {
          id: "f",
          name: "Block f",
          previous: { startsOn: "2026-09-22", endsOn: "2026-10-19" },
          next: { startsOn: TODAY, endsOn: "2026-09-07" },
        },
      ],
    });
  });

  it("deleting the last block moves nothing", () => {
    expect(computeDeleteShift([A, B, C], "c", TODAY)).toEqual({
      kind: "removed",
      changes: [],
    });
  });

  it("truncating a current block with nothing after it reports only its own change", () => {
    const outcome = computeDeleteShift([A], "a", TODAY);
    expect(outcome).toEqual({
      kind: "truncated",
      changes: [
        {
          id: "a",
          name: "Block a",
          previous: { startsOn: "2026-08-01", endsOn: "2026-09-11" },
          next: { startsOn: "2026-08-01", endsOn: "2026-08-10" },
        },
      ],
    });
  });
});
