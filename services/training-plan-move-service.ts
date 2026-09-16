import { z } from "zod";
import { supabaseAdmin } from "./supabase-admin";
import { getClientTodayString } from "./today-service";
import { resolveEventDeletionFloor } from "./event-deletion-floor";
import {
  DateOccupiedError,
  occupiedMessage,
  rethrowIfAnyDateOccupied,
} from "./training-event-occupancy";

// =============================================================================
// Moving a program's start. A coach who placed a program on the wrong day moves
// it from the Plans hero instead of deleting it and customising it again: the
// program moves whole, as it is on the calendar — its start, its end and every
// session between them shift by the same number of days, in one transaction
// (move_training_plan_atomic, migration 177). Only a program that hasn't
// started moves, and nothing is shortened or trimmed to make room: a move that
// doesn't fit is refused with a sentence saying why.
// =============================================================================

/** No live plan by that id for this client. Route: 404. */
export class PlanMoveNotFoundError extends Error {
  constructor() {
    super("Plan not found");
  }
}

/** The move isn't allowed, and the message says why. Route: 409. */
export class PlanMoveRefusedError extends Error {}

type PlanMoveResult = {
  startsOn: string;
  endsOn: string;
  sessionsMoved: number;
};

type MoveRpcError = { code?: string; message: string; details?: string };

// The function's own answer, in its columns.
const moveResultSchema = z.object({
  starts_on: z.string(),
  ends_on: z.string(),
  sessions_moved: z.number().int(),
});

/** Postgres exclusion violation: the live-window backstop (migration 167). */
const WINDOW_OVERLAP = "23P01";

/**
 * Move a program so it starts on `startsOn`.
 *
 * The floor is the client's deletion floor — their today, or tomorrow once
 * they've logged a workout today — and the function refuses a program that
 * starts before it (it has started) as well as a new start before it.
 */
export async function moveTrainingPlanStart(params: {
  clientId: string;
  planId: string;
  startsOn: string;
}): Promise<PlanMoveResult> {
  const { clientId, planId, startsOn } = params;
  const clientToday = await getClientTodayString(clientId);
  const floor = await resolveEventDeletionFloor(clientId, clientToday);

  const { data, error } = await supabaseAdmin.rpc("move_training_plan_atomic", {
    p_client_id: clientId,
    p_plan_id: planId,
    p_starts_on: startsOn,
    p_floor: floor,
  });
  if (error) throw translateMoveError(error, clientToday);

  const moved = moveResultSchema.safeParse(data);
  if (!moved.success) throw new Error("move_training_plan_atomic returned no result");
  return {
    startsOn: moved.data.starts_on,
    endsOn: moved.data.ends_on,
    sessionsMoved: moved.data.sessions_moved,
  };
}

/**
 * The function's refusal in the coach's sentences. Its message prefixes are
 * its error contract (migration 177). The two constraints stay backstops for a
 * write landing between the function's checks and its move: the
 * one-scheduled-per-day index answers with the checks' own sentence, and the
 * live-window exclusion with the overlap's, less the program it can't name.
 */
function translateMoveError(error: MoveRpcError, clientToday: string): Error {
  rethrowIfAnyDateOccupied(error);
  if (error.code === WINDOW_OVERLAP) {
    return new PlanMoveRefusedError("That would overlap another program.");
  }

  const message = error.message ?? "";
  const after = (prefix: string) => message.slice(prefix.length).trim();

  if (message.startsWith("not_found:")) return new PlanMoveNotFoundError();
  if (message.startsWith("started:")) {
    return new PlanMoveRefusedError(
      "This program has already started, so its start date can't change."
    );
  }
  if (message.startsWith("before_floor:")) {
    // The floor is the client's today, or tomorrow once they've logged a workout.
    return new PlanMoveRefusedError(
      after("before_floor:") > clientToday
        ? "A program can start from tomorrow at the earliest."
        : "A program can't start in the past."
    );
  }
  if (message.startsWith("overlap:")) {
    return new PlanMoveRefusedError(`That would overlap ${after("overlap:")}.`);
  }
  if (message.startsWith("block:start:")) {
    return new PlanMoveRefusedError(`That would run into the ${after("block:start:")} block.`);
  }
  if (message.startsWith("block:end:")) {
    return new PlanMoveRefusedError(
      `That would take it past the end of the ${after("block:end:")} block.`
    );
  }
  if (message.startsWith("occupied:")) {
    return new DateOccupiedError(occupiedMessage(after("occupied:")));
  }
  return new Error(`Failed to move the program: ${message}`);
}
