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
  return { HabitWriteError, changeHabit: vi.fn() };
});
vi.mock("@/services/today-service", () => ({ getClientTodayString: vi.fn() }));
vi.mock("@/services/audit-log-service", () => ({ recordAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/services/client-habit-figures-service", () => ({
  getCoachHabitList: vi.fn(),
  getCoachHabitWeek: vi.fn(),
  getCoachHabitWeekAndCurrent: vi.fn(),
}));

import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { changeHabit, HabitWriteError } from "@/services/client-habit-writes-service";
import { getClientTodayString } from "@/services/today-service";
import { recordAuditEvent } from "@/services/audit-log-service";
import { getCoachHabitList, getCoachHabitWeek, getCoachHabitWeekAndCurrent } from "@/services/client-habit-figures-service";
import type { CoachHabitWeek } from "@/types/habits";

const LIST = { clientToday: "2026-09-30", habits: [] };
const WEEK: CoachHabitWeek = {
  clientToday: "2026-09-30",
  start: "2026-10-08",
  end: "2026-10-14",
  dates: [],
  habits: [],
  totals: { planned: 0, done: 0, met: 0 },
  today: null,
};
const CURRENT_WEEK: CoachHabitWeek = { ...WEEK, start: "2026-09-24", end: "2026-09-30" };

const HABIT = "7c1a4d8e-2f3b-4c5d-8e9f-0a1b2c3d4e5f";
const params = (habitId = HABIT) => ({ params: Promise.resolve({ id: "client-2", habitId }) });

function request(body: unknown, query = "") {
  return new NextRequest(`http://localhost:3000/api/clients/client-2/habits/${HABIT}/change${query}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/clients/[id]/habits/[habitId]/change", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({ authorized: true, coachId: "coach-3" });
    vi.mocked(getClientTodayString).mockResolvedValue("2026-09-30");
    vi.mocked(getCoachHabitList).mockResolvedValue(LIST);
    vi.mocked(getCoachHabitWeek).mockResolvedValue(CURRENT_WEEK);
    vi.mocked(getCoachHabitWeekAndCurrent).mockResolvedValue({ week: WEEK, currentWeek: CURRENT_WEEK });
  });

  it("changes the target and days from the client's today, audits the change, and answers with the habits, the week named and the current week", async () => {
    vi.mocked(changeHabit).mockResolvedValue(true);
    const req = request({ target: 3.5, weekdays: ["monday", "friday"] }, "?week=2026-10-08");
    const response = await POST(req, params());
    expect(response.status).toBe(200);
    expect(requireCoachOwnsClient).toHaveBeenCalledWith("client-2", req);
    expect(await response.json()).toEqual({
      success: true,
      data: { changed: true, habits: LIST, week: WEEK, currentWeek: CURRENT_WEEK },
    });
    expect(getCoachHabitList).toHaveBeenCalledWith("client-2", "2026-09-30");
    expect(getCoachHabitWeekAndCurrent).toHaveBeenCalledWith("client-2", "2026-10-08", "2026-09-30");
    expect(changeHabit).toHaveBeenCalledWith({
      habitId: HABIT,
      clientId: "client-2",
      today: "2026-09-30",
      startsOn: "2026-09-30",
      createdBy: "coach-3",
      target: 3.5,
      schedule: { weekdays: ["monday", "friday"] },
    });
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "habit.change", targetId: HABIT, clientId: "client-2", metadata: { startsOn: "2026-09-30" } })
    );
  });

  it("starts from the day asked for, N times a week, and audits nothing when nothing changed", async () => {
    vi.mocked(changeHabit).mockResolvedValue(false);
    await POST(request({ startsOn: "2026-10-12", timesPerWeek: 3 }), params());
    expect(changeHabit).toHaveBeenCalledWith(
      expect.objectContaining({ startsOn: "2026-10-12", target: null, schedule: { timesPerWeek: 3 } })
    );
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it.each([
    ["both kinds of days", { weekdays: ["monday"], timesPerWeek: 2 }],
    ["neither kind of days", { target: 3 }],
    ["a target finer than two decimals", { target: 3.125, weekdays: ["monday"] }],
    ["a weekday twice", { weekdays: ["monday", "monday"] }],
    ["an unknown key", { weekdays: ["monday"], planned: true }],
    ["a day that does not exist", { startsOn: "2026-02-30", weekdays: ["monday"] }],
  ])("refuses %s before any write", async (_label, body) => {
    expect((await POST(request(body), params())).status).toBe(400);
    expect(changeHabit).not.toHaveBeenCalled();
  });

  it("refuses a week that is not a real day before any write", async () => {
    expect((await POST(request({ weekdays: ["monday"] }, "?week=next"), params())).status).toBe(400);
    expect(changeHabit).not.toHaveBeenCalled();
  });

  it("answers the change as saved, with neither the list nor the week, when reading them back fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(changeHabit).mockResolvedValue(true);
    vi.mocked(getCoachHabitWeek).mockRejectedValue(new Error("read failed"));
    const response = await POST(request({ weekdays: ["monday"] }), params());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { changed: true, habits: null, week: null, currentWeek: null } });
    spy.mockRestore();
  });

  it("says a change cannot start before today", async () => {
    vi.mocked(changeHabit).mockRejectedValue(new HabitWriteError("starts_in_past", "x"));
    const response = await POST(request({ startsOn: "2026-09-29", weekdays: ["monday"] }), params());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "starts_in_past", error: "Pick today or a later day to start from." });
  });

  it("says a number habit needs a target", async () => {
    vi.mocked(changeHabit).mockRejectedValue(new HabitWriteError("target_required", "x"));
    const response = await POST(request({ weekdays: ["monday"] }), params());
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("A number habit needs a target.");
  });

  it("answers another client's habit, or no habit at all, as not found", async () => {
    vi.mocked(changeHabit).mockRejectedValue(new HabitWriteError("not_found", "x"));
    expect((await POST(request({ weekdays: ["monday"] }), params())).status).toBe(404);
    vi.mocked(changeHabit).mockClear();
    expect((await POST(request({ weekdays: ["monday"] }), params("not-a-habit"))).status).toBe(404);
    expect(changeHabit).not.toHaveBeenCalled();
  });

  it("changes nothing for another coach's client", async () => {
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({
      authorized: false,
      response: NextResponse.json({ error: "Client not found" }, { status: 404 }),
    });
    expect((await POST(request({ weekdays: ["monday"] }), params())).status).toBe(404);
    expect(changeHabit).not.toHaveBeenCalled();
  });

  it("stops at the rate limit and at a failed CSRF check, before the coach is read", async () => {
    vi.mocked(coachApiRateLimit).mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await POST(request({ weekdays: ["monday"] }), params())).status).toBe(429);
    vi.mocked(requireCSRFProtection).mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await POST(request({ weekdays: ["monday"] }), params())).status).toBe(403);
    expect(requireCoachOwnsClient).not.toHaveBeenCalled();
  });
});
