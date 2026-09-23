import { describe, it, expect, vi, beforeEach } from "vitest";

const query = {
  select: vi.fn(),
  eq: vi.fn(),
  order: vi.fn(),
};

vi.mock("./supabase-admin", () => ({
  supabaseAdmin: { from: vi.fn(() => query) },
}));
vi.mock("./today-service", () => ({ getClientTodayString: vi.fn() }));
vi.mock("./measurements-service", () => ({ getReadingsOnDay: vi.fn() }));

import { supabaseAdmin } from "./supabase-admin";
import { getClientTodayString } from "./today-service";
import { getReadingsOnDay } from "./measurements-service";
import {
  getCurrentGoal,
  getGoalForDate,
  getGoalsOverview,
  getPastGoals,
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

  // The goals sheet floors a goal's start on the client's today, and the
  // delete confirm names the goal a delete of today's puts back in force.
  it("carries the client's today and the goal before today's, as it ended", async () => {
    returns([
      row("g16", "2026-01-05", { name: "Base" }),
      row("g13", "2026-04-13", { name: "Maintain", type: "maintain", target_weight: null }),
      row("g14", "2026-07-27"),
    ]);
    vi.mocked(getReadingsOnDay).mockResolvedValue({});
    const overview = await getGoalsOverview("client-8");
    expect(overview.clientToday).toBe("2026-09-22");
    expect(overview.current?.id).toBe("g14");
    // The one just before today's, never an older one.
    expect(overview.previous).toMatchObject({ id: "g13", name: "Maintain", endsOn: "2026-07-26" });
  });

  it("has no goal before today's when today's is the first, and still carries the client's today", async () => {
    returns([row("g15", "2026-05-18")]);
    vi.mocked(getReadingsOnDay).mockResolvedValue({});
    const withOne = await getGoalsOverview("client-8");
    expect(withOne.previous).toBeNull();

    returns([]);
    const withNone = await getGoalsOverview("client-8");
    expect(withNone).toEqual({ current: null, planned: [], previous: null, clientToday: "2026-09-22" });
  });

  it("gives no current goal before the first one starts, and reads no readings", async () => {
    returns([row("g9", "2026-10-05")]);
    const overview = await getGoalsOverview("client-8");
    expect(overview.current).toBeNull();
    expect(overview.planned.map((g) => g.id)).toEqual(["g9"]);
    expect(getReadingsOnDay).not.toHaveBeenCalled();
  });

  it("lists past goals newest first, each to the day before the next began", async () => {
    returns([row("g10", "2026-01-12"), row("g11", "2026-04-20"), row("g12", "2026-08-31")]);
    const past = await getPastGoals("client-8");
    expect(past.map((g) => [g.id, g.endsOn])).toEqual([
      ["g11", "2026-08-30"],
      ["g10", "2026-04-19"],
    ]);
  });
});
