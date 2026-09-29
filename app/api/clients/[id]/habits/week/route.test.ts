import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET } from "./route";

vi.mock("@/lib/rate-limit", () => ({ coachApiRateLimit: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/require-coach-auth", () => ({ requireCoachOwnsClient: vi.fn() }));
vi.mock("@/services/client-habit-figures-service", () => ({ getCoachHabitWeek: vi.fn() }));

import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getCoachHabitWeek } from "@/services/client-habit-figures-service";
import type { CoachHabitWeek } from "@/types/habits";

const params = { params: Promise.resolve({ id: "client-2" }) };
const request = (query = "") => new NextRequest(`http://localhost:3000/api/clients/client-2/habits/week${query}`);
const WEEK: CoachHabitWeek = {
  clientToday: "2026-09-30",
  start: "2026-09-24",
  end: "2026-09-30",
  dates: [],
  habits: [],
  totals: { planned: 13, done: 8, met: 8 },
  today: { planned: 2, done: 0 },
};

describe("GET /api/clients/[id]/habits/week", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({ authorized: true, coachId: "coach-3" });
    vi.mocked(getCoachHabitWeek).mockResolvedValue(WEEK);
  });

  it("reads the week holding the client's today, not cached", async () => {
    const req = request();
    const response = await GET(req, params);
    expect(response.status).toBe(200);
    expect(requireCoachOwnsClient).toHaveBeenCalledWith("client-2", req);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ success: true, data: WEEK });
    expect(getCoachHabitWeek).toHaveBeenCalledWith("client-2", undefined);
  });

  it("reads the week holding the day asked for, and refuses a day that does not exist", async () => {
    await GET(request("?start=2026-10-05"), params);
    expect(getCoachHabitWeek).toHaveBeenCalledWith("client-2", "2026-10-05");
    expect((await GET(request("?start=2026-10-32"), params)).status).toBe(400);
  });

  it("reads nothing for another coach's client, or over the rate limit", async () => {
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({
      authorized: false,
      response: NextResponse.json({ error: "Client not found" }, { status: 404 }),
    });
    expect((await GET(request(), params)).status).toBe(404);
    vi.mocked(coachApiRateLimit).mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await GET(request(), params)).status).toBe(429);
    expect(getCoachHabitWeek).not.toHaveBeenCalled();
  });

  it("answers a failed read with a 500", async () => {
    vi.mocked(getCoachHabitWeek).mockRejectedValue(new Error("boom"));
    expect((await GET(request(), params)).status).toBe(500);
  });
});
