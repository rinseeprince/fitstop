import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET, PUT } from "./route";

vi.mock("@/lib/rate-limit", () => ({
  coachApiRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/csrf-protection", () => ({
  requireCSRFProtection: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/require-coach-auth", () => ({
  requireCoachOwnsClient: vi.fn(),
}));

vi.mock("@/services/client-goals-service", () => ({
  getCurrentGoals: vi.fn(),
  updateGoals: vi.fn(),
  getGoalsHistory: vi.fn(),
}));

import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import {
  getCurrentGoals,
  updateGoals,
  getGoalsHistory,
} from "@/services/client-goals-service";

const mockParams = { params: Promise.resolve({ id: "client-1" }) };

const mockGoals = {
  id: "goal-1",
  clientId: "client-1",
  goalWeight: 75,
  goalBodyFatPercentage: 15,
  goalDeadline: "2024-06-01",
  primaryGoal: "Lose weight",
  setBy: "coach-1",
  effectiveFrom: "2024-01-01T00:00:00Z",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

function createMockRequest(method: string, body?: Record<string, unknown>, queryString?: string) {
  const url = `http://localhost:3000/api/clients/client-1/goals${queryString ? `?${queryString}` : ""}`;
  return new NextRequest(url, {
    method,
    ...(body
      ? {
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
        }
      : {}),
  });
}

describe("/api/clients/[id]/goals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({
      authorized: true,
      coachId: "coach-1",
    });
  });

  describe("GET", () => {
    it("returns current goals", async () => {
      vi.mocked(getCurrentGoals).mockResolvedValue(mockGoals);

      const response = await GET(createMockRequest("GET"), mockParams);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.goalWeight).toBe(75);
    });

    it("returns goals with history when ?history=true", async () => {
      vi.mocked(getCurrentGoals).mockResolvedValue(mockGoals);
      vi.mocked(getGoalsHistory).mockResolvedValue([
        mockGoals,
        { ...mockGoals, id: "goal-0", goalWeight: 80, supersededAt: "2024-01-01T00:00:00Z" },
      ]);

      const response = await GET(
        createMockRequest("GET", undefined, "history=true"),
        mockParams
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.current).toBeDefined();
      expect(data.data.history).toHaveLength(2);
    });

    it("returns empty when no goals set", async () => {
      vi.mocked(getCurrentGoals).mockResolvedValue(null);

      const response = await GET(createMockRequest("GET"), mockParams);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toBeNull();
    });
  });

  describe("PUT", () => {
    it("updates goals and returns new version", async () => {
      vi.mocked(updateGoals).mockResolvedValue({
        ...mockGoals,
        goalWeight: 70,
      });

      const response = await PUT(
        createMockRequest("PUT", { goalWeight: 70 }),
        mockParams
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.goalWeight).toBe(70);
      expect(updateGoals).toHaveBeenCalledWith("client-1", { goalWeight: 70 }, "coach-1");
    });

    it("validates input - rejects negative weight", async () => {
      const response = await PUT(
        createMockRequest("PUT", { goalWeight: -10 }),
        mockParams
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
    });
  });
});
