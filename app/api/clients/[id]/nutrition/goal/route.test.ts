import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/rate-limit", () => ({
  coachApiRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/require-coach-auth", () => ({
  requireCoachAuth: vi.fn(),
}));

vi.mock("@/lib/error-handler", () => ({
  captureApiError: vi.fn(),
}));

vi.mock("@/services/client-service", () => ({
  getClientById: vi.fn(),
}));

vi.mock("@/services/nutrition-goal-service", () => ({
  getNutritionGoalForDay: vi.fn(),
}));

import { GET } from "./route";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachAuth } from "@/lib/require-coach-auth";
import { getClientById } from "@/services/client-service";
import { getNutritionGoalForDay } from "@/services/nutrition-goal-service";

const params = { params: Promise.resolve({ id: "client-3" }) };
const CLIENT = { id: "client-3", coachId: "coach-3", currentWeight: 84.6 };

const request = (date: string | null) =>
  new NextRequest(
    `http://localhost:3000/api/clients/client-3/nutrition/goal${date === null ? "" : `?date=${date}`}`
  );

describe("GET /api/clients/[id]/nutrition/goal — the drawer's Starts on day", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(coachApiRateLimit).mockResolvedValue(null);
    vi.mocked(requireCoachAuth).mockResolvedValue({ authorized: true, coachId: "coach-3" } as never);
    vi.mocked(getClientById).mockResolvedValue(CLIENT as never);
    vi.mocked(getNutritionGoalForDay).mockResolvedValue({
      date: "2026-10-19",
      goal: null,
      calcInputs: { status: "incomplete", missing: [], today: "2026-09-23" },
    } as never);
  });

  it("answers for the asked day, from the client the coach owns, never cached", async () => {
    const response = await GET(request("2026-10-19"), params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, data: { date: "2026-10-19" } });
    expect(getNutritionGoalForDay).toHaveBeenCalledWith("client-3", CLIENT, "2026-10-19");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("rate-limits before anything else", async () => {
    vi.mocked(coachApiRateLimit).mockResolvedValue(new Response(null, { status: 429 }) as never);

    const response = await GET(request("2026-10-19"), params);

    expect(response.status).toBe(429);
    expect(requireCoachAuth).not.toHaveBeenCalled();
  });

  it("refuses a caller who is not signed in", async () => {
    vi.mocked(requireCoachAuth).mockResolvedValue({
      authorized: false,
      response: new Response(null, { status: 401 }),
    } as never);

    const response = await GET(request("2026-10-19"), params);

    expect(response.status).toBe(401);
    expect(getNutritionGoalForDay).not.toHaveBeenCalled();
  });

  it("is 404 for another coach's client, and reads nothing for it", async () => {
    vi.mocked(getClientById).mockResolvedValue({ ...CLIENT, coachId: "coach-8" } as never);

    const response = await GET(request("2026-10-19"), params);

    expect(response.status).toBe(404);
    expect(getNutritionGoalForDay).not.toHaveBeenCalled();
  });

  it("is 404 for a client that does not exist", async () => {
    vi.mocked(getClientById).mockResolvedValue(null as never);
    expect((await GET(request("2026-10-19"), params)).status).toBe(404);
  });

  it("is 400 without a well-formed day", async () => {
    expect((await GET(request(null), params)).status).toBe(400);
    expect((await GET(request("19-10-2026"), params)).status).toBe(400);
    expect(getNutritionGoalForDay).not.toHaveBeenCalled();
  });

  it("is 500 when the read fails", async () => {
    vi.mocked(getNutritionGoalForDay).mockRejectedValue(new Error("db down"));
    expect((await GET(request("2026-10-19"), params)).status).toBe(500);
  });
});
