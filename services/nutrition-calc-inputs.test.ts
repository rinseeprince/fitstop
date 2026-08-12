import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/services/body-metrics-service", () => ({
  getLatestBodyMetrics: vi.fn(),
}));
vi.mock("@/services/client-goals-service", () => ({
  getCurrentGoals: vi.fn(),
}));
vi.mock("@/services/today-service", () => ({
  getClientTodayString: vi.fn(),
}));

import { getLatestBodyMetrics } from "@/services/body-metrics-service";
import { getCurrentGoals } from "@/services/client-goals-service";
import { getClientTodayString } from "@/services/today-service";
import { resolveNutritionCalcInputs } from "./nutrition-calc-inputs";
import type { Client } from "@/types/check-in";

const CLIENT = {
  id: "client-1",
  currentWeight: 180,
  weightUnit: "lbs",
  bmr: 1800,
  tdee: 2400,
  gender: "male",
  goalWeight: 165,
  goalDeadline: "2026-12-31",
} as unknown as Client;

describe("resolveNutritionCalcInputs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getLatestBodyMetrics).mockResolvedValue(null);
    vi.mocked(getCurrentGoals).mockResolvedValue(null);
    vi.mocked(getClientTodayString).mockResolvedValue("2026-08-05");
  });

  it("returns a ready arm whose fields match NutritionCalculationInput's names and optionality", async () => {
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
    // Named `startDate`, NOT `goalStartDate`. The calculator's field is
    // optional, so a mismatched name would compile and silently fall back to
    // today — weakening the deficit for a future-dated goal start.
    expect(result.startDate).toBe("2026-08-05");
    expect(result.today).toBe("2026-08-05");
  });

  it("converts an absent goal to undefined, not null, so the spread satisfies the calculator", async () => {
    const result = await resolveNutritionCalcInputs("client-1", {
      ...CLIENT,
      goalWeight: undefined,
      goalDeadline: undefined,
    } as unknown as Client);

    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.goalWeightKg).toBeUndefined();
    expect(result.goalDeadline).toBeUndefined();
    expect("goalWeightKg" in result).toBe(true);
  });

  // The two halves of this ladder run in opposite directions on purpose.
  it("prefers body_metrics over the client cache for WEIGHT", async () => {
    // A backdated coach entry is deliberately withheld from the clients cache,
    // so the newest event can be the truer latest measurement.
    vi.mocked(getLatestBodyMetrics).mockResolvedValue({
      weight: 200,
      bmr: 1900,
      tdee: 2500,
    } as never);

    const result = await resolveNutritionCalcInputs("client-1", CLIENT);
    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.currentWeightKg).toBe(200);
  });

  it("prefers the PROFILE over body_metrics for the energy pair", async () => {
    // A generated plan's every calorie rests on this bmr. The body_metrics row
    // a plan save leaves behind carries the PLAN's numbers, so preferring it
    // would rebuild each plan from the previous plan's snapshot rather than the
    // client's current metabolism.
    vi.mocked(getLatestBodyMetrics).mockResolvedValue({
      weight: 200,
      bmr: 1850,
      tdee: 3515,
    } as never);

    const result = await resolveNutritionCalcInputs("client-1", {
      ...CLIENT,
      bmr: 3712,
      tdee: 4454,
    });
    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.bmr).toBe(3712);
    expect(result.tdee).toBe(4454);
  });

  it("falls back to body_metrics when the profile pair is still NULL", async () => {
    // A rescue, not a preference: a client the energy helper has never reached
    // must not 400 the plan save.
    vi.mocked(getLatestBodyMetrics).mockResolvedValue({
      weight: 200,
      bmr: 1900,
      tdee: 2500,
    } as never);

    const result = await resolveNutritionCalcInputs("client-1", {
      ...CLIENT,
      bmr: undefined,
      tdee: undefined,
    });
    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.bmr).toBe(1900);
    expect(result.tdee).toBe(2500);
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

  it("lets a live client goal win over the denormalized client fields", async () => {
    vi.mocked(getCurrentGoals).mockResolvedValue({
      goalWeight: 154,
      goalBodyFatPercentage: null,
      goalDeadline: "2027-01-31",
      goalStartDate: "2026-10-01",
    } as never);

    const result = await resolveNutritionCalcInputs("client-1", CLIENT);
    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.goalWeightKg).toBe(154);
    expect(result.goalDeadline).toBe("2027-01-31");
    expect(result.startDate).toBe("2026-10-01");
  });
});
