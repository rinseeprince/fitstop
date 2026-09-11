import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/services/supabase-admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));
vi.mock("@/lib/rate-limit", () => ({
  coachApiRateLimit: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/csrf-protection", () => ({
  requireCSRFProtection: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/auth-helpers", () => ({
  getAuthenticatedCoachId: vi.fn().mockResolvedValue("coach-1"),
}));
vi.mock("@/services/client-service", () => ({
  getClientById: vi.fn(),
}));
vi.mock("@/services/today-service", () => ({
  getClientTodayString: vi.fn().mockResolvedValue("2026-04-10"),
}));
vi.mock("@/services/nutrition-event-edit-service", () => ({
  resetNutritionEventDays: vi.fn(),
}));
import { getClientById } from "@/services/client-service";
import { resetNutritionEventDays } from "@/services/nutrition-event-edit-service";
import { PATCH } from "./route";

const CLIENT = { id: "client-1", coachId: "coach-1" };

function makeRequest(dates: string[]): NextRequest {
  return new NextRequest("http://localhost/api/clients/client-1/nutrition/events/reset", {
    method: "PATCH",
    body: JSON.stringify({ dates }),
  });
}

const params = { params: Promise.resolve({ id: "client-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getClientById).mockResolvedValue(CLIENT as never);
  vi.mocked(resetNutritionEventDays).mockImplementation(({ dates }) =>
    Promise.resolve({ reset: dates.length })
  );
});

// A reset is ONE act on the edits table (migration 169): the selected days'
// edit rows go, and the plan's own numbers answer again. Nothing regenerates,
// so there is nothing to group by version any more.
describe("PATCH /nutrition/events/reset", () => {
  it("removes the edits on every future selected day in one call, as sent", async () => {
    const response = await PATCH(makeRequest(["2026-05-02", "2026-04-29", "2026-04-30"]), params);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(resetNutritionEventDays).toHaveBeenCalledTimes(1);
    expect(resetNutritionEventDays).toHaveBeenCalledWith({
      clientId: "client-1",
      dates: ["2026-05-02", "2026-04-29", "2026-04-30"],
      clientToday: "2026-04-10",
    });
    expect(data).toEqual({ success: true, reset: 3 });
  });

  it("reports the days that held an edit, not the days selected", async () => {
    vi.mocked(resetNutritionEventDays).mockResolvedValue({ reset: 1 });

    const response = await PATCH(makeRequest(["2026-05-02", "2026-05-03"]), params);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.reset).toBe(1);
  });

  it("drops past dates before the reset and keeps the future ones", async () => {
    const response = await PATCH(makeRequest(["2026-04-01", "2026-05-02"]), params);

    expect(response.status).toBe(200);
    expect(resetNutritionEventDays).toHaveBeenCalledWith(
      expect.objectContaining({ dates: ["2026-05-02"] })
    );
  });

  it("403s when every selected day is in the past, touching nothing", async () => {
    const response = await PATCH(makeRequest(["2026-04-01"]), params);

    expect(response.status).toBe(403);
    expect(resetNutritionEventDays).not.toHaveBeenCalled();
  });

  it("a failed reset is a plain 500 — there is no second write to report on", async () => {
    vi.mocked(resetNutritionEventDays).mockRejectedValue(new Error("boom"));

    const response = await PATCH(makeRequest(["2026-04-10"]), params);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({ success: false, error: "Failed to reset nutrition days" });
  });

  it("403s a client the coach does not own", async () => {
    vi.mocked(getClientById).mockResolvedValue({ id: "client-1", coachId: "coach-9" } as never);

    const response = await PATCH(makeRequest(["2026-05-02"]), params);

    expect(response.status).toBe(403);
    expect(resetNutritionEventDays).not.toHaveBeenCalled();
  });
});
