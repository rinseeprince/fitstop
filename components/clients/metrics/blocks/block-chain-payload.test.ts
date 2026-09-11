import { describe, expect, it } from "vitest";
import { buildAppendPayload, buildEditPayload } from "./block-chain-payload";
import type { ClientBlockView } from "@/lib/blocks/block-derivations";

const view = (
  id: string,
  state: ClientBlockView["state"],
  overrides: Partial<ClientBlockView> = {}
): ClientBlockView => ({
  id,
  name: `Block ${id}`,
  focus: null,
  startsOn: "2026-06-01",
  endsOn: "2026-06-28",
  archivedAt: null,
  weeks: 4,
  state,
  weekOfTotal: null,
  ...overrides,
});

const ENTRY = {
  name: "Peak",
  startsOn: "2026-10-05",
  endsOn: "2026-11-01",
  focus: null,
};

describe("buildAppendPayload", () => {
  it("sends the new block's own window — no chain anchor", () => {
    expect(buildAppendPayload([], ENTRY)).toEqual({
      blocks: [
        {
          name: "Peak",
          startsOn: "2026-10-05",
          endsOn: "2026-11-01",
          focus: null,
        },
      ],
    });
  });

  it("echoes every stored block with its own dates, elapsed ones without", () => {
    // The service's pin contract: an elapsed row's dates come from storage, so
    // the payload must not carry them; current and future rows carry both.
    const payload = buildAppendPayload(
      [
        view("past", "past", { startsOn: "2026-05-04", endsOn: "2026-05-31" }),
        view("now", "current", { startsOn: "2026-06-01", endsOn: "2026-06-28" }),
      ],
      ENTRY
    );

    expect(payload.blocks[0]).toEqual({
      id: "past",
      name: "Block past",
      focus: null,
    });
    expect(payload.blocks[0]).not.toHaveProperty("targetWeightKg");
    expect(payload.blocks[1]).toMatchObject({
      id: "now",
      startsOn: "2026-06-01",
      endsOn: "2026-06-28",
    });
    expect(payload.blocks[2]).toMatchObject({ startsOn: "2026-10-05" });
  });

  it("leaves a gap alone — the appended block need not follow the last one", () => {
    // A client between programs is a real state; nothing walks the new block
    // back to the day after its predecessor.
    const payload = buildAppendPayload(
      [view("now", "current", { startsOn: "2026-06-01", endsOn: "2026-06-28" })],
      ENTRY
    );

    expect(payload.blocks[1]).toMatchObject({
      startsOn: "2026-10-05",
      endsOn: "2026-11-01",
    });
  });
});

describe("buildEditPayload", () => {
  const chain = [
    view("a", "current", { startsOn: "2026-06-01", endsOn: "2026-06-28" }),
    view("b", "future", { startsOn: "2026-07-06", endsOn: "2026-08-02" }),
    view("c", "future", { startsOn: "2026-08-10", endsOn: "2026-09-06" }),
  ];

  it("changes only the edited block — nothing after it moves", () => {
    // The whole point of a block owning its window: an edit has no consequence
    // for any other block, so there is nothing to preview before confirming.
    const { payload } = buildEditPayload(chain, "b", {
      name: "Renamed",
      focus: "hypertrophy",
      startsOn: "2026-07-13",
      endsOn: "2026-08-23",
    });

    expect(payload.blocks[1]).toEqual({
      id: "b",
      name: "Renamed",
      startsOn: "2026-07-13",
      endsOn: "2026-08-23",
      focus: "hypertrophy",
    });
    expect(payload.blocks[0]).toMatchObject({ startsOn: "2026-06-01", endsOn: "2026-06-28" });
    expect(payload.blocks[2]).toMatchObject({ startsOn: "2026-08-10", endsOn: "2026-09-06" });
  });

  it("keeps an elapsed edit fields-only", () => {
    const { payload } = buildEditPayload(
      [view("past", "past", { startsOn: "2026-04-06", endsOn: "2026-05-03" })],
      "past",
      { name: "Base", focus: null, startsOn: "2026-01-05", endsOn: "2026-02-01" }
    );

    expect(payload.blocks[0]).toEqual({
      id: "past",
      name: "Base",
      focus: null,
    });
  });

  it("falls back to the stored window when the form sends no dates", () => {
    const { payload } = buildEditPayload(chain, "c", {
      name: "Deload",
      focus: null,
    });

    expect(payload.blocks[2]).toMatchObject({
      startsOn: "2026-08-10",
      endsOn: "2026-09-06",
    });
  });

  it("totals the blocks' own spans, so a gap between them counts for nothing", () => {
    // Three 4-week blocks with gaps between them is a 12-week journey, not the
    // 15 weeks the calendar distance would give.
    const { journeyWeeks } = buildEditPayload(chain, "b", {
      name: "Block b",
      focus: null,
    });

    expect(journeyWeeks).toBe(12);
  });

  it("throws on an unknown id rather than silently echoing the set", () => {
    expect(() =>
      buildEditPayload(chain, "missing", { name: "x", focus: null })
    ).toThrow("Unknown block id");
  });
});
