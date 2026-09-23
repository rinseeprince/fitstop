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
  return { GoalWriteError, renameGoal: vi.fn() };
});
vi.mock("@/services/audit-log-service", () => ({ recordAuditEvent: vi.fn().mockResolvedValue(undefined) }));

import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getGoalsOverview } from "@/services/client-goals-service";
import { renameGoal } from "@/services/client-goal-writes-service";
import { recordAuditEvent } from "@/services/audit-log-service";

const params = { params: Promise.resolve({ id: "client-5", goalId: "goal-11" }) };

function request(body: unknown) {
  return new NextRequest("http://localhost:3000/api/clients/client-5/goals/goal-11/name", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("PUT /api/clients/[id]/goals/[goalId]/name", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({ authorized: true, coachId: "coach-8" });
    vi.mocked(getGoalsOverview).mockResolvedValue({ current: null, planned: [], clientToday: "2026-10-07" });
  });

  it("renames the goal and its description, trimmed, and audits it", async () => {
    vi.mocked(renameGoal).mockResolvedValue(true);
    const response = await PUT(request({ name: "  Off-season build ", description: "Add size" }), params);
    expect(response.status).toBe(200);
    expect(renameGoal).toHaveBeenCalledWith({
      goalId: "goal-11",
      clientId: "client-5",
      name: "Off-season build",
      description: "Add size",
    });
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "goal.rename", targetId: "goal-11" }));
  });

  it("refuses a blank name before writing", async () => {
    expect((await PUT(request({ name: "   ", description: null }), params)).status).toBe(400);
    expect(renameGoal).not.toHaveBeenCalled();
  });

  it("audits nothing when the labels were already those", async () => {
    vi.mocked(renameGoal).mockResolvedValue(false);
    await PUT(request({ name: "Off-season build", description: null }), params);
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });
});
