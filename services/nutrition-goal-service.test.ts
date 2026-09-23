import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./today-service", () => ({
  getClientTodayString: vi.fn(),
}));
vi.mock("./client-goals-service", () => ({
  getGoalForDate: vi.fn(),
  listClientGoals: vi.fn(),
}));
vi.mock("./nutrition-calc-inputs", () => ({
  resolveNutritionCalcInputs: vi.fn(),
}));
vi.mock("./nutrition-plan-service", () => ({
  getNutritionVersionGoalsFrom: vi.fn(),
}));

import { getNutritionGoalForDay, getNutritionOutOfDate } from "./nutrition-goal-service";
import { getClientTodayString } from "./today-service";
import { getGoalForDate, listClientGoals } from "./client-goals-service";
import { resolveNutritionCalcInputs } from "./nutrition-calc-inputs";
import { getNutritionVersionGoalsFrom } from "./nutrition-plan-service";
import type { ClientGoal, GoalOnDay } from "@/types/client-goals";
import type { Client } from "@/types/check-in";

const CLIENT = { id: "client-6", currentWeight: 86.3 } as unknown as Client;
const TODAY = "2026-09-23";

const build: GoalOnDay = {
  id: "g-build",
  clientId: "client-6",
  name: "Build",
  type: "build_muscle",
  targetWeight: 89.4,
  targetBodyFatPercentage: null,
  description: null,
  startsOn: "2026-10-19",
  source: "coach",
  setBy: null,
  createdAt: "2026-09-20T08:00:00Z",
  updatedAt: "2026-09-20T08:00:00Z",
  deadline: "2027-01-15",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getClientTodayString).mockResolvedValue(TODAY);
});

describe("getNutritionGoalForDay", () => {
  it("reads the goal on the asked day and hands it — with the client's today — to the save's resolver", async () => {
    vi.mocked(getGoalForDate).mockResolvedValue(build);
    const inputs = { status: "incomplete" as const, missing: ["x"], today: TODAY };
    vi.mocked(resolveNutritionCalcInputs).mockResolvedValue(inputs);

    const result = await getNutritionGoalForDay("client-6", CLIENT, "2026-10-26");

    expect(getGoalForDate).toHaveBeenCalledWith("client-6", "2026-10-26");
    expect(resolveNutritionCalcInputs).toHaveBeenCalledWith("client-6", CLIENT, {
      today: TODAY,
      day: "2026-10-26",
      goal: build,
    });
    expect(result).toEqual({ date: "2026-10-26", goal: build, calcInputs: inputs });
  });
});

describe("getNutritionOutOfDate", () => {
  it("judges the versions with a day left against the goals, from the client's today", async () => {
    const lean: ClientGoal = {
      ...build,
      id: "g-lean",
      name: "Lean out",
      type: "lose_weight",
      targetWeight: 81.2,
      startsOn: "2026-08-03",
      deadlines: [{ effectiveOn: "2026-08-03", deadline: "2026-11-30", setBy: null }],
    };
    const planned: ClientGoal = {
      ...build,
      deadlines: [{ effectiveOn: "2026-10-19", deadline: "2027-01-15", setBy: null }],
    };
    vi.mocked(listClientGoals).mockResolvedValue([lean, planned]);
    vi.mocked(getNutritionVersionGoalsFrom).mockResolvedValue([
      {
        id: "v-run",
        effectiveFrom: "2026-09-01",
        effectiveUntil: "2026-12-06",
        built: { goalWeightKg: 81.2, deadline: "2026-11-30" },
      },
    ]);

    const result = await getNutritionOutOfDate("client-6");

    expect(getNutritionVersionGoalsFrom).toHaveBeenCalledWith("client-6", TODAY);
    expect(listClientGoals).toHaveBeenCalledWith("client-6");
    expect(result).toEqual({
      clientToday: TODAY,
      outOfDate: {
        versionId: "v-run",
        fromDay: "2026-10-19",
        built: { goalWeightKg: 81.2, deadline: "2026-11-30" },
        goal: { goalWeightKg: 89.4, deadline: "2027-01-15" },
        goalName: "Build",
      },
    });
  });

  it("is null when every version fits the goal on its days", async () => {
    vi.mocked(listClientGoals).mockResolvedValue([]);
    vi.mocked(getNutritionVersionGoalsFrom).mockResolvedValue([
      { id: "v-m", effectiveFrom: TODAY, effectiveUntil: "2026-11-17", built: { goalWeightKg: null, deadline: null } },
    ]);

    expect(await getNutritionOutOfDate("client-6")).toEqual({ clientToday: TODAY, outOfDate: null });
  });
});
