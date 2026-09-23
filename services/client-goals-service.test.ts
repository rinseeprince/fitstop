import { describe, it, expect, vi, beforeEach } from "vitest";

const query = {
  select: vi.fn(),
  eq: vi.fn(),
  order: vi.fn(),
};
const versionsQuery = {
  select: vi.fn(),
  eq: vi.fn(),
  gte: vi.fn(),
  order: vi.fn(),
};

vi.mock("./supabase-admin", () => ({
  supabaseAdmin: { from: vi.fn((table: string) => (table === "nutrition_plans" ? versionsQuery : query)) },
}));
vi.mock("./today-service", () => ({ getClientTodayString: vi.fn() }));
vi.mock("./measurements-service", () => ({ getReadingsOnDay: vi.fn() }));
vi.mock("./training-service", () => ({ getTrainingPlansOverlapping: vi.fn() }));

import { supabaseAdmin } from "./supabase-admin";
import { getClientTodayString } from "./today-service";
import { getReadingsOnDay } from "./measurements-service";
import { getTrainingPlansOverlapping } from "./training-service";
import {
  getCurrentGoal,
  getGoalForDate,
  getGoalHistory,
  getGoalsOverview,
  listClientGoals,
} from "./client-goals-service";

type Row = Record<string, unknown>;

function row(id: string, startsOn: string, overrides: Row = {}, deadlines: Row[] = []): Row {
  return {
    id,
    client_id: "client-8",
    name: `Goal ${id}`,
    type: "lose_weight",
    target_weight: 76.2,
    target_body_fat_percentage: null,
    description: null,
    starts_on: startsOn,
    source: "coach",
    set_by: "coach-2",
    created_at: "2026-03-04T10:00:00Z",
    updated_at: "2026-03-04T10:00:00Z",
    client_goal_deadlines: deadlines,
    ...overrides,
  };
}

function returns(rows: Row[]) {
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockResolvedValue({ data: rows, error: null });
}

describe("the goals read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getClientTodayString).mockResolvedValue("2026-09-22");
  });

  it("reads the client's goals with their deadlines, scoped to the client", async () => {
    returns([
      row(
        "g1",
        "2026-04-06",
        { target_weight: "81.45", target_body_fat_percentage: "17.5" },
        [
          { effective_on: "2026-06-01", deadline: "2026-10-30", set_by: "coach-2" },
          { effective_on: "2026-04-06", deadline: null, set_by: null },
        ]
      ),
    ]);
    const [goal] = await listClientGoals("client-8");
    expect(supabaseAdmin.from).toHaveBeenCalledWith("client_goals");
    expect(query.eq).toHaveBeenCalledWith("client_id", "client-8");
    expect(goal).toMatchObject({ id: "g1", targetWeight: 81.45, targetBodyFatPercentage: 17.5, startsOn: "2026-04-06" });
    expect(goal.deadlines.map((d) => d.effectiveOn)).toEqual(["2026-04-06", "2026-06-01"]);
  });

  it("refuses a row whose type is not one of the six", async () => {
    returns([row("g2", "2026-05-11", { type: "fat_loss" })]);
    await expect(listClientGoals("client-8")).rejects.toThrow(/unknown type/);
  });

  it("throws a failed read rather than answering with no goal", async () => {
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.order.mockResolvedValue({ data: null, error: { message: "timeout" } });
    await expect(listClientGoals("client-8")).rejects.toThrow(/timeout/);
  });

  it("answers the goal in force on a day, with that day's deadline", async () => {
    returns([
      row("g3", "2026-02-09", {}, [{ effective_on: "2026-02-09", deadline: "2026-05-29", set_by: null }]),
      row("g4", "2026-07-13", { target_weight: 73.8 }, [{ effective_on: "2026-07-13", deadline: null, set_by: null }]),
    ]);
    expect(await getGoalForDate("client-8", "2026-07-12")).toMatchObject({ id: "g3", deadline: "2026-05-29" });
    expect(await getGoalForDate("client-8", "2026-07-13")).toMatchObject({ id: "g4", targetWeight: 73.8, deadline: null });
  });

  it("keeps a planned goal out of today's until its day", async () => {
    returns([
      row("g5", "2026-08-03"),
      row("g6", "2026-09-23", { target_weight: 70.6 }),
    ]);
    expect(await getCurrentGoal("client-8")).toMatchObject({ id: "g5" });
    vi.mocked(getClientTodayString).mockResolvedValue("2026-09-23");
    expect(await getCurrentGoal("client-8")).toMatchObject({ id: "g6" });
  });

  it("gives the Overview today's goal with the readings on its start day, and the planned ones", async () => {
    returns([
      row("g7", "2026-06-15", {}, [{ effective_on: "2026-06-15", deadline: "2026-12-04", set_by: null }]),
      row("g8", "2026-10-19", { name: "Peak" }, [{ effective_on: "2026-10-19", deadline: "2027-01-08", set_by: null }]),
    ]);
    vi.mocked(getReadingsOnDay).mockResolvedValue({
      weight: { id: "r3", metricKey: "weight", value: 84.3, date: "2026-06-14", source: "check_in" },
    });
    const overview = await getGoalsOverview("client-8");
    expect(getReadingsOnDay).toHaveBeenCalledWith("client-8", "2026-06-15");
    expect(overview.current).toMatchObject({
      id: "g7",
      deadline: "2026-12-04",
      startReadings: { weight: 84.3, bodyFat: null },
    });
    expect(overview.planned.map((g) => [g.id, g.deadline])).toEqual([["g8", "2027-01-08"]]);
  });

  // The goals sheet floors a goal's start on the client's today.
  it("carries the client's today, with a goal or without one", async () => {
    returns([row("g14", "2026-07-27")]);
    vi.mocked(getReadingsOnDay).mockResolvedValue({});
    const withOne = await getGoalsOverview("client-8");
    expect(withOne.clientToday).toBe("2026-09-22");
    expect(withOne.current?.id).toBe("g14");

    returns([]);
    const withNone = await getGoalsOverview("client-8");
    expect(withNone).toEqual({ current: null, planned: [], clientToday: "2026-09-22" });
  });

  it("gives no current goal before the first one starts, and reads no readings", async () => {
    returns([row("g9", "2026-10-05")]);
    const overview = await getGoalsOverview("client-8");
    expect(overview.current).toBeNull();
    expect(overview.planned.map((g) => g.id)).toEqual(["g9"]);
    expect(getReadingsOnDay).not.toHaveBeenCalled();
  });

});

describe("the goals table read", () => {
  function versionsReturn(rows: Row[], error: unknown = null) {
    versionsQuery.select.mockReturnValue(versionsQuery);
    versionsQuery.eq.mockReturnValue(versionsQuery);
    versionsQuery.gte.mockReturnValue(versionsQuery);
    versionsQuery.order.mockResolvedValue({ data: error ? null : rows, error });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getClientTodayString).mockResolvedValue("2026-09-22");
    vi.mocked(getTrainingPlansOverlapping).mockResolvedValue([]);
    versionsReturn([]);
  });

  it("reads nothing more for a client with no goals", async () => {
    returns([]);
    expect(await getGoalHistory("client-8")).toEqual([]);
    expect(getTrainingPlansOverlapping).not.toHaveBeenCalled();
    expect(supabaseAdmin.from).not.toHaveBeenCalledWith("nutrition_plans");
  });

  it("reads the programs from the day before the first goal on, and the versions from its first day", async () => {
    returns([row("g20", "2026-03-02"), row("g21", "2026-06-22", { name: "Build" })]);
    vi.mocked(getTrainingPlansOverlapping).mockResolvedValue([
      { id: "plan-2", name: "Base", effectiveFrom: "2026-03-02", effectiveUntil: "2026-05-24" },
    ]);
    versionsReturn([
      {
        effective_from: "2026-03-02",
        effective_until: "2026-06-21",
        baseline_calories: 2460,
        custom_macros_enabled: true,
        custom_calories: 2310,
        goal_weight_kg: "77.9",
        goal_deadline: "2026-06-19",
      },
    ]);

    const history = await getGoalHistory("client-8");

    expect(getTrainingPlansOverlapping).toHaveBeenCalledWith("client-8", "2026-03-01", null);
    expect(versionsQuery.eq).toHaveBeenCalledWith("client_id", "client-8");
    expect(versionsQuery.eq).toHaveBeenCalledWith("status", "active");
    expect(versionsQuery.gte).toHaveBeenCalledWith("effective_until", "2026-03-02");
    expect(history.map((goal) => [goal.id, goal.status, goal.endsOn])).toEqual([
      ["g21", "current", null],
      ["g20", "ended", "2026-06-21"],
    ]);
    // The coach's custom calories, and the goal the version was priced for
    expect(history[1].lines).toEqual([
      {
        kind: "nutrition",
        on: "2026-03-02",
        until: "2026-06-21",
        calories: 2310,
        builtFor: { goalWeightKg: 77.9, deadline: "2026-06-19" },
      },
      { kind: "program", on: "2026-03-02", change: "starts", name: "Base" },
      { kind: "program", on: "2026-05-24", change: "ends", name: "Base" },
    ]);
  });

  it("throws a failed read of the versions rather than a table missing them", async () => {
    returns([row("g22", "2026-04-13")]);
    versionsReturn([], { message: "timeout" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(getGoalHistory("client-8")).rejects.toThrow(/timeout/);
  });
});
