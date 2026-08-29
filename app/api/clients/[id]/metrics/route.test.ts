import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { PUT } from "./route";

vi.mock("@/lib/rate-limit", () => ({
  apiRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/csrf-protection", () => ({
  requireCSRFProtection: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/auth-helpers", () => ({
  getAuthenticatedCoachId: vi.fn().mockResolvedValue("coach-1"),
}));

vi.mock("@/services/supabase-admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock("@/services/body-metrics-service", () => ({
  recordBodyMetrics: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/services/client-goals-service", () => ({
  updateGoals: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/services/client-energy-service", () => ({
  recalculateClientEnergy: vi.fn(),
}));

import { supabaseAdmin } from "@/services/supabase-admin";
import { recordBodyMetrics } from "@/services/body-metrics-service";
import { updateGoals } from "@/services/client-goals-service";
import { recalculateClientEnergy } from "@/services/client-energy-service";

const mockParams = { params: Promise.resolve({ id: "client-1" }) };

const CLIENT_ROW = {
  id: "client-1",
  coach_id: "coach-1",
  current_weight: 80,
  current_body_fat_percentage: null,
  height: 180,
  gender: "male",
  date_of_birth: "1996-01-01",
  bmr: 1700,
  tdee: 2040,
  bmr_manual_override: false,
  tdee_manual_override: false,
};

let query: {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
};

/** One chainable stub shared by every `from()` call — the `then` thenable is
 *  what lets the handler `await` an `.update().eq().eq()` chain directly
 *  (the body-metrics-service.test.ts idiom). */
function wireSupabase() {
  const result = { data: CLIENT_ROW, error: null };
  const q: Record<string, unknown> = {
    select: vi.fn(() => q),
    insert: vi.fn(() => q),
    update: vi.fn(() => q),
    eq: vi.fn(() => q),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: (resolve: (v: typeof result) => void) =>
      Promise.resolve(result).then(resolve),
  };
  query = q as unknown as typeof query;
  vi.mocked(supabaseAdmin.from).mockImplementation((() => q) as never);
}

function request(body: Record<string, unknown>) {
  return new NextRequest("http://localhost:3000/api/clients/client-1/metrics", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function energyResult(overrides: Record<string, unknown> = {}) {
  return {
    status: "written",
    bmr: 1780,
    tdee: 2136,
    bmrManualOverride: false,
    tdeeManualOverride: false,
    bmrDisposition: "computed",
    tdeeDisposition: "computed",
    computation: null,
    missing: [],
    missingDateOfBirth: false,
    ...overrides,
  };
}

describe("PUT /api/clients/[id]/metrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wireSupabase();
    vi.mocked(recalculateClientEnergy).mockResolvedValue(
      energyResult() as never
    );
  });

  describe("the handler no longer writes the energy pair itself", () => {
    it("omits bmr, tdee and both override flags from its own update", async () => {
      // This handler used to set them directly, re-implement Mifflin-St Jeor
      // inline for reset-to-auto, and hardcode `tdee = bmr * 1.2` twice.
      const res = await PUT(request({ currentWeight: 82 }), mockParams);

      expect(res.status).toBe(200);
      const payload = query.update.mock.calls[0][0] as Record<string, unknown>;
      expect(payload).not.toHaveProperty("bmr");
      expect(payload).not.toHaveProperty("tdee");
      expect(payload).not.toHaveProperty("bmr_manual_override");
      expect(payload).not.toHaveProperty("tdee_manual_override");
      expect(payload).toHaveProperty("current_weight", 82);
    });

    it("delegates a weight change to the energy helper", async () => {
      await PUT(request({ currentWeight: 82 }), mockParams);

      expect(recalculateClientEnergy).toHaveBeenCalledWith("client-1", {
        coachId: "coach-1",
        overrides: undefined,
      });
    });
  });

  describe("override translation", () => {
    it("turns a manual tdee into a set instruction", async () => {
      await PUT(request({ tdee: 3100 }), mockParams);

      expect(recalculateClientEnergy).toHaveBeenCalledWith("client-1", {
        coachId: "coach-1",
        overrides: { tdee: { action: "set", value: 3100 } },
      });
    });

    it("turns a false override flag into a clear instruction", async () => {
      await PUT(request({ tdeeManualOverride: false }), mockParams);

      expect(recalculateClientEnergy).toHaveBeenCalledWith("client-1", {
        coachId: "coach-1",
        overrides: { tdee: { action: "clear" } },
      });
    });

    it("prefers the value over the flag when a body carries both", async () => {
      await PUT(
        request({ bmr: 2000, bmrManualOverride: false }),
        mockParams
      );

      expect(recalculateClientEnergy).toHaveBeenCalledWith("client-1", {
        coachId: "coach-1",
        overrides: { bmr: { action: "set", value: 2000 } },
      });
    });

    it("issues no clients update at all for an override-only body", async () => {
      // `updates` is empty in that case, and an empty .update({}) is a wasted
      // round trip.
      await PUT(request({ tdee: 3100 }), mockParams);

      expect(query.update).not.toHaveBeenCalled();
    });
  });

  describe("body_metrics provenance", () => {
    it("stamps the event with the helper's pair, never a local recomputation", async () => {
      await PUT(request({ currentWeight: 82 }), mockParams);

      expect(recordBodyMetrics).toHaveBeenCalledWith(
        expect.objectContaining({ bmr: 1780, tdee: 2136, weight: 82 })
      );
    });

    it("records an event for an override-only change", async () => {
      await PUT(request({ tdee: 3100 }), mockParams);

      expect(recordBodyMetrics).toHaveBeenCalledOnce();
    });

    it("records nothing when the helper skipped and no measurement changed", async () => {
      vi.mocked(recalculateClientEnergy).mockResolvedValue(
        energyResult({ status: "skipped_insufficient_data" }) as never
      );

      await PUT(request({ goalWeight: 75 }), mockParams);

      expect(recordBodyMetrics).not.toHaveBeenCalled();
    });
  });

  describe("Session 0's goal-clobber fix is undisturbed", () => {
    it("still dual-writes goals through updateGoals", async () => {
      await PUT(
        request({ goalWeight: 75, goalBodyFatPercentage: 12 }),
        mockParams
      );

      expect(updateGoals).toHaveBeenCalledWith(
        "client-1",
        { goalWeight: 75, goalBodyFatPercentage: 12 },
        "coach-1"
      );
    });

    it("does not call updateGoals when no goal field is present", async () => {
      await PUT(request({ currentWeight: 82 }), mockParams);

      expect(updateGoals).not.toHaveBeenCalled();
    });

    // Task 0b.2 — updateGoals owns both goal stores.
    it("writes no goal column to clients itself", async () => {
      await PUT(request({ goalWeight: 75, goalBodyFatPercentage: 12 }), mockParams);

      for (const call of query.update.mock.calls) {
        expect(call[0]).not.toHaveProperty("goal_weight");
        expect(call[0]).not.toHaveProperty("goal_body_fat_percentage");
      }
    });

    it("a failed goal write no longer returns success", async () => {
      vi.mocked(updateGoals).mockRejectedValueOnce(new Error("goal insert failed"));

      const response = await PUT(request({ goalWeight: 75 }), mockParams);

      expect(response.status).toBe(500);
    });
  });

  describe("auth and validation", () => {
    it("401s without a coach", async () => {
      const { getAuthenticatedCoachId } = await import("@/lib/auth-helpers");
      vi.mocked(getAuthenticatedCoachId).mockResolvedValueOnce(null);

      const res = await PUT(request({ currentWeight: 82 }), mockParams);

      expect(res.status).toBe(401);
      expect(recalculateClientEnergy).not.toHaveBeenCalled();
    });

    it("400s on an out-of-range tdee before touching the helper", async () => {
      const res = await PUT(request({ tdee: 99999 }), mockParams);

      expect(res.status).toBe(400);
      expect(recalculateClientEnergy).not.toHaveBeenCalled();
    });

    it("400s a body carrying the retired saveOption key — the check-in writer is gone", async () => {
      const res = await PUT(
        request({ currentWeight: 82, saveOption: "check-in" }),
        mockParams
      );

      expect(res.status).toBe(400);
      expect(supabaseAdmin.from).not.toHaveBeenCalledWith("check_ins");
      expect(recalculateClientEnergy).not.toHaveBeenCalled();
    });
  });
});
