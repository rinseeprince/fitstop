import { describe, it, expect, vi, beforeEach } from "vitest";

// The admin client is built at import by the plan service the partial mock
// below loads for real; this suite issues no query of its own.
vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: vi.fn(), rpc: vi.fn() } }));

// The five reads are other modules' questions; only the batching, the
// date→version mapping and the per-date assembly are under test here.
// versionCoversDate stays REAL (pure): the window arithmetic is the shipped one.
vi.mock("./nutrition-plan-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./nutrition-plan-service")>();
  return {
    ...actual,
    getNutritionPrescriptionsForRange: vi.fn(),
    getNutritionPlanGrids: vi.fn(),
  };
});
vi.mock("./training-event-service", () => ({ getEventsForDateRange: vi.fn() }));
vi.mock("./nutrition-day-edits-service", () => ({ getNutritionDayEditsForRange: vi.fn() }));

import {
  getNutritionPlanGrids,
  getNutritionPrescriptionsForRange,
} from "./nutrition-plan-service";
import { getEventsForDateRange } from "./training-event-service";
import { getNutritionDayEditsForRange } from "./nutrition-day-edits-service";
import { getNutritionEventsForDateRange } from "./nutrition-days-service";

const CLIENT = "client-41";

const V1 = {
  id: "v1",
  effectiveFrom: "2026-10-01",
  effectiveUntil: "2026-10-10",
  baselineCalories: 1800,
  proteinTargetG: 150,
  dietType: "balanced",
  coachNote: null,
};
const V2 = {
  id: "v2",
  effectiveFrom: "2026-10-21",
  effectiveUntil: "2026-12-31",
  baselineCalories: 2200,
  proteinTargetG: 170,
  dietType: "high_carb",
  coachNote: null,
};

const gridRow = (planId: string, dayOfWeek: string, calories: number) => ({
  planId,
  dayOfWeek,
  calories,
  proteinG: 150,
  carbG: 200,
  fatG: 60,
});

const session = (date: string, calorieSurplusPercentage: number | null, estimatedCalories = 0) =>
  ({
    id: `te-${date}`,
    date,
    calorieSurplusPercentage,
    estimatedCalories,
  }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getNutritionPrescriptionsForRange).mockResolvedValue([V1, V2]);
  vi.mocked(getNutritionPlanGrids).mockResolvedValue([]);
  vi.mocked(getEventsForDateRange).mockResolvedValue([]);
  vi.mocked(getNutritionDayEditsForRange).mockResolvedValue([]);
});

describe("getNutritionEventsForDateRange — batched, never per day", () => {
  it("costs four reads for a 31-day month: one per source, none per day", async () => {
    const days = await getNutritionEventsForDateRange(CLIENT, "2026-10-01", "2026-10-31");

    expect(days).toHaveLength(21); // v1's 10 days + v2's 11, none in the gap
    expect(getNutritionPrescriptionsForRange).toHaveBeenCalledTimes(1);
    expect(getNutritionPrescriptionsForRange).toHaveBeenCalledWith(CLIENT, "2026-10-01", "2026-10-31");
    expect(getNutritionPlanGrids).toHaveBeenCalledTimes(1);
    expect(getNutritionPlanGrids).toHaveBeenCalledWith(["v1", "v2"]);
    expect(getEventsForDateRange).toHaveBeenCalledTimes(1);
    expect(getEventsForDateRange).toHaveBeenCalledWith(CLIENT, "2026-10-01", "2026-10-31");
    expect(getNutritionDayEditsForRange).toHaveBeenCalledTimes(1);
    expect(getNutritionDayEditsForRange).toHaveBeenCalledWith(CLIENT, "2026-10-01", "2026-10-31");
  });

  it("a single day costs the same four reads", async () => {
    await getNutritionEventsForDateRange(CLIENT, "2026-10-05", "2026-10-05");

    for (const read of [
      getNutritionPrescriptionsForRange,
      getNutritionPlanGrids,
      getEventsForDateRange,
      getNutritionDayEditsForRange,
    ]) {
      expect(read).toHaveBeenCalledTimes(1);
    }
  });

  it("no version overlapping the range → no days, and no further read", async () => {
    vi.mocked(getNutritionPrescriptionsForRange).mockResolvedValue([]);

    const days = await getNutritionEventsForDateRange(CLIENT, "2026-10-01", "2026-10-31");

    expect(days).toEqual([]);
    expect(getNutritionPlanGrids).not.toHaveBeenCalled();
    expect(getEventsForDateRange).not.toHaveBeenCalled();
    expect(getNutritionDayEditsForRange).not.toHaveBeenCalled();
  });

  it("an inverted range reads nothing at all", async () => {
    const days = await getNutritionEventsForDateRange(CLIENT, "2026-10-31", "2026-10-01");

    expect(days).toEqual([]);
    expect(getNutritionPrescriptionsForRange).not.toHaveBeenCalled();
  });

  it("each date takes the version COVERING it, and a gap day has no day", async () => {
    const days = await getNutritionEventsForDateRange(CLIENT, "2026-10-01", "2026-10-31");
    const byDate = new Map(days.map((day) => [day.date, day]));

    expect(byDate.get("2026-10-10")).toMatchObject({ nutritionPlanId: "v1", baselineCalories: 1800 });
    expect(byDate.get("2026-10-11")).toBeUndefined();
    expect(byDate.get("2026-10-20")).toBeUndefined();
    expect(byDate.get("2026-10-21")).toMatchObject({ nutritionPlanId: "v2", baselineCalories: 2200 });
    // In date order, one per date.
    expect(days.map((day) => day.date)).toEqual([...days.map((day) => day.date)].sort());
    expect(new Set(days.map((day) => day.id)).size).toBe(days.length);
  });

  it("the grid row is picked by version AND weekday", async () => {
    // Mondays: 5 Oct is v1's, 26 Oct is v2's.
    vi.mocked(getNutritionPlanGrids).mockResolvedValue([
      gridRow("v1", "monday", 1650),
      gridRow("v2", "monday", 2350),
      gridRow("v2", "tuesday", 2375),
    ]);

    const days = await getNutritionEventsForDateRange(CLIENT, "2026-10-01", "2026-10-31");
    const byDate = new Map(days.map((day) => [day.date, day]));

    expect(byDate.get("2026-10-05")?.baselineCalories).toBe(1650);
    expect(byDate.get("2026-10-26")?.baselineCalories).toBe(2350);
    expect(byDate.get("2026-10-27")?.baselineCalories).toBe(2375);
    // A weekday with no grid row falls to the version's baseline.
    expect(byDate.get("2026-10-06")?.baselineCalories).toBe(1800);
  });

  it("sessions land on their own date; the day's surplus is that session's", async () => {
    vi.mocked(getEventsForDateRange).mockResolvedValue([session("2026-10-05", 10), session("2026-10-22", null, 275)]);

    const days = await getNutritionEventsForDateRange(CLIENT, "2026-10-01", "2026-10-31");
    const byDate = new Map(days.map((day) => [day.date, day]));

    expect(byDate.get("2026-10-05")).toMatchObject({
      isTrainingDay: true,
      calorieSurplusPercentage: 10,
      trainingBurnCalories: 180, // round(1800 × 10 / 100)
    });
    expect(byDate.get("2026-10-06")).toMatchObject({ isTrainingDay: false, trainingBurnCalories: 0 });
    // Legacy flat burn on the other side of the gap.
    expect(byDate.get("2026-10-22")).toMatchObject({ isTrainingDay: true, trainingBurnCalories: 275 });
  });

  it("an edit lands on its date; a version's note shows on the day it took effect and no other", async () => {
    vi.mocked(getNutritionDayEditsForRange).mockResolvedValue([
      { date: "2026-10-07", calories: 1500, proteinG: 140, carbG: 150, fatG: 50, note: "Rest week" },
    ]);
    // The note is a column on the version (migration 172): the latest save's,
    // carried by the computed day on the version's start date only.
    vi.mocked(getNutritionPrescriptionsForRange).mockResolvedValue([
      V1,
      { ...V2, coachNote: "Corrected save" },
    ]);

    const days = await getNutritionEventsForDateRange(CLIENT, "2026-10-01", "2026-10-31");
    const byDate = new Map(days.map((day) => [day.date, day]));

    expect(byDate.get("2026-10-07")).toMatchObject({
      isModified: true,
      baselineCalories: 1500,
      proteinG: 140,
      note: "Rest week",
    });
    expect(byDate.get("2026-10-08")?.isModified).toBe(false);
    expect(byDate.get("2026-10-21")?.coachNote).toBe("Corrected save");
    expect(byDate.get("2026-10-22")?.coachNote).toBeNull();
    // V1 saved without a note: nothing on its start date either.
    expect(byDate.get("2026-10-01")?.coachNote).toBeNull();
  });

  it("an edit on a date no version covers yields no day — the version decides existence", async () => {
    vi.mocked(getNutritionDayEditsForRange).mockResolvedValue([
      { date: "2026-10-15", calories: 1500, proteinG: 140, carbG: 150, fatG: 50, note: null },
    ]);

    const days = await getNutritionEventsForDateRange(CLIENT, "2026-10-01", "2026-10-31");

    expect(days.find((day) => day.date === "2026-10-15")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The target readers: the computed days through the client's display
// switches — the number every verdict is judged against, per client and
// across a roster in one pass.
// ---------------------------------------------------------------------------

import { supabaseAdmin } from "./supabase-admin";
import {
  getNutritionTargetsForClients,
  getNutritionTargetsForDateRange,
} from "./nutrition-days-service";

type ChainResult = { data?: unknown; error?: { message: string } | null };

/**
 * One self-returning, thenable chain per supabaseAdmin.from() call, answering
 * per TABLE. `.range()` resolves the table's rows once and an empty page after,
 * so the paged readers terminate; `.maybeSingle()` answers the prefs read.
 */
function mockTables(rows: Record<string, unknown[]>) {
  const served = new Map<string, number>();
  const calls: Array<{ table: string; chain: Record<string, ReturnType<typeof vi.fn>> }> = [];
  vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "gte", "lte", "order"]) {
      chain[m] = vi.fn().mockReturnValue(chain);
    }
    chain.range = vi.fn().mockImplementation(() => {
      const page = served.get(table) ?? 0;
      served.set(table, page + 1);
      const result: ChainResult = { data: page === 0 ? (rows[table] ?? []) : [], error: null };
      return Promise.resolve(result);
    });
    chain.maybeSingle = vi
      .fn()
      .mockResolvedValue({ data: (rows[table] ?? [])[0] ?? null, error: null });
    calls.push({ table, chain: chain as Record<string, ReturnType<typeof vi.fn>> });
    return chain;
  }) as never);
  return calls;
}

describe("getNutritionTargetsForDateRange — one client, the display shape", () => {
  it("applies the client's display switches: burn on splits the surplus, burn off is the baseline", async () => {
    vi.mocked(getNutritionPlanGrids).mockResolvedValue([gridRow("v1", "monday", 2000)]);
    vi.mocked(getEventsForDateRange).mockResolvedValue([session("2026-10-05", 10)]);

    mockTables({ clients: [{ include_activity_burn: true, surplus_as_carbs: false }] });
    const withBurn = await getNutritionTargetsForDateRange(CLIENT, "2026-10-05", "2026-10-05");
    // 2000 × 1.10 = 2200; protein held, carbs + fat scaled in their ratio.
    expect(withBurn.get("2026-10-05")).toMatchObject({
      date: "2026-10-05",
      calories: 2200,
      proteinG: 150,
      isTrainingDay: true,
      note: null,
    });
    expect(withBurn.get("2026-10-05")!.carbsG).toBeGreaterThan(200);

    mockTables({ clients: [{ include_activity_burn: false, surplus_as_carbs: false }] });
    const withoutBurn = await getNutritionTargetsForDateRange(CLIENT, "2026-10-05", "2026-10-05");
    expect(withoutBurn.get("2026-10-05")).toMatchObject({ calories: 2000, carbsG: 200, fatG: 60 });

    mockTables({ clients: [{ include_activity_burn: true, surplus_as_carbs: true }] });
    const carbsOnly = await getNutritionTargetsForDateRange(CLIENT, "2026-10-05", "2026-10-05");
    // Fat held at 60, protein at 150: the whole 200 kcal surplus lands on carbs.
    expect(carbsOnly.get("2026-10-05")).toMatchObject({ calories: 2200, fatG: 60, carbsG: 265 });
  });

  it("carries an edited day's note and has no entry for a gap day", async () => {
    vi.mocked(getNutritionDayEditsForRange).mockResolvedValue([
      { date: "2026-10-07", calories: 1500, proteinG: 140, carbG: 150, fatG: 50, note: "Rest week" },
    ]);
    mockTables({ clients: [{ include_activity_burn: true, surplus_as_carbs: false }] });

    const targets = await getNutritionTargetsForDateRange(CLIENT, "2026-10-01", "2026-10-31");

    expect(targets.get("2026-10-07")).toMatchObject({ calories: 1500, note: "Rest week" });
    expect(targets.has("2026-10-15")).toBe(false);
    expect(targets.size).toBe(21);
  });

  it("an inverted range reads nothing", async () => {
    mockTables({});
    expect((await getNutritionTargetsForDateRange(CLIENT, "2026-10-31", "2026-10-01")).size).toBe(0);
    expect(getNutritionPrescriptionsForRange).not.toHaveBeenCalled();
  });
});

describe("getNutritionTargetsForClients — the roster in one pass", () => {
  const versionRow = (id: string, client_id: string, from: string, until: string, calories: number) => ({
    id,
    client_id,
    effective_from: from,
    effective_until: until,
    baseline_calories: calories,
    protein_target_g: 150,
    diet_type: "balanced",
    coach_note: null,
  });

  it("reads each source once for the whole roster, chunked by client id, and prices every client's days with its own switches", async () => {
    const calls = mockTables({
      nutrition_plans: [
        versionRow("v-a", "ca", "2026-10-01", "2026-10-31", 2000),
        versionRow("v-b", "cb", "2026-10-10", "2026-10-31", 1800),
      ],
      nutrition_plan_daily_targets: [
        { nutrition_plan_id: "v-b", day_of_week: "monday", calories: 1700, protein_g: 140, carb_g: 180, fat_g: 55 },
      ],
      training_events: [
        { client_id: "ca", date: "2026-10-05", calorie_surplus_percentage: 10, estimated_calories: null },
        { client_id: "cb", date: "2026-10-12", calorie_surplus_percentage: 10, estimated_calories: null },
      ],
      nutrition_day_edits: [
        { client_id: "ca", date: "2026-10-06", calories: 1500, protein_g: 140, carb_g: 150, fat_g: 50, note: "Rest" },
      ],
      clients: [
        { id: "ca", include_activity_burn: true, surplus_as_carbs: false },
        { id: "cb", include_activity_burn: false, surplus_as_carbs: false },
      ],
    });

    const targets = await getNutritionTargetsForClients(["ca", "cb", "cc"], "2026-10-01", "2026-10-31");

    // One chunked read per source, none per client or per day.
    const tables = calls.map((call) => call.table);
    expect(tables.filter((t) => t === "nutrition_plans")).toHaveLength(1);
    expect(tables.filter((t) => t === "nutrition_plan_daily_targets")).toHaveLength(1);
    expect(tables.filter((t) => t === "training_events")).toHaveLength(1);
    expect(tables.filter((t) => t === "nutrition_day_edits")).toHaveLength(1);
    expect(tables.filter((t) => t === "clients")).toHaveLength(1);
    const versionsRead = calls.find((call) => call.table === "nutrition_plans")!.chain;
    expect(versionsRead.in).toHaveBeenCalledWith("client_id", ["ca", "cb", "cc"]);
    expect(versionsRead.eq).toHaveBeenCalledWith("status", "active");
    expect(versionsRead.gte).toHaveBeenCalledWith("effective_until", "2026-10-01");
    expect(versionsRead.lte).toHaveBeenCalledWith("effective_from", "2026-10-31");
    // The per-day sources are read for the covered clients only.
    const eventsRead = calls.find((call) => call.table === "training_events")!.chain;
    expect(eventsRead.in).toHaveBeenCalledWith("client_id", ["ca", "cb"]);
    const prefsRead = calls.find((call) => call.table === "clients")!.chain;
    expect(prefsRead.in).toHaveBeenCalledWith("id", ["ca", "cb"]);
    // The prescription needs no per-client read either.
    expect(getNutritionPrescriptionsForRange).not.toHaveBeenCalled();

    const byKey = new Map(targets.map((t) => [`${t.clientId}:${t.date}`, t]));
    // ca: burn on — the training day carries its surplus; the edited day its note.
    expect(byKey.get("ca:2026-10-05")).toMatchObject({ calories: 2200, isTrainingDay: true });
    expect(byKey.get("ca:2026-10-04")).toMatchObject({ calories: 2000, isTrainingDay: false });
    expect(byKey.get("ca:2026-10-06")).toMatchObject({ calories: 1500, note: "Rest" });
    // cb: burn OFF — the training day is the baseline; its Monday grid row prices Mondays.
    expect(byKey.get("cb:2026-10-12")).toMatchObject({ calories: 1700, isTrainingDay: true });
    expect(byKey.get("cb:2026-10-13")).toMatchObject({ calories: 1800 });
    // cb's window starts on the 10th; before it there is no day.
    expect(byKey.has("cb:2026-10-09")).toBe(false);
    // cc has no version: nothing at all.
    expect(targets.some((t) => t.clientId === "cc")).toBe(false);
    expect(targets.filter((t) => t.clientId === "ca")).toHaveLength(31);
    expect(targets.filter((t) => t.clientId === "cb")).toHaveLength(22);
  });

  it("no client has a version in the window: one read, nothing else", async () => {
    const calls = mockTables({ nutrition_plans: [] });

    expect(await getNutritionTargetsForClients(["ca"], "2026-10-01", "2026-10-31")).toEqual([]);
    expect(calls.map((call) => call.table)).toEqual(["nutrition_plans"]);
  });

  it("an empty roster or an inverted range reads nothing", async () => {
    const calls = mockTables({});
    expect(await getNutritionTargetsForClients([], "2026-10-01", "2026-10-31")).toEqual([]);
    expect(await getNutritionTargetsForClients(["ca"], "2026-10-31", "2026-10-01")).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
