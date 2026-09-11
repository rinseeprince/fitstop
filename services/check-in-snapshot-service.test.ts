import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NutritionDayTarget } from "./nutrition-days-service";

vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("./schedule-data-service", () => ({ fetchNutritionLogsForPeriod: vi.fn() }));
vi.mock("./training-event-service", () => ({ getEventsForDateRange: vi.fn() }));
vi.mock("./nutrition-days-service", () => ({ getNutritionTargetsForDateRange: vi.fn() }));

import { supabaseAdmin } from "./supabase-admin";
import { fetchNutritionLogsForPeriod } from "./schedule-data-service";
import { getEventsForDateRange } from "./training-event-service";
import { getNutritionTargetsForDateRange } from "./nutrition-days-service";
import { generateAndSaveCheckInSnapshot } from "./check-in-snapshot-service";
import type { PeriodSnapshot } from "@/types/schedule";

const target = (date: string, calories: number): NutritionDayTarget => ({
  date,
  calories,
  proteinG: 160,
  carbsG: 210,
  fatG: 65,
  isTrainingDay: false,
  note: null,
});

/** The check_ins update, capturing the snapshot it writes. */
function wireCheckInsUpdate() {
  const eq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn().mockReturnValue({ eq });
  vi.mocked(supabaseAdmin.from).mockReturnValue({ update } as never);
  return { update, eq };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getEventsForDateRange).mockResolvedValue([]);
});

// The check-in submit is the ONE freeze of a period's nutrition targets: the
// food log stores what the client ate and nothing else, so every day's target
// in the snapshot is the computed day at the instant of submission — for a
// logged day as for an unlogged one.
describe("generateAndSaveCheckInSnapshot — the nutrition days", () => {
  it("freezes every day's COMPUTED target beside what was eaten, and reads the log for its meals alone", async () => {
    const { update, eq } = wireCheckInsUpdate();
    vi.mocked(fetchNutritionLogsForPeriod).mockResolvedValue([
      // A row still carrying a stale target (until migration 173): never read.
      { date: "2026-05-08", caloriesConsumed: 2000, proteinG: 150, carbsG: 200, fatG: 60, targetCalories: 9999 } as never,
    ]);
    vi.mocked(getNutritionTargetsForDateRange).mockResolvedValue(
      new Map([
        ["2026-05-08", target("2026-05-08", 2100)],
        ["2026-05-09", target("2026-05-09", 2200)],
      ])
    );

    await generateAndSaveCheckInSnapshot("ci-1", "c1", "2026-05-08", "2026-05-09");

    expect(fetchNutritionLogsForPeriod).toHaveBeenCalledWith("c1", "2026-05-08", "2026-05-09");
    expect(getNutritionTargetsForDateRange).toHaveBeenCalledWith("c1", "2026-05-08", "2026-05-09");
    const snapshot = update.mock.calls[0][0].period_snapshot as PeriodSnapshot;
    expect(snapshot.nutrition.map((day) => [day.date, day.actualCalories, day.targetCalories, day.status])).toEqual([
      ["2026-05-08", 2000, 2100, "partial"],
      ["2026-05-09", null, 2200, "not_logged"],
    ]);
    expect(eq).toHaveBeenCalledWith("id", "ci-1");
  });

  it("surfaces a failed write", async () => {
    const eq = vi.fn().mockResolvedValue({ error: { message: "boom" } });
    vi.mocked(supabaseAdmin.from).mockReturnValue({ update: vi.fn().mockReturnValue({ eq }) } as never);
    vi.mocked(fetchNutritionLogsForPeriod).mockResolvedValue([]);
    vi.mocked(getNutritionTargetsForDateRange).mockResolvedValue(new Map());

    await expect(
      generateAndSaveCheckInSnapshot("ci-1", "c1", "2026-05-08", "2026-05-09")
    ).rejects.toThrow("Failed to save period snapshot: boom");
  });
});
