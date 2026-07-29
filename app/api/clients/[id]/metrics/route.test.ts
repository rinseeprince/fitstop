import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// This file exists because the goal-write path here changed from swallowing a
// failure to surfacing it, and the route had no test at all. A behaviour change
// on a coach-facing write path that no test can see is how the divergence this
// fixes went unnoticed for six weeks.

vi.mock("@/services/supabase-admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));
vi.mock("@/lib/rate-limit", () => ({
  apiRateLimit: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/csrf-protection", () => ({
  requireCSRFProtection: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/auth-helpers", () => ({
  getAuthenticatedCoachId: vi.fn().mockResolvedValue("coach-1"),
}));
vi.mock("@/services/body-metrics-service", () => ({
  recordBodyMetrics: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/services/client-goals-service", () => ({
  updateGoals: vi.fn().mockResolvedValue({}),
}));

import { supabaseAdmin } from "@/services/supabase-admin";
import { updateGoals } from "@/services/client-goals-service";
import { PUT } from "./route";

const clientId = "client-1";
const routeParams = { params: Promise.resolve({ id: clientId }) };

const clientRow = {
  id: clientId,
  coach_id: "coach-1",
  weight_unit: "kg",
  goal_weight: 90,
  goal_body_fat_percentage: 20,
};

/** Captures the payload handed to `.update()` so the test can assert on it. */
let updatePayload: Record<string, unknown> | null = null;

function armSupabase() {
  updatePayload = null;
  vi.mocked(supabaseAdmin.from).mockImplementation(
    () =>
      ({
        select: vi.fn().mockReturnThis(),
        insert: vi.fn().mockResolvedValue({ data: null, error: null }),
        update: vi.fn((payload: Record<string, unknown>) => {
          updatePayload = payload;
          return {
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          };
        }),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: clientRow, error: null }),
      }) as never
  );
}

function req(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/clients/client-1/metrics", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(updateGoals).mockResolvedValue({} as never);
  armSupabase();
});

describe("PUT /api/clients/[id]/metrics — the goal write", () => {
  it("routes a goal edit through updateGoals", async () => {
    await PUT(req({ goalWeight: 78, goalBodyFatPercentage: 15 }), routeParams);

    expect(updateGoals).toHaveBeenCalledWith(
      clientId,
      expect.objectContaining({ goalWeight: 78, goalBodyFatPercentage: 15 }),
      "coach-1"
    );
  });

  it("never writes the goal mirror itself — updateGoals owns both stores", async () => {
    await PUT(req({ goalWeight: 78, goalBodyFatPercentage: 15 }), routeParams);

    // updateGoals writes client_goals AND clients.* in one transaction
    // (migration 139). A second mirror write here is what let the two stores
    // disagree when the goal write failed in between.
    expect(updatePayload).not.toBeNull();
    expect(updatePayload).not.toHaveProperty("goal_weight");
    expect(updatePayload).not.toHaveProperty("goal_body_fat_percentage");
  });

  it("still writes non-goal metrics on the same request", async () => {
    await PUT(req({ currentWeight: 88 }), routeParams);

    expect(updatePayload).toHaveProperty("current_weight", 88);
  });

  it("does NOT return success when the goal write fails", async () => {
    vi.mocked(updateGoals).mockRejectedValue(new Error("rpc down"));

    const res = await PUT(req({ goalWeight: 78 }), routeParams);

    // The catch that used to sit here returned 200 while the mirror and
    // client_goals held different goals — invisible until a coach and their
    // client compared screens.
    expect(res.status).not.toBe(200);
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});
