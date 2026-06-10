import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET, POST } from "./route";

vi.mock("@/lib/rate-limit", () => ({
  coachApiRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/csrf-protection", () => ({
  requireCSRFProtection: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/require-coach-auth", () => ({
  requireCoachOwnsClient: vi.fn(),
}));

vi.mock("@/services/phase-transition-service", () => ({
  getPhaseReviewData: vi.fn(),
  transitionPhase: vi.fn(),
}));

// The route now records an audit event (fire-and-forget). Mock it so the test
// doesn't load the real supabase-admin client (which throws without env vars).
vi.mock("@/services/audit-log-service", () => ({
  recordAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import {
  getPhaseReviewData,
  transitionPhase,
} from "@/services/phase-transition-service";

const mockParams = {
  params: Promise.resolve({ id: "client-1", phaseId: "phase-1" }),
};

const mockReviewData = {
  phase: { id: "phase-1", name: "Phase 1", status: "active" },
  trainingAdherence: { completed: 20, prescribed: 24, percentage: 83 },
  nutritionAdherence: { averageScore: 72, logsCount: 40 },
  habitCompletion: null,
  bodyMetrics: { start: { weight: 85 }, current: { weight: 82 } },
  goalsAtStart: null,
  goalsNow: null,
  durationDays: 60,
  hasNextPhase: true,
  nextPhaseName: "Phase 2",
};

function createMockRequest(method: string, body?: Record<string, unknown>) {
  return new NextRequest(
    "http://localhost:3000/api/clients/client-1/roadmap/phases/phase-1/transition",
    {
      method,
      ...(body
        ? {
            body: JSON.stringify(body),
            headers: { "Content-Type": "application/json" },
          }
        : {}),
    }
  );
}

describe("/api/clients/[id]/roadmap/phases/[phaseId]/transition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(coachApiRateLimit).mockResolvedValue(null);
    vi.mocked(requireCSRFProtection).mockResolvedValue(null);
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({
      authorized: true,
      coachId: "coach-1",
    } as never);
  });

  describe("GET", () => {
    it("returns review data for authenticated coach", async () => {
      vi.mocked(getPhaseReviewData).mockResolvedValue(mockReviewData as never);

      const response = await GET(createMockRequest("GET"), mockParams);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.durationDays).toBe(60);
      expect(getPhaseReviewData).toHaveBeenCalledWith("phase-1", "client-1");
    });

    it("returns 401 when not authenticated", async () => {
      vi.mocked(requireCoachOwnsClient).mockResolvedValue({
        authorized: false,
        response: NextResponse.json(
          { error: "Unauthorized" },
          { status: 401 }
        ),
      } as never);

      const response = await GET(createMockRequest("GET"), mockParams);
      expect(response.status).toBe(401);
    });
  });

  describe("POST", () => {
    const validBody = {
      coachReflection: "Great work",
      nextAction: "activate_next",
      planHandling: {
        trainingPlan: "archive",
        nutritionPlan: "keep",
        habits: "archive",
      },
    };

    it("successful transition returns completed phase", async () => {
      vi.mocked(transitionPhase).mockResolvedValue({
        resultId: "phase-2",
        reviewData: mockReviewData,
      } as never);

      const response = await POST(createMockRequest("POST", validBody), mockParams);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(transitionPhase).toHaveBeenCalledWith(
        "phase-1",
        "client-1",
        validBody
      );
    });

    it("returns 400 with invalid nextAction value", async () => {
      const response = await POST(
        createMockRequest("POST", {
          ...validBody,
          nextAction: "invalid_action",
        }),
        mockParams
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
    });

    it("requires CSRF token", async () => {
      const csrfResponse = NextResponse.json(
        { error: "CSRF validation failed" },
        { status: 403 }
      );
      vi.mocked(requireCSRFProtection).mockResolvedValue(csrfResponse);

      const response = await POST(createMockRequest("POST", validBody), mockParams);
      expect(response).toBe(csrfResponse);
      expect(transitionPhase).not.toHaveBeenCalled();
    });

    it("returns 400 with missing planHandling", async () => {
      const response = await POST(
        createMockRequest("POST", {
          nextAction: "activate_next",
        }),
        mockParams
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
    });
  });
});
