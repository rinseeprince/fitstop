import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { DELETE, PATCH } from "./route";

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
  return { GoalWriteError, editGoal: vi.fn(), deleteGoal: vi.fn() };
});
vi.mock("@/services/goal-undo-token", () => ({ signGoalUndo: vi.fn() }));
vi.mock("@/services/today-service", () => ({ getClientTodayString: vi.fn() }));
vi.mock("@/services/audit-log-service", () => ({ recordAuditEvent: vi.fn().mockResolvedValue(undefined) }));

import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getGoalsOverview } from "@/services/client-goals-service";
import { deleteGoal, editGoal, GoalWriteError } from "@/services/client-goal-writes-service";
import { signGoalUndo } from "@/services/goal-undo-token";
import { getClientTodayString } from "@/services/today-service";
import { recordAuditEvent } from "@/services/audit-log-service";

const params = { params: Promise.resolve({ id: "client-2", goalId: "goal-5" }) };
const EDIT = {
  type: "event_prep",
  name: "Race day",
  targetWeight: 66.4,
  targetBodyFatPercentage: null,
  description: "Half marathon",
  startsOn: "2026-10-03",
  deadline: "2026-12-13",
};

function request(method: string, body?: unknown) {
  return new NextRequest("http://localhost:3000/api/clients/client-2/goals/goal-5", {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
  });
}

describe("/api/clients/[id]/goals/[goalId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({ authorized: true, coachId: "coach-3" });
    vi.mocked(getClientTodayString).mockResolvedValue("2026-09-22");
    vi.mocked(getGoalsOverview).mockResolvedValue({ current: null, planned: [], previous: null, clientToday: "2026-10-07" });
  });

  describe("PATCH", () => {
    it("rewrites the goal whole against the client's today and audits a change", async () => {
      vi.mocked(editGoal).mockResolvedValue(true);
      const response = await PATCH(request("PATCH", EDIT), params);
      expect(response.status).toBe(200);
      expect(editGoal).toHaveBeenCalledWith({
        goalId: "goal-5",
        clientId: "client-2",
        today: "2026-09-22",
        setBy: "coach-3",
        ...EDIT,
      });
      expect(recordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: "goal.update", targetId: "goal-5", metadata: { startsOn: "2026-10-03" } })
      );
    });

    it("audits nothing when nothing changed", async () => {
      vi.mocked(editGoal).mockResolvedValue(false);
      await PATCH(request("PATCH", EDIT), params);
      expect(recordAuditEvent).not.toHaveBeenCalled();
    });

    it("asks for every field — a missing one is refused before any write", async () => {
      const { deadline: _deadline, ...partial } = EDIT;
      expect((await PATCH(request("PATCH", partial), params)).status).toBe(400);
      expect(editGoal).not.toHaveBeenCalled();
    });

    it("says a started goal changes only its deadline and name", async () => {
      vi.mocked(editGoal).mockRejectedValue(new GoalWriteError("started", "x"));
      const response = await PATCH(request("PATCH", EDIT), params);
      expect(response.status).toBe(409);
      expect((await response.json()).code).toBe("started");
    });

    it("offers to end the previous goal's deadline when a planned start runs into it", async () => {
      vi.mocked(editGoal).mockRejectedValue(
        new GoalWriteError("previous_deadline", "{}", { goalId: "goal-4", name: "Cut", deadline: "2026-10-17" })
      );
      const body = await (await PATCH(request("PATCH", EDIT), params)).json();
      expect(body.fixes).toEqual([{ kind: "end_deadline", goalId: "goal-4", name: "Cut", deadline: "2026-10-02" }]);
    });
  });

  describe("DELETE", () => {
    it("deletes the goal and hands back a signed copy for the undo", async () => {
      const copy = { goal: { id: "goal-5" }, deadlines: [] };
      vi.mocked(deleteGoal).mockResolvedValue(copy);
      vi.mocked(signGoalUndo).mockReturnValue({ token: "signed.copy", expiresAt: "2026-09-22T18:30:30.000Z" });
      const response = await DELETE(request("DELETE"), params);
      expect(response.status).toBe(200);
      expect(deleteGoal).toHaveBeenCalledWith({ goalId: "goal-5", clientId: "client-2" });
      expect(signGoalUndo).toHaveBeenCalledWith("client-2", copy);
      expect((await response.json()).data).toMatchObject({
        undo: "signed.copy",
        undoExpiresAt: "2026-09-22T18:30:30.000Z",
      });
      expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "goal.delete", targetId: "goal-5" }));
    });

    it("answers another client's goal as not found", async () => {
      vi.mocked(deleteGoal).mockRejectedValue(new GoalWriteError("not_found", "x"));
      expect((await DELETE(request("DELETE"), params)).status).toBe(404);
      expect(signGoalUndo).not.toHaveBeenCalled();
    });

    it("deletes nothing for another coach's client", async () => {
      vi.mocked(requireCoachOwnsClient).mockResolvedValue({
        authorized: false,
        response: NextResponse.json({ error: "Client not found" }, { status: 404 }),
      });
      expect((await DELETE(request("DELETE"), params)).status).toBe(404);
      expect(deleteGoal).not.toHaveBeenCalled();
    });
  });
});
