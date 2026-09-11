import { describe, it, expect } from "vitest";
import {
  deriveBlockEnding,
  deriveBlockState,
  deriveWeekOfTotal,
  derivePlanState,
} from "./block-derivations";

// Pure string/UTC math — exact assertions hold under any server timezone.

// A 6-week block: 42 days inclusive.
const BLOCK = { startsOn: "2026-08-11", endsOn: "2026-09-21" };

describe("deriveBlockState", () => {
  it("walks future → current → past across the boundary days", () => {
    expect(deriveBlockState(BLOCK, "2026-08-10")).toBe("future");
    expect(deriveBlockState(BLOCK, "2026-08-11")).toBe("current"); // first day
    expect(deriveBlockState(BLOCK, "2026-09-21")).toBe("current"); // last day
    expect(deriveBlockState(BLOCK, "2026-09-22")).toBe("past"); // day after
  });
});

describe("deriveWeekOfTotal", () => {
  it("is null unless the block contains today", () => {
    expect(deriveWeekOfTotal(BLOCK, "2026-08-10")).toBeNull();
    expect(deriveWeekOfTotal(BLOCK, "2026-09-22")).toBeNull();
  });

  it("counts weeks from the block's own start", () => {
    expect(deriveWeekOfTotal(BLOCK, "2026-08-11")).toEqual({ current: 1, total: 6 });
    expect(deriveWeekOfTotal(BLOCK, "2026-08-17")).toEqual({ current: 1, total: 6 }); // day 7
    expect(deriveWeekOfTotal(BLOCK, "2026-08-18")).toEqual({ current: 2, total: 6 }); // day 8
    expect(deriveWeekOfTotal(BLOCK, "2026-09-21")).toEqual({ current: 6, total: 6 }); // day 42
  });

  it("stays week-accurate across a DST boundary", () => {
    // 2 weeks spanning the US spring-forward (2026-03-08).
    const dst = { startsOn: "2026-03-02", endsOn: "2026-03-15" };
    expect(deriveWeekOfTotal(dst, "2026-03-08")).toEqual({ current: 1, total: 2 });
    expect(deriveWeekOfTotal(dst, "2026-03-09")).toEqual({ current: 2, total: 2 });
  });

  it("agrees with the weeks field on a truncated block (ceil, one derivation)", () => {
    // 29 days — truncated in week 5; its final day reads week 5 of 5.
    const truncated = { startsOn: "2026-07-13", endsOn: "2026-08-10" };
    expect(deriveWeekOfTotal(truncated, "2026-08-10")).toEqual({
      current: 5,
      total: 5,
    });
  });
});

describe("deriveBlockEnding", () => {
  const chain = [
    { name: "Base", startsOn: "2026-06-01", endsOn: "2026-06-28" },
    { name: "Build", startsOn: "2026-06-29", endsOn: "2026-08-23" },
    { name: "Cut", startsOn: "2026-08-24", endsOn: "2026-09-20" },
  ];

  it("fires through the current block's final 7 days, boundary-exact", () => {
    // endsOn − 7: still quiet. endsOn − 6: the last week has started.
    expect(deriveBlockEnding(chain, "2026-08-16")).toBeNull();
    expect(deriveBlockEnding(chain, "2026-08-17")).toEqual({
      name: "Build",
      endsOn: "2026-08-23",
      nextName: "Cut",
    });
    // The block's own last day still fires.
    expect(deriveBlockEnding(chain, "2026-08-23")).toEqual({
      name: "Build",
      endsOn: "2026-08-23",
      nextName: "Cut",
    });
  });

  it("clears by the world changing: the next block's first day is quiet again", () => {
    // Cut (28 days) is current on Aug 24 but nowhere near ITS last week.
    expect(deriveBlockEnding(chain, "2026-08-24")).toBeNull();
  });

  it("names nothing after the last block", () => {
    expect(deriveBlockEnding(chain, "2026-09-20")).toEqual({
      name: "Cut",
      endsOn: "2026-09-20",
      nextName: null,
    });
  });

  it("null when no block is current (gap or empty chain)", () => {
    expect(deriveBlockEnding(chain, "2026-09-21")).toBeNull();
    expect(deriveBlockEnding([], "2026-08-17")).toBeNull();
  });

  it("still names the next block across a post-delete gap", () => {
    const gapped = [
      { name: "Build", startsOn: "2026-06-29", endsOn: "2026-08-23" },
      { name: "Cut", startsOn: "2026-08-27", endsOn: "2026-09-20" },
    ];
    expect(deriveBlockEnding(gapped, "2026-08-20")?.nextName).toBe("Cut");
  });

  it("a short current block can fire on day one — days-remaining, not week arithmetic", () => {
    const short = [{ name: "Deload", startsOn: "2026-08-17", endsOn: "2026-08-21" }];
    expect(deriveBlockEnding(short, "2026-08-17")).toEqual({
      name: "Deload",
      endsOn: "2026-08-21",
      nextName: null,
    });
  });
});

// A plan's state is the block's date rule in the plan vocabulary — one
// derivation, so a plan can never be "active" inside a block that reads
// "future" for the same day, and the boundaries agree with `coversDate`:
// the start day and the end day are both active.
describe("derivePlanState", () => {
  const window = { startsOn: "2026-08-03", endsOn: "2026-09-30" };

  it("is upcoming before the start, active from the start day", () => {
    expect(derivePlanState(window, "2026-08-02")).toBe("upcoming");
    expect(derivePlanState(window, "2026-08-03")).toBe("active");
  });

  it("is active through the end day, ended the day after", () => {
    expect(derivePlanState(window, "2026-09-30")).toBe("active");
    expect(derivePlanState(window, "2026-10-01")).toBe("ended");
  });
});
