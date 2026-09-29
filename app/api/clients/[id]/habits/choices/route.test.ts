import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET } from "./route";

vi.mock("@/lib/rate-limit", () => ({ coachApiRateLimit: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/require-coach-auth", () => ({ requireCoachOwnsClient: vi.fn() }));
vi.mock("@/services/client-habits-service", () => ({ listHabitChoices: vi.fn() }));
vi.mock("@/services/today-service", () => ({ getClientTodayString: vi.fn() }));

import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { listHabitChoices } from "@/services/client-habits-service";
import { getClientTodayString } from "@/services/today-service";

const params = { params: Promise.resolve({ id: "client-2" }) };
const request = () => new NextRequest("http://localhost:3000/api/clients/client-2/habits/choices");

describe("GET /api/clients/[id]/habits/choices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({ authorized: true, coachId: "coach-3" });
    vi.mocked(getClientTodayString).mockResolvedValue("2026-09-30");
    vi.mocked(listHabitChoices).mockResolvedValue([]);
  });

  it("reads the authed coach's habits, less this client's running ones as of the client's today", async () => {
    const req = request();
    const response = await GET(req, params);
    expect(response.status).toBe(200);
    expect(requireCoachOwnsClient).toHaveBeenCalledWith("client-2", req);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(listHabitChoices).toHaveBeenCalledWith("coach-3", "client-2", "2026-09-30");
  });

  it("reads nothing for another coach's client", async () => {
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({
      authorized: false,
      response: NextResponse.json({ error: "Client not found" }, { status: 404 }),
    });
    expect((await GET(request(), params)).status).toBe(404);
    expect(listHabitChoices).not.toHaveBeenCalled();
  });

  it("answers a failed read with a 500", async () => {
    vi.mocked(listHabitChoices).mockRejectedValue(new Error("boom"));
    expect((await GET(request(), params)).status).toBe(500);
  });

  it("stops at the rate limit before the coach is read", async () => {
    vi.mocked(coachApiRateLimit).mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await GET(request(), params)).status).toBe(429);
    expect(requireCoachOwnsClient).not.toHaveBeenCalled();
  });
});
