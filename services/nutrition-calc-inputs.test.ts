import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/services/client-goals-service", () => ({
  getGoalForDate: vi.fn(),
}));
vi.mock("@/services/today-service", () => ({
  getClientTodayString: vi.fn(),
}));

import { getGoalForDate } from "@/services/client-goals-service";
import { getClientTodayString } from "@/services/today-service";
import { resolveNutritionCalcInputs } from "./nutrition-calc-inputs";
import type { Client } from "@/types/check-in";
import type { GoalOnDay } from "@/types/client-goals";

// The client record carries the weight and the energy pair. It carries no
// goal: the goal is the one in force on the client's today, read through the
// goals service.
const CLIENT = {
  id: "client-1",
  currentWeight: 180,
  weightUnit: "lbs",
  bmr: 1800,
  tdee: 2400,
  gender: "male",
} as unknown as Client;

/** The goal in force on a day, as the goals service returns it. */
const goalOnDay = (overrides: Partial<GoalOnDay> = {}): GoalOnDay => ({
  id: "goal-now",
  clientId: "client-1",
  name: "Lose weight",
  type: "lose_weight",
  targetWeight: null,
  targetBodyFatPercentage: null,
  description: null,
  startsOn: "2026-07-13",
  source: "coach",
  setBy: "coach-1",
  createdAt: "2026-07-13T09:00:00+00:00",
  updatedAt: "2026-07-13T09:00:00+00:00",
  deadline: null,
  ...overrides,
});

describe("resolveNutritionCalcInputs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGoalForDate).mockResolvedValue(null);
    vi.mocked(getClientTodayString).mockResolvedValue("2026-08-05");
  });

  it("returns a ready arm whose fields match NutritionCalculationInput's names and optionality", async () => {
    // The weight target and the deadline come from one goal: the one in force
    // on the client's today.
    vi.mocked(getGoalForDate).mockResolvedValue(
      goalOnDay({ targetWeight: 165, deadline: "2026-12-31" })
    );

    const result = await resolveNutritionCalcInputs("client-1", CLIENT);

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;

    expect(result.bmr).toBe(1800);
    expect(result.gender).toBe("male");
    // Stored values are kilograms (migration 141), so these pass through
    // untouched. Previously both were divided by 2.205. Asserting the exact
    // input value means a reintroduced conversion fails here rather than
    // producing a plausible-looking number.
    expect(result.currentWeightKg).toBe(180);
    expect(result.goalWeightKg).toBe(165);
    expect(result.goalDeadline).toBe("2026-12-31");
    expect(result.today).toBe("2026-08-05");
    // No `startDate`. The calculator's window starts at the day the plan takes
    // effect, which the orchestrator and the drawer hand in themselves (commit
    // 8bb); a start riding here would be a second lever on that window.
    expect("startDate" in result).toBe(false);
  });

  it("converts an absent goal to undefined, not null, so the spread satisfies the calculator", async () => {
    // No goal in force on the client's today: maintenance.
    const result = await resolveNutritionCalcInputs("client-1", CLIENT);

    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.goalWeightKg).toBeUndefined();
    expect(result.goalDeadline).toBeUndefined();
    expect("goalWeightKg" in result).toBe(true);
  });

  // The calculator needs both a weight target and a deadline to solve for a
  // deficit; a goal missing either reaches it as maintenance.
  it("a goal with no weight target hands the calculator no goal weight", async () => {
    vi.mocked(getGoalForDate).mockResolvedValue(
      goalOnDay({ type: "recomposition", targetBodyFatPercentage: 16.5, deadline: "2026-11-27" })
    );

    const result = await resolveNutritionCalcInputs("client-1", CLIENT);

    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.goalWeightKg).toBeUndefined();
    expect(result.goalDeadline).toBe("2026-11-27");
  });

  it("a goal with no deadline hands the calculator no deadline", async () => {
    vi.mocked(getGoalForDate).mockResolvedValue(goalOnDay({ targetWeight: 171.5 }));

    const result = await resolveNutritionCalcInputs("client-1", CLIENT);

    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.goalWeightKg).toBe(171.5);
    expect(result.goalDeadline).toBeUndefined();
  });

  // Both inputs come from the client object and nowhere else: the weight is
  // the newest reading in the measurement log (read into `Client.currentWeight`
  // from `client_current_measurements`), the pair is the profile's. There is
  // no second source to prefer or to fall back on.
  it("takes the WEIGHT from the client object — the log's newest reading", async () => {
    const result = await resolveNutritionCalcInputs("client-1", {
      ...CLIENT,
      currentWeight: 200,
    });
    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.currentWeightKg).toBe(200);
  });

  it("takes the energy pair from the client object, each half from its own field", async () => {
    // A generated plan's every calorie rests on this bmr, and TDEE is consumed
    // directly rather than re-derived — so the two must pass through unmixed.
    const result = await resolveNutritionCalcInputs("client-1", {
      ...CLIENT,
      bmr: 3712,
      tdee: 4454,
    });
    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.bmr).toBe(3712);
    expect(result.tdee).toBe(4454);
  });

  it("takes the activity level from the CLIENT, not a request body", async () => {
    // It used to arrive from a dropdown in the nutrition drawer, so activity
    // had two homes — clients.work_activity_level and the plan's — and they
    // routinely disagreed about how active the same person was.
    const result = await resolveNutritionCalcInputs("client-1", {
      ...CLIENT,
      workActivityLevel: "very_active",
    });
    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.workActivityLevel).toBe("very_active");
  });

  it("defaults the activity level when the client has never had one set", async () => {
    const result = await resolveNutritionCalcInputs("client-1", {
      ...CLIENT,
      workActivityLevel: undefined,
    });
    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.workActivityLevel).toBe("sedentary");
  });

  it("a profile with no pair is incomplete — nothing rescues it", async () => {
    // The rescue that used to read the pair off the event log is gone with the
    // log: a client the energy helper has never reached is reported as such,
    // never costed against an invented metabolism.
    const result = await resolveNutritionCalcInputs("client-1", {
      ...CLIENT,
      bmr: undefined,
      tdee: undefined,
    });

    expect(result.status).toBe("incomplete");
    if (result.status !== "incomplete") return;
    expect(result.missing.join(" ")).toContain("BMR");
  });

  // The whole reason this is a union: a read path must be able to render
  // "why not" without a 500, and the write path turns the same value into a
  // 400. A nullable bag plus a boolean would not narrow, leaving the browser
  // to assert non-null over `bmr` and render NaN when it is wrong.
  it("returns incomplete (never throws) when the client is missing BMR", async () => {
    const result = await resolveNutritionCalcInputs("client-1", {
      ...CLIENT,
      bmr: undefined,
    } as unknown as Client);

    expect(result.status).toBe("incomplete");
    if (result.status !== "incomplete") return;
    expect(result.missing.join(" ")).toContain("BMR");
    // The UI still needs the date even when the calc cannot run.
    expect(result.today).toBe("2026-08-05");
  });

  it("reports every missing field at once", async () => {
    const result = await resolveNutritionCalcInputs("client-1", {
      id: "client-1",
    } as unknown as Client);

    if (result.status !== "incomplete") throw new Error("expected incomplete");
    expect(result.missing.length).toBeGreaterThanOrEqual(3);
  });

  // Without this the coach GET pays for today + the goal twice, because it has
  // already resolved both for its own drift check.
  it("uses prefetched today and goal instead of re-querying", async () => {
    await resolveNutritionCalcInputs("client-1", CLIENT, {
      today: "2026-09-09",
      goal: null,
    });

    expect(getClientTodayString).not.toHaveBeenCalled();
    expect(getGoalForDate).not.toHaveBeenCalled();
  });

  it("takes the weight target and the deadline from a prefetched goal", async () => {
    const result = await resolveNutritionCalcInputs("client-1", CLIENT, {
      today: "2026-09-09",
      goal: goalOnDay({ targetWeight: 158.5, deadline: "2027-01-31" }),
    });

    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.goalWeightKg).toBe(158.5);
    expect(result.goalDeadline).toBe("2027-01-31");
  });

  it("falls back to its own reads when nothing is prefetched: the goal in force on the client's today", async () => {
    await resolveNutritionCalcInputs("client-1", CLIENT);

    expect(getClientTodayString).toHaveBeenCalledWith("client-1");
    expect(getGoalForDate).toHaveBeenCalledWith("client-1", "2026-08-05");
  });

  // The plan POST hands in the today it already resolved and no goal: the goal
  // read must ask for THAT day, or a save near the client's midnight would
  // price itself against another day's goal.
  it("reads the goal in force on a prefetched today", async () => {
    await resolveNutritionCalcInputs("client-1", CLIENT, { today: "2026-09-14" });

    expect(getClientTodayString).not.toHaveBeenCalled();
    expect(getGoalForDate).toHaveBeenCalledWith("client-1", "2026-09-14");
  });
});
