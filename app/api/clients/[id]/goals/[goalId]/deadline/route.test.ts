import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { PUT } from "./route";

vi.mock("@/lib/rate-limit", () => ({ coachApiRateLimit: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/csrf-protection", () => ({ requireCSRFProtection: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/require-coach-auth", () => ({ requireCoachOwnsClient: vi.fn() }));
vi.mock("@/services/client-goals-service", () => ({ getGoalsOverview: vi.fn() }));
vi.mock("@/services/client-goal-writes-service", () => {
  class GoalWriteError extends Error {
    constructor(
      readonly code: string,
      message: string,
      readonly conflict: unknown = null
    ) {
      super(message);
    }
  }
  return { GoalWriteError, setGoalDeadline: vi.fn() };
});
vi.mock("@/services/today-service", () => ({ getClientTodayString: vi.fn() }));
vi.mock("@/services/audit-log-service", () => ({ recordAuditEvent: vi.fn().mockResolvedValue(undefined) }));

import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getGoalsOverview } from "@/services/client-goals-service";
import { GoalWriteError, setGoalDeadline } from "@/services/client-goal-writes-service";
import { getClientTodayString } from "@/services/today-service";
import { recordAuditEvent } from "@/services/audit-log-service";

const params = { params: Promise.resolve({ id: "client-4", goalId: "goal-9" }) };

function request(body: unknown) {
  return new NextRequest("http://localhost:3000/api/clients/client-4/goals/goal-9/deadline", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("PUT /api/clients/[id]/goals/[goalId]/deadline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({ authorized: true, coachId: "coach-6" });
    vi.mocked(getClientTodayString).mockResolvedValue("2026-09-22");
    vi.mocked(getGoalsOverview).mockResolvedValue({ current: null, planned: [], clientToday: "2026-10-07" });
  });

  it("records the deadline against the goal from the client's today and audits it", async () => {
    vi.mocked(setGoalDeadline).mockResolvedValue(true);
    const response = await PUT(request({ deadline: "2027-04-09" }), params);
    expect(response.status).toBe(200);
    expect(setGoalDeadline).toHaveBeenCalledWith({
      goalId: "goal-9",
      clientId: "client-4",
      today: "2026-09-22",
      setBy: "coach-6",
      deadline: "2027-04-09",
    });
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "goal.deadline", targetId: "goal-9" }));
  });

  it("takes null as no deadline", async () => {
    vi.mocked(setGoalDeadline).mockResolvedValue(true);
    await PUT(request({ deadline: null }), params);
    expect(setGoalDeadline).toHaveBeenCalledWith(expect.objectContaining({ deadline: null }));
  });

  it("audits nothing when the deadline was already that", async () => {
    vi.mocked(setGoalDeadline).mockResolvedValue(false);
    await PUT(request({ deadline: "2027-04-09" }), params);
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it("refuses a date that is not a date", async () => {
    expect((await PUT(request({ deadline: "9 April" }), params)).status).toBe(400);
    expect(setGoalDeadline).not.toHaveBeenCalled();
  });

  it("says an ended goal keeps its deadline", async () => {
    vi.mocked(setGoalDeadline).mockRejectedValue(new GoalWriteError("ended", "x"));
    const response = await PUT(request({ deadline: "2027-04-09" }), params);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("This goal has ended, so its deadline can't change.");
  });
});
