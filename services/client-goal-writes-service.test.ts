import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ClientGoal } from "@/types/client-goals";

vi.mock("./supabase-admin", () => ({ supabaseAdmin: { rpc: vi.fn() } }));
vi.mock("./today-service", () => ({ getClientTodayString: vi.fn() }));
vi.mock("./measurements-service", () => ({ getReadingsOnDay: vi.fn() }));
vi.mock("./client-goals-service", () => ({ listClientGoals: vi.fn() }));

import { supabaseAdmin } from "./supabase-admin";
import { getClientTodayString } from "./today-service";
import { getReadingsOnDay } from "./measurements-service";
import { listClientGoals } from "./client-goals-service";
import {
  addGoal,
  GoalWriteError,
  saveDetailsSheetGoal,
  setGoalDeadline,
  toGoalWriteError,
} from "./client-goal-writes-service";

const rpc = vi.mocked(supabaseAdmin.rpc);
const TODAY = "2026-09-22";

function goal(overrides: Partial<ClientGoal>): ClientGoal {
  return {
    id: "goal-running",
    clientId: "client-3",
    name: "Lose weight",
    type: "lose_weight",
    targetWeight: 74.5,
    targetBodyFatPercentage: 16,
    description: "Feel lighter on the bike",
    startsOn: "2026-07-01",
    source: "intake",
    setBy: null,
    createdAt: "2026-07-01T09:00:00Z",
    updatedAt: "2026-07-01T09:00:00Z",
    deadlines: [{ effectiveOn: "2026-07-01", deadline: "2026-12-18", setBy: null }],
    ...overrides,
  };
}

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
  });
});

describe("the details sheet's save", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getClientTodayString).mockResolvedValue(TODAY);
    vi.mocked(getReadingsOnDay).mockResolvedValue({
      weight: { id: "r1", metricKey: "weight", value: 79.6, date: "2026-09-20", source: "check_in" },
    });
  });

  it("records a deadline-only change against today's goal", async () => {
    vi.mocked(listClientGoals).mockResolvedValue([goal({})]);
    rpcReturns(true);
    const saved = await saveDetailsSheetGoal("client-3", { goalDeadline: "2027-01-15" }, "coach-5");
    expect(saved).toEqual({ wrote: "deadline", goalId: "goal-running" });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("set_client_goal_deadline", expect.objectContaining({ p_deadline: "2027-01-15" }));
  });

  it("writes nothing when nothing differs from today's goal", async () => {
    vi.mocked(listClientGoals).mockResolvedValue([goal({})]);
    const saved = await saveDetailsSheetGoal("client-3", { goalWeight: 74.5, goalDeadline: "2026-12-18" }, "coach-5");
    expect(saved).toEqual({ wrote: "nothing", goalId: "goal-running" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("makes a new goal from today when a target changes, typed and named from its targets, keeping the deadline", async () => {
    vi.mocked(listClientGoals).mockResolvedValue([goal({})]);
    rpcReturns("goal-from-today");
    const saved = await saveDetailsSheetGoal("client-3", { goalWeight: 83.2 }, "coach-5");
    expect(saved).toEqual({ wrote: "create", goalId: "goal-from-today" });
    expect(rpc).toHaveBeenCalledWith("add_client_goal", {
      p_client_id: "client-3",
      p_today: TODAY,
      p_starts_on: TODAY,
      p_type: "build_muscle",
      p_name: "Build muscle",
      p_source: "coach",
      p_set_by: "coach-5",
      p_target_weight: 83.2,
      p_target_body_fat_percentage: 16,
      p_deadline: "2026-12-18",
    });
  });

  it("corrects today's goal in place when it started today", async () => {
    vi.mocked(listClientGoals).mockResolvedValue([
      goal({}),
      goal({ id: "goal-today", startsOn: TODAY, deadlines: [{ effectiveOn: TODAY, deadline: null, setBy: null }] }),
    ]);
    rpcReturns(true);
    const saved = await saveDetailsSheetGoal("client-3", { goalBodyFatPercentage: null }, "coach-5");
    expect(saved).toEqual({ wrote: "edit", goalId: "goal-today" });
    expect(rpc).toHaveBeenCalledWith("edit_client_goal", {
      p_goal_id: "goal-today",
      p_client_id: "client-3",
      p_today: TODAY,
      p_type: "lose_weight",
      p_name: "Lose weight",
      p_starts_on: TODAY,
      p_set_by: "coach-5",
      p_target_weight: 74.5,
      p_description: "Feel lighter on the bike",
    });
  });

  it("gives a client with no goal their first, from today", async () => {
    vi.mocked(listClientGoals).mockResolvedValue([]);
    rpcReturns("goal-first");
    await saveDetailsSheetGoal("client-3", { goalWeight: 72.9, goalDeadline: "2027-02-26" }, "coach-5");
    expect(rpc).toHaveBeenCalledWith(
      "add_client_goal",
      expect.objectContaining({ p_type: "lose_weight", p_starts_on: TODAY, p_deadline: "2027-02-26" })
    );
  });

  it("leaves a planned goal out of today's", async () => {
    vi.mocked(listClientGoals).mockResolvedValue([
      goal({}),
      goal({ id: "goal-planned", startsOn: "2026-10-12", targetWeight: 70.1 }),
    ]);
    rpcReturns(true);
    await saveDetailsSheetGoal("client-3", { goalDeadline: null }, "coach-5");
    expect(rpc).toHaveBeenCalledWith("set_client_goal_deadline", expect.objectContaining({ p_goal_id: "goal-running" }));
  });
});
