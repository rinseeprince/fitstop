import { describe, it, expect, vi, beforeEach } from "vitest";

const { query } = vi.hoisted(() => ({
  query: { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() },
}));
vi.mock("./supabase-admin", () => ({ supabaseAdmin: { rpc: vi.fn(), from: vi.fn(() => query) } }));

import { supabaseAdmin } from "./supabase-admin";
import {
  addGoal,
  editGoal,
  GoalWriteError,
  setGoalDeadline,
  toGoalWriteError,
} from "./client-goal-writes-service";

const rpc = vi.mocked(supabaseAdmin.rpc);
const TODAY = "2026-09-22";

function rpcReturns(data: unknown) {
  rpc.mockResolvedValue({ data, error: null } as never);
}

describe("toGoalWriteError", () => {
  it("reads a function's code and message", () => {
    const error = toGoalWriteError({ message: "started: a goal that has started changes only its deadline" });
    expect(error).toBeInstanceOf(GoalWriteError);
    expect(error).toMatchObject({ code: "started", conflict: null });
  });

  it("reads the goal a deadline guard ran into", () => {
    const error = toGoalWriteError({
      message: 'deadline_after_next:{"goalId" : "goal-peak", "name" : "Peak", "startsOn" : "2026-10-05"}',
    });
    expect(error).toMatchObject({
      code: "deadline_after_next",
      conflict: { goalId: "goal-peak", name: "Peak", startsOn: "2026-10-05" },
    });
  });

  it("leaves anything that is not a refusal a plain error", () => {
    const error = toGoalWriteError({ message: "permission denied for table client_goals" });
    expect(error).not.toBeInstanceOf(GoalWriteError);
    expect(error.message).toMatch(/permission denied/);
  });
});

describe("the write calls", () => {
  beforeEach(() => vi.clearAllMocks());

  it("omits the optional parameters it has no value for, so SQL defaults them", async () => {
    rpcReturns("goal-new");
    await addGoal({
      clientId: "client-3",
      today: TODAY,
      startsOn: "2026-10-01",
      source: "coach",
      setBy: "coach-5",
      type: "recomposition",
      name: "Recomp",
      targetWeight: null,
      targetBodyFatPercentage: 15.5,
      description: null,
      deadline: null,
    });
    expect(rpc).toHaveBeenCalledWith("add_client_goal", {
      p_client_id: "client-3",
      p_today: TODAY,
      p_starts_on: "2026-10-01",
      p_type: "recomposition",
      p_name: "Recomp",
      p_source: "coach",
      p_set_by: "coach-5",
      p_target_body_fat_percentage: 15.5,
    });
    const sent = rpc.mock.calls[0][1] as Record<string, unknown>;
    for (const omitted of ["p_target_weight", "p_description", "p_deadline"]) {
      expect(sent).not.toHaveProperty(omitted);
    }
  });

  it("clears a deadline by omitting it", async () => {
    rpcReturns(true);
    await setGoalDeadline({ goalId: "goal-running", clientId: "client-3", today: TODAY, setBy: "coach-5", deadline: null });
    expect(rpc).toHaveBeenCalledWith("set_client_goal_deadline", {
      p_goal_id: "goal-running",
      p_client_id: "client-3",
      p_today: TODAY,
      p_set_by: "coach-5",
    });
  });

  it("throws a function's refusal as a GoalWriteError", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "ended: a goal that has ended keeps its deadline" } } as never);
    await expect(
      setGoalDeadline({ goalId: "goal-old", clientId: "client-3", today: TODAY, setBy: "coach-5", deadline: "2026-12-02" })
    ).rejects.toMatchObject({ code: "ended" });
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });
});

// A deadline that runs into the next goal is refused with that goal's name and
// start; its own deadline is read after, since a move past the new deadline
// keeps it (lib/goals/goal-write-response.ts).
describe("a refusal that runs into the next goal", () => {
  const RUNS_INTO_TAPER = {
    message: 'deadline_after_next:{"goalId" : "goal-taper", "name" : "Taper", "startsOn" : "2026-12-14"}',
  };
  const FIELDS = {
    type: "lose_weight" as const,
    name: "Cut",
    targetWeight: 77.6,
    targetBodyFatPercentage: null,
    description: null,
    deadline: "2026-12-19",
  };
  const WRITES: Array<[string, () => Promise<unknown>]> = [
    [
      "add",
      () => addGoal({ ...FIELDS, clientId: "client-3", today: TODAY, startsOn: "2026-10-26", source: "coach", setBy: "coach-5" }),
    ],
    [
      "edit",
      () => editGoal({ ...FIELDS, goalId: "goal-cut", clientId: "client-3", today: TODAY, startsOn: "2026-10-26", setBy: "coach-5" }),
    ],
    [
      "deadline",
      () => setGoalDeadline({ goalId: "goal-cut", clientId: "client-3", today: TODAY, setBy: "coach-5", deadline: "2026-12-19" }),
    ],
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    rpc.mockResolvedValue({ data: null, error: RUNS_INTO_TAPER } as never);
  });

  for (const [kind, write] of WRITES) {
    it(`${kind}: carries the next goal's own deadline, its newest, read scoped to the client`, async () => {
      query.maybeSingle.mockResolvedValue({
        data: {
          client_goal_deadlines: [
            { effective_on: "2026-12-14", deadline: "2027-01-08" },
            { effective_on: "2026-12-21", deadline: "2027-01-29" },
          ],
        },
        error: null,
      });

      const refused = await write().catch((error: unknown) => error);
      expect(refused).toBeInstanceOf(GoalWriteError);
      expect(refused).toMatchObject({
        code: "deadline_after_next",
        conflict: { goalId: "goal-taper", name: "Taper", startsOn: "2026-12-14", deadline: "2027-01-29" },
      });
      expect(supabaseAdmin.from).toHaveBeenCalledWith("client_goals");
      expect(query.eq).toHaveBeenCalledWith("id", "goal-taper");
      expect(query.eq).toHaveBeenCalledWith("client_id", "client-3");
    });
  }

  it("carries no deadline for a next goal that has none", async () => {
    query.maybeSingle.mockResolvedValue({
      data: { client_goal_deadlines: [{ effective_on: "2026-12-14", deadline: null }] },
      error: null,
    });
    const refused = (await WRITES[0][1]().catch((error: unknown) => error)) as GoalWriteError;
    expect(refused.conflict).toMatchObject({ goalId: "goal-taper" });
    expect(refused.conflict?.deadline).toBeUndefined();
  });

  // A refusal it can't complete never offers a move it can't vouch for.
  it("fails plainly when the next goal's deadline can't be read", async () => {
    query.maybeSingle.mockResolvedValue({ data: null, error: { message: "statement timeout" } });
    const failed = await WRITES[1][1]().catch((error: unknown) => error);
    expect(failed).not.toBeInstanceOf(GoalWriteError);
    expect((failed as Error).message).toMatch(/statement timeout/);
  });
});
