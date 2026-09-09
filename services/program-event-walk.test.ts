import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase-admin before importing the service
vi.mock("./supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

vi.mock("./training-event-service", () => ({
  getNextPlanStartCap: vi.fn(),
}));

vi.mock("./client-blocks-service", () => ({
  getBlockBoundForDate: vi.fn(),
}));

import { supabaseAdmin } from "./supabase-admin";
import { getNextPlanStartCap } from "./training-event-service";
import { getBlockBoundForDate } from "./client-blocks-service";
import {
  generateProgramEvents,
  placementEndDate,
  expandProgramToWindow,
  resolvePlacementWindowEnd,
  resolveWindowCap,
  type ProgramSlot,
} from "./program-event-walk";

const mockFrom = vi.mocked(supabaseAdmin.from);
const mockGetNextPlanStartCap = vi.mocked(getNextPlanStartCap);
const mockGetBlockBound = vi.mocked(getBlockBoundForDate);

// Inline query mock helper (same idiom as library-placement-service.test.ts)
function createMockQuery<T = unknown>(result: { data: T | null; error: { message: string } | null }) {
  const mockQuery = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: vi.fn(),
  };

  Object.defineProperty(mockQuery, "then", {
    value: (resolve: (value: typeof result) => void) =>
      Promise.resolve(result).then(resolve),
  });

  return mockQuery;
}

function makeSlot(overrides?: Partial<ProgramSlot>): ProgramSlot {
  return {
    id: "ts-1",
    isRest: false,
    name: "Push",
    focus: "chest",
    calorieSurplusPercentage: 15,
    estimatedCalories: null,
    ...overrides,
  };
}

describe("program-event-walk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetNextPlanStartCap.mockResolvedValue(null);
  });

  // =========================================================================
  // generateProgramEvents
  // =========================================================================

  describe("generateProgramEvents", () => {
    function wireEventUpsert() {
      const eventUpsertQuery = createMockQuery({ data: [], error: null });
      mockFrom.mockImplementation((table: string) => {
        if (table === "training_events") return eventUpsertQuery as never;
        return createMockQuery({ data: null, error: null }) as never;
      });
      return eventUpsertQuery;
    }

    it("zero-offset regression: walks slots from position 0 when startPosition is omitted", async () => {
      const eventUpsertQuery = wireEventUpsert();

      const count = await generateProgramEvents({
        clientId: "client-1",
        planId: "plan-1",
        programSlots: [
          makeSlot({ id: "ts-a", name: "A" }),
          makeSlot({ id: "ts-b", name: "B" }),
          makeSlot({ id: "ts-r", name: "Rest", isRest: true }),
        ],
        startDate: "2026-07-01",
        endDate: "2026-07-03",
      });

      const rows = eventUpsertQuery.upsert.mock.calls[0][0] as Array<{
        training_session_id: string;
        date: string;
      }>;
      // 3 days; rest on day 3 emits nothing.
      expect(rows.map((r) => [r.training_session_id, r.date])).toEqual([
        ["ts-a", "2026-07-01"],
        ["ts-b", "2026-07-02"],
      ]);
      expect(count).toBe(2);
    });

    it("startPosition resumes the walk mid-program: the first date maps to that slot", async () => {
      const eventUpsertQuery = wireEventUpsert();

      // 5-slot program, resuming at slot 3 (as an amendment does when 3 days
      // have elapsed): the floor date maps to slot 3, not slot 0.
      await generateProgramEvents({
        clientId: "client-1",
        planId: "plan-1",
        programSlots: [
          makeSlot({ id: "ts-0", name: "S0" }),
          makeSlot({ id: "ts-1", name: "S1" }),
          makeSlot({ id: "ts-2", name: "S2" }),
          makeSlot({ id: "ts-3", name: "S3" }),
          makeSlot({ id: "ts-4", name: "S4" }),
        ],
        startDate: "2026-07-04",
        endDate: "2026-07-05",
        startPosition: 3,
      });

      const rows = eventUpsertQuery.upsert.mock.calls[0][0] as Array<{
        training_session_id: string;
        date: string;
      }>;
      expect(rows.map((r) => [r.training_session_id, r.date])).toEqual([
        ["ts-3", "2026-07-04"],
        ["ts-4", "2026-07-05"],
      ]);
    });

    it("startPosition: 0 behaves identically to omitting it", async () => {
      const slots = [makeSlot({ id: "ts-a" }), makeSlot({ id: "ts-b" })];

      const firstQuery = wireEventUpsert();
      await generateProgramEvents({
        clientId: "client-1", planId: "plan-1", programSlots: slots,
        startDate: "2026-07-01", endDate: "2026-07-02",
      });
      const withoutParam = firstQuery.upsert.mock.calls[0][0];

      const secondQuery = wireEventUpsert();
      await generateProgramEvents({
        clientId: "client-1", planId: "plan-1", programSlots: slots,
        startDate: "2026-07-01", endDate: "2026-07-02", startPosition: 0,
      });
      const withZero = secondQuery.upsert.mock.calls[0][0];

      expect(withZero).toEqual(withoutParam);
    });

    it("rest slots after the resume point consume dates without emitting events", async () => {
      const eventUpsertQuery = wireEventUpsert();

      // Resume at slot 1; slot 2 is rest — it consumes 07-05 silently and
      // slot 3 lands on 07-06 (no compression).
      await generateProgramEvents({
        clientId: "client-1",
        planId: "plan-1",
        programSlots: [
          makeSlot({ id: "ts-0", name: "S0" }),
          makeSlot({ id: "ts-1", name: "S1" }),
          makeSlot({ id: "ts-r", name: "Rest", isRest: true }),
          makeSlot({ id: "ts-3", name: "S3" }),
        ],
        startDate: "2026-07-04",
        endDate: "2026-07-06",
        startPosition: 1,
      });

      const rows = eventUpsertQuery.upsert.mock.calls[0][0] as Array<{
        training_session_id: string;
        date: string;
      }>;
      expect(rows.map((r) => [r.training_session_id, r.date])).toEqual([
        ["ts-1", "2026-07-04"],
        ["ts-3", "2026-07-06"],
      ]);
    });

    it("INVARIANT: every emitted row carries the calorie_surplus_percentage key, even when null", async () => {
      const eventUpsertQuery = wireEventUpsert();

      await generateProgramEvents({
        clientId: "client-1",
        planId: "plan-1",
        programSlots: [
          makeSlot({ id: "ts-a", calorieSurplusPercentage: 20 }),
          makeSlot({ id: "ts-b", calorieSurplusPercentage: null }),
        ],
        startDate: "2026-07-01",
        endDate: "2026-07-02",
      });

      const rows = eventUpsertQuery.upsert.mock.calls[0][0] as Array<Record<string, unknown>>;
      for (const row of rows) {
        expect(Object.prototype.hasOwnProperty.call(row, "calorie_surplus_percentage")).toBe(true);
      }
      expect(rows[0].calorie_surplus_percentage).toBe(20);
      expect(rows[1].calorie_surplus_percentage).toBeNull();
    });

    it("upserts on (client_id, training_session_id, date) ignoring duplicates (idempotent re-walk)", async () => {
      const eventUpsertQuery = wireEventUpsert();

      await generateProgramEvents({
        clientId: "client-1", planId: "plan-1",
        programSlots: [makeSlot()],
        startDate: "2026-07-01", endDate: "2026-07-01",
      });

      expect(eventUpsertQuery.upsert).toHaveBeenCalledWith(expect.any(Array), {
        onConflict: "client_id,training_session_id,date",
        ignoreDuplicates: true,
      });
    });

    it("returns 0 with no DB write for an empty slot array or an all-rest window", async () => {
      const eventUpsertQuery = wireEventUpsert();

      expect(
        await generateProgramEvents({
          clientId: "client-1", planId: "plan-1", programSlots: [],
          startDate: "2026-07-01", endDate: "2026-07-07",
        }),
      ).toBe(0);
      expect(
        await generateProgramEvents({
          clientId: "client-1", planId: "plan-1",
          programSlots: [makeSlot({ isRest: true })],
          startDate: "2026-07-01", endDate: "2026-07-01",
        }),
      ).toBe(0);
      expect(eventUpsertQuery.upsert).not.toHaveBeenCalled();
    });

    it("throws on upsert failure", async () => {
      const eventUpsertQuery = createMockQuery({ data: null, error: null });
      eventUpsertQuery.upsert = vi.fn().mockResolvedValue({ error: { message: "boom" } });
      mockFrom.mockImplementation(() => eventUpsertQuery as never);

      await expect(
        generateProgramEvents({
          clientId: "client-1", planId: "plan-1",
          programSlots: [makeSlot()],
          startDate: "2026-07-01", endDate: "2026-07-01",
        }),
      ).rejects.toThrow("Failed to generate events: boom");
    });
  });

  describe("placementEndDate", () => {
    it("is start + max(1, slots) − 1, the length a placement asks for when no block stretches it", () => {
      expect(placementEndDate("2026-01-05", 0)).toBe("2026-01-05");
      expect(placementEndDate("2026-01-05", 1)).toBe("2026-01-05");
      expect(placementEndDate("2026-01-05", 28)).toBe("2026-02-01");
    });
  });
});

// ===========================================================================
// The block is the placement window's length knob.
//
// A program shorter than its block repeats to fill it, a longer one is cut at
// its end, and a placement on a day no block covers behaves exactly as it did
// before blocks bounded anything.
// ===========================================================================

describe("resolvePlacementWindowEnd", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetNextPlanStartCap.mockResolvedValue(null);
    mockGetBlockBound.mockResolvedValue(null);
  });

  it("stretches a short program's window to the block's last day", async () => {
    // 28 authored days placed into a block running to 2026-11-26.
    mockGetBlockBound.mockResolvedValue({ kind: "covering", endsOn: "2026-11-26" });

    expect(
      await resolvePlacementWindowEnd({
        clientId: "client-1",
        slotCount: 28,
        startDate: "2026-09-07",
      }),
    ).toBe("2026-11-26");
  });

  it("cuts a long program's window at the block's last day", async () => {
    // 112 authored days would reach 2026-12-27; the block stops on 2026-11-05.
    mockGetBlockBound.mockResolvedValue({ kind: "covering", endsOn: "2026-11-05" });

    expect(
      await resolvePlacementWindowEnd({
        clientId: "client-1",
        slotCount: 112,
        startDate: "2026-09-07",
      }),
    ).toBe("2026-11-05");
  });

  it("falls back to the authored length when no block covers the start", async () => {
    // 35 days from 2026-09-07 runs to 2026-10-11 — today's behaviour, untouched.
    expect(
      await resolvePlacementWindowEnd({
        clientId: "client-1",
        slotCount: 35,
        startDate: "2026-09-07",
      }),
    ).toBe("2026-10-11");
    expect(mockGetBlockBound).toHaveBeenCalledWith("client-1", "2026-09-07");
  });

  it("stops a program placed in a gap the day before the next block", async () => {
    // 35 authored days from 2026-09-07 would reach 2026-10-11; a block the coach
    // has drawn opens on 2026-09-21. The program keeps its own length up to the
    // day before it, so the block's card cannot claim a program it has none of.
    mockGetBlockBound.mockResolvedValue({ kind: "next", startsOn: "2026-09-21" });

    expect(
      await resolvePlacementWindowEnd({
        clientId: "client-1",
        slotCount: 35,
        startDate: "2026-09-07",
      }),
    ).toBe("2026-09-20");
  });

  it("never stretches a program to fill a gap — the next block is a cap, not a length", async () => {
    // 21 authored days from 2026-09-07 end on 2026-09-27; the next block is far off.
    mockGetBlockBound.mockResolvedValue({ kind: "next", startsOn: "2026-12-01" });

    expect(
      await resolvePlacementWindowEnd({
        clientId: "client-1",
        slotCount: 21,
        startDate: "2026-09-07",
      }),
    ).toBe("2026-09-27");
  });

  it("a one-day gap yields a one-day plan — the coach put it there", async () => {
    mockGetBlockBound.mockResolvedValue({ kind: "next", startsOn: "2026-09-08" });

    expect(
      await resolvePlacementWindowEnd({
        clientId: "client-1",
        slotCount: 21,
        startDate: "2026-09-07",
      }),
    ).toBe("2026-09-07");
  });

  it("still never runs past the next coexisting program's start", async () => {
    // The block says 2026-12-18, but another program opens on 2026-10-19.
    mockGetBlockBound.mockResolvedValue({ kind: "covering", endsOn: "2026-12-18" });
    mockGetNextPlanStartCap.mockResolvedValue("2026-10-18");

    expect(
      await resolvePlacementWindowEnd({
        clientId: "client-1",
        slotCount: 21,
        startDate: "2026-09-07",
      }),
    ).toBe("2026-10-18");
  });
});

describe("expandProgramToWindow", () => {
  const authored = [
    { weekIndex: 0, orderIndex: 0, name: "Push" },
    { weekIndex: 0, orderIndex: 1, name: "Pull" },
    { weekIndex: 0, orderIndex: 2, name: "Legs" },
  ];

  it("repeats the program until the window is covered", () => {
    const out = expandProgramToWindow(authored, 9);

    expect(out).toHaveLength(9);
    expect(out.map((s) => s.name)).toEqual([
      "Push", "Pull", "Legs", "Push", "Pull", "Legs", "Push", "Pull", "Legs",
    ]);
  });

  it("cuts a final partial cycle mid-program", () => {
    // The block ends when it ends; the last cycle simply stops.
    expect(expandProgramToWindow(authored, 7).map((s) => s.name)).toEqual([
      "Push", "Pull", "Legs", "Push", "Pull", "Legs", "Push",
    ]);
  });

  it("truncates a program longer than its window", () => {
    expect(expandProgramToWindow(authored, 2).map((s) => s.name)).toEqual(["Push", "Pull"]);
  });

  it("keeps (weekIndex, orderIndex) climbing across cycles", () => {
    // That pair IS the date-walk's slot position and the ordering every
    // placed-plan reader uses, so cycle 2 day 1 has to sort after cycle 1 day 3.
    const out = expandProgramToWindow(authored, 6);

    expect(out.map((s) => s.weekIndex)).toEqual([0, 0, 0, 1, 1, 1]);
    expect(out.map((s) => s.orderIndex)).toEqual([0, 1, 2, 0, 1, 2]);
    const keys = out.map((s) => `${s.weekIndex}:${s.orderIndex}`);
    expect(new Set(keys).size).toBe(out.length);
  });

  it("offsets later cycles by the authored program's own week span", () => {
    // A two-week authored program: cycle 2 starts at week 2, not week 1.
    const twoWeeks = [
      { weekIndex: 0, orderIndex: 0, name: "A" },
      { weekIndex: 1, orderIndex: 0, name: "B" },
    ];

    expect(expandProgramToWindow(twoWeeks, 4).map((s) => s.weekIndex)).toEqual([0, 1, 2, 3]);
  });

  it("leaves a single pass byte-identical to the authored program", () => {
    // Placement before blocks bounded anything must be unchanged.
    expect(expandProgramToWindow(authored, 3)).toEqual(authored);
  });

  it("returns nothing for an empty program or an empty window", () => {
    expect(expandProgramToWindow([], 10)).toEqual([]);
    expect(expandProgramToWindow(authored, 0)).toEqual([]);
  });
});

// ===========================================================================
// resolveWindowCap — the one bound placement and the amendment share.
// ===========================================================================

describe("resolveWindowCap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetNextPlanStartCap.mockResolvedValue(null);
    mockGetBlockBound.mockResolvedValue(null);
  });

  it("a covering block is the cap, and the placement stretches to it", async () => {
    mockGetBlockBound.mockResolvedValue({ kind: "covering", endsOn: "2026-11-26" });
    expect(await resolveWindowCap("client-1", "2026-09-07")).toEqual({
      stretchesToCap: true,
      cap: { endsOn: "2026-11-26", source: "block" },
    });
  });

  it("a block after the date caps at the day before it, without stretching", async () => {
    mockGetBlockBound.mockResolvedValue({ kind: "next", startsOn: "2026-10-05" });
    expect(await resolveWindowCap("client-1", "2026-09-07")).toEqual({
      stretchesToCap: false,
      cap: { endsOn: "2026-10-04", source: "next_block" },
    });
  });

  it("the next program wins when it starts before the block ends", async () => {
    mockGetBlockBound.mockResolvedValue({ kind: "covering", endsOn: "2026-11-26" });
    mockGetNextPlanStartCap.mockResolvedValue("2026-10-11");
    expect(await resolveWindowCap("client-1", "2026-09-07")).toEqual({
      stretchesToCap: true,
      cap: { endsOn: "2026-10-11", source: "next_plan" },
    });
  });

  it("a later next program does not shorten a block's cap", async () => {
    mockGetBlockBound.mockResolvedValue({ kind: "covering", endsOn: "2026-11-26" });
    mockGetNextPlanStartCap.mockResolvedValue("2026-12-31");
    expect((await resolveWindowCap("client-1", "2026-09-07")).cap).toEqual({
      endsOn: "2026-11-26",
      source: "block",
    });
  });

  it("nothing bounds a program with no block and no later program", async () => {
    expect(await resolveWindowCap("client-1", "2026-09-07")).toEqual({
      stretchesToCap: false,
      cap: null,
    });
    expect(mockGetBlockBound).toHaveBeenCalledWith("client-1", "2026-09-07");
    expect(mockGetNextPlanStartCap).toHaveBeenCalledWith("client-1", "2026-09-07");
  });
});
