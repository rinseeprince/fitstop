import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase-admin before importing the service (same pattern as
// coach-library.test.ts). exercise-catalog-service is mocked because the
// module imports it, though the page/summary reads never call it.
vi.mock("./supabase-admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));
vi.mock("./exercise-catalog-service", () => ({
  resolveExercises: vi.fn(),
}));

// A chainable query mock whose terminal await resolves to `result`.
function mockQuery(result: {
  data: unknown;
  error: { message: string } | null;
  count?: number;
}) {
  const q: Record<string, unknown> = {};
  const methods = [
    "select", "insert", "update", "delete", "eq", "neq", "or", "in",
    "is", "gt", "gte", "lt", "lte", "ilike", "order", "range", "limit",
  ];
  for (const m of methods) q[m] = vi.fn(() => q);
  Object.defineProperty(q, "then", {
    value: (resolve: (v: typeof result) => void) =>
      Promise.resolve(result).then(resolve),
  });
  return q;
}

import { supabaseAdmin } from "./supabase-admin";
import {
  getSavedPlansPage,
  getSavedPlansSummary,
} from "./coach-saved-plan-service";

const mockFrom = vi.mocked(supabaseAdmin.from);

describe("getSavedPlansPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns lean rows with derived counts + the total", async () => {
    const q = mockQuery({
      data: [
        {
          id: "p1",
          name: "PPL",
          description: "desc",
          split_type: "Glute focus",
          source: "manual",
          status: "saved",
          updated_at: "2026-07-01T00:00:00Z",
          created_at: "2026-06-01T00:00:00Z",
          program_duration_weeks: 3,
          frequency_per_week: 4,
          // 3 weeks × 7 days, one rest day per week.
          coach_saved_sessions: Array.from({ length: 21 }, (_, i) => ({
            is_rest: i % 7 === 0,
            week_index: Math.floor(i / 7),
            order_index: i,
          })),
        },
      ],
      error: null,
      count: 42,
    });
    mockFrom.mockReturnValue(q as never);

    const { plans, total } = await getSavedPlansPage("coach-1", {
      includeDrafts: true,
      limit: 20,
      offset: 0,
    });

    expect(total).toBe(42);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      id: "p1",
      name: "PPL",
      splitType: "Glute focus",
      source: "manual",
      weekCount: 3,
      totalSlots: 21,
      restCount: 3,
      trainingCount: 18,
      frequencyPerWeek: 4,
    });
  });

  it("counts days, not rows, where a day holds several sessions — the week fallback too", async () => {
    // One week: day 1 holds a morning and an evening session, days 2-6 one
    // each, day 7 rest. Eight rows, seven days, seven sessions.
    const rows = [
      { is_rest: false, week_index: 0, order_index: 0 },
      { is_rest: false, week_index: 0, order_index: 0 },
      ...Array.from({ length: 5 }, (_, i) => ({ is_rest: false, week_index: 0, order_index: i + 1 })),
      { is_rest: true, week_index: 0, order_index: 6 },
    ];
    const q = mockQuery({
      data: [
        {
          id: "p2",
          name: "Two a day",
          description: null,
          split_type: null,
          source: "manual",
          status: "saved",
          updated_at: "2026-07-01T00:00:00Z",
          created_at: "2026-06-01T00:00:00Z",
          // A row from before the duration PATCH: the length falls back to days / 7.
          program_duration_weeks: null,
          frequency_per_week: 7,
          coach_saved_sessions: rows,
        },
      ],
      error: null,
      count: 1,
    });
    mockFrom.mockReturnValue(q as never);

    const { plans } = await getSavedPlansPage("coach-1", { limit: 20, offset: 0 });

    expect(q.select).toHaveBeenCalledWith(
      expect.stringContaining("coach_saved_sessions(is_rest, week_index, order_index)"),
      { count: "exact" },
    );
    expect(plans[0]).toMatchObject({
      weekCount: 1,
      totalSlots: 7,
      restCount: 1,
      trainingCount: 7,
      frequencyPerWeek: 7,
    });
  });

  it("sanitizes the search term before the PostgREST .or() filter", async () => {
    const q = mockQuery({ data: [], error: null, count: 0 });
    mockFrom.mockReturnValue(q as never);

    await getSavedPlansPage("coach-1", {
      includeDrafts: true,
      limit: 20,
      offset: 0,
      search: "a,b(c)", // injection chars stripped → "abc"
    });

    expect(q.or).toHaveBeenCalledWith(
      "name.ilike.%abc%,description.ilike.%abc%",
    );
  });

  it("orders by program_duration_weeks for the 'longest' sort", async () => {
    const q = mockQuery({ data: [], error: null, count: 0 });
    mockFrom.mockReturnValue(q as never);

    await getSavedPlansPage("coach-1", {
      includeDrafts: true,
      limit: 20,
      offset: 0,
      sort: "longest",
    });

    expect(q.order).toHaveBeenCalledWith(
      "program_duration_weeks",
      expect.objectContaining({ ascending: false }),
    );
  });
});

describe("getSavedPlansSummary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("aggregates totals, ai/custom split, and avg/min/max weeks", async () => {
    const q = mockQuery({
      data: [
        { source: "ai", program_duration_weeks: 1 },
        { source: "manual", program_duration_weeks: 3 },
        { source: "manual", program_duration_weeks: 2 },
      ],
      error: null,
    });
    mockFrom.mockReturnValue(q as never);

    const summary = await getSavedPlansSummary("coach-1", {
      includeDrafts: true,
    });

    expect(summary).toEqual({
      total: 3,
      aiCount: 1,
      customCount: 2,
      avgWeeks: 2,
      minWeeks: 1,
      maxWeeks: 3,
    });
  });
});
