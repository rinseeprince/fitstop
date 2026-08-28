import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/rate-limit", () => ({
  coachApiRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/require-coach-auth", () => ({
  requireCoachOwnsClient: vi.fn(),
}));

vi.mock("@/services/today-service", () => ({
  getCoachTodayString: vi.fn(),
}));

vi.mock("@/services/supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getCoachTodayString } from "@/services/today-service";
import { supabaseAdmin } from "@/services/supabase-admin";
import { GET } from "./route";

const mockParams = { params: Promise.resolve({ id: "client-1" }) };

// Fixed past date: the route only echoes it into query bounds, so assertions
// can never collide with the host clock.
const COACH_TODAY = "2026-06-11";

function makeRequest(query = "") {
  return new NextRequest(
    `http://localhost:3000/api/clients/client-1/history/wellness/summary${query}`,
    { method: "GET" },
  );
}

type Chain = Record<string, ReturnType<typeof vi.fn>>;

function makeChain(terminal: string, result: unknown): Chain {
  const chain: Chain = {};
  for (const m of ["select", "eq", "or", "gte", "lte", "single", "maybeSingle"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain[terminal] = vi.fn().mockResolvedValue(result);
  return chain;
}

function dispatchTables(tables: Record<string, Chain>) {
  vi.mocked(supabaseAdmin.from).mockImplementation(
    (table: string) => tables[table] as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireCoachOwnsClient).mockResolvedValue({
    authorized: true,
    coachId: "coach-1",
  } as never);
  vi.mocked(getCoachTodayString).mockResolvedValue(COACH_TODAY);
});

describe("GET /api/clients/[id]/history/wellness/summary", () => {
  it("14-day window is bounded at coach-local today on both ends", async () => {
    const wellnessChain = makeChain("lte", {
      data: [
        // One row WITH soreness, one WITHOUT: avg_soreness must divide by
        // non-null rows only (6, not (6+0)/2 = 3).
        { mood: 4, energy: 6, sleep: 6, stress: 4, soreness: 6 },
        { mood: 4, energy: 8, sleep: 7, stress: 2 },
      ],
      error: null,
    });
    dispatchTables({ wellness_logs: wellnessChain });

    const res = await GET(makeRequest("?days=14"), mockParams);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(wellnessChain.gte).toHaveBeenCalledWith("date", "2026-05-29");
    // A client a day ahead of the coach must not have "tomorrow's" log
    // counted in the averages or days_logged.
    expect(wellnessChain.lte).toHaveBeenCalledWith("date", COACH_TODAY);
    expect(body.days_logged).toBe(2);
    expect(body.days_in_window).toBe(14);
    expect(body.avg_mood).toBe(4);
    expect(body.avg_soreness).toBe(6);
    // The chain fake ignores its arguments — the query strings are only
    // guarded here (missing select column / missing .or() term).
    expect(String(wellnessChain.select.mock.calls[0][0])).toContain("soreness");
    expect(wellnessChain.or).toHaveBeenCalledWith(expect.stringContaining("soreness.not.is.null"));
  });

  it("7-day training-week window is also capped at coach-local today", async () => {
    // The week anchor is fetched through getClientWeekAnchor, which reads the
    // one `clients` row with .maybeSingle().
    const clientsChain = makeChain("maybeSingle", {
      data: { next_check_in_due: null, start_date: null },
    });
    const wellnessChain = makeChain("lte", { data: [], error: null });
    dispatchTables({ clients: clientsChain, wellness_logs: wellnessChain });

    const res = await GET(makeRequest("?days=7"), mockParams);

    expect(res.status).toBe(200);
    expect(wellnessChain.lte).toHaveBeenCalledWith("date", COACH_TODAY);
  });
});
