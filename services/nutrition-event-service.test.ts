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
vi.mock("@/services/training-service", () => ({
  getActiveTrainingPlan: vi.fn(),
}));
vi.mock("@/services/today-service", () => ({
  getClientTodayString: vi.fn(),
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
import { getActiveTrainingPlan } from "@/services/training-service";
import { getClientTodayString } from "@/services/today-service";
import { captureApiError } from "@/lib/error-handler";
import { getActiveNutritionPlanVersionsOverlapping } from "@/services/nutrition-plan-service";
import {
  generateNutritionEvents,
  regenerateFutureNutritionEvents,
  cascadeNutritionAfterTrainingChange,
} from "./nutrition-event-service";

const mockFrom = vi.mocked(supabaseAdmin.from);

const PLAN = { baselineCalories: 2000, proteinTargetG: 150, dietType: "balanced" };

describe("nutrition-event-service: cascade-preserve guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // No training events → surplus null, burn 0; keeps generated rows deterministic.
    vi.mocked(getEventsForDateRange).mockResolvedValue([]);
    vi.mocked(getActiveTrainingPlan).mockResolvedValue(null);
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

      // Versioned model: the plan read carries the version's window, and the
      // regenerate clamps to it. An open version covering the whole range
      // keeps the clamp out of this test's frame.
      const planRow = {
        baseline_calories: 2000,
        protein_target_g: 150,
        diet_type: "balanced",
        status: "active",
        effective_from: "2026-01-01",
        effective_until: null,
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
        effective_until: null,
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

      // 8 weeks (56 days) inclusive of both ends.
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
              effective_until: null,
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
              effective_until: null,
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

      // The 8-week scope reaches 2026-06-05; the version ends 2026-04-20 — the
      // delete stops at the window's edge, never reaching the next era.
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
              effective_until: null,
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
    const V2 = { id: "v2", effectiveFrom: "2026-05-01", effectiveUntil: null };

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

    it("from-scope: sweeps stale rows on gap dates no version covers (the post-delete interregnum)", async () => {
      // One version covering only the first 7 days of the 57-day scope.
      vi.mocked(getActiveNutritionPlanVersionsOverlapping).mockResolvedValue([
        { id: "v1", effectiveFrom: "2026-01-01", effectiveUntil: "2026-04-16" },
      ]);

      let nutCount = 0;
      const gapDeleteQuery = createMockQuery({ data: null, error: null });
      const versionDeleteQuery = createMockQuery({ data: null, error: null });
      const protectedQuery = createMockQuery<{ date: string }[]>({ data: [], error: null });
      const upsertQuery = createMockQuery({ data: [], error: null });

      mockFrom.mockImplementation((table: string) => {
        if (table === "nutrition_events") {
          nutCount += 1;
          // 1 = the cascade-level gap sweep, 2 = v1's clamped delete,
          // 3 = protected read, 4 = upsert.
          if (nutCount === 1) return gapDeleteQuery as any;
          if (nutCount === 2) return versionDeleteQuery as any;
          if (nutCount === 3) return protectedQuery as any;
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
        { kind: "from", from: "2026-04-10" },
        "test-clear"
      );

      // The gap sweep covers exactly the 50 uncovered dates, client-scoped,
      // with the three survival predicates intact.
      const gapDates = vi.mocked(gapDeleteQuery.in).mock.calls[0][1] as string[];
      expect(gapDates).toHaveLength(50);
      expect(gapDates[0]).toBe("2026-04-17");
      expect(gapDates[gapDates.length - 1]).toBe("2026-06-05");
      expect(gapDeleteQuery.eq).toHaveBeenCalledWith("client_id", "client-1");
      expect(gapDeleteQuery.eq).toHaveBeenCalledWith("is_modified", false);
      expect(gapDeleteQuery.is).toHaveBeenCalledWith("coach_note", null);
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
