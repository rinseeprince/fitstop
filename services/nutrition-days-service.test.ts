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
vi.mock("./nutrition-plan-notes-service", () => ({ listNutritionPlanNotesInRange: vi.fn() }));

import {
  getNutritionPlanGrids,
  getNutritionPrescriptionsForRange,
} from "./nutrition-plan-service";
import { getEventsForDateRange } from "./training-event-service";
import { getNutritionDayEditsForRange } from "./nutrition-day-edits-service";
import { listNutritionPlanNotesInRange } from "./nutrition-plan-notes-service";
import {
  getNutritionEventForDate,
  getNutritionEventsForDateRange,
} from "./nutrition-days-service";

const CLIENT = "client-41";

const V1 = {
  id: "v1",
  effectiveFrom: "2026-10-01",
  effectiveUntil: "2026-10-10",
  baselineCalories: 1800,
  proteinTargetG: 150,
  dietType: "balanced",
};
const V2 = {
  id: "v2",
  effectiveFrom: "2026-10-21",
  effectiveUntil: "2026-12-31",
  baselineCalories: 2200,
  proteinTargetG: 170,
  dietType: "high_carb",
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
  vi.mocked(listNutritionPlanNotesInRange).mockResolvedValue([]);
});

describe("getNutritionEventsForDateRange — batched, never per day", () => {
  it("costs five reads for a 31-day month: one per source, none per day", async () => {
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
    expect(listNutritionPlanNotesInRange).toHaveBeenCalledTimes(1);
    expect(listNutritionPlanNotesInRange).toHaveBeenCalledWith(CLIENT, "2026-10-01", "2026-10-31");
  });

  it("a single day costs the same five reads", async () => {
    await getNutritionEventsForDateRange(CLIENT, "2026-10-05", "2026-10-05");

    for (const read of [
      getNutritionPrescriptionsForRange,
      getNutritionPlanGrids,
      getEventsForDateRange,
      getNutritionDayEditsForRange,
      listNutritionPlanNotesInRange,
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
    expect(listNutritionPlanNotesInRange).not.toHaveBeenCalled();
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

  it("an edit lands on its date; the newest note on a date wins", async () => {
    vi.mocked(getNutritionDayEditsForRange).mockResolvedValue([
      { date: "2026-10-07", calories: 1500, proteinG: 140, carbG: 150, fatG: 50, note: "Rest week" },
    ]);
    vi.mocked(listNutritionPlanNotesInRange).mockResolvedValue([
      { id: "n1", effectiveOn: "2026-10-21", body: "First save" },
      { id: "n2", effectiveOn: "2026-10-21", body: "Corrected save" },
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
  });

  it("an edit on a date no version covers yields no day — the version decides existence", async () => {
    vi.mocked(getNutritionDayEditsForRange).mockResolvedValue([
      { date: "2026-10-15", calories: 1500, proteinG: 140, carbG: 150, fatG: 50, note: null },
    ]);

    const days = await getNutritionEventsForDateRange(CLIENT, "2026-10-01", "2026-10-31");

    expect(days.find((day) => day.date === "2026-10-15")).toBeUndefined();
  });
});

describe("getNutritionEventForDate", () => {
  it("is the range reader over one day", async () => {
    const day = await getNutritionEventForDate(CLIENT, "2026-10-03");

    expect(day).toMatchObject({ id: "2026-10-03", date: "2026-10-03", nutritionPlanId: "v1" });
    expect(getNutritionPrescriptionsForRange).toHaveBeenCalledWith(CLIENT, "2026-10-03", "2026-10-03");
  });

  it("is null on a day no version covers", async () => {
    expect(await getNutritionEventForDate(CLIENT, "2026-10-15")).toBeNull();
  });
});
