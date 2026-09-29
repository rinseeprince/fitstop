import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { DELETE, PUT } from "./route";

vi.mock("@/lib/rate-limit", () => ({ coachApiRateLimit: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/csrf-protection", () => ({ requireCSRFProtection: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/require-coach-auth", () => ({ requireCoachOwnsClient: vi.fn() }));
vi.mock("@/services/client-habit-writes-service", () => {
  class HabitWriteError extends Error {
    constructor(
      readonly code: string,
      message: string
    ) {
      super(message);
    }
  }
  return { HabitWriteError, setHabitDay: vi.fn(), resetHabitDay: vi.fn() };
});
vi.mock("@/services/today-service", () => ({ getClientTodayString: vi.fn() }));
vi.mock("@/services/audit-log-service", () => ({ recordAuditEvent: vi.fn().mockResolvedValue(undefined) }));

import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import {
  HabitWriteError,
  resetHabitDay,
  setHabitDay,
  type HabitRefusalCode,
} from "@/services/client-habit-writes-service";
import { getClientTodayString } from "@/services/today-service";
import { recordAuditEvent } from "@/services/audit-log-service";

const HABIT = "7c1a4d8e-2f3b-4c5d-8e9f-0a1b2c3d4e5f";
const params = (date = "2026-10-07", habitId = HABIT) => ({ params: Promise.resolve({ id: "client-2", habitId, date }) });
const request = (method: "PUT" | "DELETE", body?: unknown) =>
  new NextRequest(`http://localhost:3000/api/clients/client-2/habits/${HABIT}/days/2026-10-07`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
  });

describe("/api/clients/[id]/habits/[habitId]/days/[date]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({ authorized: true, coachId: "coach-3" });
    vi.mocked(getClientTodayString).mockResolvedValue("2026-09-30");
  });

  describe("PUT", () => {
    it("sets the date's edit against the client's today, and audits it", async () => {
      vi.mocked(setHabitDay).mockResolvedValue(true);
      const req = request("PUT", { planned: true, target: 2.5 });
      const response = await PUT(req, params());
      expect(await response.json()).toEqual({ success: true, data: { changed: true } });
      expect(requireCoachOwnsClient).toHaveBeenCalledWith("client-2", req);
      expect(setHabitDay).toHaveBeenCalledWith({
        habitId: HABIT,
        clientId: "client-2",
        today: "2026-09-30",
        date: "2026-10-07",
        planned: true,
        target: 2.5,
        coachId: "coach-3",
      });
      expect(recordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: "habit.day_edit", targetId: HABIT, metadata: { date: "2026-10-07", planned: true } })
      );
    });

    it("takes a day off with no target, and audits nothing when the day already read so", async () => {
      vi.mocked(setHabitDay).mockResolvedValue(false);
      await PUT(request("PUT", { planned: false }), params());
      expect(setHabitDay).toHaveBeenCalledWith(expect.objectContaining({ planned: false, target: null }));
      expect(recordAuditEvent).not.toHaveBeenCalled();
    });

    it.each([
      ["a day off with a target", { planned: false, target: 2 }],
      ["no answer to planned", { target: 2 }],
      ["an unknown key", { planned: true, note: "x" }],
    ])("refuses %s before any write", async (_label, body) => {
      expect((await PUT(request("PUT", body), params())).status).toBe(400);
      expect(setHabitDay).not.toHaveBeenCalled();
    });

    it("refuses a date that does not exist, and a path that names no habit", async () => {
      expect((await PUT(request("PUT", { planned: true }), params("2026-13-01"))).status).toBe(400);
      expect((await PUT(request("PUT", { planned: true }), params("2026-10-07", "habit-1"))).status).toBe(404);
      expect(setHabitDay).not.toHaveBeenCalled();
    });

    it.each<[HabitRefusalCode, number, string]>([
      ["day_in_past", 409, "This day has passed, so it can't be changed."],
      ["not_running", 409, "That habit isn't running on that day."],
      ["weekly_version", 409, "This habit is done a number of times a week, so it has no set days to change."],
      ["target_not_allowed", 400, "A tick habit has no target."],
      ["not_found", 404, "Habit not found."],
    ])("says %s in its sentence", async (code, status, sentence) => {
      vi.mocked(setHabitDay).mockRejectedValue(new HabitWriteError(code, "x"));
      const response = await PUT(request("PUT", { planned: true }), params());
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ code, error: sentence });
    });

    it("edits nothing for another coach's client, or over the rate limit", async () => {
      vi.mocked(requireCoachOwnsClient).mockResolvedValue({
        authorized: false,
        response: NextResponse.json({ error: "Client not found" }, { status: 404 }),
      });
      expect((await PUT(request("PUT", { planned: true }), params())).status).toBe(404);
      vi.mocked(coachApiRateLimit).mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
      expect((await PUT(request("PUT", { planned: true }), params())).status).toBe(429);
      expect(setHabitDay).not.toHaveBeenCalled();
    });

    it("stops at a failed CSRF check, on the edit and on the reset, before the coach is read", async () => {
      vi.mocked(requireCSRFProtection).mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
      expect((await PUT(request("PUT", { planned: true }), params())).status).toBe(403);
      vi.mocked(requireCSRFProtection).mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
      expect((await DELETE(request("DELETE"), params())).status).toBe(403);
      expect(requireCoachOwnsClient).not.toHaveBeenCalled();
      expect(setHabitDay).not.toHaveBeenCalled();
      expect(resetHabitDay).not.toHaveBeenCalled();
    });
  });

  describe("DELETE", () => {
    it("resets the date against the client's today, and audits a reset that removed an edit", async () => {
      vi.mocked(resetHabitDay).mockResolvedValue(true);
      const response = await DELETE(request("DELETE"), params());
      expect(await response.json()).toEqual({ success: true, data: { changed: true } });
      expect(resetHabitDay).toHaveBeenCalledWith({ habitId: HABIT, clientId: "client-2", today: "2026-09-30", date: "2026-10-07" });
      expect(recordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: "habit.day_edit", metadata: { date: "2026-10-07", reset: true } })
      );
    });

    it("audits nothing when there was no edit, and says a past day stays", async () => {
      vi.mocked(resetHabitDay).mockResolvedValue(false);
      await DELETE(request("DELETE"), params());
      expect(recordAuditEvent).not.toHaveBeenCalled();
      vi.mocked(resetHabitDay).mockRejectedValue(new HabitWriteError("day_in_past", "x"));
      expect((await DELETE(request("DELETE"), params("2026-09-29"))).status).toBe(409);
    });
  });
});
