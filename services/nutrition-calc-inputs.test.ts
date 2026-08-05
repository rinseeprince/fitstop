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
    expect(result.currentWeightKg).toBeCloseTo(180 / 2.205, 4);
    expect(result.goalWeightKg).toBeCloseTo(165 / 2.205, 4);
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

  it("prefers body_metrics over the denormalized client cache", async () => {
    vi.mocked(getLatestBodyMetrics).mockResolvedValue({
      weight: 200,
      weightUnit: "lbs",
      bmr: 1900,
      tdee: 2500,
    } as never);

    const result = await resolveNutritionCalcInputs("client-1", CLIENT);
    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.bmr).toBe(1900);
    expect(result.tdee).toBe(2500);
    expect(result.currentWeightKg).toBeCloseTo(200 / 2.205, 4);
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
    expect(result.goalWeightKg).toBeCloseTo(154 / 2.205, 4);
    expect(result.goalDeadline).toBe("2027-01-31");
    expect(result.startDate).toBe("2026-10-01");
  });
});
