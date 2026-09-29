import { NextResponse } from "next/server";
import { DayLockedError } from "@/lib/daily-log-permissions";
import { HabitWriteError, type HabitRefusalCode } from "@/services/client-habit-writes-service";

/**
 * A habit write's refusal as the response every habit route sends: a sentence
 * a coach or a client can act on, and the function's code. A locked day is
 * the day rule's own 403 and sentence ("This day is locked.").
 */

const STATUS: Record<HabitRefusalCode, number> = {
  invalid_args: 400,
  not_found: 404,
  starts_in_past: 409,
  stops_in_past: 409,
  day_in_past: 409,
  not_running: 409,
  weekly_version: 409,
  target_required: 400,
  target_not_allowed: 400,
  has_entries: 409,
  order_mismatch: 409,
  expects_tick: 400,
  expects_number: 400,
};

const SENTENCE: Record<HabitRefusalCode, string> = {
  invalid_args: "That habit isn't valid.",
  not_found: "Habit not found.",
  starts_in_past: "Pick today or a later day to start from.",
  stops_in_past: "Pick today or a later day to stop from.",
  day_in_past: "This day has passed, so it can't be changed.",
  not_running: "That habit isn't running on that day.",
  weekly_version: "This habit is done a number of times a week, so it has no set days to change.",
  target_required: "A number habit needs a target.",
  target_not_allowed: "A tick habit has no target.",
  has_entries: "This habit has entries, so it can only be stopped.",
  order_mismatch: "The habits have changed since this list was loaded. Reload it and try again.",
  expects_tick: "This habit is ticked, not counted.",
  expects_number: "This habit takes a number.",
};

/** The route's answer to a habit write that threw: a refusal, a locked day, or a 500. */
export function habitWriteErrorResponse(error: unknown): NextResponse {
  if (error instanceof DayLockedError) {
    return NextResponse.json({ success: false, error: error.message }, { status: 403 });
  }
  if (error instanceof HabitWriteError) {
    return NextResponse.json(
      { success: false, error: SENTENCE[error.code], code: error.code },
      { status: STATUS[error.code] }
    );
  }
  console.error("Habit write failed:", error);
  return NextResponse.json({ success: false, error: "Failed to save the habit" }, { status: 500 });
}
