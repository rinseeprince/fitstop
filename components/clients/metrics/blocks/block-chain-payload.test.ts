import { describe, expect, it } from "vitest";
import {
  buildAppendPayload,
  buildEditPayload,
  computeEditShift,
} from "./block-chain-payload";
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
  archivedAt: null,
  weeks: 4,
  state,
  weekOfTotal: null,
  ...overrides,
});

const ENTRY = { name: "Peak", endsOn: "2026-09-27", focus: null, targetWeightKg: null };

describe("buildAppendPayload", () => {
  it("first block: anchors at the provided start date", () => {
    const payload = buildAppendPayload([], ENTRY, "2026-09-07");
    expect(payload).toEqual({
      startsOn: "2026-09-07",
      blocks: [{ name: "Peak", endsOn: "2026-09-27", focus: null, targetWeightKg: null }],
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

  it("elapsed rows are echoed without endsOn; current/future rows with; the new row is id-less and last", () => {
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
      endsOn: "2026-08-07",
      focus: "hold strength",
      targetWeightKg: 79.5,
    });

    expect(payload.blocks).toEqual([
      // Verbatim echo, endsOn OMITTED — elapsed dates come from storage,
      // never the walk.
      {
        id: "a",
        name: "Block a",
        focus: "base building",
        targetWeightKg: 82,
      },
      { id: "b", name: "Block b", endsOn: "2026-06-26", focus: null, targetWeightKg: null },
      { id: "c", name: "Block c", endsOn: "2026-07-24", focus: null, targetWeightKg: null },
      {
        name: "Peak",
        endsOn: "2026-08-07",
        focus: "hold strength",
        targetWeightKg: 79.5,
      },
    ]);
    expect(payload.blocks[0]).not.toHaveProperty("endsOn");
    expect(payload.blocks[3]).not.toHaveProperty("id");
  });
});

// Edit-path fixtures: A elapsed, B current, C + D future — contiguous.
const A = view("a", "past", { startsOn: "2026-05-01", endsOn: "2026-05-28" });
const B = view("b", "current", { startsOn: "2026-05-29", endsOn: "2026-06-25" });
const C = view("c", "future", { startsOn: "2026-06-26", endsOn: "2026-07-23" });
const D = view("d", "future", { startsOn: "2026-07-24", endsOn: "2026-08-06" });

describe("computeEditShift", () => {
  it("extending an end pushes every later block forward, durations preserved", () => {
    expect(computeEditShift([A, B, C, D], "b", "2026-07-02")).toEqual([
      {
        id: "c",
        name: "Block c",
        previous: { startsOn: "2026-06-26", endsOn: "2026-07-23" },
        next: { startsOn: "2026-07-03", endsOn: "2026-07-30" }, // still 28 days
      },
      {
        id: "d",
        name: "Block d",
        previous: { startsOn: "2026-07-24", endsOn: "2026-08-06" },
        next: { startsOn: "2026-07-31", endsOn: "2026-08-13" }, // still 14 days
      },
    ]);
  });

  it("shrinking an end pulls later blocks back", () => {
    const changes = computeEditShift([A, B, C, D], "b", "2026-06-18");
    expect(changes.map((c) => [c.id, c.next.startsOn])).toEqual([
      ["c", "2026-06-19"],
      ["d", "2026-07-17"],
    ]);
  });

  it("editing the last block moves nothing", () => {
    expect(computeEditShift([A, B, C, D], "d", "2026-09-01")).toEqual([]);
  });
});

describe("buildEditPayload", () => {
  it("substitutes the edited row's fields and re-anchors later ends", () => {
    const { payload, changes, journeyWeeks } = buildEditPayload([A, B, C, D], "b", {
      name: "Cut 1 (extended)",
      focus: "one more push",
      targetWeightKg: 80,
      endsOn: "2026-07-02",
    });

    expect(payload.startsOn).toBe("2026-05-01");
    expect(payload.blocks).toEqual([
      // Elapsed echo: fields verbatim, no endsOn.
      { id: "a", name: "Block a", focus: null, targetWeightKg: null },
      {
        id: "b",
        name: "Cut 1 (extended)",
        endsOn: "2026-07-02",
        focus: "one more push",
        targetWeightKg: 80,
      },
      // Later rows: re-anchored ends, own fields untouched.
      { id: "c", name: "Block c", endsOn: "2026-07-30", focus: null, targetWeightKg: null },
      { id: "d", name: "Block d", endsOn: "2026-08-13", focus: null, targetWeightKg: null },
    ]);
    expect(changes.map((c) => c.id)).toEqual(["c", "d"]);
    // 4 + 5 + 4 + 2 weeks (B grew from 4 to 5 ceil-weeks).
    expect(journeyWeeks).toBe(15);
  });

  it("elapsed edit is fields-only: no date movement, everyone else echoes verbatim", () => {
    const { payload, changes } = buildEditPayload([A, B, C, D], "a", {
      name: "Base (renamed)",
      focus: "hindsight",
      targetWeightKg: null,
    });

    expect(changes).toEqual([]);
    expect(payload.blocks[0]).toEqual({
      id: "a",
      name: "Base (renamed)",
      focus: "hindsight",
      targetWeightKg: null,
    });
    expect(payload.blocks[0]).not.toHaveProperty("endsOn");
    expect(payload.blocks[1]).toEqual({
      id: "b",
      name: "Block b",
      endsOn: "2026-06-25",
      focus: null,
      targetWeightKg: null,
    });
  });

  it("an unchanged end produces no shifts and echoes stored ends", () => {
    const { payload, changes } = buildEditPayload([A, B, C, D], "c", {
      name: "Block c",
      focus: "sharpen up",
      targetWeightKg: null,
      endsOn: "2026-07-23",
    });
    expect(changes).toEqual([]);
    expect(payload.blocks[3]).toEqual(
      expect.objectContaining({ id: "d", endsOn: "2026-08-06" })
    );
  });

  it("throws on an unknown block id", () => {
    expect(() =>
      buildEditPayload([A, B], "zz", {
        name: "X",
        focus: null,
        targetWeightKg: null,
      })
    ).toThrow("Unknown block id");
  });
});

describe("buildEditPayload — anchor move (fully-unlived first block)", () => {
  it("moves the chain anchor when editing the first future block", () => {
    const F1 = view("f1", "future", { startsOn: "2026-09-01", endsOn: "2026-09-28" });
    const F2 = view("f2", "future", { startsOn: "2026-09-29", endsOn: "2026-10-26" });

    const { payload, changes } = buildEditPayload([F1, F2], "f1", {
      name: "Block f1",
      focus: null,
      targetWeightKg: null,
      startsOn: "2026-09-08",
      endsOn: "2026-10-05",
    });

    expect(payload.startsOn).toBe("2026-09-08");
    // F2 re-anchors at the new end, duration preserved.
    expect(changes).toEqual([
      {
        id: "f2",
        name: "Block f2",
        previous: { startsOn: "2026-09-29", endsOn: "2026-10-26" },
        next: { startsOn: "2026-10-06", endsOn: "2026-11-02" },
      },
    ]);
  });

  it("ignores startsOn when the edited block is not the chain's first", () => {
    const F1 = view("f1", "future", { startsOn: "2026-09-01", endsOn: "2026-09-28" });
    const F2 = view("f2", "future", { startsOn: "2026-09-29", endsOn: "2026-10-26" });

    const { payload } = buildEditPayload([F1, F2], "f2", {
      name: "Block f2",
      focus: null,
      targetWeightKg: null,
      startsOn: "2030-01-01", // belt: not the first block — anchor untouched
      endsOn: "2026-10-26",
    });
    expect(payload.startsOn).toBe("2026-09-01");
  });
});
