import { describe, it, expect } from "vitest";
import type { ClientGoal } from "@/types/client-goals";
import { deadlineOnDay, goalAsOf, goalChangedOn, goalOnDay, plannedGoals } from "./goal-timeline";

function goal(
  id: string,
  startsOn: string,
  deadlines: Array<[effectiveOn: string, deadline: string | null]>,
  targetWeight: number | null = null
): ClientGoal {
  return {
    id,
    clientId: "client-7",
    name: `Goal ${id}`,
    type: "lose_weight",
    targetWeight,
    targetBodyFatPercentage: null,
    description: null,
    startsOn,
    source: "coach",
    setBy: null,
    createdAt: "2026-01-02T08:00:00Z",
    updatedAt: "2026-01-02T08:00:00Z",
    deadlines: deadlines.map(([effectiveOn, deadline]) => ({ effectiveOn, deadline, setBy: null })),
  };
}

// Cut runs from 3 Feb; Build replaced it from 10 Mar; Peak is planned for 20 Sep.
const cut = goal("cut", "2026-02-03", [["2026-02-03", "2026-04-30"]], 71);
const build = goal(
  "build",
  "2026-03-10",
  [
    ["2026-03-10", null],
    ["2026-05-14", "2026-08-29"],
    ["2026-06-02", "2026-09-12"],
  ],
  78
);
const peak = goal("peak", "2026-09-20", [["2026-09-20", "2026-11-06"]], 74);
const goals = [peak, cut, build];

describe("goalOnDay", () => {
  it("is the latest goal starting on or before the day", () => {
    expect(goalOnDay(goals, "2026-02-03")?.id).toBe("cut");
    expect(goalOnDay(goals, "2026-03-09")?.id).toBe("cut");
    expect(goalOnDay(goals, "2026-03-10")?.id).toBe("build");
    expect(goalOnDay(goals, "2026-09-19")?.id).toBe("build");
  });

  it("keeps a planned goal off every day before its own, then hands it the day", () => {
    expect(goalOnDay(goals, "2026-09-19")?.id).not.toBe("peak");
    expect(goalOnDay(goals, "2026-09-20")?.id).toBe("peak");
  });

  it("is null before the first goal", () => {
    expect(goalOnDay(goals, "2026-02-02")).toBeNull();
    expect(goalOnDay([], "2026-05-05")).toBeNull();
  });
});

describe("deadlineOnDay", () => {
  it("is the newest entry on or before the day", () => {
    expect(deadlineOnDay(build, "2026-04-01")).toBeNull();
    expect(deadlineOnDay(build, "2026-05-14")).toBe("2026-08-29");
    expect(deadlineOnDay(build, "2026-05-31")).toBe("2026-08-29");
    expect(deadlineOnDay(build, "2026-07-15")).toBe("2026-09-12");
  });

  it("reads a goal that has not started yet as the deadline it starts with", () => {
    expect(deadlineOnDay(peak, "2026-09-01")).toBe("2026-11-06");
  });
});

describe("goalChangedOn", () => {
  it("is the goal's start until its deadline first changes, then the day of the latest change", () => {
    expect(goalChangedOn(build, "2026-04-21")).toBe("2026-03-10");
    expect(goalChangedOn(build, "2026-05-14")).toBe("2026-05-14");
    expect(goalChangedOn(build, "2026-07-08")).toBe("2026-06-02");
  });

  it("is a planned goal's own start, read before it", () => {
    expect(goalChangedOn(peak, "2026-08-25")).toBe("2026-09-20");
  });
});

describe("goalAsOf", () => {
  it("is the goal without its list, carrying the day's deadline", () => {
    const onDay = goalAsOf(build, "2026-05-20");
    expect(onDay).not.toHaveProperty("deadlines");
    expect(onDay).toMatchObject({ id: "build", targetWeight: 78, deadline: "2026-08-29" });
  });
});

describe("plannedGoals", () => {
  it("lists goals dated after today, soonest first, each with its starting deadline", () => {
    const later = goal("later", "2026-12-01", [["2026-12-01", null]], 69);
    expect(plannedGoals([later, ...goals], "2026-09-18").map((g) => [g.id, g.deadline])).toEqual([
      ["peak", "2026-11-06"],
      ["later", null],
    ]);
  });

  it("lists nothing once a planned goal's day arrives", () => {
    expect(plannedGoals(goals, "2026-09-20")).toEqual([]);
  });
});
