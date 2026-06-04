import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const rateLimitMock = vi.fn();
const requireCoachOwnsClientMock = vi.fn();
const getOverviewBriefMock = vi.fn();

vi.mock("@/lib/rate-limit", () => ({
  coachApiRateLimit: (...a: unknown[]) => rateLimitMock(...a),
}));
vi.mock("@/lib/require-coach-auth", () => ({
  requireCoachOwnsClient: (...a: unknown[]) => requireCoachOwnsClientMock(...a),
}));
vi.mock("@/services/client-overview-brief-service", () => ({
  getOverviewBrief: (...a: unknown[]) => getOverviewBriefMock(...a),
}));

import { GET } from "./route";

const makeReq = () => new NextRequest("http://localhost:3000/api/clients/client-1/overview-brief");
const params = { params: Promise.resolve({ id: "client-1" }) };

const BRIEF = {
  lastViewedAt: "2026-06-01T00:00:00Z",
  waitingOnYou: { unreviewedCheckIn: null, attentionAlerts: [] },
  sinceLastVisit: {
    newCheckIns: 0,
    newLogs: 0,
    newBodyMetrics: 0,
    newWorkoutsLogged: 0,
    eventStatusChanges: 0,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitMock.mockResolvedValue(null);
});

describe("GET /api/clients/[id]/overview-brief", () => {
  it("200 returns the brief and invokes getOverviewBrief (which records the view)", async () => {
    requireCoachOwnsClientMock.mockResolvedValue({ authorized: true, coachId: "coach-1" });
    getOverviewBriefMock.mockResolvedValue(BRIEF);

    const res = await GET(makeReq(), params);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, data: BRIEF });
    expect(getOverviewBriefMock).toHaveBeenCalledWith("coach-1", "client-1");
  });

  it("403 when the coach does not own the client (and never builds the brief)", async () => {
    const forbidden = new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
    requireCoachOwnsClientMock.mockResolvedValue({ authorized: false, response: forbidden });

    const res = await GET(makeReq(), params);

    expect(res.status).toBe(403);
    expect(getOverviewBriefMock).not.toHaveBeenCalled();
  });

  it("500 when the service throws", async () => {
    requireCoachOwnsClientMock.mockResolvedValue({ authorized: true, coachId: "coach-1" });
    getOverviewBriefMock.mockRejectedValue(new Error("boom"));

    const res = await GET(makeReq(), params);
    expect(res.status).toBe(500);
  });
});
