import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "./route";

vi.mock("@/lib/rate-limit", () => ({
  clientApiRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/csrf-protection", () => ({
  requireCSRFProtection: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/auth-helpers", () => ({
  getAuthenticatedClientId: vi.fn(),
}));

vi.mock("@/services/supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

import { clientApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { supabaseAdmin } from "@/services/supabase-admin";

function createMockQuery(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
}

function createMockRequest(method: string, body?: Record<string, unknown>) {
  return new NextRequest("http://localhost:3000/api/client/phase-completion", {
    method,
    ...(body
      ? {
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
        }
      : {}),
  });
}

describe("/api/client/phase-completion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(clientApiRateLimit).mockResolvedValue(null);
    vi.mocked(requireCSRFProtection).mockResolvedValue(null);
    vi.mocked(getAuthenticatedClientId).mockResolvedValue("client-1");
  });

  describe("GET", () => {
    it("returns pending completion with coach reflection and metrics", async () => {
      const mockPhase = {
        id: "phase-1",
        name: "Strength Phase",
        coach_reflection: "Well done!",
        phase_summary: {
          nextPhaseId: "phase-2",
          metricsSnapshot: { startWeight: 85, endWeight: 82 },
          adherence: { training: { percentage: 80, completed: 20 } },
        },
        end_date: "2026-03-01",
      };

      // First call: phases query, second call: next phase lookup
      const phasesQuery = createMockQuery({ data: mockPhase, error: null });
      const nextPhaseQuery = createMockQuery({
        data: { name: "Hypertrophy Phase" },
        error: null,
      });

      let callCount = 0;
      vi.mocked(supabaseAdmin.from).mockImplementation(() => {
        callCount++;
        if (callCount === 1) return phasesQuery as never;
        return nextPhaseQuery as never;
      });

      const response = await GET(createMockRequest("GET"));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.phaseName).toBe("Strength Phase");
      expect(data.data.coachReflection).toBe("Well done!");
      expect(data.data.nextPhaseName).toBe("Hypertrophy Phase");
    });

    it("returns 404 when no unseen completion exists", async () => {
      const query = createMockQuery({ data: null, error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValue(query as never);

      const response = await GET(createMockRequest("GET"));
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
    });

    it("returns 401 when not authenticated", async () => {
      vi.mocked(getAuthenticatedClientId).mockResolvedValue(null);

      const response = await GET(createMockRequest("GET"));
      expect(response.status).toBe(401);
    });
  });

  describe("POST", () => {
    it("marks completion as seen", async () => {
      const query = createMockQuery({ data: null, error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValue(query as never);

      const response = await POST(
        createMockRequest("POST", {
          phaseId: "550e8400-e29b-41d4-a716-446655440000",
        })
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(supabaseAdmin.from).toHaveBeenCalledWith("phases");
    });

    it("returns 401 when not authenticated", async () => {
      vi.mocked(getAuthenticatedClientId).mockResolvedValue(null);

      const response = await POST(
        createMockRequest("POST", {
          phaseId: "550e8400-e29b-41d4-a716-446655440000",
        })
      );
      expect(response.status).toBe(401);
    });

    it("returns 400 with invalid phaseId", async () => {
      const response = await POST(
        createMockRequest("POST", { phaseId: "not-a-uuid" })
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
    });
  });
});
