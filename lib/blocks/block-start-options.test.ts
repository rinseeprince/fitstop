import { describe, it, expect } from "vitest";
import {
  buildBlockStartOptions,
  selectBlockStartOption,
  NO_BLOCK_OPTION,
} from "./block-start-options";

// Fixed dates, deliberately not the machine's: the floor is a server answer
// (the shared deletion floor — today, or tomorrow once the client has logged
// today). Feb/Mar/Apr only: en-AU spells June/July/Sept in four letters.
const FLOOR = "2026-03-10";

// The chain in date order, as the payload lists it. Blocks never overlap.
const OLD = { id: "b-old", name: "Base", startsOn: "2026-02-01", endsOn: "2026-02-28" };
const CUT = { id: "b-cut", name: "Cut", startsOn: "2026-03-02", endsOn: "2026-03-29" };
const BUILD = { id: "b-build", name: "Build", startsOn: "2026-03-30", endsOn: "2026-04-26" };
const CHAIN = [OLD, CUT, BUILD];

const labels = (blocks: typeof CHAIN, floor = FLOOR) =>
  buildBlockStartOptions(blocks, floor).map((option) => option.label);

describe("buildBlockStartOptions — the list", () => {
  it("lists the blocks whose end is on or after the floor, in chain order, with their ranges, then No block", () => {
    expect(labels(CHAIN)).toEqual([
      "Cut · 2 Mar – 29 Mar",
      "Build · 30 Mar – 26 Apr",
      "No block — pick a date",
    ]);
  });

  it("excludes a block that ended before the floor — nothing can start inside it", () => {
    const values = buildBlockStartOptions(CHAIN, FLOOR).map((option) => option.value);
    expect(values).not.toContain(OLD.id);
    expect(values).toEqual([CUT.id, BUILD.id, NO_BLOCK_OPTION]);
  });

  it("includes a block ending ON the floor — a one-day window — and drops it the day after", () => {
    const edge = { id: "b-edge", name: "Edge", startsOn: "2026-03-04", endsOn: FLOOR };
    const onTheFloor = buildBlockStartOptions([edge], FLOOR);
    expect(onTheFloor.map((option) => option.value)).toEqual([edge.id, NO_BLOCK_OPTION]);
    expect(onTheFloor[0].window).toEqual({ min: FLOOR, max: FLOOR });

    const dayAfter = buildBlockStartOptions([edge], "2026-03-11");
    expect(dayAfter.map((option) => option.value)).toEqual([NO_BLOCK_OPTION]);
  });

  it("a client with no blocks still has the No-block option, and nothing else", () => {
    expect(labels([])).toEqual(["No block — pick a date"]);
  });
});

describe("buildBlockStartOptions — the window each option constrains the date to", () => {
  const byValue = (value: string) =>
    buildBlockStartOptions(CHAIN, FLOOR).find((option) => option.value === value)?.window;

  it("a future block: from its first day to its last", () => {
    expect(byValue(BUILD.id)).toEqual({ min: "2026-03-30", max: "2026-04-26" });
  });

  it("a block already under way is floored at the floor, not the day it began", () => {
    // The placement and the nutrition save both refuse a start before the
    // floor, so the day the block began is not on offer.
    expect(byValue(CUT.id)).toEqual({ min: FLOOR, max: "2026-03-29" });
  });

  it("No block: the floor alone, with no ceiling", () => {
    expect(byValue(NO_BLOCK_OPTION)).toEqual({ min: FLOOR, max: null });
  });

  it("every listed block's window is non-empty — its min never passes its max", () => {
    // Follows from the end filter: a listed block ends on or after the floor,
    // and its start never passes its end, so max(floor, start) <= end.
    for (const floor of ["2026-02-15", FLOOR, "2026-03-29", "2026-04-26"]) {
      for (const option of buildBlockStartOptions(CHAIN, floor)) {
        if (option.value === NO_BLOCK_OPTION) continue;
        expect(option.window.max).not.toBeNull();
        expect(option.window.min <= (option.window.max as string)).toBe(true);
      }
    }
  });
});

describe("selectBlockStartOption — which option a surface shows", () => {
  const options = buildBlockStartOptions(CHAIN, FLOOR);

  it("the coach's own pick wins when it names a listed option", () => {
    expect(selectBlockStartOption(options, BUILD.id, CUT.id).value).toBe(BUILD.id);
  });

  it("an explicit No-block pick beats the block the coach came from", () => {
    expect(selectBlockStartOption(options, NO_BLOCK_OPTION, CUT.id).value).toBe(
      NO_BLOCK_OPTION
    );
  });

  it("with no pick, the block the coach came from is preselected when it is listed", () => {
    expect(selectBlockStartOption(options, null, BUILD.id).value).toBe(BUILD.id);
  });

  it("a round trip from a block that is no longer listed falls through to No block", () => {
    // A block that ended before the floor — nothing can start in it, so it is
    // not on offer and the trip cannot select it.
    expect(selectBlockStartOption(options, null, OLD.id).value).toBe(NO_BLOCK_OPTION);
  });

  it("a pick naming a block the list no longer holds falls through to the trip, then No block", () => {
    expect(selectBlockStartOption(options, "b-deleted", CUT.id).value).toBe(CUT.id);
    expect(selectBlockStartOption(options, "b-deleted", null).value).toBe(NO_BLOCK_OPTION);
  });

  it("nothing picked, no trip: No block", () => {
    expect(selectBlockStartOption(options, null, null).value).toBe(NO_BLOCK_OPTION);
  });

  it("refuses an option list without the No-block option — a caller bug, loudly", () => {
    expect(() => selectBlockStartOption([], null, null)).toThrow(/No-block option/);
  });
});
