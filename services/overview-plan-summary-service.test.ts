import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: vi.fn(), rpc: vi.fn() } }));
vi.mock("./training-service", () => ({
  getTrainingPlanForDate: vi.fn(),
  getNextFutureTrainingPlan: vi.fn().mockResolvedValue(null),
}));
vi.mock("./training-week-summary-service", () => ({ getTrainingWeekSummary: vi.fn() }));
vi.mock("./today-service", () => ({ getClientTodayString: vi.fn() }));
vi.mock("./daily-context-service", () => ({ getNutritionForDate: vi.fn() }));
vi.mock("./exercise-analytics-service", () => ({
  getClientExerciseList: vi.fn(),
  getExerciseProgressionSeries: vi.fn(),
}));

import { modalSurplus, progressionFromSeries } from "./overview-plan-summary-service";

describe("modalSurplus", () => {
  it("returns the most frequent non-null surplus", () => {
    expect(
      modalSurplus([
        { calorie_surplus_percentage: 15 },
        { calorie_surplus_percentage: 15 },
        { calorie_surplus_percentage: 10 },
        { calorie_surplus_percentage: null },
      ])
    ).toBe(15);
  });

  it("breaks frequency ties toward the larger value", () => {
    expect(
      modalSurplus([
        { calorie_surplus_percentage: 10 },
        { calorie_surplus_percentage: 15 },
      ])
    ).toBe(15);
  });

  it("returns null when no event carries a surplus", () => {
    expect(modalSurplus([])).toBeNull();
    expect(modalSurplus([{ calorie_surplus_percentage: null }])).toBeNull();
  });
});

describe("progressionFromSeries", () => {
  const effectiveFrom = "2026-06-01";

  const point = (date: string, e1rm: number | null) => ({
    date,
    estimatedOneRepMax: e1rm,
  });

  it("averages per-exercise best-e1RM change between the first logged week and the current week", () => {
    const series = [
      // Bench: week 1 best 100 → week 4 best 110 (+10%)
      { points: [point("2026-06-02", 95), point("2026-06-04", 100), point("2026-06-23", 110)] },
      // Squat: week 1 best 140 → week 4 best 147 (+5%)
      { points: [point("2026-06-03", 140), point("2026-06-24", 147)] },
    ];
    expect(progressionFromSeries(series, effectiveFrom, 4)).toBe(7.5);
  });

  it("only averages exercises present in BOTH weeks", () => {
    const series = [
      { points: [point("2026-06-02", 100), point("2026-06-23", 110)] }, // +10%
      { points: [point("2026-06-23", 200)] }, // current week only → excluded
    ];
    expect(progressionFromSeries(series, effectiveFrom, 4)).toBe(10);
  });

  it("returns null when the first logged week IS the current week", () => {
    const series = [{ points: [point("2026-06-02", 100)] }];
    expect(progressionFromSeries(series, effectiveFrom, 1)).toBeNull();
  });

  it("returns null with no points or no overlapping exercises", () => {
    expect(progressionFromSeries([], effectiveFrom, 3)).toBeNull();
    const disjoint = [
      { points: [point("2026-06-02", 100)] }, // week 1 only
      { points: [point("2026-06-16", 120)] }, // week 3 only
    ];
    expect(progressionFromSeries(disjoint, effectiveFrom, 3)).toBeNull();
  });

  it("ignores null e1RMs and points before the plan start", () => {
    const series = [
      {
        points: [
          point("2026-05-20", 500), // pre-plan → ignored
          point("2026-06-02", null), // no e1RM → ignored
          point("2026-06-03", 100),
          point("2026-06-17", 104),
        ],
      },
    ];
    expect(progressionFromSeries(series, effectiveFrom, 3)).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Upcoming (not-yet-started) program
// ---------------------------------------------------------------------------

import { supabaseAdmin } from "./supabase-admin";
import { getNextFutureTrainingPlan, getTrainingPlanForDate } from "./training-service";
import { getTrainingWeekSummary } from "./training-week-summary-service";
import { getClientTodayString } from "./today-service";
import { getOverviewPlanSummary } from "./overview-plan-summary-service";

const CLIENT_TODAY = "2026-07-26";

// What the shared getNextFutureTrainingPlan resolves (already camelCase; the
// deleted/archived exclusions it applies are proven in training-service.test.ts).
const UPCOMING_PLAN = {
  id: "plan-2",
  name: "Strength Block B",
  effectiveFrom: "2026-07-27",
  splitType: "push_pull_legs",
  frequencyPerWeek: 5,
  programDurationWeeks: 6,
};

/** Records every filter applied, and resolves maybeSingle() per table. */
function mockTables(rows: Record<string, unknown>) {
  const calls: Record<string, [string, unknown][]> = {};
  vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) => {
    calls[table] ??= [];
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "neq", "gt", "gte", "lte", "or", "order", "limit"]) {
      chain[method] = vi.fn((...args: unknown[]) => {
        calls[table].push([method, args]);
        return chain;
      });
    }
    chain.maybeSingle = vi.fn(() =>
      Promise.resolve({ data: rows[table] ?? null, error: null })
    );
    chain.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: rows[table] ?? null, error: null });
    return chain;
  }) as never);
  return calls;
}

describe("getOverviewPlanSummary — upcomingTraining", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getClientTodayString).mockResolvedValue(CLIENT_TODAY);
    vi.mocked(getTrainingWeekSummary).mockResolvedValue({
      completed: 0,
      plannedUpToToday: 0,
      totalPlanned: 0,
      missed: 0,
      weekStart: "2026-07-20",
      weekEnd: "2026-07-26",
    } as never);
    // No plan governs today — the state the whole field exists for.
    vi.mocked(getTrainingPlanForDate).mockResolvedValue(null);
  });

  it("surfaces a program placed to start after today, while training stays null", async () => {
    mockTables({});
    vi.mocked(getNextFutureTrainingPlan).mockResolvedValue(UPCOMING_PLAN);

    const summary = await getOverviewPlanSummary("coach-1", "client-1");

    expect(summary.training).toBeNull();
    expect(summary.upcomingTraining).toEqual({
      planId: "plan-2",
      planName: "Strength Block B",
      startsOn: "2026-07-27",
      splitType: "push_pull_legs",
      frequencyPerWeek: 5,
      programDurationWeeks: 6,
    });
  });

  it("reads through the shared future-plan lookup, anchored on the client's today", async () => {
    // The predicate itself (strictly-after-today, deleted/archived exclusions,
    // earliest first) is owned and tested by getNextFutureTrainingPlan. What
    // matters here is that this card cannot answer the question its own way —
    // a local copy is exactly how the Training tab and this card disagreed.
    mockTables({});
    vi.mocked(getNextFutureTrainingPlan).mockResolvedValue(UPCOMING_PLAN);

    await getOverviewPlanSummary("coach-1", "client-1");

    expect(getNextFutureTrainingPlan).toHaveBeenCalledWith("client-1", CLIENT_TODAY);
  });

  it("is null when nothing is queued", async () => {
    mockTables({});
    vi.mocked(getNextFutureTrainingPlan).mockResolvedValue(null);

    const summary = await getOverviewPlanSummary("coach-1", "client-1");

    expect(summary.upcomingTraining).toBeNull();
  });
});
