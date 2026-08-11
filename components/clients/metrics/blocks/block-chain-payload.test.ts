import { describe, expect, it } from "vitest";
import { buildAppendPayload } from "./block-chain-payload";
import type { ClientBlockView } from "@/lib/blocks/block-derivations";

const view = (
  id: string,
  state: ClientBlockView["state"],
  overrides: Partial<ClientBlockView> = {}
): ClientBlockView => ({
  id,
  name: `Block ${id}`,
  focus: null,
  targetWeightKg: null,
  startsOn: "2026-06-01",
  endsOn: "2026-06-28",
  weeks: 4,
  state,
  weekOfTotal: null,
  ...overrides,
});

const ENTRY = { name: "Peak", weeks: 3, focus: null, targetWeightKg: null };

describe("buildAppendPayload", () => {
  it("first block: anchors at the provided start date", () => {
    const payload = buildAppendPayload([], ENTRY, "2026-09-07");
    expect(payload).toEqual({
      startsOn: "2026-09-07",
      blocks: [{ name: "Peak", weeks: 3, focus: null, targetWeightKg: null }],
    });
  });

  it("throws without a start date for an empty chain", () => {
    expect(() => buildAppendPayload([], ENTRY)).toThrow(
      "The first block needs a start date"
    );
  });

  it("existing chain: anchors at the STORED start, ignoring any passed date", () => {
    const payload = buildAppendPayload(
      [view("a", "current")],
      ENTRY,
      "2030-01-01"
    );
    expect(payload.startsOn).toBe("2026-06-01");
  });

  it("elapsed rows are echoed without weeks; current/future rows with; the new row is id-less and last", () => {
    const past = view("a", "past", {
      startsOn: "2026-05-01",
      endsOn: "2026-05-29", // truncated: 29 days, weeks(ceil) = 5
      weeks: 5,
      focus: "base building",
      targetWeightKg: 82,
    });
    const current = view("b", "current", { startsOn: "2026-05-30", endsOn: "2026-06-26" });
    const future = view("c", "future", { startsOn: "2026-06-27", endsOn: "2026-07-24" });

    const payload = buildAppendPayload([past, current, future], {
      name: "Peak",
      weeks: 2,
      focus: "hold strength",
      targetWeightKg: 79.5,
    });

    expect(payload.blocks).toEqual([
      // Verbatim echo, weeks OMITTED — the service pins elapsed rows from
      // storage and a truncated 29-day block has no reproducing weeks value.
      {
        id: "a",
        name: "Block a",
        focus: "base building",
        targetWeightKg: 82,
      },
      { id: "b", name: "Block b", weeks: 4, focus: null, targetWeightKg: null },
      { id: "c", name: "Block c", weeks: 4, focus: null, targetWeightKg: null },
      {
        name: "Peak",
        weeks: 2,
        focus: "hold strength",
        targetWeightKg: 79.5,
      },
    ]);
    expect(payload.blocks[0]).not.toHaveProperty("weeks");
    expect(payload.blocks[3]).not.toHaveProperty("id");
  });
});
