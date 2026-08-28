import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
}));

vi.mock("./supabase-admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock("./today-service", () => ({
  getClientTodayString: vi.fn(),
}));

vi.mock("./training-event-service", () => ({
  getEventsForDateRange: vi.fn().mockResolvedValue([]),
}));

vi.mock("./nutrition-event-service", () => ({
  getNutritionEventsForDateRange: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/utils/build-daily-targets", () => ({
  buildDailyTargetsFromPlan: vi.fn().mockReturnValue([]),
}));

import { supabaseAdmin } from "./supabase-admin";
import { getClientTodayString } from "./today-service";
import { getEventsForDateRange } from "./training-event-service";
import { getNutritionEventsForDateRange } from "./nutrition-event-service";
import { buildDailyTargetsFromPlan } from "@/utils/build-daily-targets";
import { getClientNutritionTargets } from "./client-portal-service";

function createMockQuery(result: { data: unknown; error: unknown }) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: undefined as unknown,
  };
  Object.defineProperty(query, "then", {
    value: (resolve: (value: typeof result) => void) =>
      Promise.resolve(result).then(resolve),
  });
  return query;
}

describe("getClientNutritionTargets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("anchors the live training week to the CLIENT's local today", async () => {
    // The client's local day is Wednesday 2026-06-10 — possibly a different
    // day (or week) than the server's UTC clock. The live-week window for
    // calorie enrichment must derive from the client's day.
    vi.mocked(getClientTodayString).mockResolvedValue("2026-06-10");

    const clientQuery = createMockQuery({
      data: { include_activity_burn: true, unit_preference: "metric" },
      error: null,
    });
    const planQuery = createMockQuery({
      data: {
        id: "plan-1",
        status: "active",
        effective_from: "2026-05-01",
        effective_until: null,
        diet_type: "balanced",
        custom_macros_enabled: false,
        custom_calories: null,
        custom_protein_g: null,
        custom_carb_g: null,
        custom_fat_g: null,
        baseline_calories: 2200,
        protein_target_g: 170,
        carb_target_g: 240,
        fat_target_g: 70,
      },
      error: null,
    });
    // getClientWeekAnchor's own `clients` read, issued alongside the display-
    // prefs one inside the same Promise.all. No check-in day -> Mon-Sun.
    const anchorQuery = createMockQuery({
      data: { next_check_in_due: null, start_date: null },
      error: null,
    });
    const targetsQuery = createMockQuery({ data: [], error: null });

    let call = 0;
    vi.mocked(supabaseAdmin.from).mockImplementation((() => {
      call++;
      if (call === 1) return clientQuery;
      if (call === 2) return anchorQuery;
      if (call === 3) return planQuery;
      return targetsQuery;
    }) as never);

    const result = await getClientNutritionTargets("client-1");

    expect(result).not.toBeNull();
    expect(getClientTodayString).toHaveBeenCalledWith("client-1");
    // 2026-06-10 is a Wednesday: no check-in day -> Mon-Sun = 06-08 .. 06-14.
    expect(getEventsForDateRange).toHaveBeenCalledWith(
      "client-1",
      "2026-06-08",
      "2026-06-14",
    );
    // The dense nutrition events for the same week feed the program card so
    // per-day edits surface.
    expect(getNutritionEventsForDateRange).toHaveBeenCalledWith(
      "client-1",
      "2026-06-08",
      "2026-06-14",
    );
  });

  // The client's own nutrition page used to be hard Mon-Sun for everyone,
  // while every coach surface cut the same client's week on their check-in
  // day. This is the assertion that the two now agree.
  it("anchors the week on the client's check-in day, not on Monday", async () => {
    vi.mocked(getClientTodayString).mockResolvedValue("2026-06-10");

    const clientQuery = createMockQuery({
      data: { include_activity_burn: true, unit_preference: "metric" },
      error: null,
    });
    const anchorQuery = createMockQuery({
      data: { next_check_in_due: "2026-06-10", start_date: null }, // a Wednesday
      error: null,
    });
    const planQuery = createMockQuery({
      data: {
        id: "plan-1",
        status: "active",
        effective_from: "2026-05-01",
        effective_until: null,
        diet_type: "balanced",
        custom_macros_enabled: false,
        baseline_calories: 2200,
        protein_target_g: 170,
        carb_target_g: 240,
        fat_target_g: 70,
      },
      error: null,
    });
    const targetsQuery = createMockQuery({ data: [], error: null });

    let call = 0;
    vi.mocked(supabaseAdmin.from).mockImplementation((() => {
      call++;
      if (call === 1) return clientQuery;
      if (call === 2) return anchorQuery;
      if (call === 3) return planQuery;
      return targetsQuery;
    }) as never);

    await getClientNutritionTargets("client-1");

    // Wednesday check-in => the week ENDS on Wednesday and starts the day
    // after. Client-local today is Wed 2026-06-10, so the window that
    // contains it is Thu 06-04 .. Wed 06-10 — NOT the Mon 06-08 .. Sun 06-14
    // this read returned for every client before.
    expect(getEventsForDateRange).toHaveBeenCalledWith(
      "client-1",
      "2026-06-04",
      "2026-06-10",
    );
    expect(getNutritionEventsForDateRange).toHaveBeenCalledWith(
      "client-1",
      "2026-06-04",
      "2026-06-10",
    );
  });

  it("reads surplus_as_carbs from the client and threads it + the week's events into the builder", async () => {
    vi.mocked(getClientTodayString).mockResolvedValue("2026-06-10");
    const weekEvents = [{ dayOfWeek: "monday" }];
    vi.mocked(getNutritionEventsForDateRange).mockResolvedValue(
      weekEvents as never,
    );

    const clientQuery = createMockQuery({
      data: {
        include_activity_burn: true,
        unit_preference: "metric",
        surplus_as_carbs: true,
      },
      error: null,
    });
    const planQuery = createMockQuery({
      data: {
        id: "plan-1",
        status: "active",
        effective_from: "2026-05-01",
        effective_until: "2026-09-30",
        diet_type: "balanced",
        custom_macros_enabled: false,
        baseline_calories: 2200,
        protein_target_g: 170,
        carb_target_g: 240,
        fat_target_g: 70,
      },
      error: null,
    });
    const anchorQuery = createMockQuery({
      data: { next_check_in_due: null, start_date: null },
      error: null,
    });
    const targetsQuery = createMockQuery({ data: [], error: null });

    let call = 0;
    vi.mocked(supabaseAdmin.from).mockImplementation((() => {
      call++;
      if (call === 1) return clientQuery;
      if (call === 2) return anchorQuery;
      if (call === 3) return planQuery;
      return targetsQuery;
    }) as never);

    await getClientNutritionTargets("client-1");

    const [input] = vi.mocked(buildDailyTargetsFromPlan).mock.calls[0];
    expect(input.surplusAsCarbs).toBe(true); // threaded through
    expect(input.nutritionEvents).toBe(weekEvents); // the week's nutrition events
    // The template gate's inputs. This mock never runs the real util, so this
    // assertion is the ONLY thing standing between "gate exists" and "gate is
    // actually wired" — a caller that forgets the window leaves the gate dead
    // with every gate unit test green.
    expect(input.weekWindow).toEqual({
      weekStart: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      effectiveFrom: "2026-05-01",
      effectiveUntil: "2026-09-30",
    });
  });
});
