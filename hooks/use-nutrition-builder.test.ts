import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useNutritionBuilder } from "./use-nutrition-builder";
import { generateNutritionPlan } from "@/services/nutrition-service";
import { splitToGrams } from "@/lib/nutrition/macro-balance";
import type { NutritionCalcInputs } from "@/services/nutrition-calc-inputs";
import type { Client } from "@/types/check-in";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/hooks/use-nutrition-calendar-events", () => ({
  useInvalidateNutritionCalendar: () => vi.fn().mockResolvedValue(undefined),
}));

// The blocks payload, which carries the client's blocks and the plan-start
// floor (training's deletion floor: today, or tomorrow once the client has
// logged a workout today — read by the apply dialog, NOT by this hook). Held
// where the module mock can reach it; null = the payload has not landed.
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

// The day read (docs/MEASUREMENT-LOG-PLAN.md commit 8d1): the goal and the
// calculator's inputs for the drawer's Starts on day. Every day a render asks
// for is recorded; `inputsFor` answers per day, so a test can put a planned
// goal on a later day.
const dayState = vi.hoisted(() => ({
  reads: [] as Array<string | null>,
  pending: false,
  failed: false,
  inputsFor: (_day: string): unknown => null,
  goalFor: (_day: string): unknown => null,
  retry: vi.fn(),
  clear: vi.fn(),
}));
vi.mock("@/hooks/use-nutrition-goal", () => ({
  useNutritionGoalForDay: (_clientId: string, day: string | null) => {
    dayState.reads.push(day);
    const answered = day !== null && !dayState.pending && !dayState.failed;
    return {
      goalForDay: answered
        ? { date: day, goal: dayState.goalFor(day), calcInputs: dayState.inputsFor(day) }
        : null,
      isLoading: dayState.pending,
      isError: dayState.failed,
      retry: dayState.retry,
    };
  },
  useClearNutritionGoal: () => dayState.clear,
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

beforeEach(() => {
  dayState.reads = [];
  dayState.pending = false;
  dayState.failed = false;
  dayState.inputsFor = () => CALC_INPUTS;
  dayState.goalFor = () => null;
  dayState.clear.mockReset();
});

const CLIENT = {
  id: "client-1",
  name: "Alex Doe",
  currentWeight: 85,
  bmr: 1800,
  tdee: 2400,
  gender: "male",
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
      clientToday: CLIENT_TODAY,
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

// The start is the CLIENT's today, whatever they have logged (owner,
// 2026-09-11): today's targets are the coach's to replace, and a logged today
// is re-recorded onto the client's log by the save. The deletion floor is
// training's — a workout logged today moves a program's start, never the
// targets' — so the blocks payload's floor is not read here at all.
describe("useNutritionBuilder — the start is the client's today, whatever they logged", () => {
  const TOMORROW = "2026-07-03";

  beforeEach(() => {
    planState.nutritionData = {
      clientToday: CLIENT_TODAY,
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

  it("defaults to the client's today even when the training floor says tomorrow", () => {
    // A workout logged today: the apply dialog's picker moves to tomorrow;
    // the targets' start does not.
    blocksState.planStartFloor = TOMORROW;
    const { result } = renderHook(() => useNutritionBuilder({ client: CLIENT }));
    expect(result.current.effectiveFrom).toBe(CLIENT_TODAY);
    expect(result.current.clientToday).toBe(CLIENT_TODAY);
  });

  it("is null until the resolved inputs have loaded, whatever the payload says", () => {
    planState.nutritionData = null;
    blocksState.planStartFloor = TOMORROW;
    const { result } = renderHook(() => useNutritionBuilder({ client: CLIENT }));
    expect(result.current.effectiveFrom).toBeNull();
  });

  it("the coach's own pick still wins over the default", () => {
    blocksState.planStartFloor = TOMORROW;
    const { result } = renderHook(() => useNutritionBuilder({ client: CLIENT }));
    act(() => result.current.handleEffectiveFromChange(THREE_WEEKS_OUT));
    expect(result.current.effectiveFrom).toBe(THREE_WEEKS_OUT);
  });
});

// The Block field (D): the dash — the empty state — then the client's blocks
// whose end is on or after the client's today. The block the coach came from —
// the Journey round trip's, captured on arrival by the host and handed in — is
// preselected; a chosen block FIXES the start on its first available day and
// the form greys the date; the dash hands the date back to the coach. Purely
// UX: the save resolves its own window from the block covering the start, so
// this only starts the version where the block the coach means begins.
describe("useNutritionBuilder — the Block field", () => {
  const TOMORROW = "2026-07-03";
  // Under way at the client's today; the next one; one that ended before it.
  const CUT = { id: "b-cut", name: "Cut", startsOn: "2026-06-20", endsOn: "2026-07-17" };
  const BUILD = { id: "b-build", name: "Build", startsOn: "2026-07-18", endsOn: "2026-08-14" };
  const OLD = { id: "b-old", name: "Base", startsOn: "2026-05-01", endsOn: "2026-05-31" };

  beforeEach(() => {
    planState.nutritionData = {
      clientToday: CLIENT_TODAY,
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

  it("leads with the dash, then the blocks whose end is on or after today, and defaults to the dash", () => {
    const { result } = renderHook(() => useNutritionBuilder({ client: CLIENT }));
    expect(result.current.blockOptions.map((option) => option.value)).toEqual([
      "none",
      CUT.id,
      BUILD.id,
    ]);
    expect(result.current.blockValue).toBe("none");
    expect(result.current.blockSelected).toBe(false);
    expect(result.current.effectiveFrom).toBe(CLIENT_TODAY);
  });

  it("preselects the block the coach came from: a future block fixes the start on its own first day", () => {
    const { result } = renderHook(() =>
      useNutritionBuilder({ client: CLIENT, roundTripBlockId: BUILD.id })
    );
    expect(result.current.blockValue).toBe(BUILD.id);
    expect(result.current.blockSelected).toBe(true);
    expect(result.current.effectiveFrom).toBe(BUILD.startsOn);
  });

  it("a block already under way fixes the start at the client's today, not the day it began — a logged workout notwithstanding", () => {
    const { result } = renderHook(() =>
      useNutritionBuilder({ client: CLIENT, roundTripBlockId: CUT.id })
    );
    expect(result.current.blockSelected).toBe(true);
    expect(result.current.effectiveFrom).toBe(CLIENT_TODAY);

    // A workout logged today moves a program's start to tomorrow (the apply
    // dialog); targets in a running block still start today.
    blocksState.planStartFloor = TOMORROW;
    const trained = renderHook(() =>
      useNutritionBuilder({ client: CLIENT, roundTripBlockId: CUT.id })
    );
    expect(trained.result.current.effectiveFrom).toBe(CLIENT_TODAY);
  });

  it("a round trip from a block no longer listed falls to the dash", () => {
    const { result } = renderHook(() =>
      useNutritionBuilder({ client: CLIENT, roundTripBlockId: OLD.id })
    );
    expect(result.current.blockValue).toBe("none");
    expect(result.current.blockSelected).toBe(false);
    expect(result.current.effectiveFrom).toBe(CLIENT_TODAY);
  });

  it("picking a block fixes the start; picking the dash hands the date back at today", () => {
    const { result } = renderHook(() => useNutritionBuilder({ client: CLIENT }));

    act(() => result.current.handleBlockChange(BUILD.id));
    expect(result.current.blockValue).toBe(BUILD.id);
    expect(result.current.blockSelected).toBe(true);
    expect(result.current.effectiveFrom).toBe(BUILD.startsOn);

    act(() => result.current.handleBlockChange("none"));
    expect(result.current.blockValue).toBe("none");
    expect(result.current.blockSelected).toBe(false);
    expect(result.current.effectiveFrom).toBe(CLIENT_TODAY);
  });

  it("the coach's own date applies with the dash only, and a block change discards it", () => {
    const { result } = renderHook(() => useNutritionBuilder({ client: CLIENT }));
    act(() => result.current.handleEffectiveFromChange("2026-07-25"));
    expect(result.current.effectiveFrom).toBe("2026-07-25");

    act(() => result.current.handleBlockChange(BUILD.id));
    expect(result.current.effectiveFrom).toBe(BUILD.startsOn);

    act(() => result.current.handleBlockChange("none"));
    expect(result.current.effectiveFrom).toBe(CLIENT_TODAY);
  });

  it("the request carries the chosen block's first available day", async () => {
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

  it("no options and nothing fixed until the resolved inputs have loaded", () => {
    planState.nutritionData = null;
    const { result } = renderHook(() =>
      useNutritionBuilder({ client: CLIENT, roundTripBlockId: BUILD.id })
    );
    expect(result.current.blockOptions).toEqual([]);
    expect(result.current.blockValue).toBe("none");
    expect(result.current.blockSelected).toBe(false);
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
      clientToday: CLIENT_TODAY,
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

// The two surplus settings are fields of the save (migration 196): a flip
// writes nothing, and Regenerate / Generate carries both with the version, so
// only the days it covers are priced with them — never an earlier one.
describe("useNutritionBuilder — the surplus settings are saved with the plan", () => {
  beforeEach(() => {
    planState.nutritionData = {
      clientToday: CLIENT_TODAY,
      hasPlan: true,
      includeActivityBurn: false,
      surplusAsCarbs: true,
      scheduledFor: null,
    };
    planState.refetchNutrition.mockReset();
  });

  afterEach(() => vi.restoreAllMocks());

  it("seeds both switches from the latest-saved plan", () => {
    const { result } = renderHook(() => useNutritionBuilder({ client: CLIENT }));
    expect(result.current.includeActivityBurn).toBe(false);
    expect(result.current.surplusAsCarbs).toBe(true);
  });

  it("with no plan, starts from the defaults a first plan has: surplus on, kept to the split", () => {
    planState.nutritionData = { clientToday: CLIENT_TODAY, hasPlan: false, scheduledFor: null };
    const { result } = renderHook(() => useNutritionBuilder({ client: CLIENT }));
    expect(result.current.includeActivityBurn).toBe(true);
    expect(result.current.surplusAsCarbs).toBe(false);
  });

  it("flipping either switch sends no request — it only changes what the save will carry", () => {
    const fetchSpy = mockFetch();
    const { result } = renderHook(() => useNutritionBuilder({ client: CLIENT }));

    act(() => result.current.handleToggleActivityBurn(true));
    act(() => result.current.handleToggleSurplusAsCarbs(false));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.includeActivityBurn).toBe(true);
    expect(result.current.surplusAsCarbs).toBe(false);
  });

  it("a refetch carrying the same saved values does not undo a flip", () => {
    const { result, rerender } = renderHook(() => useNutritionBuilder({ client: CLIENT }));
    act(() => result.current.handleToggleActivityBurn(true));

    planState.nutritionData = { ...(planState.nutritionData as object) };
    rerender();

    expect(result.current.includeActivityBurn).toBe(true);
  });

  it("a flip followed by a save sends the flipped values", async () => {
    const fetchSpy = mockFetch();
    const { result } = renderHook(() => useNutritionBuilder({ client: CLIENT }));
    act(() => result.current.handleToggleActivityBurn(true));

    await act(async () => {
      await result.current.generatePlan();
    });

    expect(postedBody(fetchSpy)).toMatchObject({ includeActivityBurn: true, surplusAsCarbs: true });
  });

  it("a flip stays a draft until a new save, whose saved values then show", () => {
    const { result, rerender } = renderHook(() => useNutritionBuilder({ client: CLIENT }));
    act(() => result.current.handleToggleActivityBurn(true));
    rerender();
    expect(result.current.includeActivityBurn).toBe(true);
    expect(result.current.surplusAsCarbs).toBe(true);

    planState.nutritionData = {
      ...(planState.nutritionData as object),
      includeActivityBurn: true,
      surplusAsCarbs: false,
    };
    rerender();

    expect(result.current.includeActivityBurn).toBe(true);
    expect(result.current.surplusAsCarbs).toBe(false);
  });
});

// docs/MEASUREMENT-LOG-PLAN.md commit 8d1: the drawer prices a plan for the goal
// in force on its Starts on day — the goal the save resolves for its own start
// through the same resolver — so preview and save agree even inside a planned
// goal. The goal and the inputs are one read per day.
describe("useNutritionBuilder — the goal on the Starts on day", () => {
  // Build (88 kg by 31 Dec) is planned from 20 Jul, inside the three weeks.
  const PLANNED_FROM = "2026-07-20";
  const BUILD_INPUTS: NutritionCalcInputs = {
    ...CALC_INPUTS,
    goalWeightKg: 88,
    goalDeadline: "2026-12-31",
  };
  const BUILD_GOAL = { id: "g-build", name: "Build", targetWeight: 88, deadline: "2026-12-31" };
  const FUTURE_BLOCK = { id: "b-peak", name: "Peak", startsOn: "2026-08-10", endsOn: "2026-09-06" };

  beforeEach(() => {
    planState.nutritionData = {
      clientToday: CLIENT_TODAY,
      hasPlan: true,
      includeActivityBurn: true,
      scheduledFor: null,
    };
    planState.refetchNutrition.mockReset();
    dayState.inputsFor = (day) => (day >= PLANNED_FROM ? BUILD_INPUTS : CALC_INPUTS);
    dayState.goalFor = (day) => (day >= PLANNED_FROM ? BUILD_GOAL : null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    blocksState.blocks = [];
  });

  it("reads the goal for the Starts on day, and a new date is a new read", () => {
    const { result } = renderHook(() => useNutritionBuilder({ client: CLIENT }));
    expect(dayState.reads.at(-1)).toBe(CLIENT_TODAY);

    act(() => result.current.handleEffectiveFromChange(THREE_WEEKS_OUT));
    expect(dayState.reads.at(-1)).toBe(THREE_WEEKS_OUT);
  });

  it("prices that day's goal: inside a planned goal the preview is the planned goal's, and so is the Goal line", () => {
    const { result } = renderHook(() => useNutritionBuilder({ client: CLIENT }));
    act(() => result.current.handleEffectiveFromChange(THREE_WEEKS_OUT));

    expect(result.current.dayGoal).toEqual(BUILD_GOAL);
    expect(result.current.autoPlan).toEqual(
      generateNutritionPlan({
        ...BUILD_INPUTS,
        proteinTargetGPerKg: result.current.settings.proteinTargetGPerKg,
        dietType: result.current.settings.dietType,
        startDate: THREE_WEEKS_OUT,
      })
    );
    // Not the goal on the client's today.
    expect(result.current.autoPlan).not.toEqual(
      generateNutritionPlan({
        ...CALC_INPUTS,
        proteinTargetGPerKg: result.current.settings.proteinTargetGPerKg,
        dietType: result.current.settings.dietType,
        startDate: THREE_WEEKS_OUT,
      })
    );
  });

  it("while the day is loading, nothing is previewed and a save sends nothing", async () => {
    dayState.pending = true;
    const fetchSpy = mockFetch();
    const { result } = renderHook(() => useNutritionBuilder({ client: CLIENT }));

    expect(result.current.isDayPending).toBe(true);
    expect(result.current.autoPlan).toBeNull();
    let saved = true;
    await act(async () => {
      saved = await result.current.generatePlan();
    });
    expect(saved).toBe(false);
    expect(fetchSpy.mock.calls.find(([, init]) => init?.method === "POST")).toBeUndefined();
  });

  it("a failed day read refuses the save", async () => {
    dayState.failed = true;
    const fetchSpy = mockFetch();
    const { result } = renderHook(() => useNutritionBuilder({ client: CLIENT }));

    expect(result.current.isDayError).toBe(true);
    expect(result.current.isDayPending).toBe(false);
    let saved = true;
    await act(async () => {
      saved = await result.current.generatePlan();
    });
    expect(saved).toBe(false);
    expect(fetchSpy.mock.calls.find(([, init]) => init?.method === "POST")).toBeUndefined();
  });

  it("an arrival's start day is where the drawer starts; the coach's own pick wins over it", () => {
    const { result } = renderHook(() =>
      useNutritionBuilder({ client: CLIENT, roundTripStartsOn: THREE_WEEKS_OUT })
    );
    expect(result.current.effectiveFrom).toBe(THREE_WEEKS_OUT);
    // Never a render on the client's today first.
    expect(dayState.reads).not.toContain(CLIENT_TODAY);

    act(() => result.current.handleEffectiveFromChange("2026-08-03"));
    expect(result.current.effectiveFrom).toBe("2026-08-03");
  });

  it("a chosen block wins over an arrival's start day", () => {
    blocksState.blocks = [FUTURE_BLOCK];
    const { result } = renderHook(() =>
      useNutritionBuilder({
        client: CLIENT,
        roundTripBlockId: FUTURE_BLOCK.id,
        roundTripStartsOn: THREE_WEEKS_OUT,
      })
    );
    expect(result.current.effectiveFrom).toBe(FUTURE_BLOCK.startsOn);
  });

  it("Set nutrition from a day moves to the dash and that day in one update", () => {
    blocksState.blocks = [FUTURE_BLOCK];
    const { result } = renderHook(() =>
      useNutritionBuilder({ client: CLIENT, roundTripBlockId: FUTURE_BLOCK.id })
    );
    expect(result.current.blockValue).toBe(FUTURE_BLOCK.id);

    act(() => result.current.setStartsOn(THREE_WEEKS_OUT));
    expect(result.current.blockValue).toBe("none");
    expect(result.current.effectiveFrom).toBe(THREE_WEEKS_OUT);
  });

  it("a save clears the reads of how nutrition follows the goal", async () => {
    mockFetch();
    const { result } = renderHook(() => useNutritionBuilder({ client: CLIENT }));

    await act(async () => {
      await result.current.generatePlan();
    });
    expect(dayState.clear).toHaveBeenCalledWith("client-1");
  });
});
