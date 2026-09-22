import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

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
  return { GoalWriteError, restoreGoal: vi.fn() };
});
vi.mock("@/services/goal-undo-token", () => ({ readGoalUndo: vi.fn() }));
vi.mock("@/services/audit-log-service", () => ({ recordAuditEvent: vi.fn().mockResolvedValue(undefined) }));

import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getGoalsOverview } from "@/services/client-goals-service";
import { GoalWriteError, restoreGoal } from "@/services/client-goal-writes-service";
import { readGoalUndo } from "@/services/goal-undo-token";
import { recordAuditEvent } from "@/services/audit-log-service";

const params = { params: Promise.resolve({ id: "client-6" }) };
const COPY = { goal: { id: "goal-13" }, deadlines: [] };

function request(body: unknown) {
  return new NextRequest("http://localhost:3000/api/clients/client-6/goals/restore", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/clients/[id]/goals/restore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({ authorized: true, coachId: "coach-10" });
    vi.mocked(getGoalsOverview).mockResolvedValue({ current: null, planned: [] });
  });

  it("puts back the signed copy for this client and audits it", async () => {
    vi.mocked(readGoalUndo).mockReturnValue({ ok: true, copy: COPY });
    vi.mocked(restoreGoal).mockResolvedValue("goal-13");
    const response = await POST(request({ undo: "payload.signature" }), params);
    expect(response.status).toBe(200);
    expect(readGoalUndo).toHaveBeenCalledWith("payload.signature", "client-6");
    expect(restoreGoal).toHaveBeenCalledWith({ clientId: "client-6", copy: COPY });
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "goal.restore", targetId: "goal-13" }));
  });

  it("refuses a copy it did not sign, or signed for another client", async () => {
    vi.mocked(readGoalUndo).mockReturnValueOnce({ ok: false, reason: "invalid" });
    expect((await POST(request({ undo: "forged.copy" }), params)).status).toBe(400);
    vi.mocked(readGoalUndo).mockReturnValueOnce({ ok: false, reason: "foreign" });
    expect((await POST(request({ undo: "other.client" }), params)).status).toBe(400);
    expect(restoreGoal).not.toHaveBeenCalled();
  });

  it("says when it is too late to undo", async () => {
    vi.mocked(readGoalUndo).mockReturnValue({ ok: false, reason: "expired" });
    const response = await POST(request({ undo: "late.copy" }), params);
    expect(response.status).toBe(410);
    expect((await response.json()).error).toBe("Too late to undo — set the goal again instead.");
    expect(restoreGoal).not.toHaveBeenCalled();
  });

  it("answers a goal now starting on the same day as a conflict", async () => {
    vi.mocked(readGoalUndo).mockReturnValue({ ok: true, copy: COPY });
    vi.mocked(restoreGoal).mockRejectedValue(new GoalWriteError("day_taken", "x"));
    expect((await POST(request({ undo: "payload.signature" }), params)).status).toBe(409);
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });
});
