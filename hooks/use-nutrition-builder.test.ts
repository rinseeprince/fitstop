import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useNutritionBuilder } from "./use-nutrition-builder";
import { generateNutritionPlan } from "@/services/nutrition-service";
import type { NutritionCalcInputs } from "@/services/nutrition-calc-inputs";
import type { Client } from "@/types/check-in";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/use-nutrition-calendar-events", () => ({
  useInvalidateNutritionCalendar: () => vi.fn().mockResolvedValue(undefined),
}));

// What the coach GET ships, held where the module mock below can reach it.
const planState = vi.hoisted(() => ({
  nutritionData: null as unknown,
  refetchNutrition: vi.fn(),
}));
vi.mock("@/hooks/use-nutrition-plan", () => ({
  useNutritionPlan: ({ client }: { client: unknown }) => ({
    client,
    hasPlan: false,
    hasTrainingPlan: false,
    trainingPlanName: null,
    isLoadingTrainingPlan: false,
    showRegenerationBanner: false,
    nutritionData: planState.nutritionData,
    isLoadingNutrition: false,
    refetchNutrition: planState.refetchNutrition,
  }),
}));

// A 5 kg goal 91 days out from the CLIENT's today — a fixed day, deliberately
// not the machine's, so the default below is provably the client's and not
// the browser's. Under the weekly safety cap from today and from three weeks
// later, so the two windows yield two different deficits.
const CLIENT_TODAY = "2026-07-02";
const THREE_WEEKS_OUT = "2026-07-23";
const CALC_INPUTS: NutritionCalcInputs = {
  status: "ready",
  currentWeightKg: 85,
  bmr: 1800,
  gender: "male",
  tdee: 2400,
  workActivityLevel: "sedentary",
  goalWeightKg: 80,
  goalDeadline: "2026-09-30",
  startDate: CLIENT_TODAY,
  today: CLIENT_TODAY,
};

const CLIENT = {
  id: "client-1",
  name: "Alex Doe",
  currentWeight: 85,
  bmr: 1800,
  tdee: 2400,
  gender: "male",
  includeActivityBurn: true,
  surplusAsCarbs: false,
} as unknown as Client;

function okResponse(): Response {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        success: true,
        plan: { calorieTarget: 2000, proteinTargetG: 170, warnings: [] },
      }),
  } as unknown as Response;
}

function postedBody(spy: ReturnType<typeof mockFetch>): Record<string, unknown> {
  const call = spy.mock.calls.find(([, init]) => init?.method === "POST");
  if (!call) throw new Error("no POST was made");
  return JSON.parse(call[1]?.body as string) as Record<string, unknown>;
}

function mockFetch() {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(okResponse());
}

// The day the plan takes effect (docs/MEASUREMENT-LOG-PLAN.md commit 8bb): a
// drawer setting picked before the save, which the preview and the save both
// compute from. The deficit used to be spread from the day of the calculation
// whatever date the coach picked, so a cut queued weeks out understated it.
describe("useNutritionBuilder — the day the plan takes effect", () => {
  beforeEach(() => {
    planState.nutritionData = {
      calcInputs: CALC_INPUTS,
      hasPlan: false,
      includeActivityBurn: true,
      scheduledFor: null,
    };
    planState.refetchNutrition.mockReset();
  });

  afterEach(() => vi.restoreAllMocks());

  it("defaults to the CLIENT's today from the resolved inputs, never the browser's day (D27)", () => {
    const { result } = renderHook(() => useNutritionBuilder({ client: CLIENT }));
    expect(result.current.effectiveFrom).toBe(CLIENT_TODAY);
    expect(result.current.clientToday).toBe(CLIENT_TODAY);
  });

  it("is null, with no preview, until the resolved inputs have loaded", () => {
    planState.nutritionData = null;
    const { result } = renderHook(() => useNutritionBuilder({ client: CLIENT }));
    expect(result.current.effectiveFrom).toBeNull();
    expect(result.current.autoPlan).toBeNull();
  });

  it("the preview follows the date: three weeks out, the deficit is steeper and the calories lower", () => {
    const { result } = renderHook(() => useNutritionBuilder({ client: CLIENT }));
    const fromToday = result.current.autoPlan;
    if (!fromToday) throw new Error("expected a preview");

    act(() => result.current.handleEffectiveFromChange(THREE_WEEKS_OUT));
    const fromLater = result.current.autoPlan;
    if (!fromLater) throw new Error("expected a preview");

    expect(fromLater.requiredDailyDeficit).toBeGreaterThan(fromToday.requiredDailyDeficit);
    expect(fromLater.baselineCalories).toBeLessThan(fromToday.baselineCalories);
    // The preview IS the calculator over the same inputs and the picked date —
    // the save runs the identical pure module with the identical override.
    expect(fromLater).toEqual(
      generateNutritionPlan({
        ...CALC_INPUTS,
        proteinTargetGPerKg: result.current.settings.proteinTargetGPerKg,
        dietType: result.current.settings.dietType,
        startDate: THREE_WEEKS_OUT,
      }),
    );
  });

  it("the request carries the picked date", async () => {
    const fetchSpy = mockFetch();
    const { result } = renderHook(() => useNutritionBuilder({ client: CLIENT }));
    act(() => result.current.handleEffectiveFromChange(THREE_WEEKS_OUT));

    await act(async () => {
      await result.current.generatePlan();
    });

    expect(postedBody(fetchSpy).effectiveFrom).toBe(THREE_WEEKS_OUT);
  });

  it("the request carries the client's today when nothing was picked — the day the preview used", async () => {
    const fetchSpy = mockFetch();
    const { result } = renderHook(() => useNutritionBuilder({ client: CLIENT }));

    await act(async () => {
      await result.current.generatePlan();
    });

    expect(postedBody(fetchSpy).effectiveFrom).toBe(CLIENT_TODAY);
  });

  it("an emptied picker means today again, not an empty date", () => {
    const { result } = renderHook(() => useNutritionBuilder({ client: CLIENT }));
    act(() => result.current.handleEffectiveFromChange(THREE_WEEKS_OUT));
    act(() => result.current.handleEffectiveFromChange(""));
    expect(result.current.effectiveFrom).toBe(CLIENT_TODAY);
  });

  it("a saved plan resets the pick, so the next save defaults to today again (D27)", async () => {
    mockFetch();
    const { result } = renderHook(() => useNutritionBuilder({ client: CLIENT }));
    act(() => result.current.handleEffectiveFromChange(THREE_WEEKS_OUT));

    await act(async () => {
      await result.current.generatePlan();
    });

    expect(result.current.effectiveFrom).toBe(CLIENT_TODAY);
  });
});
