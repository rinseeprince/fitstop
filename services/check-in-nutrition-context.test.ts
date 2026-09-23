import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NutritionEvent } from "@/types/check-in";

vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("./training-service", () => ({ getActiveTrainingPlan: vi.fn() }));
vi.mock("./training-event-service", () => ({ getEventsForDateRange: vi.fn() }));
vi.mock("./nutrition-plan-service", () => ({ getNutritionPlanForDate: vi.fn() }));
vi.mock("./nutrition-days-service", () => ({ getNutritionEventsForDateRange: vi.fn() }));
vi.mock("./today-service", () => ({ getClientTodayString: vi.fn() }));
vi.mock("./check-in-week-service", () => ({ getClientWeekAnchor: vi.fn() }));

import { supabaseAdmin } from "./supabase-admin";
import { getNutritionPlanForDate } from "./nutrition-plan-service";
import { getNutritionEventsForDateRange } from "./nutrition-days-service";
import { getClientTodayString } from "./today-service";
import { getClientWeekAnchor } from "./check-in-week-service";
import { getCheckInNutritionContext } from "./check-in-context-service";

function day(overrides: Partial<NutritionEvent>): NutritionEvent {
  return {
    id: "2026-09-21",
    clientId: "client-1",
    nutritionPlanId: "plan-1",
    date: "2026-09-21",
    dayOfWeek: "monday",
    baselineCalories: 2140,
    trainingBurnCalories: 0,
    proteinG: 168,
    carbG: 219,
    fatG: 66,
    dietType: "balanced",
    isTrainingDay: true,
    calorieSurplusPercentage: 14,
    includeActivityBurn: true,
    surplusAsCarbs: false,
    isModified: false,
    note: null,
    coachNote: null,
    status: "scheduled",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getClientTodayString).mockResolvedValue("2026-09-23");
  vi.mocked(getClientWeekAnchor).mockResolvedValue({ weekday: "wednesday" } as never);
  vi.mocked(getNutritionPlanForDate).mockResolvedValue({ baseline_calories: 2195 } as never);
});

describe("getCheckInNutritionContext", () => {
  it("prices each day of the week with its own version's surplus settings, never the client's", async () => {
    vi.mocked(getNutritionEventsForDateRange).mockResolvedValue([
      // A session under a version with the surplus on…
      day({}),
      // …and one under a later version with it off.
      day({
        id: "2026-09-23",
        nutritionPlanId: "plan-2",
        date: "2026-09-23",
        dayOfWeek: "wednesday",
        baselineCalories: 2080,
        calorieSurplusPercentage: 11,
        includeActivityBurn: false,
      }),
    ]);

    const context = await getCheckInNutritionContext("client-1");

    expect(context.hasNutritionPlan).toBe(true);
    const [monday, wednesday] = context.weeklyTargets ?? [];
    expect(monday.calories).toBe(Math.round(2140 * 1.14));
    expect(wednesday.calories).toBe(2080);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });
});
