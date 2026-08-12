import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

vi.mock("@/lib/rate-limit", () => ({
  apiRateLimit: vi.fn().mockResolvedValue(null),
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

vi.mock("@/services/client-energy-service", () => ({
  recalculateClientEnergy: vi.fn(),
}));

import { getClientById } from "@/services/client-service";
import { recalculateClientEnergy } from "@/services/client-energy-service";

const mockParams = { params: Promise.resolve({ id: "client-1" }) };

function request() {
  return new NextRequest(
    "http://localhost:3000/api/clients/client-1/calculate-bmr",
    { method: "POST" }
  );
}

function energyResult(overrides: Record<string, unknown> = {}) {
  return {
    status: "written",
    bmr: 3712,
    tdee: 4454,
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

describe("POST /api/clients/[id]/calculate-bmr", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getClientById).mockResolvedValue({
      id: "client-1",
      coachId: "coach-1",
    } as never);
    vi.mocked(recalculateClientEnergy).mockResolvedValue(
      energyResult() as never
    );
  });

  it("returns BOTH bmr and tdee", async () => {
    // It used to write `{ bmr }` alone and return only bmr, while the calling
    // hook's toast read `data.tdee` — rendering "TDEE: undefined cal/day".
    const res = await POST(request(), mockParams);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.bmr).toBe(3712);
    expect(json.tdee).toBe(4454);
  });

  it("routes through the shared energy helper, scoped to the coach", async () => {
    await POST(request(), mockParams);

    expect(recalculateClientEnergy).toHaveBeenCalledWith("client-1", {
      coachId: "coach-1",
    });
  });

  it("does NOT clear override flags", async () => {
    // Silently discarding a coach's custom TDEE on a button press would be
    // worse than the bug this route had. A "recalculate + clear" gesture needs
    // a button that says so.
    await POST(request(), mockParams);

    const options = vi.mocked(recalculateClientEnergy).mock.calls[0][1];
    expect(options).not.toHaveProperty("overrides");
  });

  it("400s with the helper's missing-field list", async () => {
    vi.mocked(recalculateClientEnergy).mockResolvedValue(
      energyResult({
        status: "skipped_insufficient_data",
        missing: ["height", "gender"],
      }) as never
    );

    const res = await POST(request(), mockParams);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.missing).toEqual(["height", "gender"]);
  });

  it("500s when the write fails", async () => {
    vi.mocked(recalculateClientEnergy).mockResolvedValue(
      energyResult({ status: "failed" }) as never
    );

    const res = await POST(request(), mockParams);

    expect(res.status).toBe(500);
  });

  it("403s on a client the coach does not own, before recomputing", async () => {
    vi.mocked(getClientById).mockResolvedValue({
      id: "client-1",
      coachId: "someone-else",
    } as never);

    const res = await POST(request(), mockParams);

    expect(res.status).toBe(403);
    expect(recalculateClientEnergy).not.toHaveBeenCalled();
  });

  it("401s without a coach", async () => {
    const { getAuthenticatedCoachId } = await import("@/lib/auth-helpers");
    vi.mocked(getAuthenticatedCoachId).mockResolvedValueOnce(null);

    const res = await POST(request(), mockParams);

    expect(res.status).toBe(401);
    expect(recalculateClientEnergy).not.toHaveBeenCalled();
  });

  it("404s on an unknown client", async () => {
    vi.mocked(getClientById).mockResolvedValue(null);

    const res = await POST(request(), mockParams);

    expect(res.status).toBe(404);
  });
});
