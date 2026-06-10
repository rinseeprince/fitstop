import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

// The live consumer of getCoachingWeekSummaryLive is the CLIENT portal's
// weekly-nutrition route, so the current week resolves from the client's day.
vi.mock("./today-service", () => ({
  getClientTodayString: vi.fn(),
}));

vi.mock("@/services/daily-context-service", () => ({
  getPlanTargetForDate: vi.fn().mockResolvedValue(null),
}));

import { supabaseAdmin } from "./supabase-admin";
import { getClientTodayString } from "./today-service";
import { getCoachingWeekSummaryLive } from "./weekly-nutrition-service";

function createMockQuery(result: { data: unknown; error: unknown }) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
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

describe("getCoachingWeekSummaryLive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves the current coaching week from the CLIENT's local today", async () => {
    // A fixed past client-local today (Wed 2024-03-27) that can never equal
    // the host clock: the fetched week must be Mon 03-25 .. Sun 03-31. A
    // regression to the server clock fails these exact-match assertions.
    vi.mocked(getClientTodayString).mockResolvedValue("2024-03-27");

    const clientQuery = createMockQuery({
      data: { start_date: null, include_activity_burn: true },
      error: null,
    });
    const logsQuery = createMockQuery({ data: [], error: null });

    let call = 0;
    vi.mocked(supabaseAdmin.from).mockImplementation((() => {
      call++;
      if (call === 1) return clientQuery as never;
      return logsQuery as never;
    }) as never);

    await getCoachingWeekSummaryLive("client-1", null);

    expect(getClientTodayString).toHaveBeenCalledWith("client-1");
    expect(logsQuery.gte).toHaveBeenCalledWith("date", "2024-03-25");
    expect(logsQuery.lte).toHaveBeenCalledWith("date", "2024-03-31");
  });
});
