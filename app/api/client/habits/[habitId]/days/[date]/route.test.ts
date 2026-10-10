import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/rate-limit", () => ({
  apiRateLimit: vi.fn().mockResolvedValue(null),
  authRateLimit: vi.fn().mockResolvedValue(null),
  checkInRateLimit: vi.fn().mockResolvedValue(null),
  clientApiRateLimit: vi.fn().mockResolvedValue(null),
  clientPerClientRateLimit: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/csrf-protection", () => ({ requireCSRFProtection: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/auth-helpers", () => ({ getAuthenticatedClientId: vi.fn() }));
vi.mock("@/services/client-habit-writes-service", () => {
  class HabitWriteError extends Error {
    constructor(
      readonly code: string,
      message: string
    ) {
      super(message);
    }
  }
  return { HabitWriteError, saveHabitEntry: vi.fn(), clearHabitEntry: vi.fn() };
});
vi.mock("@/services/client-habit-figures-service", () => ({ getHabitEntryResult: vi.fn() }));
vi.mock("@/services/check-in-week-service", () => ({ getClientWeekAnchor: vi.fn() }));

import { clientPerClientRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { clearHabitEntry, HabitWriteError, saveHabitEntry } from "@/services/client-habit-writes-service";
import { getHabitEntryResult } from "@/services/client-habit-figures-service";
import { getClientWeekAnchor } from "@/services/check-in-week-service";
import { DayLockedError } from "@/lib/daily-log-permissions";
import { DELETE, PUT } from "./route";
import type { HabitEntryResult } from "@/types/habits";

const HABIT = "7c1a4d8e-2f3b-4c5d-8e9f-0a1b2c3d4e5f";
const params = (date = "2026-09-29", habitId = HABIT) => ({ params: Promise.resolve({ habitId, date }) });
const request = (method: "PUT" | "DELETE", body?: unknown) =>
  new NextRequest(`http://localhost/api/client/habits/${HABIT}/days/2026-09-29`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });

const RESULT: HabitEntryResult = {
  day: {
    date: "2026-09-29",
    covered: true,
    planned: false,
    target: 3,
    edited: false,
    versionId: "v1",
    timesPerWeek: null,
    entry: { done: null, value: 3.1, note: null },
    met: true,
  },
  week: { planned: 7, done: 5, met: 5, start: "2026-09-24", end: "2026-09-30" },
};
const ANCHOR = { weekday: "wednesday" as const, startDate: "2026-06-01" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAuthenticatedClientId).mockResolvedValue("client-1");
  vi.mocked(saveHabitEntry).mockResolvedValue(undefined);
  vi.mocked(clearHabitEntry).mockResolvedValue(undefined);
  vi.mocked(getHabitEntryResult).mockResolvedValue(RESULT);
  vi.mocked(getClientWeekAnchor).mockResolvedValue(ANCHOR);
});

describe("PUT /api/client/habits/[habitId]/days/[date]", () => {
  it("saves the authed client's number for the day and answers with the habit's day and week", async () => {
    const response = await PUT(request("PUT", { value: 3.1 }), params());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: RESULT });
    expect(saveHabitEntry).toHaveBeenCalledWith({
      clientId: "client-1",
      habitId: HABIT,
      date: "2026-09-29",
      answer: { value: 3.1 },
      note: undefined,
    });
    expect(getClientWeekAnchor).toHaveBeenCalledWith("client-1");
    expect(getHabitEntryResult).toHaveBeenCalledWith("client-1", HABIT, "2026-09-29", ANCHOR);
  });

  it("answers a saved entry as saved, with no data, when only reading the week back fails", async () => {
    vi.mocked(getHabitEntryResult).mockRejectedValue(new Error("read failed"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await PUT(request("PUT", { value: 3.1 }), params());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: null });
    expect(saveHabitEntry).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("Habit entry written, reading it back failed:", expect.any(Error));
    spy.mockRestore();
  });

  it("answers a saved entry as saved, with no data, when the week's anchor — read alongside the write — fails", async () => {
    vi.mocked(getClientWeekAnchor).mockRejectedValue(new Error("anchor failed"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await PUT(request("PUT", { value: 3.1 }), params());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: null });
    expect(saveHabitEntry).toHaveBeenCalledTimes(1);
    expect(getHabitEntryResult).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("answers a refused write with its refusal, whatever the anchor read did", async () => {
    vi.mocked(getClientWeekAnchor).mockRejectedValue(new Error("anchor failed"));
    vi.mocked(saveHabitEntry).mockRejectedValue(new DayLockedError("2026-09-29", "habit"));
    const response = await PUT(request("PUT", { done: true }), params());
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("This day is locked.");
  });

  it("saves a tick with its note trimmed, and an empty note as none", async () => {
    await PUT(request("PUT", { done: false, note: "  Travelling  " }), params());
    expect(saveHabitEntry).toHaveBeenLastCalledWith(expect.objectContaining({ answer: { done: false }, note: "Travelling" }));
    await PUT(request("PUT", { done: true, note: "   " }), params());
    expect(saveHabitEntry).toHaveBeenLastCalledWith(expect.objectContaining({ answer: { done: true }, note: null }));
  });

  it.each([
    ["both answers", { done: true, value: 3 }],
    ["no answer", { note: "x" }],
    ["a negative number", { value: -1 }],
    ["a number finer than two decimals", { value: 2.005 }],
    ["a number in exponent notation", { value: 1e-7 }],
    ["a note over 500 characters", { done: true, note: "x".repeat(501) }],
    ["an unknown key", { done: true, date: "2026-09-28" }],
  ])("refuses %s before any write", async (_label, body) => {
    expect((await PUT(request("PUT", body), params())).status).toBe(400);
    expect(saveHabitEntry).not.toHaveBeenCalled();
  });

  it("refuses a path naming no habit (404) or no day (400)", async () => {
    expect((await PUT(request("PUT", { done: true }), params("2026-09-29", "habit-1"))).status).toBe(404);
    expect((await PUT(request("PUT", { done: true }), params("2026-9-29"))).status).toBe(400);
    expect(saveHabitEntry).not.toHaveBeenCalled();
  });

  it.each([
    [new HabitWriteError("not_found", "x"), 404, "Habit not found."],
    [new HabitWriteError("not_running", "x"), 409, "That habit isn't running on that day."],
    [new HabitWriteError("expects_number", "x"), 400, "This habit takes a number."],
    [new HabitWriteError("expects_tick", "x"), 400, "This habit is ticked, not counted."],
    [new DayLockedError("2026-09-29", "habit"), 403, "This day is locked."],
  ])("answers %s with its status and sentence", async (error, status, sentence) => {
    vi.mocked(saveHabitEntry).mockRejectedValue(error);
    const response = await PUT(request("PUT", { done: true }), params());
    expect(response.status).toBe(status);
    expect((await response.json()).error).toBe(sentence);
    expect(getHabitEntryResult).not.toHaveBeenCalled();
  });

  it("writes nothing without a session, over the client's own limit, or without the CSRF check", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValueOnce(null);
    expect((await PUT(request("PUT", { done: true }), params())).status).toBe(401);
    vi.mocked(clientPerClientRateLimit).mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await PUT(request("PUT", { done: true }), params())).status).toBe(429);
    vi.mocked(requireCSRFProtection).mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await PUT(request("PUT", { done: true }), params())).status).toBe(403);
    expect(saveHabitEntry).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/client/habits/[habitId]/days/[date]", () => {
  it("clears the authed client's entry and answers with the habit's day and week", async () => {
    const response = await DELETE(request("DELETE"), params());
    expect(await response.json()).toEqual({ success: true, data: RESULT });
    expect(clearHabitEntry).toHaveBeenCalledWith({ clientId: "client-1", habitId: HABIT, date: "2026-09-29" });
  });

  it("answers a cleared entry as saved, with no data, when reading the week back fails", async () => {
    vi.mocked(getHabitEntryResult).mockRejectedValue(new Error("read failed"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await DELETE(request("DELETE"), params());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: null });
    spy.mockRestore();
  });

  it("clears nothing on a locked day or for another client's habit", async () => {
    vi.mocked(clearHabitEntry).mockRejectedValue(new DayLockedError("2026-09-29", "habit"));
    expect((await DELETE(request("DELETE"), params())).status).toBe(403);
    vi.mocked(clearHabitEntry).mockRejectedValue(new HabitWriteError("not_found", "x"));
    expect((await DELETE(request("DELETE"), params())).status).toBe(404);
    expect(getHabitEntryResult).not.toHaveBeenCalled();
  });
});
