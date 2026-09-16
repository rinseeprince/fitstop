import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase-admin", () => ({
  supabaseAdmin: { rpc: vi.fn() },
}));
vi.mock("./today-service", () => ({
  getClientTodayString: vi.fn(),
}));
// The one answer to "from which day may a program start" — its own rules are
// proved in event-deletion-floor.test.ts.
vi.mock("./event-deletion-floor", () => ({
  resolveEventDeletionFloor: vi.fn(),
}));

import { supabaseAdmin } from "./supabase-admin";
import { getClientTodayString } from "./today-service";
import { resolveEventDeletionFloor } from "./event-deletion-floor";
import { DateOccupiedError } from "./training-event-occupancy";
import {
  moveTrainingPlanStart,
  PlanMoveNotFoundError,
  PlanMoveRefusedError,
} from "./training-plan-move-service";

const CLIENT = "client-1";
const PLAN = "plan-1";
const TODAY = "2026-09-16";

const rpc = vi.mocked(supabaseAdmin.rpc);

/** The function refuses with this message (and code). */
function refuse(message: string, extra: { code?: string; details?: string } = {}) {
  rpc.mockResolvedValue({ data: null, error: { message, ...extra } } as never);
}

const move = (startsOn = "2026-10-05") =>
  moveTrainingPlanStart({ clientId: CLIENT, planId: PLAN, startsOn });

async function refusal(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("the move went through");
}

describe("moveTrainingPlanStart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getClientTodayString).mockResolvedValue(TODAY);
    vi.mocked(resolveEventDeletionFloor).mockResolvedValue(TODAY);
    rpc.mockResolvedValue({
      data: { starts_on: "2026-10-05", ends_on: "2026-10-25", sessions_moved: 9 },
      error: null,
    } as never);
  });

  it("moves the program through the function, with the client's deletion floor", async () => {
    vi.mocked(resolveEventDeletionFloor).mockResolvedValue("2026-09-17");

    const result = await move();

    expect(resolveEventDeletionFloor).toHaveBeenCalledWith(CLIENT, TODAY);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("move_training_plan_atomic", {
      p_client_id: CLIENT,
      p_plan_id: PLAN,
      p_starts_on: "2026-10-05",
      // The floor, not the client's today: a client who has logged a workout
      // today has started whatever begins today.
      p_floor: "2026-09-17",
    });
    expect(result).toEqual({ startsOn: "2026-10-05", endsOn: "2026-10-25", sessionsMoved: 9 });
  });

  it("fails loudly when the function answers with nothing it recognises", async () => {
    rpc.mockResolvedValue({ data: null, error: null } as never);
    await expect(move()).rejects.toThrow("move_training_plan_atomic returned no result");
  });

  it("a plan that is not this client's, or not live, is not found", async () => {
    refuse("not_found: plan plan-1 is not a live plan of this client");
    const error = await refusal(move());
    expect(error).toBeInstanceOf(PlanMoveNotFoundError);
  });

  it("a program that has started is refused in a sentence", async () => {
    refuse("started: the program started on 2026-09-07");
    const error = await refusal(move());
    expect(error).toBeInstanceOf(PlanMoveRefusedError);
    expect(error.message).toBe("This program has already started, so its start date can't change.");
  });

  it("a start before a floor of tomorrow says tomorrow is the earliest", async () => {
    refuse("before_floor:2026-09-17");
    const error = await refusal(move("2026-09-16"));
    expect(error).toBeInstanceOf(PlanMoveRefusedError);
    expect(error.message).toBe("A program can start from tomorrow at the earliest.");
  });

  it("a start before a floor of today says it is in the past", async () => {
    refuse("before_floor:2026-09-16");
    const error = await refusal(move("2026-09-15"));
    expect(error).toBeInstanceOf(PlanMoveRefusedError);
    expect(error.message).toBe("A program can't start in the past.");
  });

  it("an overlap names the other program", async () => {
    refuse("overlap:Strength");
    const error = await refusal(move());
    expect(error).toBeInstanceOf(PlanMoveRefusedError);
    expect(error.message).toBe("That would overlap Strength.");
  });

  it("crossing a block's start names the block", async () => {
    refuse("block:start:Peak");
    const error = await refusal(move());
    expect(error).toBeInstanceOf(PlanMoveRefusedError);
    expect(error.message).toBe("That would run into the Peak block.");
  });

  it("crossing a block's end names the block", async () => {
    refuse("block:end:Build");
    const error = await refusal(move());
    expect(error).toBeInstanceOf(PlanMoveRefusedError);
    expect(error.message).toBe("That would take it past the end of the Build block.");
  });

  it("a day that already holds a session is named in the calendar's own sentence", async () => {
    refuse("occupied:2026-10-22");
    const error = await refusal(move());
    expect(error).toBeInstanceOf(DateOccupiedError);
    expect(error.message).toBe("Thu, Oct 22 already has a session");
  });

  it("the one-session-a-day index firing mid-move reads as the same sentence", async () => {
    refuse(
      'duplicate key value violates unique constraint "idx_training_events_one_scheduled_per_day"',
      {
        code: "23505",
        details: "Key (client_id, date)=(client-1, 2026-10-22) already exists.",
      }
    );
    const error = await refusal(move());
    expect(error).toBeInstanceOf(DateOccupiedError);
    expect(error.message).toBe("Thu, Oct 22 already has a session");
  });

  it("the live-window exclusion firing mid-move reads as an overlap", async () => {
    refuse('conflicting key value violates exclusion constraint "training_plans_live_window_overlap"', {
      code: "23P01",
    });
    const error = await refusal(move());
    expect(error).toBeInstanceOf(PlanMoveRefusedError);
    expect(error.message).toBe("That would overlap another program.");
  });

  it("anything else is a failure, never a refusal a coach could act on", async () => {
    refuse("connection reset");
    const error = await refusal(move());
    expect(error).not.toBeInstanceOf(PlanMoveRefusedError);
    expect(error).not.toBeInstanceOf(DateOccupiedError);
    expect(error.message).toBe("Failed to move the program: connection reset");
  });
});
