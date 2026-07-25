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
    `http://localhost:3000/api/clients/client-1/history/wellness${query}`,
    { method: "GET" },
  );
}

type Chain = Record<string, ReturnType<typeof vi.fn>>;

function makeChain(terminal: string, result: unknown): Chain {
  const chain: Chain = {};
  for (const m of ["select", "eq", "or", "gte", "lte", "order", "range", "maybeSingle"]) {
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

describe("GET /api/clients/[id]/history/wellness", () => {
  it("bounds logged rows at coach-local today", async () => {
    const wellnessChain = makeChain("range", {
      data: [{ date: "2026-06-10", mood: 4, energy: 6, sleep: 6, stress: 4, soreness: 5 }],
      error: null,
      count: 1,
    });
    dispatchTables({ wellness_logs: wellnessChain });

    const res = await GET(makeRequest("?limit=20&offset=0"), mockParams);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.rows).toHaveLength(1);
    // A client a day ahead of the coach has rows that are still "tomorrow"
    // for the coach — the read must exclude them.
    expect(getCoachTodayString).toHaveBeenCalledWith("coach-1");
    expect(wellnessChain.lte).toHaveBeenCalledWith("date", COACH_TODAY);
    // The chain fake ignores its arguments, so the query strings are only
    // guarded here: a metric missing from select never arrives; a metric
    // missing from the .or() filter makes its metric-only days invisible.
    expect(String(wellnessChain.select.mock.calls[0][0])).toContain("soreness");
    expect(wellnessChain.or).toHaveBeenCalledWith(expect.stringContaining("soreness.not.is.null"));
  });
});
