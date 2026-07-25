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

import { supabaseAdmin } from "./supabase-admin";
import { getNextPlanStartCap } from "./training-event-service";
import {
  generateProgramEvents,
  calculatePlacementEndDate,
  type ProgramSlot,
} from "./program-event-walk";

const mockFrom = vi.mocked(supabaseAdmin.from);
const mockGetNextPlanStartCap = vi.mocked(getNextPlanStartCap);

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

  // =========================================================================
  // calculatePlacementEndDate
  // =========================================================================

  describe("calculatePlacementEndDate", () => {
    it("window = slotCount days, one pass", async () => {
      expect(
        await calculatePlacementEndDate({
          clientId: "client-1", slotCount: 14, startDate: "2026-07-01",
        }),
      ).toBe("2026-07-14");
    });

    it("clamps slotCount up to at least one day", async () => {
      expect(
        await calculatePlacementEndDate({
          clientId: "client-1", slotCount: 0, startDate: "2026-07-01",
        }),
      ).toBe("2026-07-01");
    });

    it("caps at the next coexisting plan's start", async () => {
      mockGetNextPlanStartCap.mockResolvedValue("2026-07-08");
      expect(
        await calculatePlacementEndDate({
          clientId: "client-1", slotCount: 28, startDate: "2026-07-01",
        }),
      ).toBe("2026-07-08");
      expect(mockGetNextPlanStartCap).toHaveBeenCalledWith("client-1", "2026-07-01");
    });
  });
});
