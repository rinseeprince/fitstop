import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/services/client-goals-service", () => ({
  getCurrentGoals: vi.fn(),
}));
vi.mock("@/services/today-service", () => ({
  getClientTodayString: vi.fn(),
}));

import { getCurrentGoals } from "@/services/client-goals-service";
import { getClientTodayString } from "@/services/today-service";
import { resolveNutritionCalcInputs } from "./nutrition-calc-inputs";
import type { Client } from "@/types/check-in";

// No `goalDeadline` here, deliberately. This fixture used to carry one and the
// ready-arm test asserted it reached the result — through the `?? client
// .goalDeadline` fallback, which was unreachable in production the whole time
// because `mapClientRow` never mapped the column. The cast hides that from tsc,
// so the fallback looked exercised while nothing real could reach it. Deadlines
// now come from `client_goals`, which is where they always came from live.
const CLIENT = {
  id: "client-1",
  currentWeight: 180,
  weightUnit: "lbs",
  bmr: 1800,
  tdee: 2400,
  gender: "male",
  goalWeight: 165,
} as unknown as Client;

describe("resolveNutritionCalcInputs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentGoals).mockResolvedValue(null);
    vi.mocked(getClientTodayString).mockResolvedValue("2026-08-05");
  });

  it("returns a ready arm whose fields match NutritionCalculationInput's names and optionality", async () => {
    // Goal weight from the mirror (that fallback survives), deadline from
    // client_goals (its only source) — the two legs this resolver now has.
    vi.mocked(getCurrentGoals).mockResolvedValue({
      goalDeadline: "2026-12-31",
    } as never);

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
    const result = await resolveNutritionCalcInputs("client-1", {
      ...CLIENT,
      goalWeight: undefined,
    } as unknown as Client);

    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.goalWeightKg).toBeUndefined();
    expect(result.goalDeadline).toBeUndefined();
    expect("goalWeightKg" in result).toBe(true);
  });

  it("no deadline reaches the calculator from the clients mirror", async () => {
    // The deleted fallback, pinned. A `goal_deadline` on the client object can
    // no longer influence the calculator: with no client_goals row the deficit
    // path must see no deadline and fall through to maintenance, rather than
    // solving against a mirror value that has no single writer.
    const withMirrorDeadline = {
      ...CLIENT,
      goalDeadline: "2030-01-01",
    } as unknown as Client;

    const result = await resolveNutritionCalcInputs("client-1", withMirrorDeadline);

    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.goalDeadline).toBeUndefined();
    // The goal WEIGHT mirror leg is untouched by that deletion.
    expect(result.goalWeightKg).toBe(165);
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

  // Without this the coach GET pays for today + goals twice, because it has
  // already resolved both for its own drift check.
  it("uses prefetched today/goals instead of re-querying", async () => {
    await resolveNutritionCalcInputs("client-1", CLIENT, {
      today: "2026-09-09",
      currentGoals: null,
    });

    expect(getClientTodayString).not.toHaveBeenCalled();
    expect(getCurrentGoals).not.toHaveBeenCalled();
  });

  it("falls back to its own reads when nothing is prefetched", async () => {
    await resolveNutritionCalcInputs("client-1", CLIENT);

    expect(getClientTodayString).toHaveBeenCalledWith("client-1");
    expect(getCurrentGoals).toHaveBeenCalledWith("client-1");
  });

  // Two different claims, deliberately not merged under one title. The WEIGHT
  // assertion is a precedence test — there is a mirror value to beat. The
  // deadline is not: it has no mirror leg any more, so asserting it under
  // "wins over the denormalized fields" would name a contest that no longer
  // has two sides.
  it("a live client goal's WEIGHT wins over the denormalized client field", async () => {
    vi.mocked(getCurrentGoals).mockResolvedValue({
      goalWeight: 154,
      goalBodyFatPercentage: null,
    } as never);

    const result = await resolveNutritionCalcInputs("client-1", CLIENT);
    if (result.status !== "ready") throw new Error("expected ready");
    // CLIENT's mirror holds 165.
    expect(result.goalWeightKg).toBe(154);
  });

  it("the deadline comes from client_goals, its only source", async () => {
    vi.mocked(getCurrentGoals).mockResolvedValue({
      goalWeight: 154,
      goalBodyFatPercentage: null,
      goalDeadline: "2027-01-31",
    } as never);

    const result = await resolveNutritionCalcInputs("client-1", CLIENT);
    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.goalDeadline).toBe("2027-01-31");
  });
});
