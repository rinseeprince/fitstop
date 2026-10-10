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
  placementEndDate,
  resolvePlacementWindowEnd,
  resolveWindowCap,
  type ProgramSession,
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

function makeSession(overrides?: Partial<ProgramSession>): ProgramSession {
  return {
    id: "ts-1",
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

    it("walks the days from the first date", async () => {
      const eventUpsertQuery = wireEventUpsert();

      const count = await generateProgramEvents({
        clientId: "client-1",
        planId: "plan-1",
        programDays: [
          [makeSession({ id: "ts-a", name: "A" })],
          [makeSession({ id: "ts-b", name: "B" })],
          [],
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

    it("a rest day consumes its date without emitting an event", async () => {
      const eventUpsertQuery = wireEventUpsert();

      // The rest day takes 07-05 silently and the next day lands on 07-06:
      // no compression.
      await generateProgramEvents({
        clientId: "client-1",
        planId: "plan-1",
        programDays: [
          [makeSession({ id: "ts-0", name: "S0" })],
          [],
          [makeSession({ id: "ts-2", name: "S2" })],
        ],
        startDate: "2026-07-04",
        endDate: "2026-07-06",
      });

      const rows = eventUpsertQuery.upsert.mock.calls[0][0] as Array<{
        training_session_id: string;
        date: string;
      }>;
      expect(rows.map((r) => [r.training_session_id, r.date])).toEqual([
        ["ts-0", "2026-07-04"],
        ["ts-2", "2026-07-06"],
      ]);
    });

    it("lays a day's sessions on its date in the day's order, each at its place", async () => {
      const eventUpsertQuery = wireEventUpsert();

      const count = await generateProgramEvents({
        clientId: "client-1",
        planId: "plan-1",
        programDays: [
          [makeSession({ id: "ts-run", name: "AM run" }), makeSession({ id: "ts-lift", name: "PM lift" })],
          [],
          [makeSession({ id: "ts-solo", name: "Solo" })],
        ],
        startDate: "2026-07-01",
        endDate: "2026-07-03",
      });

      const rows = eventUpsertQuery.upsert.mock.calls[0][0] as Array<{
        training_session_id: string;
        date: string;
        day_order: number;
      }>;
      expect(rows.map((r) => [r.training_session_id, r.date, r.day_order])).toEqual([
        ["ts-run", "2026-07-01", 0],
        ["ts-lift", "2026-07-01", 1],
        ["ts-solo", "2026-07-03", 0],
      ]);
      expect(count).toBe(3);
    });

    it("INVARIANT: every emitted row carries the calorie_surplus_percentage key, even when null", async () => {
      const eventUpsertQuery = wireEventUpsert();

      await generateProgramEvents({
        clientId: "client-1",
        planId: "plan-1",
        programDays: [
          [makeSession({ id: "ts-a", calorieSurplusPercentage: 20 })],
          [makeSession({ id: "ts-b", calorieSurplusPercentage: null })],
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
        programDays: [[makeSession()]],
        startDate: "2026-07-01", endDate: "2026-07-01",
      });

      expect(eventUpsertQuery.upsert).toHaveBeenCalledWith(expect.any(Array), {
        onConflict: "client_id,training_session_id,date",
        ignoreDuplicates: true,
      });
    });

    it("writes a long walk in chunks, every event exactly once", async () => {
      const eventUpsertQuery = wireEventUpsert();

      // 400 days of three sessions each: 1,200 events, three statements.
      const days = Array.from({ length: 400 }, (_, d) =>
        [0, 1, 2].map((place) => makeSession({ id: `ts-${d}-${place}` })),
      );
      const count = await generateProgramEvents({
        clientId: "client-1", planId: "plan-1", programDays: days,
        startDate: "2026-01-01", endDate: "2027-02-04",
      });

      expect(count).toBe(1200);
      const chunks = eventUpsertQuery.upsert.mock.calls.map((call) => (call[0] as unknown[]).length);
      expect(chunks).toEqual([500, 500, 200]);
      const ids = eventUpsertQuery.upsert.mock.calls.flatMap((call) =>
        (call[0] as Array<{ training_session_id: string }>).map((row) => row.training_session_id),
      );
      expect(new Set(ids).size).toBe(1200);
    });

    it("returns 0 with no DB write for an empty program or an all-rest window", async () => {
      const eventUpsertQuery = wireEventUpsert();

      expect(
        await generateProgramEvents({
          clientId: "client-1", planId: "plan-1", programDays: [],
          startDate: "2026-07-01", endDate: "2026-07-07",
        }),
      ).toBe(0);
      expect(
        await generateProgramEvents({
          clientId: "client-1", planId: "plan-1",
          programDays: [[]],
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
          programDays: [[makeSession()]],
          startDate: "2026-07-01", endDate: "2026-07-01",
        }),
      ).rejects.toThrow("Failed to generate events: boom");
    });
  });

  describe("placementEndDate", () => {
    it("is start + max(1, days) − 1, the length a placement asks for", () => {
      expect(placementEndDate("2026-01-05", 0)).toBe("2026-01-05");
      expect(placementEndDate("2026-01-05", 1)).toBe("2026-01-05");
      expect(placementEndDate("2026-01-05", 28)).toBe("2026-02-01");
    });
  });
});

// ===========================================================================
// A placed program runs its authored length, capped at the day before the next
// live program (SD4, docs/SUNSET-PLAN.md). Nothing stretches it.
// ===========================================================================

describe("resolvePlacementWindowEnd", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetNextPlanStartCap.mockResolvedValue(null);
  });

  it("runs a program shorter than the gap to the next program its own length, never stretched to the cap", async () => {
    // 21 authored days from 2026-09-07 end on 2026-09-27; the next program
    // starts 2026-10-19, so the gap runs to 2026-10-18. The days between stay
    // empty.
    mockGetNextPlanStartCap.mockResolvedValue("2026-10-18");

    expect(
      await resolvePlacementWindowEnd({ clientId: "client-1", dayCount: 21, startDate: "2026-09-07" }),
    ).toBe("2026-09-27");
  });

  it("cuts a program longer than the gap at the day before the next program", async () => {
    // 35 authored days from 2026-09-07 would reach 2026-10-11; the next
    // program starts 2026-09-21.
    mockGetNextPlanStartCap.mockResolvedValue("2026-09-20");

    expect(
      await resolvePlacementWindowEnd({ clientId: "client-1", dayCount: 35, startDate: "2026-09-07" }),
    ).toBe("2026-09-20");
  });

  it("a program that fills the gap exactly ends the day before the next one", async () => {
    // 14 authored days from 2026-09-07 end on 2026-09-20, the cap itself.
    mockGetNextPlanStartCap.mockResolvedValue("2026-09-20");

    expect(
      await resolvePlacementWindowEnd({ clientId: "client-1", dayCount: 14, startDate: "2026-09-07" }),
    ).toBe("2026-09-20");
  });

  it("runs its own length when no program follows", async () => {
    // 35 days from 2026-09-07 runs to 2026-10-11.
    expect(
      await resolvePlacementWindowEnd({ clientId: "client-1", dayCount: 35, startDate: "2026-09-07" }),
    ).toBe("2026-10-11");
    expect(mockGetNextPlanStartCap).toHaveBeenCalledWith("client-1", "2026-09-07");
  });
});

// ===========================================================================
// resolveWindowCap — the one bound placement and the plan editor share.
// ===========================================================================

describe("resolveWindowCap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetNextPlanStartCap.mockResolvedValue(null);
  });

  it("the day before the next program is the cap", async () => {
    mockGetNextPlanStartCap.mockResolvedValue("2026-10-11");
    expect(await resolveWindowCap("client-1", "2026-09-07")).toEqual({
      endsOn: "2026-10-11",
      source: "next_plan",
    });
  });

  it("nothing bounds a program with no later program", async () => {
    expect(await resolveWindowCap("client-1", "2026-09-07")).toBeNull();
    expect(mockGetNextPlanStartCap).toHaveBeenCalledWith("client-1", "2026-09-07");
  });
});
