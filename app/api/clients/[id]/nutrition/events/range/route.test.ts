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
  materializeNutritionEventDays: vi.fn(),
}));

import { getClientById } from "@/services/client-service";
import { materializeNutritionEventDays } from "@/services/nutrition-event-edit-service";
import { PATCH } from "./route";

const CLIENT = { id: "client-1", coachId: "coach-1" };

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/clients/client-1/nutrition/events/range", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: "client-1" }) };
const EDIT = { mode: "absolute", calories: 1800, proteinG: 150, carbG: 170, fatG: 50 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getClientById).mockResolvedValue(CLIENT as never);
  vi.mocked(materializeNutritionEventDays).mockImplementation(({ dates }) =>
    Promise.resolve({ updated: dates.length })
  );
});

// A range edit writes the coach's numbers onto the selected future days as
// edit rows (migration 169), and nothing else: a logged today reads the new
// target at once, because the food log stores none.
describe("PATCH /nutrition/events/range", () => {
  it("writes the edit onto every future selected day, as sent, with the coach as its author", async () => {
    const response = await PATCH(
      makeRequest({ ...EDIT, dates: ["2026-05-02", "2026-04-29"], note: "Deload" }),
      params
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(materializeNutritionEventDays).toHaveBeenCalledTimes(1);
    expect(materializeNutritionEventDays).toHaveBeenCalledWith({
      clientId: "client-1",
      coachId: "coach-1",
      dates: ["2026-05-02", "2026-04-29"],
      edit: { calories: 1800, proteinG: 150, carbG: 170, fatG: 50, note: "Deload" },
      clientToday: "2026-04-10",
    });
    expect(data).toEqual({ success: true, updated: 2 });
  });

  it("drops past dates before the edit and keeps the future ones — today included", async () => {
    const response = await PATCH(makeRequest({ ...EDIT, dates: ["2026-04-01", "2026-04-10"] }), params);

    expect(response.status).toBe(200);
    expect(materializeNutritionEventDays).toHaveBeenCalledWith(
      expect.objectContaining({ dates: ["2026-04-10"] })
    );
  });

  it("403s when every selected day is in the past, touching nothing", async () => {
    const response = await PATCH(makeRequest({ ...EDIT, dates: ["2026-04-01"] }), params);

    expect(response.status).toBe(403);
    expect(materializeNutritionEventDays).not.toHaveBeenCalled();
  });

  it("400s a body that is not an absolute edit", async () => {
    const response = await PATCH(makeRequest({ mode: "delta", dates: ["2026-05-02"] }), params);

    expect(response.status).toBe(400);
    expect(materializeNutritionEventDays).not.toHaveBeenCalled();
  });

  it("403s a client the coach does not own", async () => {
    vi.mocked(getClientById).mockResolvedValue({ id: "client-1", coachId: "coach-9" } as never);

    const response = await PATCH(makeRequest({ ...EDIT, dates: ["2026-05-02"] }), params);

    expect(response.status).toBe(403);
    expect(materializeNutritionEventDays).not.toHaveBeenCalled();
  });

  it("a failed edit is a plain 500 — there is no second write to report on", async () => {
    vi.mocked(materializeNutritionEventDays).mockRejectedValue(new Error("boom"));

    const response = await PATCH(makeRequest({ ...EDIT, dates: ["2026-05-02"] }), params);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({ success: false, error: "Failed to edit nutrition range" });
  });
});
