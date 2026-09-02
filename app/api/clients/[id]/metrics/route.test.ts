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

vi.mock("@/services/measurements-service", () => ({
  appendMeasurements: vi.fn(),
}));

vi.mock("@/services/today-service", () => ({
  getCoachTodayString: vi.fn().mockResolvedValue("2026-09-02"),
}));

vi.mock("@/services/client-goals-service", () => ({
  updateGoals: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/services/client-energy-service", () => ({
  recalculateClientEnergy: vi.fn(),
}));

import { supabaseAdmin } from "@/services/supabase-admin";
import { appendMeasurements } from "@/services/measurements-service";
import { getCoachTodayString } from "@/services/today-service";
import { updateGoals } from "@/services/client-goals-service";
import { recalculateClientEnergy } from "@/services/client-energy-service";

const mockParams = { params: Promise.resolve({ id: "client-1" }) };

const CLIENT_ROW = {
  id: "client-1",
  coach_id: "coach-1",
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
 *  what lets a handler `await` a builder chain directly. */
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

function appendResult() {
  return { rows: {}, inserted: [], unchanged: [], energy: "not_newest" as const };
}

describe("PUT /api/clients/[id]/metrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wireSupabase();
    vi.mocked(getCoachTodayString).mockResolvedValue("2026-09-02");
    vi.mocked(appendMeasurements).mockResolvedValue(appendResult());
    vi.mocked(recalculateClientEnergy).mockResolvedValue(
      energyResult() as never
    );
  });

  describe("a reading is a row in the measurement log, never a column", () => {
    it("appends the weight as the coach's entry, dated the coach's today, and updates no clients column", async () => {
      const res = await PUT(request({ currentWeight: 82 }), mockParams);

      expect(res.status).toBe(200);
      expect(appendMeasurements).toHaveBeenCalledTimes(1);
      expect(appendMeasurements).toHaveBeenCalledWith({
        clientId: "client-1",
        source: "coach_entry",
        recordedOn: "2026-09-02",
        values: { weight: 82, bodyFat: undefined },
        createdBy: "coach-1",
      });
      expect(getCoachTodayString).toHaveBeenCalledWith("coach-1");
      // The four weight columns left `clients` with migration 158.
      expect(query.update).not.toHaveBeenCalled();
    });

    it("appends a body-fat reading the same way", async () => {
      await PUT(request({ currentBodyFatPercentage: 18 }), mockParams);

      expect(appendMeasurements).toHaveBeenCalledWith(
        expect.objectContaining({
          source: "coach_entry",
          values: { weight: undefined, bodyFat: 18 },
        })
      );
    });

    it("does not call the energy helper for a reading alone — the append recomputes when the row is newest", async () => {
      await PUT(request({ currentWeight: 82 }), mockParams);

      expect(recalculateClientEnergy).not.toHaveBeenCalled();
    });

    it("a failed append is a 500, never a silent success", async () => {
      vi.mocked(appendMeasurements).mockRejectedValueOnce(new Error("insert failed"));

      const res = await PUT(request({ currentWeight: 82 }), mockParams);

      expect(res.status).toBe(500);
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

    it("issues no clients update and appends nothing for an override-only body", async () => {
      await PUT(request({ tdee: 3100 }), mockParams);

      expect(query.update).not.toHaveBeenCalled();
      expect(appendMeasurements).not.toHaveBeenCalled();
    });

    it("applies an override AFTER the reading in the same body has landed, so the typed number wins", async () => {
      await PUT(request({ currentWeight: 82, tdee: 3100 }), mockParams);

      expect(appendMeasurements).toHaveBeenCalledTimes(1);
      expect(recalculateClientEnergy).toHaveBeenCalledTimes(1);
      expect(vi.mocked(appendMeasurements).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(recalculateClientEnergy).mock.invocationCallOrder[0]
      );
    });

    it("400s an impossible override instead of silently storing nothing", async () => {
      vi.mocked(recalculateClientEnergy).mockResolvedValue(
        energyResult({
          status: "rejected_invalid_override",
          rejection: "TDEE cannot be below BMR",
        }) as never
      );

      const res = await PUT(request({ tdee: 1000 }), mockParams);
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe("TDEE cannot be below BMR");
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

    it("a goal-only body appends no reading and touches no energy", async () => {
      await PUT(request({ goalWeight: 75 }), mockParams);

      expect(appendMeasurements).not.toHaveBeenCalled();
      expect(recalculateClientEnergy).not.toHaveBeenCalled();
    });

    // Task 0b.2 — updateGoals owns both goal stores.
    it("writes no goal column to clients itself", async () => {
      await PUT(request({ goalWeight: 75, goalBodyFatPercentage: 12 }), mockParams);

      expect(query.update).not.toHaveBeenCalled();
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
      expect(appendMeasurements).not.toHaveBeenCalled();
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
      expect(appendMeasurements).not.toHaveBeenCalled();
      expect(recalculateClientEnergy).not.toHaveBeenCalled();
    });
  });
});
