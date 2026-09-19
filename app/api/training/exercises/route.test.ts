import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/services/exercise-catalog-service", () => ({
  getExercisesForCoach: vi.fn(),
  createExercise: vi.fn(),
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

import { POST } from "./route";
import { createExercise } from "@/services/exercise-catalog-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";

const mockCreate = vi.mocked(createExercise);
const mockAuth = vi.mocked(getAuthenticatedCoachId);

function postRequest(body: unknown) {
  return new NextRequest("http://localhost/api/training/exercises", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const created = {
  id: "ex-1",
  coachId: "coach-1",
  name: "Sled Sprint",
  muscleGroup: null,
  equipment: null,
  category: null,
  exerciseType: "carry_sled" as const,
  aliases: [],
  createdAt: "2026-09-19T00:00:00Z",
  updatedAt: "2026-09-19T00:00:00Z",
};

describe("POST /api/training/exercises", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue("coach-1");
    mockCreate.mockResolvedValue(created);
  });

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(postRequest({ name: "X" }));
    expect(res.status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("refuses a blank name and an unknown type with 400", async () => {
    expect((await POST(postRequest({ name: "   " }))).status).toBe(400);
    expect((await POST(postRequest({ name: "Sled Sprint", exerciseType: "cardio" }))).status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("creates a Strength exercise when the body names no type", async () => {
    const res = await POST(postRequest({ name: "  Sled Sprint ", muscleGroup: null }));
    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith("coach-1", {
      name: "Sled Sprint",
      exerciseType: "strength",
      muscleGroup: null,
    });
    expect(await res.json()).toEqual({ success: true, exercise: created });
  });

  it("creates an exercise on the type the form chose", async () => {
    const res = await POST(
      postRequest({ name: "Sled Sprint", exerciseType: "carry_sled", equipment: "sled", category: null }),
    );
    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith("coach-1", {
      name: "Sled Sprint",
      exerciseType: "carry_sled",
      equipment: "sled",
      category: null,
    });
  });
});
