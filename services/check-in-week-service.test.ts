import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase-admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

import { supabaseAdmin } from "./supabase-admin";
import { getClientWeekAnchor } from "./check-in-week-service";

function mockClientRow(result: { data: unknown; error: unknown }) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  vi.mocked(supabaseAdmin.from).mockReturnValue(query as never);
  return query;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getClientWeekAnchor", () => {
  it("returns the client's check-in weekday and start date from one read", async () => {
    const query = mockClientRow({
      data: { next_check_in_due: "2026-06-10", start_date: "2026-01-15" }, // a Wednesday
      error: null,
    });

    const anchor = await getClientWeekAnchor("client-1");

    expect(anchor).toEqual({ weekday: "wednesday", startDate: "2026-01-15" });
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1);
    expect(supabaseAdmin.from).toHaveBeenCalledWith("clients");
    expect(query.eq).toHaveBeenCalledWith("id", "client-1");
  });

  it("fetches the start date in the SAME query as the weekday", async () => {
    // The two history summaries need both. Splitting them would cost each of
    // them a second round trip for one column, which is why this helper
    // returns the pair rather than the weekday alone.
    const query = mockClientRow({
      data: { next_check_in_due: "2026-06-08", start_date: "2026-02-01" },
      error: null,
    });

    await getClientWeekAnchor("client-1");

    const selected = String(query.select.mock.calls[0][0]);
    expect(selected).toContain("next_check_in_due");
    expect(selected).toContain("start_date");
  });

  it("falls back to the no-schedule anchor when the client has no due date", async () => {
    mockClientRow({
      data: { next_check_in_due: null, start_date: null },
      error: null,
    });

    expect(await getClientWeekAnchor("client-1")).toEqual({
      weekday: "sunday", // Mon-Sun — see NO_SCHEDULE_WEEK_ANCHOR
      startDate: null,
    });
  });

  it("resolves rather than throws when the row is missing", async () => {
    mockClientRow({ data: null, error: null });

    expect(await getClientWeekAnchor("nope")).toEqual({
      weekday: "sunday",
      startDate: null,
    });
  });

  it("logs and falls back when the read fails, rather than failing the request", async () => {
    // Every caller's previous behaviour on a null row was the default week.
    // A week boundary is not the place to 500.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockClientRow({ data: null, error: { message: "boom" } });

    expect(await getClientWeekAnchor("client-1")).toEqual({
      weekday: "sunday",
      startDate: null,
    });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
