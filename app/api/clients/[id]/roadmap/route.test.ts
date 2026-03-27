import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET, POST, PUT, DELETE } from "./route";

vi.mock("@/lib/rate-limit", () => ({
  coachApiRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/csrf-protection", () => ({
  requireCSRFProtection: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/require-coach-auth", () => ({
  requireCoachOwnsClient: vi.fn(),
}));

vi.mock("@/services/roadmap-service", () => ({
  getActiveRoadmap: vi.fn(),
  createRoadmap: vi.fn(),
  updateRoadmap: vi.fn(),
  deleteRoadmap: vi.fn(),
}));

import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import {
  getActiveRoadmap,
  createRoadmap,
  updateRoadmap,
  deleteRoadmap,
} from "@/services/roadmap-service";

const mockParams = { params: Promise.resolve({ id: "client-1" }) };

const mockRoadmap = {
  id: "roadmap-1",
  clientId: "client-1",
  coachId: "coach-1",
  name: "12-Week Plan",
  longTermGoal: "Lose 10 lbs",
  status: "active" as const,
  startedAt: "2024-01-01",
  targetEndDate: "2024-03-25",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  phases: [],
};

function createMockRequest(method: string, body?: Record<string, unknown>) {
  return new NextRequest("http://localhost:3000/api/clients/client-1/roadmap", {
    method,
    ...(body
      ? {
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
        }
      : {}),
  });
}

describe("/api/clients/[id]/roadmap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(coachApiRateLimit).mockResolvedValue(null);
    vi.mocked(requireCSRFProtection).mockResolvedValue(null);
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({
      authorized: true,
      coachId: "coach-1",
    });
  });

  describe("GET", () => {
    it("returns active roadmap with phases", async () => {
      vi.mocked(getActiveRoadmap).mockResolvedValue(mockRoadmap);

      const response = await GET(createMockRequest("GET"), mockParams);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.id).toBe("roadmap-1");
      expect(data.data.name).toBe("12-Week Plan");
      expect(data.data.phases).toEqual([]);
    });

    it("returns 200 with null data when no active roadmap", async () => {
      vi.mocked(getActiveRoadmap).mockResolvedValue(null);

      const response = await GET(createMockRequest("GET"), mockParams);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toBeNull();
    });

    it("returns 401 when not authenticated", async () => {
      vi.mocked(requireCoachOwnsClient).mockResolvedValue({
        authorized: false,
        response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      });

      const response = await GET(createMockRequest("GET"), mockParams);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("POST", () => {
    it("creates roadmap successfully", async () => {
      vi.mocked(createRoadmap).mockResolvedValue(mockRoadmap);

      const response = await POST(
        createMockRequest("POST", { name: "12-Week Plan", longTermGoal: "Lose 10 lbs" }),
        mockParams
      );
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.data.name).toBe("12-Week Plan");
      expect(createRoadmap).toHaveBeenCalledWith("client-1", "coach-1", {
        name: "12-Week Plan",
        longTermGoal: "Lose 10 lbs",
      });
    });

    it("returns 400 with invalid body", async () => {
      const response = await POST(
        createMockRequest("POST", {}),
        mockParams
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
    });

    it("requires CSRF token on POST", async () => {
      const csrfResponse = NextResponse.json(
        { error: "CSRF validation failed" },
        { status: 403 }
      );
      vi.mocked(requireCSRFProtection).mockResolvedValue(csrfResponse);

      const response = await POST(
        createMockRequest("POST", { name: "Test" }),
        mockParams
      );

      expect(response).toBe(csrfResponse);
      expect(createRoadmap).not.toHaveBeenCalled();
    });

    it("returns 400 when active roadmap already exists", async () => {
      vi.mocked(createRoadmap).mockRejectedValue(
        new Error("This client already has an active roadmap.")
      );

      const response = await POST(
        createMockRequest("POST", { name: "New Plan" }),
        mockParams
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("already has an active roadmap");
    });
  });

  describe("PUT", () => {
    it("updates roadmap with partial fields", async () => {
      vi.mocked(getActiveRoadmap).mockResolvedValue(mockRoadmap);
      vi.mocked(updateRoadmap).mockResolvedValue({
        ...mockRoadmap,
        name: "Updated Plan",
      });

      const response = await PUT(
        createMockRequest("PUT", { name: "Updated Plan" }),
        mockParams
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(updateRoadmap).toHaveBeenCalledWith("roadmap-1", { name: "Updated Plan" });
    });

    it("returns 404 when no active roadmap to update", async () => {
      vi.mocked(getActiveRoadmap).mockResolvedValue(null);

      const response = await PUT(
        createMockRequest("PUT", { name: "Updated Plan" }),
        mockParams
      );
      const data = await response.json();

      expect(response.status).toBe(404);
    });

    it("requires CSRF token on PUT", async () => {
      const csrfResponse = NextResponse.json(
        { error: "CSRF validation failed" },
        { status: 403 }
      );
      vi.mocked(requireCSRFProtection).mockResolvedValue(csrfResponse);

      const response = await PUT(
        createMockRequest("PUT", { name: "Test" }),
        mockParams
      );

      expect(response).toBe(csrfResponse);
    });
  });

  describe("DELETE", () => {
    it("deletes roadmap when all phases are planned", async () => {
      vi.mocked(getActiveRoadmap).mockResolvedValue(mockRoadmap);
      vi.mocked(deleteRoadmap).mockResolvedValue(undefined);

      const response = await DELETE(createMockRequest("DELETE"), mockParams);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(deleteRoadmap).toHaveBeenCalledWith("roadmap-1");
    });

    it("returns 400 when phases were activated", async () => {
      vi.mocked(getActiveRoadmap).mockResolvedValue(mockRoadmap);
      vi.mocked(deleteRoadmap).mockRejectedValue(
        new Error(
          "This roadmap has phases that were started or completed. Archive it instead of deleting."
        )
      );

      const response = await DELETE(createMockRequest("DELETE"), mockParams);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("phases that were started or completed");
    });

    it("returns 404 when no active roadmap to delete", async () => {
      vi.mocked(getActiveRoadmap).mockResolvedValue(null);

      const response = await DELETE(createMockRequest("DELETE"), mockParams);
      const data = await response.json();

      expect(response.status).toBe(404);
    });

    it("requires CSRF token on DELETE", async () => {
      const csrfResponse = NextResponse.json(
        { error: "CSRF validation failed" },
        { status: 403 }
      );
      vi.mocked(requireCSRFProtection).mockResolvedValue(csrfResponse);

      const response = await DELETE(createMockRequest("DELETE"), mockParams);

      expect(response).toBe(csrfResponse);
    });
  });
});
