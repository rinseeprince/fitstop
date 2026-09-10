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
  it("leads with the dash — the empty state — then the blocks whose end is on or after the floor, in chain order, with their ranges", () => {
    expect(labels(CHAIN)).toEqual(["—", "Cut · 2 Mar – 29 Mar", "Build · 30 Mar – 26 Apr"]);
  });

  it("excludes a block that ended before the floor — nothing can start inside it", () => {
    const values = buildBlockStartOptions(CHAIN, FLOOR).map((option) => option.value);
    expect(values).not.toContain(OLD.id);
    expect(values).toEqual([NO_BLOCK_OPTION, CUT.id, BUILD.id]);
  });

  it("includes a block ending ON the floor — it starts the plan that day — and drops it the day after", () => {
    const edge = { id: "b-edge", name: "Edge", startsOn: "2026-03-04", endsOn: FLOOR };
    const onTheFloor = buildBlockStartOptions([edge], FLOOR);
    expect(onTheFloor.map((option) => option.value)).toEqual([NO_BLOCK_OPTION, edge.id]);
    expect(onTheFloor[1].startsOn).toBe(FLOOR);

    const dayAfter = buildBlockStartOptions([edge], "2026-03-11");
    expect(dayAfter.map((option) => option.value)).toEqual([NO_BLOCK_OPTION]);
  });

  it("a client with no blocks still has the dash, and nothing else", () => {
    expect(labels([])).toEqual(["—"]);
  });
});

describe("buildBlockStartOptions — the day each option starts the plan on", () => {
  const startOf = (value: string) =>
    buildBlockStartOptions(CHAIN, FLOOR).find((option) => option.value === value)?.startsOn;

  it("a future block: its first day", () => {
    expect(startOf(BUILD.id)).toBe("2026-03-30");
  });

  it("a block already under way: the floor, not the day it began", () => {
    // The placement and the nutrition save both refuse a start before the
    // floor, so the day the block began is not on offer.
    expect(startOf(CUT.id)).toBe(FLOOR);
  });

  it("the dash: the floor — the earliest day the coach may pick", () => {
    expect(startOf(NO_BLOCK_OPTION)).toBe(FLOOR);
  });

  it("every listed block starts the plan inside itself and never before the floor", () => {
    // Follows from the end filter: a listed block ends on or after the floor,
    // and its start never passes its end, so floor <= max(floor, start) <= end.
    const byId = new Map(CHAIN.map((block) => [block.id, block]));
    for (const floor of ["2026-02-15", FLOOR, "2026-03-29", "2026-04-26"]) {
      for (const option of buildBlockStartOptions(CHAIN, floor)) {
        if (option.value === NO_BLOCK_OPTION) continue;
        const block = byId.get(option.value);
        if (!block) throw new Error(`unknown option ${option.value}`);
        expect(option.startsOn >= floor).toBe(true);
        expect(option.startsOn <= block.endsOn).toBe(true);
      }
    }
  });
});

describe("selectBlockStartOption — which option a surface shows", () => {
  const options = buildBlockStartOptions(CHAIN, FLOOR);

  it("the coach's own pick wins when it names a listed option", () => {
    expect(selectBlockStartOption(options, BUILD.id, CUT.id).value).toBe(BUILD.id);
  });

  it("an explicit pick of the dash beats the block the coach came from", () => {
    expect(selectBlockStartOption(options, NO_BLOCK_OPTION, CUT.id).value).toBe(
      NO_BLOCK_OPTION
    );
  });

  it("with no pick, the block the coach came from is preselected when it is listed", () => {
    expect(selectBlockStartOption(options, null, BUILD.id).value).toBe(BUILD.id);
  });

  it("a round trip from a block that is no longer listed falls through to the dash", () => {
    // A block that ended before the floor — nothing can start in it, so it is
    // not on offer and the trip cannot select it.
    expect(selectBlockStartOption(options, null, OLD.id).value).toBe(NO_BLOCK_OPTION);
  });

  it("a pick naming a block the list no longer holds falls through to the trip, then the dash", () => {
    expect(selectBlockStartOption(options, "b-deleted", CUT.id).value).toBe(CUT.id);
    expect(selectBlockStartOption(options, "b-deleted", null).value).toBe(NO_BLOCK_OPTION);
  });

  it("nothing picked, no trip: the dash", () => {
    expect(selectBlockStartOption(options, null, null).value).toBe(NO_BLOCK_OPTION);
  });

  it("refuses an option list without the dash — a caller bug, loudly", () => {
    expect(() => selectBlockStartOption([], null, null)).toThrow(/no-block option/);
  });
});
