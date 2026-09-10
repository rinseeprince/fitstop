import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useNutritionBuilder } from "./use-nutrition-builder";
import { generateNutritionPlan } from "@/services/nutrition-service";
import { splitToGrams } from "@/lib/nutrition/macro-balance";
import type { NutritionCalcInputs } from "@/services/nutrition-calc-inputs";
import type { Client } from "@/types/check-in";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/use-nutrition-calendar-events", () => ({
  useInvalidateNutritionCalendar: () => vi.fn().mockResolvedValue(undefined),
}));

// The blocks payload, which carries the client's blocks and the plan-start
// floor (the shared deletion floor: today, or tomorrow once the client has
// logged today). Held where the module mock can reach it; null = the payload
// has not landed.
const blocksState = vi.hoisted(() => ({
  planStartFloor: null as string | null,
  blocks: [] as Array<{ id: string; name: string; startsOn: string; endsOn: string }>,
}));
vi.mock("@/components/clients/metrics/hooks/use-client-blocks", () => ({
  useClientBlocks: () => ({
    blocks: blocksState.blocks,
    clientToday: null,
    planStartFloor: blocksState.planStartFloor,
    isLoading: false,
    isError: false,
  }),
  useClearBlockFacts: () => vi.fn().mockResolvedValue(undefined),
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

// The field's floor is the shared deletion floor (commit B): a version may not
// start on a day the client has already logged, the same line the training
// placement and both plan clears keep to. The server refuses a start before it;
// this is the affordance, and the default start follows it.
describe("useNutritionBuilder — the start floor", () => {
  const TOMORROW = "2026-07-03";

  beforeEach(() => {
    planState.nutritionData = {
      calcInputs: CALC_INPUTS,
      hasPlan: false,
      includeActivityBurn: true,
      scheduledFor: null,
    };
    planState.refetchNutrition.mockReset();
    blocksState.planStartFloor = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    blocksState.planStartFloor = null;
  });

  it("is the client's today until the payload lands", () => {
    const { result } = renderHook(() => useNutritionBuilder({ client: CLIENT }));
    expect(result.current.startFloor).toBe(CLIENT_TODAY);
  });

  it("moves to the floor once the client has logged today, and the default start follows it", () => {
    blocksState.planStartFloor = TOMORROW;
    const { result } = renderHook(() => useNutritionBuilder({ client: CLIENT }));
    expect(result.current.startFloor).toBe(TOMORROW);
    expect(result.current.effectiveFrom).toBe(TOMORROW);
    expect(result.current.clientToday).toBe(CLIENT_TODAY);
  });

  it("never floors before the client's today, whatever a stale payload says", () => {
    blocksState.planStartFloor = "2026-07-01";
    const { result } = renderHook(() => useNutritionBuilder({ client: CLIENT }));
    expect(result.current.startFloor).toBe(CLIENT_TODAY);
    expect(result.current.effectiveFrom).toBe(CLIENT_TODAY);
  });

  it("is null until the resolved inputs have loaded, even with the floor in hand", () => {
    planState.nutritionData = null;
    blocksState.planStartFloor = TOMORROW;
    const { result } = renderHook(() => useNutritionBuilder({ client: CLIENT }));
    expect(result.current.startFloor).toBeNull();
    expect(result.current.effectiveFrom).toBeNull();
  });

  it("the coach's own pick still wins over the floor's default", () => {
    blocksState.planStartFloor = TOMORROW;
    const { result } = renderHook(() => useNutritionBuilder({ client: CLIENT }));
    act(() => result.current.handleEffectiveFromChange(THREE_WEEKS_OUT));
    expect(result.current.effectiveFrom).toBe(THREE_WEEKS_OUT);
  });
});

// The Block field (D): the client's blocks whose end is on or after the floor,
// then No block. The block the coach came from — the Journey round trip's,
// captured on arrival by the host and handed in — is preselected; choosing a
// block sets the start to its first available day and bounds the date to its
// window. Purely UX: the save resolves its own window from the block covering
// the start, so this only picks a valid start inside the block the coach means.
describe("useNutritionBuilder — the Block field", () => {
  const TOMORROW = "2026-07-03";
  // Under way at the client's today; the next one; one that ended before it.
  const CUT = { id: "b-cut", name: "Cut", startsOn: "2026-06-20", endsOn: "2026-07-17" };
  const BUILD = { id: "b-build", name: "Build", startsOn: "2026-07-18", endsOn: "2026-08-14" };
  const OLD = { id: "b-old", name: "Base", startsOn: "2026-05-01", endsOn: "2026-05-31" };

  beforeEach(() => {
    planState.nutritionData = {
      calcInputs: CALC_INPUTS,
      hasPlan: false,
      includeActivityBurn: true,
      scheduledFor: null,
    };
    planState.refetchNutrition.mockReset();
    blocksState.planStartFloor = null;
    blocksState.blocks = [OLD, CUT, BUILD];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    blocksState.planStartFloor = null;
    blocksState.blocks = [];
  });

  it("lists the blocks whose end is on or after the floor, then No block, and defaults to No block", () => {
    const { result } = renderHook(() => useNutritionBuilder({ client: CLIENT }));
    expect(result.current.blockOptions.map((option) => option.value)).toEqual([
      CUT.id,
      BUILD.id,
      "none",
    ]);
    expect(result.current.blockValue).toBe("none");
    expect(result.current.startWindow).toEqual({ min: CLIENT_TODAY, max: null });
    expect(result.current.effectiveFrom).toBe(CLIENT_TODAY);
  });

  it("preselects the block the coach came from: a future block seeds its own start and bounds the date to it", () => {
    const { result } = renderHook(() =>
      useNutritionBuilder({ client: CLIENT, roundTripBlockId: BUILD.id })
    );
    expect(result.current.blockValue).toBe(BUILD.id);
    expect(result.current.effectiveFrom).toBe(BUILD.startsOn);
    expect(result.current.startWindow).toEqual({ min: BUILD.startsOn, max: BUILD.endsOn });
  });

  it("a block already under way seeds the floor, not the day it began", () => {
    const { result } = renderHook(() =>
      useNutritionBuilder({ client: CLIENT, roundTripBlockId: CUT.id })
    );
    expect(result.current.effectiveFrom).toBe(CLIENT_TODAY);
    expect(result.current.startWindow).toEqual({ min: CLIENT_TODAY, max: CUT.endsOn });

    blocksState.planStartFloor = TOMORROW;
    const logged = renderHook(() =>
      useNutritionBuilder({ client: CLIENT, roundTripBlockId: CUT.id })
    );
    expect(logged.result.current.effectiveFrom).toBe(TOMORROW);
    expect(logged.result.current.startWindow).toEqual({ min: TOMORROW, max: CUT.endsOn });
  });

  it("a round trip from a block no longer listed falls to No block", () => {
    const { result } = renderHook(() =>
      useNutritionBuilder({ client: CLIENT, roundTripBlockId: OLD.id })
    );
    expect(result.current.blockValue).toBe("none");
    expect(result.current.effectiveFrom).toBe(CLIENT_TODAY);
  });

  it("picking a block sets the date and its bounds; picking No block clears the ceiling", () => {
    const { result } = renderHook(() => useNutritionBuilder({ client: CLIENT }));

    act(() => result.current.handleBlockChange(BUILD.id));
    expect(result.current.blockValue).toBe(BUILD.id);
    expect(result.current.effectiveFrom).toBe(BUILD.startsOn);
    expect(result.current.startWindow).toEqual({ min: BUILD.startsOn, max: BUILD.endsOn });

    act(() => result.current.handleBlockChange("none"));
    expect(result.current.blockValue).toBe("none");
    expect(result.current.effectiveFrom).toBe(CLIENT_TODAY);
    expect(result.current.startWindow).toEqual({ min: CLIENT_TODAY, max: null });
  });

  it("the coach's own date wins inside the window, and a block change re-seeds it", () => {
    const { result } = renderHook(() => useNutritionBuilder({ client: CLIENT }));
    act(() => result.current.handleBlockChange(BUILD.id));
    act(() => result.current.handleEffectiveFromChange("2026-07-25"));
    expect(result.current.effectiveFrom).toBe("2026-07-25");

    act(() => result.current.handleBlockChange(CUT.id));
    expect(result.current.effectiveFrom).toBe(CLIENT_TODAY);
  });

  it("the request carries the block's first available day when a block is picked", async () => {
    const fetchSpy = mockFetch();
    const { result } = renderHook(() => useNutritionBuilder({ client: CLIENT }));
    act(() => result.current.handleBlockChange(BUILD.id));

    await act(async () => {
      await result.current.generatePlan();
    });

    expect(postedBody(fetchSpy).effectiveFrom).toBe(BUILD.startsOn);
  });

  it("a saved plan resets the block pick as it resets the date", async () => {
    mockFetch();
    const { result } = renderHook(() => useNutritionBuilder({ client: CLIENT }));
    act(() => result.current.handleBlockChange(BUILD.id));

    await act(async () => {
      await result.current.generatePlan();
    });

    expect(result.current.blockValue).toBe("none");
    expect(result.current.effectiveFrom).toBe(CLIENT_TODAY);
  });

  it("no options and no window until the resolved inputs have loaded", () => {
    planState.nutritionData = null;
    const { result } = renderHook(() =>
      useNutritionBuilder({ client: CLIENT, roundTripBlockId: BUILD.id })
    );
    expect(result.current.blockOptions).toEqual([]);
    expect(result.current.blockValue).toBe("none");
    expect(result.current.startWindow).toBeNull();
    expect(result.current.effectiveFrom).toBeNull();
  });
});

// N4: the manual entry is the macro balancer. Generate posts the coach's typed
// calorie target with the grams the split derives from it — the custom-macro
// override the server already stores. There is no re-totalled figure: the two
// are within one carb rounding of each other by construction.
describe("useNutritionBuilder — the manual save carries the balancer's numbers", () => {
  const SPLIT = { carbs: 45, fat: 25, protein: 30 };

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

  it("posts the typed calories and the derived grams as the custom-macro override", async () => {
    const fetchSpy = mockFetch();
    const { result } = renderHook(() => useNutritionBuilder({ client: CLIENT }));
    const auto = result.current.autoTargets;
    if (!auto) throw new Error("expected a preview");
    act(() => result.current.enableManualTargets(auto));
    act(() => result.current.setManualBalance({ calories: 2400, split: SPLIT }));

    await act(async () => {
      await result.current.generatePlan(true);
    });

    const grams = splitToGrams(2400, SPLIT);
    expect(postedBody(fetchSpy)).toMatchObject({
      customMacrosEnabled: true,
      customCalories: 2400,
      customProteinG: grams.proteinG,
      customCarbG: grams.carbG,
      customFatG: grams.fatG,
    });
  });

  it("refuses to post an override with no calorie target", async () => {
    const fetchSpy = mockFetch();
    const { result } = renderHook(() => useNutritionBuilder({ client: CLIENT }));
    const auto = result.current.autoTargets;
    if (!auto) throw new Error("expected a preview");
    act(() => result.current.enableManualTargets(auto));
    act(() => result.current.setManualBalance({ calories: null, split: SPLIT }));

    let saved: boolean | undefined;
    await act(async () => {
      saved = await result.current.generatePlan(true);
    });

    expect(saved).toBe(false);
    expect(fetchSpy.mock.calls.find(([, init]) => init?.method === "POST")).toBeUndefined();
  });
});
