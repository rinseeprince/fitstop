import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./supabase-admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock("@/services/client-service", () => ({
  getClientById: vi.fn(),
}));

vi.mock("@/services/today-service", () => ({
  getClientTodayString: vi.fn().mockResolvedValue("2026-07-02"),
}));

// The deletion floor is TRAINING's (owner, 2026-09-11): a version starts on
// any day from the client's today whatever they have logged. It stays mocked
// here — answering TOMORROW — so a belt that consulted it again would refuse a
// save from today and fail the test that proves it is not asked.
vi.mock("@/services/event-deletion-floor", () => ({
  resolveEventDeletionFloor: vi.fn().mockResolvedValue("2026-07-03"),
}));

vi.mock("@/lib/validations/nutrition", () => ({
  validateClientForNutrition: vi.fn().mockReturnValue({ valid: true, errors: [] }),
}));

vi.mock("@/services/client-goals-service", () => ({
  getCurrentGoals: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/services/nutrition-service", () => ({
  generateNutritionPlan: vi.fn(),
}));

vi.mock("@/services/nutrition-plan-service", () => ({
  createNutritionPlan: vi.fn(),
  resolveNutritionPlacementEnd: vi.fn(),
}));

// The delete is one act, owned by the clear service (migration 166); its
// statement semantics are proved in nutrition-plan-clear-service.test.ts.
vi.mock("@/services/nutrition-plan-clear-service", () => ({
  clearNutritionPlansForClient: vi.fn(),
}));

import { supabaseAdmin } from "./supabase-admin";
import { getClientById } from "@/services/client-service";
import { generateNutritionPlan } from "@/services/nutrition-service";
import {
  createNutritionPlan,
  resolveNutritionPlacementEnd,
} from "@/services/nutrition-plan-service";
import { clearNutritionPlansForClient } from "@/services/nutrition-plan-clear-service";
import { resolveEventDeletionFloor } from "@/services/event-deletion-floor";
import { getCurrentGoals } from "@/services/client-goals-service";
import { resolveNutritionCalcInputs } from "@/services/nutrition-calc-inputs";
import {
  orchestrateNutritionPlanCreation,
  orchestrateNutritionPlanDeletion,
} from "./nutrition-plan-orchestrator";
import type { GenerateNutritionPlanRequest } from "@/types/check-in";
import { CUSTOM_MACRO_CALORIE_TOLERANCE } from "@/lib/constants";

const clientId = "client-1";
const coachId = "coach-1";

const client = {
  id: clientId,
  coachId,
  currentWeight: 180,
  weightUnit: "lbs",
  bmr: 1700,
  tdee: 2400,
  gender: "male",
  goalWeight: 170,
  goalBodyFatPercentage: null,
  // No `goalDeadline`: `Client` has no such field. It was inert here (null
  // either way) but named a mirror column nothing ever read — deadlines resolve
  // from `client_goals` alone.
};

const calculatedPlan = {
  baselineCalories: 2000,
  tdee: 2400,
  calorieTarget: 2000,
  proteinTargetG: 160,
  carbTargetG: 200,
  fatTargetG: 62,
  adjustedTdee: 2400,
  weeklyWeightChangeKg: -0.4,
  requiredDailyDeficit: 400,
  warnings: [],
};

const calculatedBody: GenerateNutritionPlanRequest = {
  workActivityLevel: "sedentary",
  proteinTargetGPerKg: 2.0,
  dietType: "balanced",
} as GenerateNutritionPlanRequest;

// 150*4 + 200*4 + 60*9 = 1940 — matches customCalories exactly (within tolerance).
const customBody: GenerateNutritionPlanRequest = {
  workActivityLevel: "sedentary",
  proteinTargetGPerKg: 2.0,
  dietType: "balanced",
  customMacrosEnabled: true,
  customProteinG: 150,
  customCarbG: 200,
  customFatG: 60,
  customCalories: 1940,
} as GenerateNutritionPlanRequest;

/** handleCalculatedPlan reads the existing active plan; serve { data: null } ("initial"). */
function mockNoExistingPlan(): void {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  vi.mocked(supabaseAdmin.from).mockReturnValue(chain as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getClientById).mockResolvedValue(client as never);
  vi.mocked(generateNutritionPlan).mockReturnValue(calculatedPlan as never);
  vi.mocked(createNutritionPlan).mockResolvedValue("plan-1" as never);
  vi.mocked(resolveNutritionPlacementEnd).mockResolvedValue("2026-08-27");
  vi.mocked(clearNutritionPlansForClient).mockResolvedValue({
    versionsCleared: 1, editsCleared: 0,
    versionIds: ["plan-1"],
  });
  mockNoExistingPlan();
});

// =============================================================================
// The touched-day rules (owner, 2026-09-11): today is the coach's to change or
// to end, whatever the client logged; the client's logs are never lost.
// =============================================================================
describe("orchestrateNutritionPlanCreation — the touched-day rules (C2)", () => {
  const CLIENT_TODAY = "2026-07-02";

  it("a save from today is accepted whatever the client has logged — nutrition asks no floor", async () => {
    // The floor says tomorrow (a workout logged today). A program's start
    // would move; the targets' start does not, and the floor is not even read.
    const result = await orchestrateNutritionPlanCreation(
      clientId,
      coachId,
      { ...calculatedBody, effectiveFrom: CLIENT_TODAY },
      {}
    );

    expect(result.success).toBe(true);
    expect(resolveEventDeletionFloor).not.toHaveBeenCalled();
    expect(createNutritionPlan).toHaveBeenCalledWith(
      expect.objectContaining({ effectiveFrom: CLIENT_TODAY })
    );
  });

  it("the default start — today — is accepted the same way", async () => {
    const result = await orchestrateNutritionPlanCreation(clientId, coachId, calculatedBody, {});

    expect(result.success).toBe(true);
    expect(resolveEventDeletionFloor).not.toHaveBeenCalled();
    expect(createNutritionPlan).toHaveBeenCalledTimes(1);
  });

  it("a past start is still refused, before any write", async () => {
    await expect(
      orchestrateNutritionPlanCreation(
        clientId,
        coachId,
        { ...calculatedBody, effectiveFrom: "2026-07-01" },
        {}
      )
    ).rejects.toMatchObject({
      name: "NutritionPlanError",
      statusCode: 400,
      message: "Effective date cannot be in the past",
    });
    expect(createNutritionPlan).not.toHaveBeenCalled();
  });

  // A save from today replaces the running version from today and touches
  // nothing else: the food log stores no target, so a logged today reads the
  // new target the moment the RPC commits. No re-record, no second write.
  it("a save covering a logged today writes nothing to the food log — the RPC is the whole save", async () => {
    await orchestrateNutritionPlanCreation(clientId, coachId, calculatedBody, {});
    await orchestrateNutritionPlanCreation(clientId, coachId, customBody, {});

    expect(createNutritionPlan).toHaveBeenCalledTimes(2);
    expect(vi.mocked(supabaseAdmin.from).mock.calls.map((call) => call[0])).not.toContain(
      "nutrition_logs"
    );
  });
});

describe("orchestrateNutritionPlanCreation — the save is the RPC and the note, nothing else", () => {
  // A day's target is computed from the version the RPC stores (owner
  // decision 2026-09-10): no day row is written, deleted or swept here, so
  // there is no calendar write left to fail after the row has committed.
  const tablesTouched = () => vi.mocked(supabaseAdmin.from).mock.calls.map((call) => call[0]);

  it("calculated branch: resolves success once the RPC has stored the version, and writes no day", async () => {
    const result = await orchestrateNutritionPlanCreation(clientId, coachId, calculatedBody, {});

    expect(result.success).toBe(true);
    expect(createNutritionPlan).toHaveBeenCalledTimes(1);
    // The one direct read this branch makes is the existing-plan lookup that
    // labels the save "initial" or "regenerated".
    expect(tablesTouched()).toEqual(["nutrition_plans"]);
  });

  it("custom-macros branch: resolves success once the RPC has stored the version, and touches no table directly", async () => {
    const result = await orchestrateNutritionPlanCreation(clientId, coachId, customBody, {});

    expect(result.success).toBe(true);
    expect(createNutritionPlan).toHaveBeenCalledTimes(1);
    expect(tablesTouched()).toEqual([]);
  });

  it("hands the RPC the effective date when one is provided", async () => {
    await orchestrateNutritionPlanCreation(
      clientId,
      coachId,
      { ...calculatedBody, effectiveFrom: "2026-07-10" },
      {}
    );
    expect(createNutritionPlan).toHaveBeenCalledWith(
      expect.objectContaining({ effectiveFrom: "2026-07-10" })
    );
  });
});

describe("orchestrateNutritionPlanCreation — the coach note rides the RPC (migration 172)", () => {
  const NOTE = "Dropping calories 200 while we hold training volume.";

  it("hands the note to the save itself, so it lands with the version or not at all", async () => {
    await orchestrateNutritionPlanCreation(clientId, coachId, calculatedBody, { coachNotes: NOTE });

    expect(createNutritionPlan).toHaveBeenCalledWith(expect.objectContaining({ coachNote: NOTE }));
    // No second statement after the RPC: the note is one of its arguments.
    expect(vi.mocked(supabaseAdmin.from).mock.calls.map((c) => String(c[0]))).not.toContain(
      "nutrition_plan_notes"
    );
  });

  it("trims the note, and a blank one is no note — omitted, so the RPC's default clears a same-day re-save's", async () => {
    await orchestrateNutritionPlanCreation(clientId, coachId, calculatedBody, {
      coachNotes: "  Aggressive  ",
    });
    expect(createNutritionPlan).toHaveBeenLastCalledWith(
      expect.objectContaining({ coachNote: "Aggressive" })
    );

    await orchestrateNutritionPlanCreation(clientId, coachId, calculatedBody, { coachNotes: "   " });
    const last = vi.mocked(createNutritionPlan).mock.calls.at(-1)?.[0];
    expect(last?.coachNote).toBeUndefined();
  });

  it("custom-macros branch hands the note too — both handlers, not one", async () => {
    await orchestrateNutritionPlanCreation(clientId, coachId, customBody, { coachNotes: NOTE });
    expect(createNutritionPlan).toHaveBeenCalledWith(expect.objectContaining({ coachNote: NOTE }));
  });
});

describe("orchestrateNutritionPlanDeletion — one act, the clear service's (migration 166)", () => {
  it("retires the versions the client is on, with the client's today, and names the earliest for the audit", async () => {
    vi.mocked(clearNutritionPlansForClient).mockResolvedValue({
      versionsCleared: 2, editsCleared: 0,
      versionIds: ["plan-1", "q1"],
    });

    const result = await orchestrateNutritionPlanDeletion(clientId, coachId);

    // Unscoped — no block window: the calendar's own delete. The floor, the
    // day removal and the archive are the clear service's.
    expect(clearNutritionPlansForClient).toHaveBeenCalledWith(clientId, "2026-07-02");
    expect(result).toEqual({ planId: "plan-1" });
  });

  it("rejects 404 when nothing is left to retire — a same-day second delete is a clean 404, not a silent success", async () => {
    vi.mocked(clearNutritionPlansForClient).mockResolvedValue({ versionsCleared: 0, editsCleared: 0, versionIds: [] });

    await expect(orchestrateNutritionPlanDeletion(clientId, coachId)).rejects.toMatchObject({
      name: "NutritionPlanError",
      statusCode: 404,
      message: "No active nutrition plan to delete",
    });
  });

  it("rejects 404 when the client does not exist", async () => {
    vi.mocked(getClientById).mockResolvedValue(null);

    await expect(orchestrateNutritionPlanDeletion(clientId, coachId)).rejects.toMatchObject({
      name: "NutritionPlanError",
      statusCode: 404,
    });
    expect(clearNutritionPlansForClient).not.toHaveBeenCalled();
  });

  it("rejects 403 when the coach does not own the client", async () => {
    await expect(orchestrateNutritionPlanDeletion(clientId, "other-coach")).rejects.toMatchObject({
      name: "NutritionPlanError",
      statusCode: 403,
    });
    expect(clearNutritionPlansForClient).not.toHaveBeenCalled();
  });

  it("propagates a clear failure as-is (the route reports it; the clear left the versions retryable)", async () => {
    vi.mocked(clearNutritionPlansForClient).mockRejectedValue(new Error("delete exploded"));

    await expect(orchestrateNutritionPlanDeletion(clientId, coachId)).rejects.toThrow(
      "delete exploded"
    );
  });
});

// =============================================================================
// The placement's end (migration 166): resolved once, for the effective date,
// and handed to the RPC — the row IS the window.
// =============================================================================

describe("orchestrateNutritionPlanCreation — the placement's end", () => {
  it("resolves the end for the effective date — today when none was sent — and hands it to the RPC", async () => {
    await orchestrateNutritionPlanCreation(clientId, coachId, calculatedBody, {});

    expect(resolveNutritionPlacementEnd).toHaveBeenCalledWith(clientId, "2026-07-02");
    expect(createNutritionPlan).toHaveBeenCalledWith(
      expect.objectContaining({ effectiveUntil: "2026-08-27" })
    );
  });

  it("resolves it for a queued start, not for today", async () => {
    vi.mocked(resolveNutritionPlacementEnd).mockResolvedValue("2026-10-11");

    await orchestrateNutritionPlanCreation(
      clientId,
      coachId,
      { ...calculatedBody, effectiveFrom: "2026-08-16" },
      {}
    );

    expect(resolveNutritionPlacementEnd).toHaveBeenCalledWith(clientId, "2026-08-16");
    expect(createNutritionPlan).toHaveBeenCalledWith(
      expect.objectContaining({ effectiveFrom: "2026-08-16", effectiveUntil: "2026-10-11" })
    );
  });

  it("the custom-macros branch hands the same end to the RPC — both handlers, not one", async () => {
    await orchestrateNutritionPlanCreation(clientId, coachId, customBody, {});

    expect(createNutritionPlan).toHaveBeenCalledWith(
      expect.objectContaining({ customMacrosEnabled: true, effectiveUntil: "2026-08-27" })
    );
  });

  it("resolves the end BEFORE the RPC, never after — the row is written with it", async () => {
    await orchestrateNutritionPlanCreation(clientId, coachId, calculatedBody, {});

    expect(vi.mocked(resolveNutritionPlacementEnd).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(createNutritionPlan).mock.invocationCallOrder[0]
    );
  });
});

// =============================================================================
// The deficit runs from the day the plan takes effect
// (docs/MEASUREMENT-LOG-PLAN.md commit 8bb). These pin arithmetic, so they run
// the REAL calculator over the real input resolver; only the DB reads stay
// mocked. It used to be spread from the day of the calculation whatever date
// the coach picked, so a cut queued four weeks out understated its deficit by
// four weeks.
// =============================================================================
describe("orchestrateNutritionPlanCreation — the deficit runs from the day the plan takes effect", () => {
  // A 5 kg goal 91 days out (client-today is 2026-07-02): under the weekly
  // safety cap from today AND from three weeks later, so the two windows
  // yield two different deficits rather than one capped number.
  const GOAL = { goalWeight: 175, goalDeadline: "2026-09-30" };
  const THREE_WEEKS_OUT = "2026-07-23";

  let realGenerate: typeof generateNutritionPlan;

  beforeEach(async () => {
    const actual = await vi.importActual<typeof import("@/services/nutrition-service")>(
      "@/services/nutrition-service"
    );
    realGenerate = actual.generateNutritionPlan;
    vi.mocked(generateNutritionPlan).mockImplementation(realGenerate);
    vi.mocked(getCurrentGoals).mockResolvedValue(GOAL as never);
  });

  afterEach(() => {
    vi.mocked(getCurrentGoals).mockResolvedValue(null);
  });

  it("hands the calculator the effective date as the window's start — today when none was sent", async () => {
    await orchestrateNutritionPlanCreation(
      clientId,
      coachId,
      { ...calculatedBody, effectiveFrom: THREE_WEEKS_OUT },
      {}
    );
    expect(generateNutritionPlan).toHaveBeenLastCalledWith(
      expect.objectContaining({ startDate: THREE_WEEKS_OUT })
    );

    await orchestrateNutritionPlanCreation(clientId, coachId, calculatedBody, {});
    expect(generateNutritionPlan).toHaveBeenLastCalledWith(
      expect.objectContaining({ startDate: "2026-07-02" })
    );
  });

  it("a date three weeks out yields a steeper deficit than today's", async () => {
    const later = await orchestrateNutritionPlanCreation(
      clientId,
      coachId,
      { ...calculatedBody, effectiveFrom: THREE_WEEKS_OUT },
      {}
    );
    const today = await orchestrateNutritionPlanCreation(clientId, coachId, calculatedBody, {});

    expect(later.plan.requiredDailyDeficit as number).toBeGreaterThan(
      today.plan.requiredDailyDeficit as number
    );
    expect(later.plan.baselineCalories as number).toBeLessThan(
      today.plan.baselineCalories as number
    );
  });

  it("the preview and the save agree: one pure calculator over the same resolved inputs", async () => {
    // What the drawer previews: the shared resolver's inputs, the pickers, and
    // the picked date as the window's start.
    const inputs = await resolveNutritionCalcInputs(clientId, client as never, {
      today: "2026-07-02",
    });
    if (inputs.status !== "ready") throw new Error("expected ready inputs");
    const previewed = realGenerate({
      ...inputs,
      proteinTargetGPerKg: calculatedBody.proteinTargetGPerKg,
      dietType: calculatedBody.dietType,
      startDate: THREE_WEEKS_OUT,
    });

    const saved = await orchestrateNutritionPlanCreation(
      clientId,
      coachId,
      { ...calculatedBody, effectiveFrom: THREE_WEEKS_OUT },
      {}
    );

    expect(saved.plan.baselineCalories).toBe(previewed.baselineCalories);
    expect(saved.plan.requiredDailyDeficit).toBe(previewed.requiredDailyDeficit);
    expect(saved.plan.proteinTargetG).toBe(previewed.proteinTargetG);
    // And the version that lands carries the previewed numbers from that day.
    expect(createNutritionPlan).toHaveBeenLastCalledWith(
      expect.objectContaining({
        baselineCalories: previewed.baselineCalories,
        effectiveFrom: THREE_WEEKS_OUT,
      })
    );
  });
});

// =============================================================================
// The custom-macros belt. Both coach entries are the macro balancer, whose
// grams derive from the calories, so a save from the app is inside one carb
// rounding by construction; this belt is against a raw API caller, and it is
// deliberately tight — a stated target that contradicts its own macro bars
// must not reach the client.
// =============================================================================
describe("orchestrateNutritionPlanCreation — the custom-macros belt", () => {
  // customBody's macros total 1940 kcal (150*4 + 200*4 + 60*9).
  const withCalories = (customCalories: number): GenerateNutritionPlanRequest =>
    ({ ...customBody, customCalories }) as GenerateNutritionPlanRequest;

  it("refuses a stated target 40 kcal from its macros with a 400 naming the tolerance, and saves nothing", async () => {
    await expect(
      orchestrateNutritionPlanCreation(clientId, coachId, withCalories(1980), {})
    ).rejects.toMatchObject({
      name: "NutritionPlanError",
      statusCode: 400,
      message: expect.stringContaining(`±${CUSTOM_MACRO_CALORIE_TOLERANCE} calories`),
    });
    await expect(
      orchestrateNutritionPlanCreation(clientId, coachId, withCalories(1980), {})
    ).rejects.toThrow("calculated: 1940 cal");
    expect(createNutritionPlan).not.toHaveBeenCalled();
  });

  it("the tolerance is 10 kcal: a gap on the belt saves, one past it does not", async () => {
    expect(CUSTOM_MACRO_CALORIE_TOLERANCE).toBe(10);

    const onTheBelt = await orchestrateNutritionPlanCreation(clientId, coachId, withCalories(1950), {});
    expect(onTheBelt.success).toBe(true);
    expect(createNutritionPlan).toHaveBeenLastCalledWith(
      expect.objectContaining({ customCalories: 1950, baselineCalories: 1950 })
    );

    await expect(
      orchestrateNutritionPlanCreation(clientId, coachId, withCalories(1951), {})
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("a balancer save — the typed target within one carb rounding of its grams — passes", async () => {
    // 2,400 kcal at 45 / 25 / 30 derives 180 / 269 / 67 g = 2,399 kcal.
    const body = {
      ...customBody,
      customCalories: 2400,
      customProteinG: 180,
      customCarbG: 269,
      customFatG: 67,
    } as GenerateNutritionPlanRequest;
    const result = await orchestrateNutritionPlanCreation(clientId, coachId, body, {});
    expect(result.success).toBe(true);
    expect(result.plan).toMatchObject({ calorieTarget: 2400, proteinTargetG: 180, carbTargetG: 269, fatTargetG: 67 });
  });
});
