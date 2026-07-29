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
vi.mock("@/services/client-phases-service", () => ({
  getClientPhases: vi.fn().mockResolvedValue([]),
}));

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
import { getClientPhases } from "@/services/client-phases-service";
import {
  generateNutritionEvents,
  createNutritionTargetResolver,
  regenerateFutureNutritionEvents,
} from "./nutrition-event-service";

const mockFrom = vi.mocked(supabaseAdmin.from);

const PLAN = { baselineCalories: 2000, proteinTargetG: 150, dietType: "balanced" };

/** The pre-blocks resolver: plan scalars only, no grid, no blocks. */
const PLAN_RESOLVER = createNutritionTargetResolver({
  plan: PLAN,
  planDailyTargets: null,
});

describe("nutrition-event-service: cascade-preserve guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // No training events → surplus null, burn 0; keeps generated rows deterministic.
    vi.mocked(getEventsForDateRange).mockResolvedValue([]);
    // clearAllMocks wipes the module-level default, so restore "no blocks".
    vi.mocked(getClientPhases).mockResolvedValue([]);
    vi.mocked(getActiveTrainingPlan).mockResolvedValue(null);
    vi.mocked(getClientTodayString).mockResolvedValue("2026-04-10");
  });

  // =========================================================================
  // ◆2(b) generateNutritionEvents — skip is_modified days from the upsert
  // =========================================================================
  describe("generateNutritionEvents preserves is_modified days", () => {
    it("omits coach-edited dates from the upsert and regenerates the rest", async () => {
      let nutCount = 0;
      // The protected-days read returns one edited day in the middle of the window.
      const protectedQuery = createMockQuery<{ date: string }[]>({
        data: [{ date: "2026-04-11" }],
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
        PLAN_RESOLVER,
        null,
        ["2026-04-10", "2026-04-11", "2026-04-12"],
      );

      // Protected-days read is keyed on client_id + the exact date LIST (NOT plan
      // id — the upsert conflict key is client-scoped; and not a [min,max] range —
      // a scattered cascade must not read days it is not writing).
      expect(protectedQuery.eq).toHaveBeenCalledWith("client_id", "client-1");
      expect(protectedQuery.eq).toHaveBeenCalledWith("is_modified", true);
      expect(protectedQuery.in).toHaveBeenCalledWith("date", [
        "2026-04-10",
        "2026-04-11",
        "2026-04-12",
      ]);
      expect(protectedQuery.gte).not.toHaveBeenCalled();
      expect(protectedQuery.lte).not.toHaveBeenCalled();

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
        PLAN_RESOLVER,
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
        generateNutritionEvents("client-1", "plan-1", PLAN_RESOLVER, null, [
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

      // One generic "fat" row satisfies every nutrition_plans read (baseline,
      // status, planned-sibling); planned-sibling effective_from:null -> no cap.
      const planRow = {
        baseline_calories: 2000,
        protein_target_g: 150,
        diet_type: "balanced",
        status: "active",
        effective_from: null,
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
      expect(deleteQuery.eq).toHaveBeenCalledWith("nutrition_plan_id", "plan-1");
      expect(deleteQuery.gte).toHaveBeenCalledWith("date", "2026-04-10");
      expect(deleteQuery.eq).toHaveBeenCalledWith("status", "scheduled");
      // The guard under test: edited rows survive the cascade delete.
      expect(deleteQuery.eq).toHaveBeenCalledWith("is_modified", false);

      // The delete is BOUNDED, and bounded by the same end the regenerate used.
      // Previously it was `.gte` with no upper bound while the regenerate stopped
      // at the horizon, so every cascade erased the days past it for good.
      const upsertedDates = (
        upsertQuery.upsert.mock.calls[0][0] as Array<{ date: string }>
      ).map((r) => r.date);
      const regenEnd = upsertedDates[upsertedDates.length - 1];
      expect(deleteQuery.lte).toHaveBeenCalledWith("date", regenEnd);
    });

    it("honours an explicit `to` past the default horizon", async () => {
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
        if (table === "nutrition_plans") {
          return createMockQuery({
            data: { baseline_calories: 2000, protein_target_g: 150, diet_type: "balanced" },
            error: null,
          }) as any;
        }
        return createMockQuery({ data: [], error: null }) as any;
      });

      // A deleted 20-week plan reaches well past the 8-week horizon. Without the
      // explicit end those later days keep a stale training-day surplus forever,
      // because nothing else ever revisits them.
      await regenerateFutureNutritionEvents("client-1", "plan-1", {
        kind: "from",
        from: "2026-04-10",
        to: "2026-08-28",
      });

      const rows = upsertQuery.upsert.mock.calls[0][0] as Array<{ date: string }>;
      expect(rows[0].date).toBe("2026-04-10");
      expect(rows[rows.length - 1].date).toBe("2026-08-28");
      expect(deleteQuery.lte).toHaveBeenCalledWith("date", "2026-08-28");
    });
  });

  // =========================================================================
  // Narrow scope: exactly the caller's dates, and NO delete at all.
  //
  // `updated_at` cannot witness this: the column is DEFAULT NOW() with no
  // trigger, and the upsert payload omits it — a default fires on INSERT, not on
  // the UPDATE half of an upsert. So an over-wide narrow cascade rewrites its
  // neighbours with the timestamp frozen. The upserted date list is the only
  // direct observation.
  // =========================================================================
  describe("regenerateFutureNutritionEvents narrow scope", () => {
    it("upserts exactly the given dates and issues no delete", async () => {
      let nutCount = 0;
      const protectedQuery = createMockQuery<{ date: string }[]>({ data: [], error: null });
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
            data: { baseline_calories: 2000, protein_target_g: 150, diet_type: "balanced" },
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
      // `endDate <= fromDate` guard — a "deleted the calendar, returned success".
      expect(anyQuery.delete).not.toHaveBeenCalled();
      expect(anyQuery.upsert).not.toHaveBeenCalled();
    });
  });
});

// ===========================================================================
// Task 2.5 — per-date resolution. The generator used to close over ONE set of
// numbers for the whole walk; it now asks per date.
// ===========================================================================

const WEEKDAYS = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
] as const;

/** A flat 7-row weekday grid, every day the same, so a block is one number. */
function grid(calories: number) {
  return WEEKDAYS.map((day) => ({
    day_of_week: day,
    calories,
    protein_g: 150,
    carb_g: 200,
    fat_g: 60,
  }));
}

function planGrid(calories: number) {
  return WEEKDAYS.map((day) => ({
    day_of_week: day,
    calories,
    protein_g: 150,
    carb_g: 200,
    fat_g: 60,
    is_training_day: false,
  }));
}

describe("createNutritionTargetResolver", () => {
  // Three consecutive blocks, each with its own calorie level.
  const PHASES = [
    { startsOn: "2026-08-01", endsOn: "2026-08-28", dailyTargets: grid(2200) },
    { startsOn: "2026-08-29", endsOn: "2026-09-25", dailyTargets: grid(2600) },
    { startsOn: "2026-09-26", endsOn: "2026-10-23", dailyTargets: grid(1900) },
  ];

  it("a client with NO blocks resolves exactly as before blocks existed", () => {
    const withoutBlocks = createNutritionTargetResolver({
      plan: PLAN,
      planDailyTargets: planGrid(2000),
    });
    const emptyBlocks = createNutritionTargetResolver({
      plan: PLAN,
      planDailyTargets: planGrid(2000),
      phases: [],
    });

    for (const date of ["2026-08-05", "2026-09-05", "2026-10-05"]) {
      const a = withoutBlocks(date, "wednesday", false);
      expect(a.baselineCalories).toBe(2000);
      expect(emptyBlocks(date, "wednesday", false)).toEqual(a);
    }
  });

  it("each date resolves to the numbers of the block that covers it", () => {
    const resolve = createNutritionTargetResolver({
      plan: PLAN,
      planDailyTargets: planGrid(2000),
      phases: PHASES,
    });

    expect(resolve("2026-08-01", "saturday", false).baselineCalories).toBe(2200);
    expect(resolve("2026-08-28", "friday", false).baselineCalories).toBe(2200);
    expect(resolve("2026-08-29", "saturday", false).baselineCalories).toBe(2600);
    expect(resolve("2026-09-25", "friday", false).baselineCalories).toBe(2600);
    expect(resolve("2026-09-26", "saturday", false).baselineCalories).toBe(1900);
  });

  it("a date in NO block falls back to the plan's weekday grid", () => {
    const resolve = createNutritionTargetResolver({
      plan: PLAN,
      planDailyTargets: planGrid(2000),
      phases: PHASES,
    });

    expect(resolve("2026-07-31", "friday", false).baselineCalories).toBe(2000);
    expect(resolve("2026-10-24", "saturday", false).baselineCalories).toBe(2000);
  });

  it("a block whose grid has not been generated yet falls back to the plan", () => {
    // `daily_targets` is NULL until task 2.6 runs the calculator per block. A
    // covering block with no grid must not produce zeros or undefined.
    const resolve = createNutritionTargetResolver({
      plan: PLAN,
      planDailyTargets: planGrid(2000),
      phases: [{ startsOn: "2026-08-01", endsOn: "2026-08-28", dailyTargets: null }],
    });

    expect(resolve("2026-08-05", "wednesday", false).baselineCalories).toBe(2000);
  });

  it("custom macros ignore blocks entirely", () => {
    // The coach typed these numbers and the calculator never ran, so no block
    // drove them. Resolving to a block's grid here would overwrite what the
    // coach typed on exactly the dates a block happens to cover.
    const resolve = createNutritionTargetResolver({
      plan: PLAN,
      planDailyTargets: planGrid(1800),
      phases: PHASES,
      customMacrosEnabled: true,
    });

    expect(resolve("2026-08-05", "wednesday", false).baselineCalories).toBe(1800);
    expect(resolve("2026-09-05", "saturday", false).baselineCalories).toBe(1800);
  });

  it("falls back to the plan SCALAR when there is no grid at all", () => {
    const resolve = createNutritionTargetResolver({
      plan: PLAN,
      planDailyTargets: null,
    });
    expect(resolve("2026-08-05", "wednesday", false).baselineCalories).toBe(2000);
  });
});

describe("generateNutritionEvents across blocks (the cascade invariant)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getEventsForDateRange).mockResolvedValue([]);
    vi.mocked(getClientPhases).mockResolvedValue([]);
    vi.mocked(getClientTodayString).mockResolvedValue("2026-08-01");
  });

  it("a cascade spanning three blocks writes THREE different sets of numbers", async () => {
    // THE test this workstream cares about most. A coach re-placing or amending
    // a program mid-plan cascades across every later block. Before the per-date
    // resolver this flattened every one of those days to a single set of
    // numbers, silently and with no error.
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

    const resolve = createNutritionTargetResolver({
      plan: PLAN,
      planDailyTargets: planGrid(2000),
      phases: [
        { startsOn: "2026-08-01", endsOn: "2026-08-28", dailyTargets: grid(2200) },
        { startsOn: "2026-08-29", endsOn: "2026-09-25", dailyTargets: grid(2600) },
        { startsOn: "2026-09-26", endsOn: "2026-10-23", dailyTargets: grid(1900) },
      ],
    });

    // One date in each block, plus one outside every block.
    await generateNutritionEvents(
      "client-1",
      "plan-1",
      resolve,
      null,
      ["2026-08-10", "2026-09-10", "2026-10-01", "2026-11-01"],
    );

    const rows = upsertQuery.upsert.mock.calls[0][0] as Array<{
      date: string;
      baseline_calories: number;
    }>;
    expect(rows.map((r) => [r.date, r.baseline_calories])).toEqual([
      ["2026-08-10", 2200],
      ["2026-09-10", 2600],
      ["2026-10-01", 1900],
      ["2026-11-01", 2000], // past the last block → the plan grid
    ]);
  });
});

describe("horizon extends to the last block end", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getEventsForDateRange).mockResolvedValue([]);
    vi.mocked(getClientTodayString).mockResolvedValue("2026-08-01");
  });

  function wireRegenMocks() {
    let nutCount = 0;
    const deleteQuery = createMockQuery({ data: [], error: null });
    const protectedQuery = createMockQuery<{ date: string }[]>({ data: [], error: null });
    const upsertQuery = createMockQuery({ data: [], error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === "nutrition_events") {
        nutCount += 1;
        if (nutCount === 1) return deleteQuery as any;
        if (nutCount === 2) return protectedQuery as any;
        return upsertQuery as any;
      }
      if (table === "nutrition_plans") {
        return createMockQuery({
          data: {
            baseline_calories: 2000,
            protein_target_g: 150,
            diet_type: "balanced",
            custom_macros_enabled: false,
          },
          error: null,
        }) as any;
      }
      return createMockQuery({ data: [], error: null }) as any;
    });

    return { deleteQuery, upsertQuery };
  }

  it("stops at today + 8 weeks when the client has no blocks", async () => {
    vi.mocked(getClientPhases).mockResolvedValue([]);
    const { deleteQuery, upsertQuery } = wireRegenMocks();

    await regenerateFutureNutritionEvents("client-1", "plan-1", {
      kind: "from",
      from: "2026-08-01",
    });

    // 2026-08-01 + 56d = 2026-09-26.
    expect(deleteQuery.lte).toHaveBeenCalledWith("date", "2026-09-26");
    const rows = upsertQuery.upsert.mock.calls[0][0] as Array<{ date: string }>;
    expect(rows[rows.length - 1].date).toBe("2026-09-26");
  });

  it("extends past the 8-week horizon to the last block's end", async () => {
    vi.mocked(getClientPhases).mockResolvedValue([
      {
        id: "p1",
        name: "Cut 1",
        startsOn: "2026-08-01",
        endsOn: "2026-11-20",
        ratePerWeekKg: -0.6,
        dailyTargets: null,
      },
    ] as never);
    const { deleteQuery, upsertQuery } = wireRegenMocks();

    await regenerateFutureNutritionEvents("client-1", "plan-1", {
      kind: "from",
      from: "2026-08-01",
    });

    // The block runs to 11-20, well past the 09-26 default horizon. The DELETE
    // and the regenerate must BOTH reach it — they derive from one array, which
    // is what stops task 1.2's unbounded-delete mismatch from coming back.
    expect(deleteQuery.gte).toHaveBeenCalledWith("date", "2026-08-01");
    expect(deleteQuery.lte).toHaveBeenCalledWith("date", "2026-11-20");
    const rows = upsertQuery.upsert.mock.calls[0][0] as Array<{ date: string }>;
    expect(rows[rows.length - 1].date).toBe("2026-11-20");
  });

  it("a block ending BEFORE the horizon does not shorten it", async () => {
    vi.mocked(getClientPhases).mockResolvedValue([
      {
        id: "p1",
        name: "Short block",
        startsOn: "2026-08-01",
        endsOn: "2026-08-14",
        ratePerWeekKg: -0.6,
        dailyTargets: null,
      },
    ] as never);
    const { deleteQuery } = wireRegenMocks();

    await regenerateFutureNutritionEvents("client-1", "plan-1", {
      kind: "from",
      from: "2026-08-01",
    });

    expect(deleteQuery.lte).toHaveBeenCalledWith("date", "2026-09-26");
  });
});

describe("coach-edited days keep their numbers but not a stale TRAIN badge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getEventsForDateRange).mockResolvedValue([]);
    vi.mocked(getClientPhases).mockResolvedValue([]);
    vi.mocked(getClientTodayString).mockResolvedValue("2026-07-30");
  });

  /** protected-select → flag UPDATE(s) → upsert, in that order. */
  function wire(protectedDates: string[]) {
    const queries: ReturnType<typeof createMockQuery>[] = [];
    let nutCount = 0;

    mockFrom.mockImplementation((table: string) => {
      if (table === "nutrition_events") {
        nutCount += 1;
        const q =
          nutCount === 1
            ? createMockQuery<{ date: string }[]>({
                data: protectedDates.map((date) => ({ date })),
                error: null,
              })
            : createMockQuery({ data: [], error: null });
        queries.push(q);
        return q as any;
      }
      return createMockQuery({ data: null, error: null }) as any;
    });

    return queries;
  }

  it("clears the flag when training moved OFF an edited day", async () => {
    // The bug: the coach edits 07-31 to 4000 kcal while it is a training day,
    // then moves the session to 07-30. The cascade skips 07-31 entirely, so its
    // TRAIN badge stays on forever even though the session has gone.
    const queries = wire(["2026-07-31"]);

    // No training events anywhere → both days resolve to is_training_day false.
    await generateNutritionEvents(
      "client-1",
      "plan-1",
      PLAN_RESOLVER,
      null,
      ["2026-07-30", "2026-07-31"],
    );

    const flagUpdate = queries[1];
    expect(flagUpdate.update).toHaveBeenCalledWith(
      expect.objectContaining({ is_training_day: false }),
    );
    // Scoped, and re-asserts is_modified so a stale set cannot reach a normal row.
    expect(flagUpdate.eq).toHaveBeenCalledWith("client_id", "client-1");
    expect(flagUpdate.eq).toHaveBeenCalledWith("is_modified", true);
    expect(flagUpdate.in).toHaveBeenCalledWith("date", ["2026-07-31"]);

    // The coach's numbers are NOT in the payload — only the flag and updated_at.
    const payload = flagUpdate.update.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(["is_training_day", "updated_at"]);

    // And the edited day is still excluded from the upsert.
    const upserted = queries[2].upsert.mock.calls[0][0] as Array<{ date: string }>;
    expect(upserted.map((r) => r.date)).toEqual(["2026-07-30"]);
  });

  it("sets the flag when training moves ONTO an edited day", async () => {
    vi.mocked(getEventsForDateRange).mockResolvedValue([
      { date: "2026-07-31", calorieSurplusPercentage: 15, estimatedCalories: 0 },
    ] as never);
    const queries = wire(["2026-07-31"]);

    await generateNutritionEvents(
      "client-1",
      "plan-1",
      PLAN_RESOLVER,
      null,
      ["2026-07-31"],
    );

    expect(queries[1].update).toHaveBeenCalledWith(
      expect.objectContaining({ is_training_day: true }),
    );
  });

  it("issues no flag write at all when no day is edited", async () => {
    const queries = wire([]);

    await generateNutritionEvents(
      "client-1",
      "plan-1",
      PLAN_RESOLVER,
      null,
      ["2026-07-30", "2026-07-31"],
    );

    // Only the protected-select and the upsert — never a bare UPDATE.
    for (const q of queries) expect(q.update).not.toHaveBeenCalled();
    expect(queries[1].upsert).toHaveBeenCalledTimes(1);
  });

  it("splits mixed days into one UPDATE per flag, not one per row", async () => {
    vi.mocked(getEventsForDateRange).mockResolvedValue([
      { date: "2026-07-31", calorieSurplusPercentage: 15, estimatedCalories: 0 },
    ] as never);
    const queries = wire(["2026-07-30", "2026-07-31"]);

    await generateNutritionEvents(
      "client-1",
      "plan-1",
      PLAN_RESOLVER,
      null,
      ["2026-07-30", "2026-07-31"],
    );

    // Two edited days, opposite flags → exactly two UPDATEs (constant, not N).
    expect(queries[1].update).toHaveBeenCalledWith(
      expect.objectContaining({ is_training_day: true }),
    );
    expect(queries[1].in).toHaveBeenCalledWith("date", ["2026-07-31"]);
    expect(queries[2].update).toHaveBeenCalledWith(
      expect.objectContaining({ is_training_day: false }),
    );
    expect(queries[2].in).toHaveBeenCalledWith("date", ["2026-07-30"]);
  });
});
