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
// versionCoversDate stays REAL (pure) — the grouping under test is the
// shipped window arithmetic, only the DB read is stubbed.
vi.mock("@/services/nutrition-plan-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/nutrition-plan-service")>();
  return { ...actual, getActiveNutritionPlanVersionsOverlapping: vi.fn() };
});
vi.mock("@/services/nutrition-event-edit-service", () => ({
  resetNutritionEventDays: vi.fn(),
}));

import { getClientById } from "@/services/client-service";
import { getActiveNutritionPlanVersionsOverlapping } from "@/services/nutrition-plan-service";
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
  vi.mocked(resetNutritionEventDays).mockImplementation((_c, dates) =>
    Promise.resolve({ reset: dates.length })
  );
});

describe("PATCH /nutrition/events/reset — per-version grouping (migration 144)", () => {
  it("splits a date list straddling an era boundary and resets each group from ITS version", async () => {
    vi.mocked(getActiveNutritionPlanVersionsOverlapping).mockResolvedValue([
      { id: "v1", effectiveFrom: "2026-01-01", effectiveUntil: "2026-04-30" },
      { id: "v2", effectiveFrom: "2026-05-01", effectiveUntil: null },
    ]);

    const response = await PATCH(makeRequest(["2026-05-02", "2026-04-29", "2026-04-30"]), params);
    const data = await response.json();

    expect(response.status).toBe(200);
    // Grouped per covering version, dates sorted, one reset call per group.
    expect(resetNutritionEventDays).toHaveBeenCalledTimes(2);
    expect(resetNutritionEventDays).toHaveBeenCalledWith(
      "client-1",
      ["2026-04-29", "2026-04-30"],
      "v1",
      "2026-04-10"
    );
    expect(resetNutritionEventDays).toHaveBeenCalledWith(
      "client-1",
      ["2026-05-02"],
      "v2",
      "2026-04-10"
    );
    expect(data.reset).toBe(3);
  });

  it("skips dates no version covers (there is no prescription to reset them to)", async () => {
    vi.mocked(getActiveNutritionPlanVersionsOverlapping).mockResolvedValue([
      { id: "v2", effectiveFrom: "2026-05-01", effectiveUntil: null },
    ]);

    const response = await PATCH(makeRequest(["2026-04-29", "2026-05-02"]), params);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(resetNutritionEventDays).toHaveBeenCalledTimes(1);
    expect(resetNutritionEventDays).toHaveBeenCalledWith(
      "client-1",
      ["2026-05-02"],
      "v2",
      "2026-04-10"
    );
    expect(data.reset).toBe(1);
  });

  it("404s when no version covers any selected date", async () => {
    vi.mocked(getActiveNutritionPlanVersionsOverlapping).mockResolvedValue([]);

    const response = await PATCH(makeRequest(["2026-04-29"]), params);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe("No nutrition plan covers the selected dates");
    expect(resetNutritionEventDays).not.toHaveBeenCalled();
  });

  it("still drops past dates before grouping (403 when none remain)", async () => {
    const response = await PATCH(makeRequest(["2026-04-01"]), params);

    expect(response.status).toBe(403);
    expect(getActiveNutritionPlanVersionsOverlapping).not.toHaveBeenCalled();
  });
});
