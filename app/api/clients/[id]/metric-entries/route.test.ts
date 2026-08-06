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

vi.mock("@/services/metric-entries-service", () => ({
  listMetricEntries: vi.fn(),
  upsertMetricEntry: vi.fn(),
}));

// The route records an audit event (fire-and-forget). Mock it so the test
// doesn't load the real supabase-admin client (which throws without env vars).
vi.mock("@/services/audit-log-service", () => ({
  recordAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

// The no-future bound lives route-side against the coach's local today (the
// goal-deadline pattern); the zod schema stays format-only. Mock it so the
// bound is deterministic regardless of the suite's wall clock / TZ.
vi.mock("@/services/today-service", () => ({
  getCoachTodayString: vi.fn(),
}));

import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import {
  listMetricEntries,
  upsertMetricEntry,
} from "@/services/metric-entries-service";
import { getCoachTodayString } from "@/services/today-service";
import { recordAuditEvent } from "@/services/audit-log-service";
import type { MetricEntry } from "@/types/metric-entries";

const mockParams = { params: Promise.resolve({ id: "client-1" }) };

const mockEntry: MetricEntry = {
  id: "entry-1",
  clientId: "client-1",
  metricKey: "weight",
  value: 82.5,
  entryDate: "2026-07-24",
  note: "morning weigh-in",
  createdBy: "coach-1",
  createdAt: "2026-07-24T08:00:00Z",
  updatedAt: "2026-07-24T08:00:00Z",
};

function createMockRequest(method: string, body?: Record<string, unknown>) {
  const url = "http://localhost:3000/api/clients/client-1/metric-entries";
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

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    metricKey: "weight",
    value: 82.5,
    entryDate: "2026-07-24",
    note: "morning weigh-in",
    ...overrides,
  };
}

describe("/api/clients/[id]/metric-entries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({
      authorized: true,
      coachId: "coach-1",
    });
    vi.mocked(getCoachTodayString).mockResolvedValue("2026-07-24");
    vi.mocked(upsertMetricEntry).mockResolvedValue(mockEntry);
    vi.mocked(listMetricEntries).mockResolvedValue([mockEntry]);
  });

  describe("GET", () => {
    it("returns the unauthorized response verbatim when the coach doesn't own the client", async () => {
      const unauthorized = NextResponse.json(
        { error: "Client not found" },
        { status: 404 }
      );
      vi.mocked(requireCoachOwnsClient).mockResolvedValue({
        authorized: false,
        response: unauthorized,
      });

      const response = await GET(createMockRequest("GET"), mockParams);

      expect(response).toBe(unauthorized);
      expect(response.status).toBe(404);
      expect(listMetricEntries).not.toHaveBeenCalled();
    });

    it("returns the client's metric entries", async () => {
      const response = await GET(createMockRequest("GET"), mockParams);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(1);
      expect(data.data[0].metricKey).toBe("weight");
      expect(listMetricEntries).toHaveBeenCalledWith("client-1");
    });
  });

  describe("POST", () => {
    it("returns the unauthorized response verbatim and never writes", async () => {
      const unauthorized = NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
      vi.mocked(requireCoachOwnsClient).mockResolvedValue({
        authorized: false,
        response: unauthorized,
      });

      const response = await POST(
        createMockRequest("POST", validBody()),
        mockParams
      );

      expect(response).toBe(unauthorized);
      expect(response.status).toBe(401);
      expect(upsertMetricEntry).not.toHaveBeenCalled();
    });

    it("rejects an unknown metricKey (400)", async () => {
      const response = await POST(
        createMockRequest("POST", validBody({ metricKey: "height", value: 180 })),
        mockParams
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(upsertMetricEntry).not.toHaveBeenCalled();
    });

    // The bound is KILOGRAMS (WEIGHT_KG_MAX = 250). 300 is the case that
    // matters: it passed the old pounds-shaped 20-700 range, so a coach could
    // store 300 kg — a number that only made sense as pounds, on a column that
    // has been canonical kilograms since migration 141.
    it("rejects a weight above the kg ceiling (300 kg)", async () => {
      const response = await POST(
        createMockRequest("POST", validBody({ value: 300 })),
        mockParams
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(upsertMetricEntry).not.toHaveBeenCalled();
    });

    it("rejects a weight below the kg floor (15 kg)", async () => {
      const response = await POST(
        createMockRequest("POST", validBody({ value: 15 })),
        mockParams
      );

      expect(response.status).toBe(400);
      expect(upsertMetricEntry).not.toHaveBeenCalled();
    });

    it("accepts a plausible kg weight at the top of the range", async () => {
      const response = await POST(
        createMockRequest("POST", validBody({ value: 249 })),
        mockParams
      );

      expect(response.status).toBe(200);
      expect(upsertMetricEntry).toHaveBeenCalled();
    });

    it("rejects a mood above its 1-5 scale (6)", async () => {
      const response = await POST(
        createMockRequest("POST", validBody({ metricKey: "mood", value: 6 })),
        mockParams
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(upsertMetricEntry).not.toHaveBeenCalled();
    });

    it("rejects a non-integer value for an integer wellness scale (energy 5.5)", async () => {
      const response = await POST(
        createMockRequest("POST", validBody({ metricKey: "energy", value: 5.5 })),
        mockParams
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(upsertMetricEntry).not.toHaveBeenCalled();
    });

    it("rejects a malformed entryDate at the schema (25-07-2026)", async () => {
      const response = await POST(
        createMockRequest("POST", validBody({ entryDate: "25-07-2026" })),
        mockParams
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(upsertMetricEntry).not.toHaveBeenCalled();
    });

    it("rejects an unknown extra field (.strict())", async () => {
      const response = await POST(
        createMockRequest("POST", validBody({ extraneous: true })),
        mockParams
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(upsertMetricEntry).not.toHaveBeenCalled();
    });

    it("rejects an entryDate after coach-local today", async () => {
      vi.mocked(getCoachTodayString).mockResolvedValue("2026-07-24");

      const response = await POST(
        createMockRequest("POST", validBody({ entryDate: "2026-07-25" })),
        mockParams
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe("Entry date cannot be in the future");
      expect(getCoachTodayString).toHaveBeenCalledWith("coach-1");
      expect(upsertMetricEntry).not.toHaveBeenCalled();
    });

    it("upserts with the route clientId + authed coachId and returns 200 {success, data}", async () => {
      const response = await POST(
        createMockRequest("POST", validBody()),
        mockParams
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.id).toBe("entry-1");
      expect(upsertMetricEntry).toHaveBeenCalledWith("client-1", {
        metricKey: "weight",
        value: 82.5,
        entryDate: "2026-07-24",
        note: "morning weigh-in",
        coachId: "coach-1",
      });
    });

    it("records an audit event with metric + date only (no measurement value)", async () => {
      await POST(createMockRequest("POST", validBody()), mockParams);

      expect(recordAuditEvent).toHaveBeenCalledTimes(1);
      const event = vi.mocked(recordAuditEvent).mock.calls[0][0];
      expect(event.action).toBe("metric_entry.upsert");
      expect(event.targetTable).toBe("client_metric_entries");
      expect(event.targetId).toBe("entry-1");
      expect(event.clientId).toBe("client-1");
      expect(event.actorId).toBe("coach-1");
      // metric + date only — the measurement value is health data and stays out
      expect(event.metadata).toEqual({
        metricKey: "weight",
        entryDate: "2026-07-24",
      });
      expect(event.metadata).not.toHaveProperty("value");
    });
  });
});
