import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET, POST, PUT } from "./route";

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
  return { GoalWriteError, addGoal: vi.fn(), saveDetailsSheetGoal: vi.fn() };
});
vi.mock("@/services/today-service", () => ({ getClientTodayString: vi.fn() }));
vi.mock("@/services/audit-log-service", () => ({ recordAuditEvent: vi.fn().mockResolvedValue(undefined) }));

import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getGoalsOverview } from "@/services/client-goals-service";
import { addGoal, GoalWriteError, saveDetailsSheetGoal } from "@/services/client-goal-writes-service";
import { getClientTodayString } from "@/services/today-service";
import { recordAuditEvent } from "@/services/audit-log-service";

const params = { params: Promise.resolve({ id: "client-1" }) };
const OVERVIEW = { current: { id: "goal-now", name: "Lose weight" }, planned: [] };

function request(method: string, body?: unknown) {
  return new NextRequest("http://localhost:3000/api/clients/client-1/goals", {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
  });
}

describe("/api/clients/[id]/goals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({ authorized: true, coachId: "coach-1" });
    vi.mocked(getClientTodayString).mockResolvedValue("2026-09-22");
    vi.mocked(getGoalsOverview).mockResolvedValue(OVERVIEW as never);
  });

  describe("GET", () => {
    it("answers today's goal and the planned ones, uncached", async () => {
      const response = await GET(request("GET"), params);
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toEqual({ success: true, data: OVERVIEW });
      expect(requireCoachOwnsClient).toHaveBeenCalledWith("client-1", expect.anything());
    });

    it("reads nothing for another coach's client", async () => {
      vi.mocked(requireCoachOwnsClient).mockResolvedValue({
        authorized: false,
        response: NextResponse.json({ error: "Client not found" }, { status: 404 }),
      });
      expect((await GET(request("GET"), params)).status).toBe(404);
      expect(getGoalsOverview).not.toHaveBeenCalled();
    });

    it("fails loudly when the read fails", async () => {
      vi.mocked(getGoalsOverview).mockRejectedValue(new Error("down"));
      expect((await GET(request("GET"), params)).status).toBe(500);
    });
  });

  describe("POST", () => {
    it("sets a goal from the client's today, named from its type, and audits it", async () => {
      vi.mocked(addGoal).mockResolvedValue("goal-new");
      const response = await POST(request("POST", { type: "build_muscle", targetWeight: 84.6 }), params);
      expect(response.status).toBe(201);
      expect(addGoal).toHaveBeenCalledWith({
        clientId: "client-1",
        today: "2026-09-22",
        startsOn: "2026-09-22",
        source: "coach",
        setBy: "coach-1",
        type: "build_muscle",
        name: "Build muscle",
        targetWeight: 84.6,
        targetBodyFatPercentage: null,
        description: null,
        deadline: null,
      });
      expect(recordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "goal.create",
          targetId: "goal-new",
          clientId: "client-1",
          metadata: { startsOn: "2026-09-22", planned: false },
        })
      );
    });

    it("plans a goal from a later day under the coach's name for it", async () => {
      vi.mocked(addGoal).mockResolvedValue("goal-planned");
      await POST(request("POST", { type: "recomposition", name: "Summer recomp", startsOn: "2026-10-26" }), params);
      expect(addGoal).toHaveBeenCalledWith(
        expect.objectContaining({ startsOn: "2026-10-26", name: "Summer recomp" })
      );
      expect(recordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { startsOn: "2026-10-26", planned: true } })
      );
    });

    it("refuses a type that is not one of the six before writing", async () => {
      const response = await POST(request("POST", { type: "fat_loss" }), params);
      expect(response.status).toBe(400);
      expect(addGoal).not.toHaveBeenCalled();
    });

    it("stops at the CSRF check", async () => {
      vi.mocked(requireCSRFProtection).mockResolvedValueOnce(
        NextResponse.json({ error: "Forbidden" }, { status: 403 })
      );
      expect((await POST(request("POST", { type: "maintain" }), params)).status).toBe(403);
      expect(requireCoachOwnsClient).not.toHaveBeenCalled();
    });

    it("answers a deadline guard with the sentence and the fixes", async () => {
      vi.mocked(addGoal).mockRejectedValue(
        new GoalWriteError("deadline_after_next", "{}", { goalId: "goal-peak", name: "Peak", startsOn: "2026-11-09" })
      );
      const response = await POST(
        request("POST", { type: "lose_weight", targetWeight: 70.8, deadline: "2026-11-20" }),
        params
      );
      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error).toBe("The deadline runs into Peak, which starts 9 Nov. Move Peak to 21 Nov or delete it.");
      expect(body.fixes).toHaveLength(2);
      expect(recordAuditEvent).not.toHaveBeenCalled();
    });
  });

  describe("PUT (the details sheet)", () => {
    it("saves the sheet's changed fields and audits what the save did", async () => {
      vi.mocked(saveDetailsSheetGoal).mockResolvedValue({ wrote: "deadline", goalId: "goal-now" });
      const response = await PUT(request("PUT", { goalDeadline: "2027-03-12" }), params);
      expect(response.status).toBe(200);
      expect(saveDetailsSheetGoal).toHaveBeenCalledWith("client-1", { goalDeadline: "2027-03-12" }, "coach-1");
      expect(recordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: "goal.deadline", targetId: "goal-now" })
      );
    });

    it("audits a new goal as a create and a corrected one as an update", async () => {
      vi.mocked(saveDetailsSheetGoal).mockResolvedValueOnce({ wrote: "create", goalId: "goal-a" });
      await PUT(request("PUT", { goalWeight: 77.7 }), params);
      vi.mocked(saveDetailsSheetGoal).mockResolvedValueOnce({ wrote: "edit", goalId: "goal-b" });
      await PUT(request("PUT", { goalWeight: 77.9 }), params);
      expect(vi.mocked(recordAuditEvent).mock.calls.map(([event]) => event.action)).toEqual([
        "goal.create",
        "goal.update",
      ]);
    });

    it("audits nothing when nothing was written", async () => {
      vi.mocked(saveDetailsSheetGoal).mockResolvedValue({ wrote: "nothing", goalId: "goal-now" });
      await PUT(request("PUT", { goalBodyFatPercentage: 14 }), params);
      expect(recordAuditEvent).not.toHaveBeenCalled();
    });

    it("refuses an empty body", async () => {
      expect((await PUT(request("PUT", {}), params)).status).toBe(400);
      expect(saveDetailsSheetGoal).not.toHaveBeenCalled();
    });
  });
});
