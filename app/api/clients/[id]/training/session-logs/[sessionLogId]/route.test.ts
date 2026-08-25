import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/rate-limit", () => ({
  coachApiRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/auth-helpers", () => ({
  getAuthenticatedCoachId: vi.fn(),
}));

vi.mock("@/services/client-service", () => ({
  getClientById: vi.fn(),
}));

vi.mock("@/services/training-log-service", () => ({
  getSessionLogDetail: vi.fn(),
}));

import { GET } from "./route";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { getClientById } from "@/services/client-service";
import { getSessionLogDetail } from "@/services/training-log-service";

const COACH_ID = "coach-1";
const CLIENT_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_CLIENT_ID = "99999999-9999-9999-9999-999999999999";
const SESSION_LOG_ID = "22222222-2222-2222-2222-222222222222";

function makeRequest(): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/clients/${CLIENT_ID}/training/session-logs/${SESSION_LOG_ID}`,
    { method: "GET" },
  );
}

const mockClient = {
  id: CLIENT_ID,
  coachId: COACH_ID,
  name: "Test Client",
} as unknown as Awaited<ReturnType<typeof getClientById>>;

const mockSessionLog = {
  id: SESSION_LOG_ID,
  clientId: CLIENT_ID,
  trainingSessionId: "session-1",
  trainingEventId: null,
  completedAt: "2026-01-01T00:00:00Z",
  completionQuality: "full" as const,
  notes: null,
  weekStartDate: "2025-12-29",
  prescribedSessionSnapshot: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const mockResult = {
  sessionLog: mockSessionLog,
  exerciseLogs: [],
  performedSessionName: null,
  prescribedExercises: [],
};

describe("GET /api/clients/[id]/training/session-logs/[sessionLogId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with sessionLog and exerciseLogs on happy path", async () => {
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(COACH_ID);
    vi.mocked(getClientById).mockResolvedValue(mockClient);
    vi.mocked(getSessionLogDetail).mockResolvedValue(mockResult);

    const response = await GET(makeRequest(), {
      params: Promise.resolve({ id: CLIENT_ID, sessionLogId: SESSION_LOG_ID }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true, data: mockResult });
    expect(getSessionLogDetail).toHaveBeenCalledWith(SESSION_LOG_ID);
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(null);

    const response = await GET(makeRequest(), {
      params: Promise.resolve({ id: CLIENT_ID, sessionLogId: SESSION_LOG_ID }),
    });

    expect(response.status).toBe(401);
    expect(getClientById).not.toHaveBeenCalled();
    expect(getSessionLogDetail).not.toHaveBeenCalled();
  });

  it("returns 403 when coach does not own URL client", async () => {
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(COACH_ID);
    vi.mocked(getClientById).mockResolvedValue({
      ...(mockClient as object),
      coachId: "other-coach",
    } as Awaited<ReturnType<typeof getClientById>>);

    const response = await GET(makeRequest(), {
      params: Promise.resolve({ id: CLIENT_ID, sessionLogId: SESSION_LOG_ID }),
    });
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data).toEqual({ success: false, error: "Forbidden" });
    expect(getSessionLogDetail).not.toHaveBeenCalled();
  });

  it("returns 403 when client missing", async () => {
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(COACH_ID);
    vi.mocked(getClientById).mockResolvedValue(null);

    const response = await GET(makeRequest(), {
      params: Promise.resolve({ id: CLIENT_ID, sessionLogId: SESSION_LOG_ID }),
    });

    expect(response.status).toBe(403);
    expect(getSessionLogDetail).not.toHaveBeenCalled();
  });

  it("returns 404 when session_log missing", async () => {
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(COACH_ID);
    vi.mocked(getClientById).mockResolvedValue(mockClient);
    vi.mocked(getSessionLogDetail).mockResolvedValue(null);

    const response = await GET(makeRequest(), {
      params: Promise.resolve({ id: CLIENT_ID, sessionLogId: SESSION_LOG_ID }),
    });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({ success: false, error: "Session log not found" });
  });

  it("returns 404 when sessionLog.clientId does not match URL clientId", async () => {
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(COACH_ID);
    vi.mocked(getClientById).mockResolvedValue(mockClient);
    vi.mocked(getSessionLogDetail).mockResolvedValue({
      sessionLog: { ...mockSessionLog, clientId: OTHER_CLIENT_ID },
      exerciseLogs: [],
      performedSessionName: null,
      prescribedExercises: [],
    });

    const response = await GET(makeRequest(), {
      params: Promise.resolve({ id: CLIENT_ID, sessionLogId: SESSION_LOG_ID }),
    });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({ success: false, error: "Session log not found" });
  });

  it("returns 500 when service throws", async () => {
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(COACH_ID);
    vi.mocked(getClientById).mockResolvedValue(mockClient);
    vi.mocked(getSessionLogDetail).mockRejectedValue(new Error("boom"));

    const response = await GET(makeRequest(), {
      params: Promise.resolve({ id: CLIENT_ID, sessionLogId: SESSION_LOG_ID }),
    });
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.success).toBe(false);
  });
});
