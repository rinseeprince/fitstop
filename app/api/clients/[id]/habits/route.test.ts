import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET, POST } from "./route";

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
  return { HabitWriteError, addHabits: vi.fn() };
});
vi.mock("@/services/client-habit-figures-service", () => ({
  getCoachHabitList: vi.fn(),
  getCoachHabitWeek: vi.fn(),
  getCoachHabitWeekAndCurrent: vi.fn(),
}));
vi.mock("@/services/today-service", () => ({ getClientTodayString: vi.fn() }));
vi.mock("@/services/audit-log-service", () => ({ recordAuditEvents: vi.fn().mockResolvedValue(undefined) }));

import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { addHabits, HabitWriteError } from "@/services/client-habit-writes-service";
import { getCoachHabitList, getCoachHabitWeek, getCoachHabitWeekAndCurrent } from "@/services/client-habit-figures-service";
import { getClientTodayString } from "@/services/today-service";
import { recordAuditEvents } from "@/services/audit-log-service";
import type { CoachHabitWeek } from "@/types/habits";

const LIST = {
  clientToday: "2026-09-30",
  habits: [
    {
      id: "h1",
      name: "Water",
      howTo: null,
      measure: "number" as const,
      unit: "L",
      direction: "at_least" as const,
      position: 1,
      versions: [{ id: "v1", startsOn: "2026-09-30", endsOn: null, target: 3, timesPerWeek: null, weekdays: [] }],
      dayEdits: [],
      hasEntries: false,
      status: "running" as const,
      words: { schedule: "Every day", target: "at least 3 L" },
    },
  ],
};
const WEEK: CoachHabitWeek = {
  clientToday: "2026-09-30",
  start: "2026-09-24",
  end: "2026-09-30",
  dates: [],
  habits: [],
  totals: { planned: 0, done: 0, met: 0 },
  today: null,
};
const NEXT_WEEK: CoachHabitWeek = { ...WEEK, start: "2026-10-01", end: "2026-10-07" };
const EVERY_DAY = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const params = { params: Promise.resolve({ id: "client-2" }) };

function post(body: unknown, query = "") {
  return new NextRequest(`http://localhost:3000/api/clients/client-2/habits${query}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}
const get = () => new NextRequest("http://localhost:3000/api/clients/client-2/habits");

const water = { name: "Water", measure: "number", unit: "L", direction: "at_least", target: 3, weekdays: EVERY_DAY };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireCoachOwnsClient).mockResolvedValue({ authorized: true, coachId: "coach-3" });
  vi.mocked(getClientTodayString).mockResolvedValue("2026-09-30");
  vi.mocked(getCoachHabitList).mockResolvedValue(LIST);
  vi.mocked(getCoachHabitWeek).mockResolvedValue(WEEK);
  vi.mocked(getCoachHabitWeekAndCurrent).mockResolvedValue({ week: NEXT_WEEK, currentWeek: WEEK });
});

describe("GET /api/clients/[id]/habits", () => {
  it("answers the client's habits, uncached", async () => {
    const req = get();
    const response = await GET(req, params);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ success: true, data: LIST });
    expect(requireCoachOwnsClient).toHaveBeenCalledWith("client-2", req);
    expect(getCoachHabitList).toHaveBeenCalledWith("client-2");
  });

  it("reads nothing for another coach's client", async () => {
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({
      authorized: false,
      response: NextResponse.json({ error: "Client not found" }, { status: 404 }),
    });
    expect((await GET(get(), params)).status).toBe(404);
    expect(getCoachHabitList).not.toHaveBeenCalled();
  });

  it("stops at the rate limit before the coach is read", async () => {
    vi.mocked(coachApiRateLimit).mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await GET(get(), params)).status).toBe(429);
    expect(requireCoachOwnsClient).not.toHaveBeenCalled();
  });

  it("answers a failed read with a 500", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(getCoachHabitList).mockRejectedValue(new Error("boom"));
    expect((await GET(get(), params)).status).toBe(500);
    spy.mockRestore();
  });
});

describe("POST /api/clients/[id]/habits", () => {
  it("adds the habits from the client's today, audits each, and answers with their ids and the habits and the week as they now stand", async () => {
    vi.mocked(addHabits).mockResolvedValue(["h1", "h2"]);
    const req = post({
      habits: [
        water,
        { name: "  Mobility ", howTo: "Ten minutes", measure: "tick", timesPerWeek: 3 },
      ],
    });
    const response = await POST(req, params);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { habitIds: ["h1", "h2"], habits: LIST, week: WEEK, currentWeek: null } });
    expect(requireCoachOwnsClient).toHaveBeenCalledWith("client-2", req);
    // The day is the CLIENT's today, on their calendar — never the coach's.
    expect(getClientTodayString).toHaveBeenCalledWith("client-2");
    expect(addHabits).toHaveBeenCalledWith({
      clientId: "client-2",
      today: "2026-09-30",
      startsOn: "2026-09-30",
      createdBy: "coach-3",
      habits: [
        { name: "Water", howTo: null, measure: "number", unit: "L", direction: "at_least", target: 3, schedule: { weekdays: EVERY_DAY } },
        { name: "Mobility", howTo: "Ten minutes", measure: "tick", unit: null, direction: null, target: null, schedule: { timesPerWeek: 3 } },
      ],
    });
    expect(recordAuditEvents).toHaveBeenCalledWith([
      expect.objectContaining({ action: "habit.create", targetTable: "client_habits", targetId: "h1", clientId: "client-2", actorId: "coach-3", metadata: { startsOn: "2026-09-30" } }),
      expect.objectContaining({ action: "habit.create", targetId: "h2" }),
    ]);
    expect(getCoachHabitList).toHaveBeenCalledWith("client-2", "2026-09-30");
    // No week named: the client's current week, on the today just read.
    expect(getCoachHabitWeek).toHaveBeenCalledWith("client-2", undefined, "2026-09-30");
  });

  it("answers with the week the Habits tab named and the client's current week, which its summary shows", async () => {
    vi.mocked(addHabits).mockResolvedValue(["h1"]);
    const response = await POST(post({ habits: [water] }, "?week=2026-10-01"), params);
    expect(getCoachHabitWeekAndCurrent).toHaveBeenCalledWith("client-2", "2026-10-01", "2026-09-30");
    expect((await response.json()).data).toMatchObject({ week: NEXT_WEEK, currentWeek: WEEK });
  });

  it("refuses a week that is not a real day before any write", async () => {
    const response = await POST(post({ habits: [water] }, "?week=2026-13-01"), params);
    expect(response.status).toBe(400);
    expect(addHabits).not.toHaveBeenCalled();
  });

  it("starts from the day asked for", async () => {
    vi.mocked(addHabits).mockResolvedValue(["h1"]);
    await POST(post({ startsOn: "2026-10-05", habits: [water] }), params);
    expect(addHabits).toHaveBeenCalledWith(expect.objectContaining({ today: "2026-09-30", startsOn: "2026-10-05" }));
  });

  it.each([
    ["no habits", { habits: [] }],
    ["a habit with no name", { habits: [{ ...water, name: "   " }] }],
    ["a name past 100 characters", { habits: [{ ...water, name: "x".repeat(101) }] }],
    ["both kinds of days", { habits: [{ ...water, timesPerWeek: 2 }] }],
    ["neither kind of days", { habits: [{ name: "Water", measure: "tick" }] }],
    ["a measure the product does not know", { habits: [{ ...water, measure: "count" }] }],
    ["a target finer than two decimals", { habits: [{ ...water, target: 3.125 }] }],
    ["an empty unit", { habits: [{ ...water, unit: "" }] }],
    ["an unknown key", { habits: [{ ...water, isActive: true }] }],
    ["an unknown key on the add", { habits: [water], clientId: "someone-else" }],
    ["a start day that does not exist", { startsOn: "2026-02-30", habits: [water] }],
  ])("refuses %s before any write", async (_label, body) => {
    expect((await POST(post(body), params)).status).toBe(400);
    expect(addHabits).not.toHaveBeenCalled();
  });

  it("says a habit cannot start before today", async () => {
    vi.mocked(addHabits).mockRejectedValue(new HabitWriteError("starts_in_past", "x"));
    const response = await POST(post({ startsOn: "2026-09-29", habits: [water] }), params);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "starts_in_past", error: "Pick today or a later day to start from." });
    expect(recordAuditEvents).not.toHaveBeenCalled();
  });

  it("says a number habit needs a target, and a tick habit takes none", async () => {
    vi.mocked(addHabits).mockRejectedValueOnce(new HabitWriteError("target_required", "x"));
    const noTarget = await POST(post({ habits: [{ ...water, target: null }] }), params);
    expect(noTarget.status).toBe(400);
    expect((await noTarget.json()).error).toBe("A number habit needs a target.");

    vi.mocked(addHabits).mockRejectedValueOnce(new HabitWriteError("target_not_allowed", "x"));
    const tickTarget = await POST(post({ habits: [{ name: "Walk", measure: "tick", target: 2, weekdays: EVERY_DAY }] }), params);
    expect(tickTarget.status).toBe(400);
    expect((await tickTarget.json()).error).toBe("A tick habit has no target.");
  });

  it("adds nothing for another coach's client", async () => {
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({
      authorized: false,
      response: NextResponse.json({ error: "Client not found" }, { status: 404 }),
    });
    expect((await POST(post({ habits: [water] }), params)).status).toBe(404);
    expect(addHabits).not.toHaveBeenCalled();
  });

  it("stops at the rate limit and at a failed CSRF check, before the coach is read", async () => {
    vi.mocked(coachApiRateLimit).mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await POST(post({ habits: [water] }), params)).status).toBe(429);
    vi.mocked(requireCSRFProtection).mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await POST(post({ habits: [water] }), params)).status).toBe(403);
    expect(requireCoachOwnsClient).not.toHaveBeenCalled();
  });

  it("answers the added habits as saved, with neither the list nor the week, when reading them back fails — so the screen reads again, never adds twice", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(addHabits).mockResolvedValue(["h1"]);
    vi.mocked(getCoachHabitList).mockRejectedValue(new Error("read failed"));
    const response = await POST(post({ habits: [water] }), params);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { habitIds: ["h1"], habits: null, week: null, currentWeek: null } });
    expect(recordAuditEvents).toHaveBeenCalled();
    spy.mockRestore();
  });
});
