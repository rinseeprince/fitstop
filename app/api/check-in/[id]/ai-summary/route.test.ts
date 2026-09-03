import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/rate-limit", () => ({
  aiRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/csrf-protection", () => ({
  requireCSRFProtection: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/require-coach-auth", () => ({
  requireCoachOwnsCheckIn: vi.fn(),
}));

// A factory mock replaces the module wholesale: an export the route imports and
// this list omits arrives as undefined and the route 500s at call time, not at
// import. Grow this list whenever the route's import list grows.
vi.mock("@/services/check-in-service", () => ({
  getClientCheckIns: vi.fn(),
  updateCheckInAISummary: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/services/client-service", () => ({
  getClientById: vi.fn().mockResolvedValue({ id: "client-1", name: "Sam", nextCheckInDue: null }),
}));

vi.mock("@/services/ai-service", () => ({
  generateCheckInSummary: vi.fn().mockResolvedValue({ summary: "s", clientMessage: "m" }),
  regenerateAISummary: vi.fn().mockResolvedValue({ summary: "s", clientMessage: "m" }),
}));

vi.mock("@/services/daily-logs-service", () => ({
  getDailyLogs: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/services/daily-habits-service", () => ({
  getHabitLogs: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/services/weekly-nutrition-service", () => ({
  getNutritionSummaryForPeriod: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/services/check-in-context-service", () => ({
  getExerciseSummariesForPeriod: vi.fn().mockResolvedValue(new Map()),
  getTrainingEventDetailsForPeriod: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/viewer-preferences", () => ({
  getCoachUnitPreference: vi.fn().mockResolvedValue("metric"),
}));

import { POST } from "./route";
import { requireCoachOwnsCheckIn } from "@/lib/require-coach-auth";
import { getClientCheckIns } from "@/services/check-in-service";
import { generateCheckInSummary } from "@/services/ai-service";

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (body: unknown = {}) =>
  new NextRequest("https://t.dev/api/check-in/ci-may/ai-summary", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

/** A May check-in regenerated in September, when later check-ins exist. */
const mayCheckIn = {
  id: "ci-may",
  clientId: "client-1",
  createdAt: "2026-05-31T12:00:00+00:00",
  periodStart: "2026-05-25",
  periodEnd: "2026-05-31",
};

describe("POST /api/check-in/[id]/ai-summary — the previous check-ins are the ones up to this one", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCoachOwnsCheckIn).mockResolvedValue({
      authorized: true,
      coachId: "coach-1",
      checkIn: mayCheckIn,
    } as never);
    vi.mocked(getClientCheckIns).mockResolvedValue({
      checkIns: [
        mayCheckIn,
        { id: "ci-24-may", clientId: "client-1", createdAt: "2026-05-24T12:00:00+00:00" },
      ],
      total: 2,
      nextCursor: null,
    } as never);
  });

  it("bounds the read to the check-in's instant, so a regenerated old review is never told about later check-ins", async () => {
    const res = await POST(req(), params("ci-may"));

    expect(res.status).toBe(200);
    expect(getClientCheckIns).toHaveBeenCalledWith("client-1", {
      limit: 5,
      upTo: "2026-05-31T12:00:00+00:00",
    });
  });

  it("hands the prompt the earlier check-ins, with the one under review filtered out", async () => {
    await POST(req(), params("ci-may"));

    const [, previous] = vi.mocked(generateCheckInSummary).mock.calls[0];
    expect(previous.map((ci) => ci.id)).toEqual(["ci-24-may"]);
  });
});
