import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { DELETE, PATCH } from "./route";

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
  return { HabitWriteError, renameHabit: vi.fn(), deleteHabit: vi.fn() };
});
vi.mock("@/services/client-habit-figures-service", () => ({
  getCoachHabitList: vi.fn(),
  getCoachHabitWeek: vi.fn(),
  getCoachHabitWeekAndCurrent: vi.fn(),
}));
vi.mock("@/services/today-service", () => ({ getClientTodayString: vi.fn() }));
vi.mock("@/services/audit-log-service", () => ({ recordAuditEvent: vi.fn().mockResolvedValue(undefined) }));

import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { deleteHabit, HabitWriteError, renameHabit } from "@/services/client-habit-writes-service";
import { getCoachHabitList, getCoachHabitWeek, getCoachHabitWeekAndCurrent } from "@/services/client-habit-figures-service";
import { getClientTodayString } from "@/services/today-service";
import { recordAuditEvent } from "@/services/audit-log-service";
import type { CoachHabitWeek } from "@/types/habits";

const HABIT = "7c1a4d8e-2f3b-4c5d-8e9f-0a1b2c3d4e5f";
// The client's today, a day ahead of the server's: the delete must take the client's.
const CLIENT_TODAY = "2026-10-01";
const LIST = { clientToday: CLIENT_TODAY, habits: [] };
const WEEK: CoachHabitWeek = {
  clientToday: CLIENT_TODAY,
  start: "2026-10-01",
  end: "2026-10-07",
  dates: [],
  habits: [],
  totals: { planned: 0, done: 0, met: 0 },
  today: null,
};
const NEXT_WEEK: CoachHabitWeek = { ...WEEK, start: "2026-10-08", end: "2026-10-14" };
const params = (habitId = HABIT) => ({ params: Promise.resolve({ id: "client-2", habitId }) });

function request(method: "PATCH" | "DELETE", body?: unknown, query = "") {
  return new NextRequest(`http://localhost:3000/api/clients/client-2/habits/${HABIT}${query}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireCoachOwnsClient).mockResolvedValue({ authorized: true, coachId: "coach-3" });
  vi.mocked(getCoachHabitList).mockResolvedValue(LIST);
  vi.mocked(getCoachHabitWeek).mockResolvedValue(WEEK);
  vi.mocked(getCoachHabitWeekAndCurrent).mockResolvedValue({ week: NEXT_WEEK, currentWeek: WEEK });
  vi.mocked(getClientTodayString).mockResolvedValue(CLIENT_TODAY);
});

const foreign = () =>
  vi.mocked(requireCoachOwnsClient).mockResolvedValue({
    authorized: false,
    response: NextResponse.json({ error: "Client not found" }, { status: 404 }),
  });

describe("PATCH /api/clients/[id]/habits/[habitId]", () => {
  it("renames the habit, audits it, and answers with the habits and the week named as they now stand", async () => {
    vi.mocked(renameHabit).mockResolvedValue(true);
    const req = request("PATCH", { name: " Water ", howTo: "  A glass with each meal " }, "?week=2026-10-08");
    const response = await PATCH(req, params());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: { changed: true, habits: LIST, week: NEXT_WEEK, currentWeek: WEEK },
    });
    expect(requireCoachOwnsClient).toHaveBeenCalledWith("client-2", req);
    expect(renameHabit).toHaveBeenCalledWith({ habitId: HABIT, clientId: "client-2", name: "Water", howTo: "A glass with each meal" });
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "habit.rename", targetTable: "client_habits", targetId: HABIT, clientId: "client-2", actorId: "coach-3" })
    );
    // The client's today, read once beside the rename, serves both reads of the answer.
    expect(getClientTodayString).toHaveBeenCalledTimes(1);
    expect(getCoachHabitList).toHaveBeenCalledWith("client-2", CLIENT_TODAY);
    expect(getCoachHabitWeekAndCurrent).toHaveBeenCalledWith("client-2", "2026-10-08", CLIENT_TODAY);
  });

  it("refuses a week that is not a real day before any write", async () => {
    expect((await PATCH(request("PATCH", { name: "Water", howTo: null }, "?week=someday"), params())).status).toBe(400);
    expect(renameHabit).not.toHaveBeenCalled();
  });

  it("clears the how-to on null or an empty one, and audits nothing when nothing changed", async () => {
    vi.mocked(renameHabit).mockResolvedValue(false);
    await PATCH(request("PATCH", { name: "Water", howTo: "   " }), params());
    expect(renameHabit).toHaveBeenCalledWith(expect.objectContaining({ howTo: null }));
    await PATCH(request("PATCH", { name: "Water", howTo: null }), params());
    expect(renameHabit).toHaveBeenLastCalledWith(expect.objectContaining({ howTo: null }));
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it.each([
    ["no name", { name: "  ", howTo: null }],
    ["no how-to key: both labels are sent", { name: "Water" }],
    ["a how-to past 500 characters", { name: "Water", howTo: "x".repeat(501) }],
    ["a target: a rename changes labels alone", { name: "Water", howTo: null, target: 4 }],
  ])("refuses %s before any write", async (_label, body) => {
    expect((await PATCH(request("PATCH", body), params())).status).toBe(400);
    expect(renameHabit).not.toHaveBeenCalled();
  });

  it("answers another client's habit, or no habit at all, as not found", async () => {
    vi.mocked(renameHabit).mockRejectedValue(new HabitWriteError("not_found", "x"));
    const response = await PATCH(request("PATCH", { name: "Water", howTo: null }), params());
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Habit not found.");
    vi.mocked(renameHabit).mockClear();
    expect((await PATCH(request("PATCH", { name: "Water", howTo: null }), params("not-a-habit"))).status).toBe(404);
    expect(renameHabit).not.toHaveBeenCalled();
  });

  it("renames nothing for another coach's client", async () => {
    foreign();
    expect((await PATCH(request("PATCH", { name: "Water", howTo: null }), params())).status).toBe(404);
    expect(renameHabit).not.toHaveBeenCalled();
  });

  it("stops at the rate limit and at a failed CSRF check, before the coach is read", async () => {
    vi.mocked(coachApiRateLimit).mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await PATCH(request("PATCH", { name: "Water", howTo: null }), params())).status).toBe(429);
    vi.mocked(requireCSRFProtection).mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await PATCH(request("PATCH", { name: "Water", howTo: null }), params())).status).toBe(403);
    expect(requireCoachOwnsClient).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/clients/[id]/habits/[habitId]", () => {
  it("deletes the habit from the client's today, audits it, and answers with the habits and the week as they now stand", async () => {
    vi.mocked(deleteHabit).mockResolvedValue(undefined);
    const req = request("DELETE");
    const response = await DELETE(req, params());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { changed: true, habits: LIST, week: WEEK, currentWeek: null } });
    expect(requireCoachOwnsClient).toHaveBeenCalledWith("client-2", req);
    expect(getClientTodayString).toHaveBeenCalledWith("client-2");
    expect(deleteHabit).toHaveBeenCalledWith({ habitId: HABIT, clientId: "client-2", today: CLIENT_TODAY });
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "habit.delete", targetTable: "client_habits", targetId: HABIT, clientId: "client-2" })
    );
    expect(getCoachHabitList).toHaveBeenCalledWith("client-2", CLIENT_TODAY);
    expect(getCoachHabitWeek).toHaveBeenCalledWith("client-2", undefined, CLIENT_TODAY);
  });

  it("refuses a week that is not a real day before anything is deleted", async () => {
    expect((await DELETE(request("DELETE", undefined, "?week=2026-02-30"), params())).status).toBe(400);
    expect(deleteHabit).not.toHaveBeenCalled();
  });

  it("answers another client's habit, a deleted one, or no habit at all, as not found, and audits nothing", async () => {
    vi.mocked(deleteHabit).mockRejectedValue(new HabitWriteError("not_found", "x"));
    expect((await DELETE(request("DELETE"), params())).status).toBe(404);
    expect(recordAuditEvent).not.toHaveBeenCalled();
    vi.mocked(deleteHabit).mockClear();
    expect((await DELETE(request("DELETE"), params("not-a-habit"))).status).toBe(404);
    expect(deleteHabit).not.toHaveBeenCalled();
  });

  it("deletes nothing for another coach's client", async () => {
    foreign();
    expect((await DELETE(request("DELETE"), params())).status).toBe(404);
    expect(deleteHabit).not.toHaveBeenCalled();
  });

  it("stops at the rate limit and at a failed CSRF check, before the coach is read", async () => {
    vi.mocked(coachApiRateLimit).mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await DELETE(request("DELETE"), params())).status).toBe(429);
    vi.mocked(requireCSRFProtection).mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await DELETE(request("DELETE"), params())).status).toBe(403);
    expect(requireCoachOwnsClient).not.toHaveBeenCalled();
  });

  it("answers the delete as saved, with neither the list nor the week, when reading them back fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(deleteHabit).mockResolvedValue(undefined);
    vi.mocked(getCoachHabitWeek).mockRejectedValue(new Error("read failed"));
    const response = await DELETE(request("DELETE"), params());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { changed: true, habits: null, week: null, currentWeek: null } });
    spy.mockRestore();
  });
});
