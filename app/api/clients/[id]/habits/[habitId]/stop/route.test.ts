import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { POST } from "./route";

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
  return { HabitWriteError, stopHabit: vi.fn() };
});
vi.mock("@/services/today-service", () => ({ getClientTodayString: vi.fn() }));
vi.mock("@/services/audit-log-service", () => ({ recordAuditEvent: vi.fn().mockResolvedValue(undefined) }));

import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { HabitWriteError, stopHabit } from "@/services/client-habit-writes-service";
import { getClientTodayString } from "@/services/today-service";
import { recordAuditEvent } from "@/services/audit-log-service";

const HABIT = "7c1a4d8e-2f3b-4c5d-8e9f-0a1b2c3d4e5f";
const params = { params: Promise.resolve({ id: "client-2", habitId: HABIT }) };
const request = (body: unknown) =>
  new NextRequest(`http://localhost:3000/api/clients/client-2/habits/${HABIT}/stop`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

describe("POST /api/clients/[id]/habits/[habitId]/stop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({ authorized: true, coachId: "coach-3" });
    vi.mocked(getClientTodayString).mockResolvedValue("2026-09-30");
  });

  it("stops from the client's today when no day is given, and audits it", async () => {
    vi.mocked(stopHabit).mockResolvedValue(true);
    const req = request({});
    const response = await POST(req, params);
    expect(requireCoachOwnsClient).toHaveBeenCalledWith("client-2", req);
    expect(await response.json()).toEqual({ success: true, data: { changed: true } });
    expect(stopHabit).toHaveBeenCalledWith({ habitId: HABIT, clientId: "client-2", today: "2026-09-30", stopsOn: "2026-09-30" });
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "habit.stop", targetId: HABIT, metadata: { stopsOn: "2026-09-30" } })
    );
  });

  it("stops from a later day, and audits nothing when it was already stopped", async () => {
    vi.mocked(stopHabit).mockResolvedValue(false);
    await POST(request({ stopsOn: "2026-10-12" }), params);
    expect(stopHabit).toHaveBeenCalledWith(expect.objectContaining({ stopsOn: "2026-10-12" }));
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it("refuses a malformed day or an unknown key before any write", async () => {
    expect((await POST(request({ stopsOn: "12/10/2026" }), params)).status).toBe(400);
    expect((await POST(request({ stopsOn: "2026-10-12", reason: "x" }), params)).status).toBe(400);
    expect(stopHabit).not.toHaveBeenCalled();
  });

  it("says a habit cannot stop before today", async () => {
    vi.mocked(stopHabit).mockRejectedValue(new HabitWriteError("stops_in_past", "x"));
    const response = await POST(request({ stopsOn: "2026-09-29" }), params);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("Pick today or a later day to stop from.");
  });

  it("answers another client's habit, or a path naming no habit, as not found", async () => {
    vi.mocked(stopHabit).mockRejectedValue(new HabitWriteError("not_found", "x"));
    expect((await POST(request({}), params)).status).toBe(404);
    vi.mocked(stopHabit).mockClear();
    const noHabit = { params: Promise.resolve({ id: "client-2", habitId: "habit-1" }) };
    expect((await POST(request({}), noHabit)).status).toBe(404);
    expect(stopHabit).not.toHaveBeenCalled();
  });

  it("stops nothing for another coach's client, or without the CSRF check", async () => {
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({
      authorized: false,
      response: NextResponse.json({ error: "Client not found" }, { status: 404 }),
    });
    expect((await POST(request({}), params)).status).toBe(404);
    vi.mocked(requireCSRFProtection).mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await POST(request({}), params)).status).toBe(403);
    expect(stopHabit).not.toHaveBeenCalled();
  });

  it("stops at the rate limit before the coach is read", async () => {
    vi.mocked(coachApiRateLimit).mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await POST(request({}), params)).status).toBe(429);
    expect(requireCoachOwnsClient).not.toHaveBeenCalled();
  });
});
