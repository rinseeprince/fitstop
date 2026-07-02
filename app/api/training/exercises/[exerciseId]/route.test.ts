import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/services/exercise-catalog-service", () => ({
  updateCatalogExercise: vi.fn(),
  deleteCatalogExercise: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
  getAuthenticatedCoachId: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  coachApiRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/csrf-protection", () => ({
  requireCSRFProtection: vi.fn().mockResolvedValue(null),
}));

import { PATCH, DELETE } from "./route";
import {
  updateCatalogExercise,
  deleteCatalogExercise,
} from "@/services/exercise-catalog-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";

const mockUpdate = vi.mocked(updateCatalogExercise);
const mockDelete = vi.mocked(deleteCatalogExercise);
const mockAuth = vi.mocked(getAuthenticatedCoachId);

const params = { params: Promise.resolve({ exerciseId: "ex-1" }) };

function patchRequest(body: unknown) {
  return new NextRequest("http://localhost/api/training/exercises/ex-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function deleteRequest() {
  return new NextRequest("http://localhost/api/training/exercises/ex-1", {
    method: "DELETE",
  });
}

describe("PATCH /api/training/exercises/[exerciseId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue("coach-1");
  });

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await PATCH(patchRequest({ name: "X" }), params);
    expect(res.status).toBe(401);
  });

  it("rejects invalid input with 400", async () => {
    const res = await PATCH(patchRequest({ name: "" }), params);
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("updates and returns the exercise", async () => {
    mockUpdate.mockResolvedValue({
      id: "ex-1",
      coachId: "coach-1",
      name: "Walking Lunge",
      muscleGroup: "legs",
      equipment: null,
      category: null,
      aliases: [],
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: "2026-07-01T00:00:00Z",
    });
    const res = await PATCH(
      patchRequest({ name: "Walking Lunge", muscleGroup: "legs" }),
      params
    );
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith("ex-1", "coach-1", {
      name: "Walking Lunge",
      muscleGroup: "legs",
    });
  });

  it("maps Exercise not found (global rows) to 404", async () => {
    mockUpdate.mockRejectedValue(new Error("Exercise not found"));
    const res = await PATCH(patchRequest({ name: "X" }), params);
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/training/exercises/[exerciseId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue("coach-1");
  });

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await DELETE(deleteRequest(), params);
    expect(res.status).toBe(401);
  });

  it("deletes a coach-owned exercise", async () => {
    mockDelete.mockResolvedValue(undefined);
    const res = await DELETE(deleteRequest(), params);
    expect(res.status).toBe(200);
    expect(mockDelete).toHaveBeenCalledWith("ex-1", "coach-1");
  });

  it("maps Exercise not found to 404", async () => {
    mockDelete.mockRejectedValue(new Error("Exercise not found"));
    const res = await DELETE(deleteRequest(), params);
    expect(res.status).toBe(404);
  });

  it("returns 500 on service failure", async () => {
    mockDelete.mockRejectedValue(new Error("boom"));
    const res = await DELETE(deleteRequest(), params);
    expect(res.status).toBe(500);
  });
});
