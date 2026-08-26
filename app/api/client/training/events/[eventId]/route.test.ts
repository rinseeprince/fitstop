import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/rate-limit", () => ({
  clientApiRateLimit: vi.fn().mockResolvedValue(null),
  clientPerClientRateLimit: vi.fn().mockResolvedValue(null),
  apiRateLimit: vi.fn().mockResolvedValue(null),
  authRateLimit: vi.fn().mockResolvedValue(null),
  checkInRateLimit: vi.fn().mockResolvedValue(null),
  aiRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/csrf-protection", () => ({
  requireCSRFProtection: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/auth-helpers", () => ({
  getAuthenticatedClientId: vi.fn(),
}));

vi.mock("@/services/training-log-service", () => ({
  getTrainingEventDetail: vi.fn(),
}));

import { GET } from "./route";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { getTrainingEventDetail } from "@/services/training-log-service";

const EVENT_ID = "11111111-1111-1111-1111-111111111111";
const CLIENT_ID = "22222222-2222-2222-2222-222222222222";

function makeRequest(): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/client/training/events/${EVENT_ID}`,
    { method: "GET" },
  );
}

const mockDetail = {
  event: { id: EVENT_ID, clientId: CLIENT_ID } as never,
  session: { source: "snapshot", snapshot: {} } as never,
  exercises: [],
  sessionLog: null,
  exerciseLogs: [],
};

describe("GET /api/client/training/events/[eventId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with detail and Cache-Control: no-store on success", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(CLIENT_ID);
    vi.mocked(getTrainingEventDetail).mockResolvedValue(mockDetail);

    const response = await GET(makeRequest(), {
      params: Promise.resolve({ eventId: EVENT_ID }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(data).toEqual({ success: true, data: mockDetail });
    expect(getTrainingEventDetail).toHaveBeenCalledWith(EVENT_ID, CLIENT_ID);
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(null);

    const response = await GET(makeRequest(), {
      params: Promise.resolve({ eventId: EVENT_ID }),
    });

    expect(response.status).toBe(401);
    expect(getTrainingEventDetail).not.toHaveBeenCalled();
  });

  it("returns 404 when service returns null (missing or wrong-client)", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(CLIENT_ID);
    vi.mocked(getTrainingEventDetail).mockResolvedValue(null);

    const response = await GET(makeRequest(), {
      params: Promise.resolve({ eventId: EVENT_ID }),
    });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({ success: false, error: "Event not found" });
  });

  it("returns 500 when service throws", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(CLIENT_ID);
    vi.mocked(getTrainingEventDetail).mockRejectedValue(new Error("boom"));

    const response = await GET(makeRequest(), {
      params: Promise.resolve({ eventId: EVENT_ID }),
    });
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.success).toBe(false);
  });
});
