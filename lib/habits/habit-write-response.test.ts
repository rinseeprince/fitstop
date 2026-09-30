import { describe, it, expect, vi } from "vitest";

vi.mock("@/services/client-habit-writes-service", () => {
  class HabitWriteError extends Error {
    constructor(
      readonly code: string,
      message: string
    ) {
      super(message);
    }
  }
  return { HabitWriteError };
});

import { HabitWriteError, type HabitRefusalCode } from "@/services/client-habit-writes-service";
import { DayLockedError } from "@/lib/daily-log-permissions";
import { habitWriteErrorResponse } from "./habit-write-response";

const CASES: Array<[HabitRefusalCode, number, string]> = [
  ["invalid_args", 400, "That habit isn't valid."],
  ["not_found", 404, "Habit not found."],
  ["starts_in_past", 409, "Pick today or a later day to start from."],
  ["stops_in_past", 409, "Pick today or a later day to stop from."],
  ["day_in_past", 409, "This day has passed, so it can't be changed."],
  ["not_running", 409, "That habit isn't running on that day."],
  ["weekly_version", 409, "This habit is done a number of times a week, so it has no set days to change."],
  ["target_required", 400, "A number habit needs a target."],
  ["target_not_allowed", 400, "A tick habit has no target."],
  ["order_mismatch", 409, "The habits have changed since this list was loaded. Reload it and try again."],
  ["expects_tick", 400, "This habit is ticked, not counted."],
  ["expects_number", 400, "This habit takes a number."],
];

describe("habitWriteErrorResponse", () => {
  it.each(CASES)("answers %s with %i and its sentence", async (code, status, sentence) => {
    const response = habitWriteErrorResponse(new HabitWriteError(code, "the function's own words"));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ success: false, error: sentence, code });
  });

  it("answers a locked day with the day rule's own 403 and sentence", async () => {
    const response = habitWriteErrorResponse(new DayLockedError("2026-09-20", "habit"));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ success: false, error: "This day is locked." });
  });

  it("answers anything else with a 500 that names no database detail", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = habitWriteErrorResponse(new Error('duplicate key value violates unique constraint "x"'));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, error: "Failed to save the habit" });
    spy.mockRestore();
  });
});
