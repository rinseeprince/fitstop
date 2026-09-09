import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase-admin before importing the service
vi.mock("./supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

// Service deps that hit supabase / the clock — stub directly so the unit under
// test is the nutrition event service alone.
vi.mock("@/services/training-event-service", () => ({
  getEventsForDateRange: vi.fn(),
}));
vi.mock("@/services/today-service", () => ({
  getClientTodayString: vi.fn(),
}));
vi.mock("@/services/event-deletion-floor", () => ({
  resolveEventDeletionFloor: vi.fn(),
}));
vi.mock("@/lib/error-handler", () => ({
  captureApiError: vi.fn(),
}));
// Partial mock: the cascade's version lookup is stubbed; versionCoversDate
// stays REAL (pure) so the gap-sweep computation under test is the shipped one.
vi.mock("@/services/nutrition-plan-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/nutrition-plan-service")>();
  return { ...actual, getActiveNutritionPlanVersionsOverlapping: vi.fn() };
});

// Inline query-builder mock (mirrors services/training-event-service.test.ts):
// every chain method returns `this`; single/maybeSingle resolve to `result`; a
// thenable makes `await query` resolve to `result` (list reads).
function createMockQuery<T = unknown>(result: {
  data: T | null;
  error: { message: string } | null;
}) {
  const mockQuery = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
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

import { supabaseAdmin } from "./supabase-admin";
import { getEventsForDateRange } from "@/services/training-event-service";
import { getClientTodayString } from "@/services/today-service";
import { captureApiError } from "@/lib/error-handler";
import { resolveEventDeletionFloor } from "@/services/event-deletion-floor";
import { getActiveNutritionPlanVersionsOverlapping } from "@/services/nutrition-plan-service";
import {
  generateNutritionEvents,
  regenerateFutureNutritionEvents,
  cascadeNutritionAfterTrainingChange,
  sweepUncoveredNutritionDays,
} from "./nutrition-event-service";

const mockFrom = vi.mocked(supabaseAdmin.from);

const PLAN = { baselineCalories: 2000, proteinTargetG: 150, dietType: "balanced" };

describe("nutrition-event-service: cascade-preserve guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // No training events → surplus null, burn 0; keeps generated rows deterministic.
    vi.mocked(getEventsForDateRange).mockResolvedValue([]);
    vi.mocked(getClientTodayString).mockResolvedValue("2026-04-10");
  });

  // =========================================================================
  // ◆2(b) generateNutritionEvents — skip is_modified days from the upsert
  // =========================================================================
  describe("generateNutritionEvents preserves is_modified days", () => {
    it("omits coach-edited dates from the upsert and regenerates the rest", async () => {
      let nutCount = 0;
      // The existing-days read returns one edited day in the middle of the
      // window. It is now UNFILTERED (one read serves both the is_modified
      // guard and the coach-note carry-forward), so rows carry their flags.
      const protectedQuery = createMockQuery<
        { date: string; is_modified: boolean; coach_note: string | null }[]
      >({
        data: [{ date: "2026-04-11", is_modified: true, coach_note: null }],
        error: null,
      });
      const upsertQuery = createMockQuery({ data: [], error: null });

      mockFrom.mockImplementation((table: string) => {
        if (table === "nutrition_events") {
          nutCount += 1;
          // 1st nutrition_events access = protected-select, 2nd = upsert
          return (nutCount === 1 ? protectedQuery : upsertQuery) as any;
        }
        return createMockQuery({ data: null, error: null }) as any;
      });

      await generateNutritionEvents(
        "client-1",
        "plan-1",
        PLAN,
        null,
        null,
        ["2026-04-10", "2026-04-11", "2026-04-12"],
      );

      // Read is keyed on client_id + the exact date list (NOT plan id, NOT a
      // [min,max] range), because the upsert conflict key is client-scoped and
      // a scattered narrow cascade must not reason about days it is not
      // writing. is_modified is partitioned in memory rather than filtered in
      // SQL, so one round trip serves both the edit guard and the coach-note
      // carry-forward.
      expect(protectedQuery.eq).toHaveBeenCalledWith("client_id", "client-1");
      expect(protectedQuery.select).toHaveBeenCalledWith("date, is_modified, coach_note");
      expect(protectedQuery.in).toHaveBeenCalledWith("date", [
        "2026-04-10",
        "2026-04-11",
        "2026-04-12",
      ]);

      // The edited day (04-11) is omitted; the other two days are regenerated.
      expect(upsertQuery.upsert).toHaveBeenCalledTimes(1);
      const rows = upsertQuery.upsert.mock.calls[0][0] as Array<{ date: string }>;
      expect(rows.map((r) => r.date)).toEqual(["2026-04-10", "2026-04-12"]);
      expect(upsertQuery.upsert.mock.calls[0][1]).toEqual({ onConflict: "client_id,date" });
    });

    it("upserts every day when none are edited", async () => {
      let nutCount = 0;
      const protectedQuery = createMockQuery<{ date: string }[]>({ data: [], error: null });
      const upsertQuery = createMockQuery({ data: [], error: null });

      mockFrom.mockImplementation((table: string) => {
        if (table === "nutrition_events") {
          nutCount += 1;
          return (nutCount === 1 ? protectedQuery : upsertQuery) as any;
        }
        return createMockQuery({ data: null, error: null }) as any;
      });

      await generateNutritionEvents(
        "client-1",
        "plan-1",
        PLAN,
        null,
        null,
        ["2026-04-10", "2026-04-11", "2026-04-12"],
      );

      const rows = upsertQuery.upsert.mock.calls[0][0] as Array<{ date: string }>;
      expect(rows.map((r) => r.date)).toEqual(["2026-04-10", "2026-04-11", "2026-04-12"]);
    });

    it("throws (and never upserts) when the protected-days read fails", async () => {
      let nutCount = 0;
      const protectedQuery = createMockQuery({ data: null, error: { message: "boom" } });
      const upsertQuery = createMockQuery({ data: [], error: null });

      mockFrom.mockImplementation((table: string) => {
        if (table === "nutrition_events") {
          nutCount += 1;
          return (nutCount === 1 ? protectedQuery : upsertQuery) as any;
        }
        return createMockQuery({ data: null, error: null }) as any;
      });

      await expect(
        generateNutritionEvents("client-1", "plan-1", PLAN, null, null, [
          "2026-04-10",
          "2026-04-11",
          "2026-04-12",
        ]),
      ).rejects.toMatchObject({ message: "boom" });

      // A read failure must NOT silently overwrite an edited day.
      expect(upsertQuery.upsert).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // ◆2(a) regenerateFutureNutritionEvents — delete preserves is_modified rows
  // =========================================================================
  describe("regenerateFutureNutritionEvents delete-guard", () => {
    it("excludes is_modified rows from the cascade delete", async () => {
      let nutCount = 0;
      const deleteQuery = createMockQuery({ data: null, error: null });
      const protectedQuery = createMockQuery<{ date: string }[]>({ data: [], error: null });
      const upsertQuery = createMockQuery({ data: [], error: null });

      // The plan read carries the version's window and the regenerate clamps
      // to it (migration 166: the window IS the row). A version reaching past
      // the range keeps the clamp out of this test's frame.
      const planRow = {
        baseline_calories: 2000,
        protein_target_g: 150,
        diet_type: "balanced",
        status: "active",
        effective_from: "2026-01-01",
        effective_until: "2026-06-05",
      };

      mockFrom.mockImplementation((table: string) => {
        if (table === "nutrition_events") {
          nutCount += 1;
          // 1st = delete, 2nd = protected-select (in generate), 3rd = upsert
          if (nutCount === 1) return deleteQuery as any;
          if (nutCount === 2) return protectedQuery as any;
          return upsertQuery as any;
        }
        if (table === "nutrition_plans") {
          return createMockQuery({ data: planRow, error: null }) as any;
        }
        if (table === "nutrition_plan_daily_targets") {
          return createMockQuery({ data: [], error: null }) as any;
        }
        return createMockQuery({ data: null, error: null }) as any;
      });

      await regenerateFutureNutritionEvents("client-1", "plan-1", {
        kind: "from",
        from: "2026-04-10",
      });

      expect(deleteQuery.delete).toHaveBeenCalled();
      // CLIENT-scoped since 1b.2: rows inside the version's window may carry a
      // prior version's id (or NULL), which the old plan-id scoping missed.
      expect(deleteQuery.eq).toHaveBeenCalledWith("client_id", "client-1");
      expect(deleteQuery.eq).not.toHaveBeenCalledWith("nutrition_plan_id", "plan-1");
      expect(deleteQuery.gte).toHaveBeenCalledWith("date", "2026-04-10");
      expect(deleteQuery.eq).toHaveBeenCalledWith("status", "scheduled");
      // The guard under test: edited rows survive the cascade delete.
      expect(deleteQuery.eq).toHaveBeenCalledWith("is_modified", false);
    });

    // =======================================================================
    // Shipment 0 — the delete window must equal the regeneration window.
    //
    // The delete was an unbounded ray (`date >= fromDate`) while the
    // regeneration covers a fixed 8 weeks, so a cascade anchored EARLIER than
    // the anchor that wrote the rows deleted a tail it never rebuilt. A plan
    // generated with an effective date a week out wrote events to day+63; a
    // routine training edit anchored at today then deleted all of them and
    // regenerated only to day+56, leaving 7 dates with no nutrition event and
    // no template fallback behind them.
    // =======================================================================
    it("bounds the delete at the regeneration end date, so no date is deleted without being rebuilt", async () => {
      let nutCount = 0;
      const deleteQuery = createMockQuery({ data: null, error: null });
      const protectedQuery = createMockQuery<{ date: string }[]>({ data: [], error: null });
      const upsertQuery = createMockQuery({ data: [], error: null });

      const planRow = {
        baseline_calories: 2000,
        protein_target_g: 150,
        diet_type: "balanced",
        status: "active",
        effective_from: "2026-01-01",
        effective_until: "2026-06-05",
      };

      mockFrom.mockImplementation((table: string) => {
        if (table === "nutrition_events") {
          nutCount += 1;
          if (nutCount === 1) return deleteQuery as any;
          if (nutCount === 2) return protectedQuery as any;
          return upsertQuery as any;
        }
        if (table === "nutrition_plans") return createMockQuery({ data: planRow, error: null }) as any;
        if (table === "nutrition_plan_daily_targets") return createMockQuery({ data: [], error: null }) as any;
        return createMockQuery({ data: null, error: null }) as any;
      });

      await regenerateFutureNutritionEvents("client-1", "plan-1", {
        kind: "from",
        from: "2026-04-10",
      });

      // The version's own end (the fixture's effective_until), inclusive.
      const EXPECTED_END = "2026-06-05";

      // The delete is closed at BOTH ends...
      expect(deleteQuery.gte).toHaveBeenCalledWith("date", "2026-04-10");
      expect(deleteQuery.lte).toHaveBeenCalledWith("date", EXPECTED_END);

      // ...and its upper bound is exactly the last date regenerated behind it.
      const rows = upsertQuery.upsert.mock.calls[0][0] as Array<{ date: string }>;
      expect(rows[0].date).toBe("2026-04-10");
      expect(rows[rows.length - 1].date).toBe(EXPECTED_END);
      expect(rows).toHaveLength(57);
    });

    // A coach note explains WHY the prescription changed on a date. It has to
    // outlive the next prescription change, or a routine training edit erases
    // the coach's own record of what they did.
    it("spares annotated days from the cascade delete", async () => {
      let nutCount = 0;
      const deleteQuery = createMockQuery({ data: null, error: null });
      const protectedQuery = createMockQuery<{ date: string }[]>({ data: [], error: null });
      const upsertQuery = createMockQuery({ data: [], error: null });

      mockFrom.mockImplementation((table: string) => {
        if (table === "nutrition_events") {
          nutCount += 1;
          if (nutCount === 1) return deleteQuery as any;
          if (nutCount === 2) return protectedQuery as any;
          return upsertQuery as any;
        }
        if (table === "nutrition_plans")
          return createMockQuery({
            data: {
              baseline_calories: 2000,
              protein_target_g: 150,
              diet_type: "balanced",
              effective_from: "2026-01-01",
              effective_until: "2026-06-05",
            },
            error: null,
          }) as any;
        if (table === "nutrition_plan_daily_targets")
          return createMockQuery({ data: [], error: null }) as any;
        return createMockQuery({ data: null, error: null }) as any;
      });

      await regenerateFutureNutritionEvents("client-1", "plan-1", {
        kind: "from",
        from: "2026-04-10",
      });

      expect(deleteQuery.is).toHaveBeenCalledWith("coach_note", null);
    });
  });

  // =========================================================================
  // Notes carry forward across a regeneration.
  //
  // Annotated days survive the delete, so they arrive at the upsert as a
  // conflict and their targets ARE rewritten. coach_note is set explicitly on
  // every row rather than omitted-and-assumed-preserved.
  // =========================================================================
  describe("generateNutritionEvents preserves coach notes", () => {
    it("carries an existing note onto the regenerated row and leaves other days null", async () => {
      let nutCount = 0;
      const existingQuery = createMockQuery<
        { date: string; is_modified: boolean; coach_note: string | null }[]
      >({
        data: [
          { date: "2026-04-11", is_modified: false, coach_note: "Dropped cals, knee flare-up" },
        ],
        error: null,
      });
      const upsertQuery = createMockQuery({ data: [], error: null });

      mockFrom.mockImplementation((table: string) => {
        if (table === "nutrition_events") {
          nutCount += 1;
          return (nutCount === 1 ? existingQuery : upsertQuery) as any;
        }
        return createMockQuery({ data: null, error: null }) as any;
      });

      await generateNutritionEvents(
        "client-1",
        "plan-1",
        PLAN,
        null,
        null,
        ["2026-04-10", "2026-04-11", "2026-04-12"],
      );

      const rows = upsertQuery.upsert.mock.calls[0][0] as Array<{
        date: string;
        coach_note: string | null;
      }>;
      expect(rows.map((r) => r.date)).toEqual(["2026-04-10", "2026-04-11", "2026-04-12"]);
      expect(rows.find((r) => r.date === "2026-04-11")?.coach_note).toBe(
        "Dropped cals, knee flare-up",
      );
      // Explicitly null, not absent — the column is always in the payload so
      // the DO UPDATE SET list cannot depend on which keys happen to be present.
      expect(rows.find((r) => r.date === "2026-04-10")?.coach_note).toBeNull();
    });

    it("still skips is_modified days now that the read is unfiltered", async () => {
      let nutCount = 0;
      const existingQuery = createMockQuery<
        { date: string; is_modified: boolean; coach_note: string | null }[]
      >({
        data: [{ date: "2026-04-11", is_modified: true, coach_note: null }],
        error: null,
      });
      const upsertQuery = createMockQuery({ data: [], error: null });

      mockFrom.mockImplementation((table: string) => {
        if (table === "nutrition_events") {
          nutCount += 1;
          return (nutCount === 1 ? existingQuery : upsertQuery) as any;
        }
        return createMockQuery({ data: null, error: null }) as any;
      });

      await generateNutritionEvents(
        "client-1", "plan-1", PLAN, null, null,
        ["2026-04-10", "2026-04-11", "2026-04-12"],
      );

      const rows = upsertQuery.upsert.mock.calls[0][0] as Array<{ date: string }>;
      expect(rows.map((r) => r.date)).toEqual(["2026-04-10", "2026-04-12"]);
    });
  });

  // =========================================================================
  // Narrow scope — the no-row window. Routes that know their exact dates pass
  // {kind:"dates"} and get a pure upsert: those days NEVER lose their row. The
  // old delete-then-regenerate left every date in the window row-less across
  // four network round trips, and getPlanTargetForDate resolves a missing row
  // to null — which nutrition_logs snapshots permanently.
  // =========================================================================
  describe("regenerateFutureNutritionEvents narrow scope", () => {
    it("upserts exactly the given dates and issues no delete", async () => {
      let nutCount = 0;
      const protectedQuery = createMockQuery<
        { date: string; is_modified: boolean; coach_note: string | null }[]
      >({ data: [], error: null });
      const upsertQuery = createMockQuery({ data: [], error: null });
      const deleteQuery = createMockQuery({ data: null, error: null });

      mockFrom.mockImplementation((table: string) => {
        if (table === "nutrition_events") {
          nutCount += 1;
          // With no delete, the FIRST nutrition_events access is the protected
          // read. If an implementation regressed to deleting, this dispatch would
          // hand the delete the protected query and the assertions below trip.
          return (nutCount === 1 ? protectedQuery : upsertQuery) as any;
        }
        if (table === "nutrition_plans") {
          return createMockQuery({
            data: {
              baseline_calories: 2000,
              protein_target_g: 150,
              diet_type: "balanced",
              effective_from: "2026-01-01",
              effective_until: "2026-12-31",
            },
            error: null,
          }) as any;
        }
        return createMockQuery({ data: [], error: null }) as any;
      });

      // A move: the day it left and the day it landed on, three months apart.
      await regenerateFutureNutritionEvents("client-1", "plan-1", {
        kind: "dates",
        dates: ["2026-07-20", "2026-04-27"],
      });

      // Sorted, and NOT expanded to the 85 days between them.
      const rows = upsertQuery.upsert.mock.calls[0][0] as Array<{ date: string }>;
      expect(rows.map((r) => r.date)).toEqual(["2026-04-27", "2026-07-20"]);

      // The protected read is keyed on the exact list too — a scattered narrow
      // cascade must not read (or reason about) days it is not writing.
      expect(protectedQuery.in).toHaveBeenCalledWith("date", [
        "2026-04-27",
        "2026-07-20",
      ]);

      // The whole point: no DELETE, so the dates never lose their row. A missing
      // row reads as null from getPlanTargetForDate, and that null is snapshotted
      // permanently into nutrition_logs.
      expect(deleteQuery.delete).not.toHaveBeenCalled();
      expect(protectedQuery.delete).not.toHaveBeenCalled();
      expect(upsertQuery.delete).not.toHaveBeenCalled();
      expect(nutCount).toBe(2); // protected-read + upsert only
    });

    it("does nothing at all when the date list is empty", async () => {
      const anyQuery = createMockQuery({ data: [], error: null });
      mockFrom.mockImplementation(() => anyQuery as any);

      await regenerateFutureNutritionEvents("client-1", "plan-1", {
        kind: "dates",
        dates: [],
      });

      // Bails BEFORE any write. The old code deleted first and only then hit its
      // range guard — a "deleted the calendar, returned success" shape.
      expect(anyQuery.delete).not.toHaveBeenCalled();
      expect(anyQuery.upsert).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Migration 144: the version-window clamp. A version can only write or
  // delete inside its own [effective_from, effective_until] — the property
  // the cascade's segmentation is built on.
  // =========================================================================
  describe("regenerateFutureNutritionEvents version clamp", () => {
    it("clamps a from-scope's delete AND regenerate to a closed version's window", async () => {
      let nutCount = 0;
      const deleteQuery = createMockQuery({ data: null, error: null });
      const protectedQuery = createMockQuery<{ date: string }[]>({ data: [], error: null });
      const upsertQuery = createMockQuery({ data: [], error: null });

      mockFrom.mockImplementation((table: string) => {
        if (table === "nutrition_events") {
          nutCount += 1;
          if (nutCount === 1) return deleteQuery as any;
          if (nutCount === 2) return protectedQuery as any;
          return upsertQuery as any;
        }
        if (table === "nutrition_plans")
          return createMockQuery({
            data: {
              baseline_calories: 2000,
              protein_target_g: 150,
              diet_type: "balanced",
              effective_from: "2026-04-01",
              effective_until: "2026-04-20", // closed version — superseded era
            },
            error: null,
          }) as any;
        return createMockQuery({ data: [], error: null }) as any;
      });

      await regenerateFutureNutritionEvents("client-1", "plan-1", {
        kind: "from",
        from: "2026-04-10",
      });

      // The version ends 2026-04-20 — the delete stops at the window's edge,
      // never reaching the next era.
      expect(deleteQuery.gte).toHaveBeenCalledWith("date", "2026-04-10");
      expect(deleteQuery.lte).toHaveBeenCalledWith("date", "2026-04-20");
      const rows = upsertQuery.upsert.mock.calls[0][0] as Array<{ date: string }>;
      expect(rows[0].date).toBe("2026-04-10");
      expect(rows[rows.length - 1].date).toBe("2026-04-20");
      expect(rows).toHaveLength(11);
    });

    it("writes nothing at all when the scope falls entirely outside the version's window", async () => {
      let nutCount = 0;
      mockFrom.mockImplementation((table: string) => {
        if (table === "nutrition_events") nutCount += 1;
        if (table === "nutrition_plans")
          return createMockQuery({
            data: {
              baseline_calories: 2000,
              protein_target_g: 150,
              diet_type: "balanced",
              effective_from: "2026-05-01",
              effective_until: "2026-12-31",
            },
            error: null,
          }) as any;
        return createMockQuery({ data: [], error: null }) as any;
      });

      await regenerateFutureNutritionEvents("client-1", "plan-1", {
        kind: "dates",
        dates: ["2026-04-01"],
      });

      expect(nutCount).toBe(0);
    });
  });

  // =========================================================================
  // Migration 144: cascade version segmentation — the FIRST cascade coverage.
  // The cascade hands the SAME scope to every overlapping version; each
  // version's clamp does the splitting.
  // =========================================================================
  describe("cascadeNutritionAfterTrainingChange version segmentation", () => {
    const V1 = { id: "v1", effectiveFrom: "2026-01-01", effectiveUntil: "2026-04-30" };
    const V2 = { id: "v2", effectiveFrom: "2026-05-01", effectiveUntil: "2026-12-31" };

    it("regenerates each side of an era boundary from its OWN version's grid", async () => {
      vi.mocked(getActiveNutritionPlanVersionsOverlapping).mockResolvedValue([V1, V2]);

      let planCount = 0;
      let nutCount = 0;
      const upserts: Array<ReturnType<typeof createMockQuery>> = [];
      mockFrom.mockImplementation((table: string) => {
        if (table === "nutrition_plans") {
          planCount += 1;
          return createMockQuery({
            data:
              planCount === 1
                ? { baseline_calories: 1800, protein_target_g: 150, diet_type: "balanced",
                    effective_from: V1.effectiveFrom, effective_until: V1.effectiveUntil }
                : { baseline_calories: 2200, protein_target_g: 150, diet_type: "balanced",
                    effective_from: V2.effectiveFrom, effective_until: V2.effectiveUntil },
            error: null,
          }) as any;
        }
        if (table === "nutrition_events") {
          nutCount += 1;
          // Per version, a dates-scope touches events twice: protected read,
          // then upsert (no delete). Odd = protected, even = upsert.
          if (nutCount % 2 === 1) return createMockQuery({ data: [], error: null }) as any;
          const upsert = createMockQuery({ data: [], error: null });
          upserts.push(upsert);
          return upsert as any;
        }
        return createMockQuery({ data: [], error: null }) as any;
      });

      // A training move straddling the boundary: one date in each era.
      await cascadeNutritionAfterTrainingChange(
        "client-1",
        { kind: "dates", dates: ["2026-04-29", "2026-05-02"] },
        "test-move"
      );

      expect(getActiveNutritionPlanVersionsOverlapping).toHaveBeenCalledWith(
        "client-1",
        "2026-04-29",
        "2026-05-02"
      );
      // v1 wrote only its own day, from ITS baseline; v2 likewise.
      const v1Rows = upserts[0].upsert.mock.calls[0][0] as Array<{ date: string; baseline_calories: number }>;
      const v2Rows = upserts[1].upsert.mock.calls[0][0] as Array<{ date: string; baseline_calories: number }>;
      expect(v1Rows.map((r) => r.date)).toEqual(["2026-04-29"]);
      expect(v1Rows[0].baseline_calories).toBe(1800);
      expect(v2Rows.map((r) => r.date)).toEqual(["2026-05-02"]);
      expect(v2Rows[0].baseline_calories).toBe(2200);
    });

    it("from-scope: sweeps the uncovered stretch past the version's end, one range, as far as the caller cleared training", async () => {
      // One version ending a week in; the training clear reached 2026-06-05;
      // the last stale row sits at 2026-05-20, inside that reach.
      vi.mocked(getActiveNutritionPlanVersionsOverlapping).mockResolvedValue([
        { id: "v1", effectiveFrom: "2026-01-01", effectiveUntil: "2026-04-16" },
      ]);

      let nutCount = 0;
      const lastQuery = createMockQuery({ data: { date: "2026-05-20" }, error: null });
      const sweepDeleteQuery = createMockQuery({ data: null, error: null });
      const versionDeleteQuery = createMockQuery({ data: null, error: null });
      const protectedQuery = createMockQuery<{ date: string }[]>({ data: [], error: null });
      const upsertQuery = createMockQuery({ data: [], error: null });

      mockFrom.mockImplementation((table: string) => {
        if (table === "nutrition_events") {
          nutCount += 1;
          // 1 = the sweep's read of the last stale day, 2 = its range delete,
          // 3 = v1's clamped delete, 4 = protected read, 5 = upsert.
          if (nutCount === 1) return lastQuery as any;
          if (nutCount === 2) return sweepDeleteQuery as any;
          if (nutCount === 3) return versionDeleteQuery as any;
          if (nutCount === 4) return protectedQuery as any;
          return upsertQuery as any;
        }
        if (table === "nutrition_plans")
          return createMockQuery({
            data: { baseline_calories: 2000, protein_target_g: 150, diet_type: "balanced",
                    effective_from: "2026-01-01", effective_until: "2026-04-16" },
            error: null,
          }) as any;
        return createMockQuery({ data: [], error: null }) as any;
      });

      await cascadeNutritionAfterTrainingChange(
        "client-1",
        { kind: "from", from: "2026-04-10", to: "2026-06-05" },
        "test-clear"
      );

      // A from-scope asks for every version with days on or after the anchor —
      // no upper bound; each regenerates to its own end.
      expect(getActiveNutritionPlanVersionsOverlapping).toHaveBeenCalledWith("client-1", "2026-04-10");
      // The sweep: one range from the day after v1's end to the day the caller
      // cleared training, client-scoped, the three survival predicates intact.
      expect(sweepDeleteQuery.delete).toHaveBeenCalled();
      expect(sweepDeleteQuery.gte).toHaveBeenCalledWith("date", "2026-04-17");
      expect(sweepDeleteQuery.lte).toHaveBeenCalledWith("date", "2026-06-05");
      expect(sweepDeleteQuery.eq).toHaveBeenCalledWith("client_id", "client-1");
      expect(sweepDeleteQuery.eq).toHaveBeenCalledWith("is_modified", false);
      expect(sweepDeleteQuery.is).toHaveBeenCalledWith("coach_note", null);
      // The stretch opens after the anchor, so the floor was never asked.
      expect(resolveEventDeletionFloor).not.toHaveBeenCalled();
      // The version's own delete stays inside its window.
      expect(versionDeleteQuery.gte).toHaveBeenCalledWith("date", "2026-04-10");
      expect(versionDeleteQuery.lte).toHaveBeenCalledWith("date", "2026-04-16");
    });

    it("LOUD-BREAK REGRESSION: a failed version lookup is logged, never mistaken for 'no plan'", async () => {
      const boom = new Error("connection reset");
      vi.mocked(getActiveNutritionPlanVersionsOverlapping).mockRejectedValue(boom);
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await cascadeNutritionAfterTrainingChange(
        "client-1",
        { kind: "dates", dates: ["2026-04-29"] },
        "test-fail"
      );

      // The old shape discarded the error and silently no-opped every cascade.
      // Now: logged, Sentried, and no event write attempted.
      expect(consoleSpy).toHaveBeenCalled();
      expect(captureApiError).toHaveBeenCalledWith(boom, {
        action: "test-fail",
        clientId: "client-1",
      });
      expect(mockFrom).not.toHaveBeenCalledWith("nutrition_events");
      consoleSpy.mockRestore();
    });

    it("no overlapping versions → clean no-op", async () => {
      vi.mocked(getActiveNutritionPlanVersionsOverlapping).mockResolvedValue([]);

      await cascadeNutritionAfterTrainingChange(
        "client-1",
        { kind: "dates", dates: ["2026-04-29"] },
        "test-none"
      );

      expect(mockFrom).not.toHaveBeenCalledWith("nutrition_events");
    });
  });
});

// ===========================================================================
// The window is the row (migration 166).
//
// A version carries its own end, resolved at save the way a training
// placement resolves its window and stored on the row. Regeneration reads it
// there and nowhere else: no block, no program and no fixed window is
// consulted per call, and nothing bounds a version but its own end.
// ===========================================================================

describe("nutrition-event-service: the window is the row", () => {
  const PLAN_ROW = {
    baseline_calories: 1809,
    protein_target_g: 138,
    diet_type: "balanced",
    effective_from: "2026-09-04",
    effective_until: "2026-11-06",
  };

  /** delete → protected-select → upsert, in call order. */
  function wireNutritionTables(planRow: typeof PLAN_ROW = PLAN_ROW) {
    const deleteQuery = createMockQuery({ data: null, error: null });
    const protectedQuery = createMockQuery<{ date: string }[]>({ data: [], error: null });
    const upsertQuery = createMockQuery({ data: [], error: null });
    let nutCount = 0;

    mockFrom.mockImplementation((table: string) => {
      if (table === "nutrition_events") {
        nutCount += 1;
        if (nutCount === 1) return deleteQuery as any;
        if (nutCount === 2) return protectedQuery as any;
        return upsertQuery as any;
      }
      if (table === "nutrition_plans")
        return createMockQuery({ data: planRow, error: null }) as any;
      if (table === "nutrition_plan_daily_targets")
        return createMockQuery({ data: [], error: null }) as any;
      return createMockQuery({ data: null, error: null }) as any;
    });

    return { deleteQuery, protectedQuery, upsertQuery };
  }

  const writtenDates = (upsertQuery: ReturnType<typeof createMockQuery>) =>
    (upsertQuery.upsert.mock.calls[0][0] as Array<{ date: string }>).map((r) => r.date);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getEventsForDateRange).mockResolvedValue([]);
    vi.mocked(getClientTodayString).mockResolvedValue("2026-09-04");
  });

  it("writes from the anchor to the version's own end, and not a day further", async () => {
    const { upsertQuery } = wireNutritionTables();

    await regenerateFutureNutritionEvents("client-1", "plan-1", {
      kind: "from",
      from: "2026-09-04",
    });

    const dates = writtenDates(upsertQuery);
    expect(dates[0]).toBe("2026-09-04");
    expect(dates[dates.length - 1]).toBe("2026-11-06");
    expect(dates).toHaveLength(64);
  });

  it("deletes exactly the range it regenerates", async () => {
    // The equality the module has always depended on: an unbounded delete paired
    // with a bounded regenerate once removed a tail it never rebuilt.
    const { deleteQuery, upsertQuery } = wireNutritionTables();

    await regenerateFutureNutritionEvents("client-1", "plan-2", {
      kind: "from",
      from: "2026-09-04",
    });

    const dates = writtenDates(upsertQuery);
    expect(deleteQuery.gte).toHaveBeenCalledWith("date", dates[0]);
    expect(deleteQuery.lte).toHaveBeenCalledWith("date", dates[dates.length - 1]);
    expect(deleteQuery.lte).toHaveBeenCalledWith("date", "2026-11-06");
  });

  it("an anchor before the version's start regenerates from the start", async () => {
    const { deleteQuery, upsertQuery } = wireNutritionTables({
      ...PLAN_ROW,
      effective_from: "2026-09-10",
    });

    await regenerateFutureNutritionEvents("client-1", "plan-3", {
      kind: "from",
      from: "2026-09-04",
    });

    expect(writtenDates(upsertQuery)[0]).toBe("2026-09-10");
    expect(deleteQuery.gte).toHaveBeenCalledWith("date", "2026-09-10");
  });

  it("an anchor past the version's end writes and deletes nothing", async () => {
    let nutCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "nutrition_events") nutCount += 1;
      if (table === "nutrition_plans")
        return createMockQuery({ data: PLAN_ROW, error: null }) as any;
      return createMockQuery({ data: [], error: null }) as any;
    });

    await regenerateFutureNutritionEvents("client-1", "plan-4", {
      kind: "from",
      from: "2026-12-01",
    });

    expect(nutCount).toBe(0);
  });

  it("`to` never stretches a version past its end — it widens only the cascade's sweep", async () => {
    const { deleteQuery, upsertQuery } = wireNutritionTables();

    await regenerateFutureNutritionEvents("client-1", "plan-5", {
      kind: "from",
      from: "2026-09-04",
      to: "2026-12-24",
    });

    expect(writtenDates(upsertQuery).at(-1)).toBe("2026-11-06");
    expect(deleteQuery.lte).toHaveBeenCalledWith("date", "2026-11-06");
  });

  it("a narrow scope keeps the days inside the window and drops the rest", async () => {
    // A `dates` scope skips the DELETE, so it is protected-select then upsert.
    const protectedQuery = createMockQuery<{ date: string }[]>({ data: [], error: null });
    const upsertQuery = createMockQuery({ data: [], error: null });
    let nutCount = 0;
    mockFrom.mockImplementation(((table: string) => {
      if (table === "nutrition_events") {
        nutCount += 1;
        return (nutCount === 1 ? protectedQuery : upsertQuery) as never;
      }
      if (table === "nutrition_plans")
        return createMockQuery({ data: PLAN_ROW, error: null }) as never;
      return createMockQuery({ data: [], error: null }) as never;
    }) as never);

    await regenerateFutureNutritionEvents("client-1", "plan-6", {
      kind: "dates",
      dates: ["2026-10-03", "2026-12-08"],
    });

    expect(writtenDates(upsertQuery)).toEqual(["2026-10-03"]);
  });

  it("consults no block and no program — the row is the only bound", async () => {
    wireNutritionTables();

    await regenerateFutureNutritionEvents("client-1", "plan-7", {
      kind: "from",
      from: "2026-09-04",
    });

    const tables = mockFrom.mock.calls.map((c) => c[0]);
    expect(tables).not.toContain("client_phases");
    expect(tables).not.toContain("training_plans");
    expect(tables).not.toContain("training_sessions");
  });

  it("cascade, from-scope: every version with days on or after the anchor regenerates to its OWN end", async () => {
    const V1 = { id: "v1", effectiveFrom: "2026-01-01", effectiveUntil: "2026-09-30" };
    const V2 = { id: "v2", effectiveFrom: "2026-10-01", effectiveUntil: "2026-11-06" };
    vi.mocked(getActiveNutritionPlanVersionsOverlapping).mockResolvedValue([V1, V2]);

    let planCount = 0;
    let nutCount = 0;
    const upserts: Array<ReturnType<typeof createMockQuery>> = [];
    mockFrom.mockImplementation((table: string) => {
      if (table === "nutrition_plans") {
        planCount += 1;
        const version = planCount === 1 ? V1 : V2;
        return createMockQuery({
          data: {
            baseline_calories: planCount === 1 ? 1809 : 1730,
            protein_target_g: 138,
            diet_type: "balanced",
            effective_from: version.effectiveFrom,
            effective_until: version.effectiveUntil,
          },
          error: null,
        }) as any;
      }
      if (table === "nutrition_events") {
        nutCount += 1;
        // The sweep's one read first, then per version: delete, protected
        // read, upsert.
        if (nutCount > 1 && (nutCount - 1) % 3 === 0) {
          const upsert = createMockQuery({ data: [], error: null });
          upserts.push(upsert);
          return upsert as any;
        }
        return createMockQuery({ data: [], error: null }) as any;
      }
      return createMockQuery({ data: [], error: null }) as any;
    });

    await cascadeNutritionAfterTrainingChange(
      "client-1",
      { kind: "from", from: "2026-09-04" },
      "test-place"
    );

    expect(getActiveNutritionPlanVersionsOverlapping).toHaveBeenCalledWith("client-1", "2026-09-04");
    const v1Dates = writtenDates(upserts[0]);
    const v2Dates = writtenDates(upserts[1]);
    expect(v1Dates[0]).toBe("2026-09-04");
    expect(v1Dates.at(-1)).toBe("2026-09-30");
    expect(v2Dates[0]).toBe("2026-10-01");
    expect(v2Dates.at(-1)).toBe("2026-11-06");
    // No day between or past them to sweep: the sweep's read, then two
    // versions' worth of writes.
    expect(nutCount).toBe(7);
  });

  it("cascade, from-scope: a version reaching past every stale day leaves nothing to sweep — one read, then the version's own delete", async () => {
    vi.mocked(getActiveNutritionPlanVersionsOverlapping).mockResolvedValue([
      { id: "v1", effectiveFrom: "2026-01-01", effectiveUntil: "2026-09-16" },
    ]);
    const lastQuery = createMockQuery({ data: { date: "2026-09-16" }, error: null });
    const deleteQuery = createMockQuery({ data: null, error: null });
    const protectedQuery = createMockQuery<{ date: string }[]>({ data: [], error: null });
    const upsertQuery = createMockQuery({ data: [], error: null });
    let nutCount = 0;
    mockFrom.mockImplementation(((table: string) => {
      if (table === "nutrition_events") {
        nutCount += 1;
        return (nutCount === 1 ? lastQuery : nutCount === 2 ? deleteQuery : nutCount === 3 ? protectedQuery : upsertQuery) as never;
      }
      if (table === "nutrition_plans")
        return createMockQuery({
          data: { ...PLAN_ROW, effective_from: "2026-01-01", effective_until: "2026-09-16" },
          error: null,
        }) as never;
      return createMockQuery({ data: [], error: null }) as never;
    }) as never);

    await cascadeNutritionAfterTrainingChange(
      "client-1",
      { kind: "from", from: "2026-09-04" },
      "test-move"
    );

    // Nothing lies between the anchor and the window's end, and nothing past
    // it: the sweep read once and deleted nothing, then the version's own
    // delete ran.
    expect(nutCount).toBe(4);
    expect(deleteQuery.gte).toHaveBeenCalledWith("date", "2026-09-04");
    expect(deleteQuery.lte).toHaveBeenCalledWith("date", "2026-09-16");
  });
});

// ===========================================================================
// sweepUncoveredNutritionDays — the days no version covers, from the anchor on.
// ===========================================================================

describe("sweepUncoveredNutritionDays", () => {
  const CLIENT = "client-1";

  /** The last-stale-day read, then one delete query per uncovered stretch. */
  function wire(lastDate: string | null, readError: { message: string } | null = null) {
    const lastQuery = createMockQuery({ data: lastDate ? { date: lastDate } : null, error: readError });
    const deletes: Array<ReturnType<typeof createMockQuery>> = [];
    let n = 0;
    mockFrom.mockImplementation(((table: string) => {
      if (table !== "nutrition_events") return createMockQuery({ data: null, error: null }) as never;
      n += 1;
      if (n === 1) return lastQuery as never;
      const q = createMockQuery({ data: null, error: null });
      deletes.push(q);
      return q as never;
    }) as never);
    return { lastQuery, deletes };
  }

  const range = (q: ReturnType<typeof createMockQuery>) => [
    (q.gte.mock.calls.find((c) => c[0] === "date") ?? [])[1],
    (q.lte.mock.calls.find((c) => c[0] === "date") ?? [])[1],
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getClientTodayString).mockResolvedValue("2026-09-04");
    vi.mocked(resolveEventDeletionFloor).mockResolvedValue("2026-09-04");
  });

  it("deletes one range per uncovered stretch — between two windows and past the last — reaching the last stale day", async () => {
    const { lastQuery, deletes } = wire("2026-10-15");

    await sweepUncoveredNutritionDays(CLIENT, "2026-09-04", [
      { effectiveFrom: "2026-09-01", effectiveUntil: "2026-09-10" },
      { effectiveFrom: "2026-09-21", effectiveUntil: "2026-09-30" },
    ]);

    // One read of the last sweepable day, client-scoped from the anchor.
    expect(lastQuery.gte).toHaveBeenCalledWith("date", "2026-09-04");
    expect(lastQuery.order).toHaveBeenCalledWith("date", { ascending: false });
    expect(lastQuery.limit).toHaveBeenCalledWith(1);
    // Two stretches: the gap between the windows, then past the last window
    // to the last stale day.
    expect(deletes.map(range)).toEqual([
      ["2026-09-11", "2026-09-20"],
      ["2026-10-01", "2026-10-15"],
    ]);
    // Neither stretch opens on the anchor, so the floor was never asked.
    expect(resolveEventDeletionFloor).not.toHaveBeenCalled();
  });

  it("reaches the caller's `to` when it lies past the last stale day", async () => {
    const { deletes } = wire("2026-10-15");

    await sweepUncoveredNutritionDays(
      CLIENT,
      "2026-09-04",
      [{ effectiveFrom: "2026-09-01", effectiveUntil: "2026-09-30" }],
      "2026-11-30"
    );

    expect(deletes.map(range)).toEqual([["2026-10-01", "2026-11-30"]]);
  });

  it("sweeps nothing when the windows reach past every stale day — one read, no delete", async () => {
    const { deletes } = wire("2026-09-20");

    await sweepUncoveredNutritionDays(CLIENT, "2026-09-04", [
      { effectiveFrom: "2026-09-01", effectiveUntil: "2026-09-30" },
    ]);

    expect(deletes).toHaveLength(0);
  });

  it("floors the stretch that opens on the anchor — a logged today is never emptied", async () => {
    // Today is uncovered (the version starts on the 10th) and the client has
    // logged against today's stale target: the floor says tomorrow.
    vi.mocked(resolveEventDeletionFloor).mockResolvedValue("2026-09-05");
    const { deletes } = wire("2026-09-04");

    await sweepUncoveredNutritionDays(CLIENT, "2026-09-04", [
      { effectiveFrom: "2026-09-10", effectiveUntil: "2026-09-30" },
    ]);

    expect(resolveEventDeletionFloor).toHaveBeenCalledWith(CLIENT, "2026-09-04");
    expect(deletes.map(range)).toEqual([["2026-09-05", "2026-09-09"]]);
  });

  it("drops an anchor stretch the floor swallows whole", async () => {
    vi.mocked(resolveEventDeletionFloor).mockResolvedValue("2026-09-05");
    const { deletes } = wire("2026-09-04");

    await sweepUncoveredNutritionDays(CLIENT, "2026-09-04", [
      { effectiveFrom: "2026-09-05", effectiveUntil: "2026-09-30" },
    ]);

    expect(deletes).toHaveLength(0);
  });

  it("carries the three survival predicates on the read and on every range", async () => {
    const { lastQuery, deletes } = wire("2026-10-15");

    await sweepUncoveredNutritionDays(CLIENT, "2026-09-04", [
      { effectiveFrom: "2026-09-01", effectiveUntil: "2026-09-30" },
    ]);

    for (const q of [lastQuery, deletes[0]]) {
      expect(q.eq).toHaveBeenCalledWith("client_id", CLIENT);
      expect(q.eq).toHaveBeenCalledWith("status", "scheduled");
      expect(q.eq).toHaveBeenCalledWith("is_modified", false);
      expect(q.is).toHaveBeenCalledWith("coach_note", null);
    }
    expect(deletes[0].delete).toHaveBeenCalled();
  });

  it("throws on a failed read — the caller decides what a stale day costs", async () => {
    wire(null, { message: "boom" });

    await expect(
      sweepUncoveredNutritionDays(CLIENT, "2026-09-04", [
        { effectiveFrom: "2026-09-01", effectiveUntil: "2026-09-30" },
      ])
    ).rejects.toEqual({ message: "boom" });
  });
});
