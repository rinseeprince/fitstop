import { NextResponse } from "next/server";
import { addDaysToDateString, formatDateOnlyShort } from "@/lib/date-helpers";
import {
  GoalWriteError,
  type GoalConflict,
  type GoalRefusalCode,
} from "@/services/client-goal-writes-service";
import type { GoalFix } from "@/types/client-goals";

/**
 * A goal write's refusal as the response every goal route sends: a sentence a
 * coach can act on, the function's code, and — for the two deadline guards —
 * the goal in the way and the fixes offered rather than a dead end: move the
 * next goal past the new deadline, where its own deadline allows, or delete
 * it; or end the previous goal's deadline the day before the new start.
 */

/** What the refused write asked for, where a fix is worked out from it. */
export type GoalWriteAttempt = { startsOn?: string; deadline?: string | null };

const STATUS: Record<GoalRefusalCode, number> = {
  invalid_args: 400,
  not_found: 404,
  starts_in_past: 409,
  day_taken: 409,
  deadline_before_start: 409,
  deadline_after_next: 409,
  previous_deadline: 409,
  started: 409,
  ended: 409,
  exists: 409,
};

function describe(
  code: GoalRefusalCode,
  conflict: GoalConflict | null,
  attempt: GoalWriteAttempt
): { message: string; fixes: GoalFix[] } {
  switch (code) {
    case "deadline_after_next": {
      if (!conflict?.startsOn) break;
      const starts = formatDateOnlyShort(conflict.startsOn);
      // The day after the new deadline — a move there keeps the next goal's
      // own deadline, so it is offered only where that deadline allows.
      const moveTo = attempt.deadline ? addDaysToDateString(attempt.deadline, 1) : null;
      const canMove = moveTo !== null && (conflict.deadline == null || conflict.deadline >= moveTo);
      const fixes: GoalFix[] = [];
      if (canMove) {
        fixes.push({ kind: "move_goal", goalId: conflict.goalId, name: conflict.name, startsOn: moveTo });
      }
      fixes.push({ kind: "delete_goal", goalId: conflict.goalId, name: conflict.name });
      const offer = canMove
        ? `Move ${conflict.name} to ${formatDateOnlyShort(moveTo)} or delete it.`
        : moveTo
          ? `Set a deadline before ${starts}, or delete ${conflict.name}.`
          : `Move ${conflict.name} or delete it.`;
      return {
        message: `The deadline runs into ${conflict.name}, which starts ${starts}. ${offer}`,
        fixes,
      };
    }
    case "previous_deadline": {
      if (!conflict?.deadline) break;
      const fixes: GoalFix[] = attempt.startsOn
        ? [
            {
              kind: "end_deadline",
              goalId: conflict.goalId,
              name: conflict.name,
              deadline: addDaysToDateString(attempt.startsOn, -1),
            },
          ]
        : [];
      const end = attempt.startsOn
        ? `End that deadline on ${formatDateOnlyShort(addDaysToDateString(attempt.startsOn, -1))}, or start this goal after it.`
        : "Start this goal after it.";
      return {
        message: `${conflict.name}'s deadline is ${formatDateOnlyShort(conflict.deadline)}. ${end}`,
        fixes,
      };
    }
    case "starts_in_past":
      return { message: "A goal can't start before today.", fixes: [] };
    case "day_taken":
      return { message: "Another goal already starts on that day.", fixes: [] };
    case "deadline_before_start":
      return { message: "The deadline can't be before the goal starts.", fixes: [] };
    case "started":
      return {
        message:
          "This goal has started, so only its deadline and name can change. Set a new goal to change the rest.",
        fixes: [],
      };
    case "ended":
      return { message: "This goal has ended, so its deadline can't change.", fixes: [] };
    case "exists":
      return { message: "That goal is already back.", fixes: [] };
    case "not_found":
      return { message: "Goal not found.", fixes: [] };
    case "invalid_args":
      return { message: "That goal isn't valid.", fixes: [] };
  }
  return { message: "That goal can't be saved.", fixes: [] };
}

/** The route's answer to a goal write that threw: a refusal, or a 500. */
export function goalWriteErrorResponse(
  error: unknown,
  attempt: GoalWriteAttempt = {}
): NextResponse {
  if (error instanceof GoalWriteError) {
    const { message, fixes } = describe(error.code, error.conflict, attempt);
    return NextResponse.json(
      { success: false, error: message, code: error.code, conflict: error.conflict, fixes },
      { status: STATUS[error.code] }
    );
  }
  console.error("Goal write failed:", error);
  return NextResponse.json({ success: false, error: "Failed to save the goal" }, { status: 500 });
}
