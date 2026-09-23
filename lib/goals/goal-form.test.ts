import { describe, it, expect } from "vitest";
import { goalBody, goalFormTargets, goalSaveWrites, startsNewGoal, type GoalDraft } from "./goal-form";
import type { GoalOnDay } from "@/types/client-goals";

const TODAY = "2026-10-07";

function stored(overrides: Partial<GoalOnDay> = {}): GoalOnDay {
  return {
    id: "goal-lean",
    clientId: "client-4",
    name: "Lean out",
    type: "lose_weight",
    targetWeight: 78.4,
    targetBodyFatPercentage: null,
    description: "Feel lighter on the bike",
    startsOn: "2026-08-17",
    source: "coach",
    setBy: "coach-2",
    createdAt: "2026-08-17T07:00:00Z",
    updatedAt: "2026-08-17T07:00:00Z",
    deadline: "2026-12-04",
    ...overrides,
  };
}

/** The form as it opened on `goal`, unchanged. */
function draftOf(goal: GoalOnDay, overrides: Partial<GoalDraft> = {}): GoalDraft {
  return {
    type: goal.type,
    name: goal.name,
    targetWeight: goal.targetWeight,
    targetBodyFatPercentage: goal.targetBodyFatPercentage,
    description: goal.description ?? "",
    startsOn: goal.startsOn,
    deadline: goal.deadline,
    ...overrides,
  };
}

describe("goalFormTargets — the targets the form shows", () => {
  it("shows the one the type needs", () => {
    expect(goalFormTargets("lose_weight", null)).toEqual({ weight: true, bodyFat: false });
    expect(goalFormTargets("recomposition", null)).toEqual({ weight: false, bodyFat: true });
    expect(goalFormTargets("event_prep", null)).toEqual({ weight: false, bodyFat: false });
    expect(goalFormTargets(null, null)).toEqual({ weight: false, bodyFat: false });
  });

  it("and any the goal already holds, so none is dropped unseen", () => {
    expect(goalFormTargets("lose_weight", stored({ targetBodyFatPercentage: 17.6 }))).toEqual({
      weight: true,
      bodyFat: true,
    });
    expect(goalFormTargets("maintain", stored())).toEqual({ weight: true, bodyFat: false });
  });
});

describe("goalBody — the draft as a route takes it", () => {
  it("names a nameless goal from its type and drops a blank description", () => {
    expect(goalBody(draftOf(stored(), { type: "build_muscle", name: "  ", description: "   " }))).toMatchObject({
      name: "Build muscle",
      description: null,
    });
  });

  it("trims what the coach typed", () => {
    expect(goalBody(draftOf(stored(), { name: " Cut ", description: " Summer " }))).toMatchObject({
      name: "Cut",
      description: "Summer",
    });
  });
});

// A planned goal starts on 19 Oct; the current one started on 17 Aug.
describe("goalSaveWrites — the writes a save makes", () => {
  it("adds a new goal from the day the form gives", () => {
    const draft: GoalDraft = {
      type: "build_muscle",
      name: "",
      targetWeight: 84.9,
      targetBodyFatPercentage: null,
      description: "",
      startsOn: "2026-10-19",
      deadline: "2027-01-22",
    };
    expect(goalSaveWrites({ stored: null, draft, today: TODAY })).toEqual([
      {
        kind: "add",
        body: {
          type: "build_muscle",
          name: "Build muscle",
          targetWeight: 84.9,
          targetBodyFatPercentage: null,
          description: null,
          deadline: "2027-01-22",
          startsOn: "2026-10-19",
        },
      },
    ]);
  });

  it("rewrites a planned goal whole, on the day the form gives", () => {
    const planned = stored({ id: "goal-build", type: "build_muscle", name: "Build", startsOn: "2026-10-19" });
    const writes = goalSaveWrites({
      stored: planned,
      draft: draftOf(planned, { startsOn: "2026-10-26", targetWeight: 85.3 }),
      today: TODAY,
    });
    expect(writes).toEqual([
      expect.objectContaining({
        kind: "edit",
        goalId: "goal-build",
        body: expect.objectContaining({ startsOn: "2026-10-26", targetWeight: 85.3 }),
      }),
    ]);
  });

  it("rewrites today's goal whole and keeps today as its start", () => {
    const todays = stored({ startsOn: TODAY });
    const writes = goalSaveWrites({
      stored: todays,
      draft: draftOf(todays, { type: "maintain", targetWeight: null, startsOn: null }),
      today: TODAY,
    });
    expect(writes).toEqual([
      expect.objectContaining({ kind: "edit", body: expect.objectContaining({ startsOn: TODAY, type: "maintain" }) }),
    ]);
  });

  it("makes a new goal from today when a started goal's target or type changes", () => {
    const current = stored();
    for (const change of [{ targetWeight: 76.9 }, { type: "maintain" as const }, { targetBodyFatPercentage: 16.3 }]) {
      const writes = goalSaveWrites({ stored: current, draft: draftOf(current, change), today: TODAY });
      expect(writes).toHaveLength(1);
      expect(writes[0]).toMatchObject({ kind: "add", body: { startsOn: TODAY } });
      expect(startsNewGoal(current, draftOf(current, change), TODAY)).toBe(true);
    }
  });

  it("records only the deadline of a started goal when that is all that changed", () => {
    const current = stored();
    expect(goalSaveWrites({ stored: current, draft: draftOf(current, { deadline: "2027-02-12" }), today: TODAY })).toEqual([
      { kind: "deadline", goalId: "goal-lean", deadline: "2027-02-12" },
    ]);
    expect(goalSaveWrites({ stored: current, draft: draftOf(current, { deadline: null }), today: TODAY })).toEqual([
      { kind: "deadline", goalId: "goal-lean", deadline: null },
    ]);
  });

  it("renames a started goal, labels only, and puts the deadline first when both changed", () => {
    const current = stored();
    expect(goalSaveWrites({ stored: current, draft: draftOf(current, { name: "Trim" }), today: TODAY })).toEqual([
      { kind: "rename", goalId: "goal-lean", name: "Trim", description: "Feel lighter on the bike" },
    ]);
    const both = goalSaveWrites({
      stored: current,
      draft: draftOf(current, { name: "Trim", description: "", deadline: "2027-03-05" }),
      today: TODAY,
    });
    expect(both.map((write) => write.kind)).toEqual(["deadline", "rename"]);
    expect(both[1]).toMatchObject({ description: null });
  });

  it("writes nothing when nothing changed — started, planned or today's", () => {
    for (const goal of [stored(), stored({ startsOn: "2026-10-19" }), stored({ startsOn: TODAY })]) {
      expect(goalSaveWrites({ stored: goal, draft: draftOf(goal), today: TODAY })).toEqual([]);
    }
  });

  it("never calls a planned or today's goal a new one", () => {
    const planned = stored({ startsOn: "2026-10-19" });
    expect(startsNewGoal(planned, draftOf(planned, { type: "maintain" }), TODAY)).toBe(false);
    const todays = stored({ startsOn: TODAY });
    expect(startsNewGoal(todays, draftOf(todays, { targetWeight: 74.8 }), TODAY)).toBe(false);
  });
});
