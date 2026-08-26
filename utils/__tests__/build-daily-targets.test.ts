import { describe, it, expect } from "vitest";
import { buildDailyTargetsFromPlan } from "../build-daily-targets";
import { mapNutritionEventToDisplayTarget } from "../nutrition-event-helpers";
import type { NutritionEvent } from "@/types/check-in";
import type { TrainingEvent } from "@/types/training";

const PLAN = {
  baseline_calories: 2000,
  protein_target_g: 150,
  carb_target_g: 200,
  fat_target_g: 67,
};

// weekWindow that gates nothing: effectiveFrom null. 2026-06-08 is the Monday
// the fixtures' dates sit in, so weekday->date derivation matches them.
const NO_GATE = { weekStart: "2026-06-08", effectiveFrom: null, effectiveUntil: null };

// 2026-06-08 is a Monday.
function tev(overrides: Partial<TrainingEvent>): TrainingEvent {
  return {
    id: "te-1",
    clientId: "c1",
    trainingPlanId: "tp-1",
    trainingSessionId: "ts-1",
    date: "2026-06-08",
    sessionName: "Push",
    sessionFocus: null,
    estimatedCalories: 200,
    status: "scheduled",
    sessionLogId: null,
    isModified: false,
    calorieSurplusPercentage: 10,
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

function nev(overrides: Partial<NutritionEvent>): NutritionEvent {
  return {
    id: "ne-1",
    clientId: "c1",
    nutritionPlanId: "np-1",
    date: "2026-06-08",
    dayOfWeek: "monday",
    baselineCalories: 2000,
    trainingBurnCalories: 0,
    proteinG: 150,
    carbG: 200,
    fatG: 67,
    dietType: "balanced",
    isTrainingDay: false,
    calorieSurplusPercentage: null,
    isModified: false,
    note: null,
    status: "scheduled",
    createdAt: "",
    updatedAt: "",
    coachNote: null,
    ...overrides,
  };
}

function row(day: string, o: Partial<{ calories: number; protein_g: number; carb_g: number; fat_g: number; is_training_day: boolean }> = {}) {
  return {
    day_of_week: day,
    calories: 2000,
    protein_g: 150,
    carb_g: 200,
    fat_g: 67,
    is_training_day: false,
    ...o,
  };
}

const find = (targets: ReturnType<typeof buildDailyTargetsFromPlan>, day: string) =>
  targets.find((t) => t.day === day)!;

describe("buildDailyTargetsFromPlan", () => {
  it("always returns one entry per weekday (7), even with sparse rows/events", () => {
    const targets = buildDailyTargetsFromPlan({ plan: PLAN, dailyTargetRows: [], includeActivityBurn: true, dietType: "balanced", surplusAsCarbs: false, trainingEvents: undefined, nutritionEvents: undefined, weekWindow: NO_GATE });
    expect(targets).toHaveLength(7);
  });

  it("no-event rest day: shows stored macros VERBATIM (never re-derived from the diet split)", () => {
    // Stored split is high-carb/low-fat; the old calculateDailyMacros path would
    // have re-derived it to the balanced ratio. It must not.
    const rows = [row("monday", { carb_g: 250, fat_g: 47, is_training_day: false })];
    const mon = find(buildDailyTargetsFromPlan({ plan: PLAN, dailyTargetRows: rows, includeActivityBurn: true, dietType: "balanced", surplusAsCarbs: false, trainingEvents: undefined, nutritionEvents: undefined, weekWindow: NO_GATE }), "monday");
    expect(mon.calories).toBe(2000);
    expect(mon.carbsG).toBe(250);
    expect(mon.fatG).toBe(47);
  });

  it("no-event training day, keep-split: preserves the stored carb:fat ratio (matches the event mapper)", () => {
    const rows = [row("monday", { carb_g: 100, fat_g: 50, is_training_day: true })];
    const events = [tev({ calorieSurplusPercentage: 10 })];
    const mon = find(
      buildDailyTargetsFromPlan({ plan: PLAN, dailyTargetRows: rows, includeActivityBurn: true, dietType: "balanced", surplusAsCarbs: false, trainingEvents: events, nutritionEvents: undefined, weekWindow: NO_GATE }),
      "monday",
    );
    expect(mon.calories).toBe(2200);
    expect(mon.proteinG).toBe(150);
    expect(mon.carbsG).toBe(188);
    expect(mon.fatG).toBe(94);
  });

  it("no-event training day, carbs-only: protein AND fat held, surplus goes to carbs", () => {
    const rows = [row("monday", { carb_g: 100, fat_g: 50, is_training_day: true })];
    const events = [tev({ calorieSurplusPercentage: 10 })];
    const mon = find(
      buildDailyTargetsFromPlan({ plan: PLAN, dailyTargetRows: rows, includeActivityBurn: true, dietType: "balanced", surplusAsCarbs: true, trainingEvents: events, nutritionEvents: undefined, weekWindow: NO_GATE }),
      "monday",
    );
    expect(mon.calories).toBe(2200);
    expect(mon.proteinG).toBe(150);
    expect(mon.fatG).toBe(50);
    expect(mon.carbsG).toBe(288);
  });

  it("event day: reuses the calendar mapper for parity AND preserves trainingSessions", () => {
    const nutritionEvents = [
      nev({ isTrainingDay: true, baselineCalories: 2000, proteinG: 150, carbG: 100, fatG: 50, calorieSurplusPercentage: 10 }),
    ];
    const trainingEvents = [tev({ sessionName: "Push", estimatedCalories: 200, calorieSurplusPercentage: 10 })];
    const mon = find(
      buildDailyTargetsFromPlan({ plan: PLAN, dailyTargetRows: [], includeActivityBurn: true, dietType: "balanced", surplusAsCarbs: false, trainingEvents: trainingEvents, nutritionEvents: nutritionEvents, weekWindow: NO_GATE }),
      "monday",
    );

    // Numbers identical to the mapper (parity by construction)...
    const mapped = mapNutritionEventToDisplayTarget(nutritionEvents[0], true, false);
    expect(mon.calories).toBe(mapped.calories);
    expect(mon.carbsG).toBe(mapped.carbsG);
    expect(mon.fatG).toBe(mapped.fatG);
    // ...but trainingSessions come from the training events (the mapper has none).
    expect(mon.trainingSessions).toEqual([{ name: "Push", calories: 200 }]);
  });

  it("frozen (is_modified) event day: verbatim macros, surplus does NOT re-stack on top of the live training surplus", () => {
    const nutritionEvents = [
      nev({ isModified: true, isTrainingDay: true, baselineCalories: 2586, proteinG: 190, carbG: 250, fatG: 47, calorieSurplusPercentage: null }),
    ];
    // A live training event with a real surplus still exists on this day...
    const trainingEvents = [tev({ calorieSurplusPercentage: 15 })];
    const mon = find(
      buildDailyTargetsFromPlan({ plan: PLAN, dailyTargetRows: [], includeActivityBurn: true, dietType: "balanced", surplusAsCarbs: false, trainingEvents: trainingEvents, nutritionEvents: nutritionEvents, weekWindow: NO_GATE }),
      "monday",
    );
    // ...but the frozen event wins: 2586, not 2586*(1.15).
    expect(mon.calories).toBe(2586);
    expect(mon.carbsG).toBe(250);
    expect(mon.fatG).toBe(47);
  });

  it("burn off: flattens to baseline with stored macros verbatim (no calculateDailyMacros re-split)", () => {
    const rows = [row("monday", { carb_g: 100, fat_g: 50, is_training_day: true })];
    const events = [tev({ calorieSurplusPercentage: 10 })];
    const mon = find(
      buildDailyTargetsFromPlan({ plan: PLAN, dailyTargetRows: rows, includeActivityBurn: false, dietType: "balanced", surplusAsCarbs: false, trainingEvents: events, nutritionEvents: undefined, weekWindow: NO_GATE }),
      "monday",
    );
    expect(mon.calories).toBe(2000);
    expect(mon.carbsG).toBe(100);
    expect(mon.fatG).toBe(50);
    expect(mon.trainingSessionCalories).toBe(0);
  });

  it("surfaces the event's coach note on the program card (event days only)", () => {
    const nutritionEvents = [nev({ dayOfWeek: "monday", note: "Deload week — go easy" })];
    const targets = buildDailyTargetsFromPlan({ plan: PLAN, dailyTargetRows: [], includeActivityBurn: true, dietType: "balanced", surplusAsCarbs: false, trainingEvents: [], nutritionEvents: nutritionEvents, weekWindow: NO_GATE });
    expect(find(targets, "monday").note).toBe("Deload week — go easy");
    // A template (no-event) day carries no per-date note.
    expect(find(targets, "tuesday").note ?? null).toBeNull();
  });

  it("gap day (no event, no stored row): falls back to plan baseline + diet split", () => {
    const nutritionEvents = [nev({ dayOfWeek: "monday" })];
    const targets = buildDailyTargetsFromPlan({ plan: PLAN, dailyTargetRows: [], includeActivityBurn: true, dietType: "balanced", surplusAsCarbs: false, trainingEvents: [], nutritionEvents: nutritionEvents, weekWindow: NO_GATE });
    const tue = find(targets, "tuesday");
    expect(tue.calories).toBe(PLAN.baseline_calories);
    // balanced split: (2000 - 600) / 2 between carb/fat
    expect(tue.carbsG).toBe(175);
    expect(tue.fatG).toBe(78);
  });
});

describe("buildDailyTargetsFromPlan — the effective_from template gate (migration 143)", () => {
  // Week Mon 2026-06-08 .. Sun 2026-06-14; the plan's current numbers take
  // effect Thu 2026-06-11. Since 143, effective_from means "when the current
  // numbers took effect", so a NO-EVENT day before it must not render the next
  // prescription's template as current.
  const GATED = { weekStart: "2026-06-08", effectiveFrom: "2026-06-11", effectiveUntil: null };

  it("drops template days dated before effective_from and keeps the rest", () => {
    const targets = buildDailyTargetsFromPlan({ plan: PLAN, dailyTargetRows: [], includeActivityBurn: true, dietType: "balanced", surplusAsCarbs: false, trainingEvents: undefined, nutritionEvents: undefined, weekWindow: GATED });

    // Mon/Tue/Wed (08/09/10) are gone; Thu..Sun (11..14) are served.
    expect(targets.map((t) => t.day)).toEqual(["thursday", "friday", "saturday", "sunday"]);
  });

  it("never gates an event day — events are the dated SOT and pre-effective_from rows keep the old prescription", () => {
    const nutritionEvents = [nev({ dayOfWeek: "monday", date: "2026-06-08", baselineCalories: 1800 })];
    const targets = buildDailyTargetsFromPlan({ plan: PLAN, dailyTargetRows: [], includeActivityBurn: true, dietType: "balanced", surplusAsCarbs: false, trainingEvents: [], nutritionEvents: nutritionEvents, weekWindow: GATED });

    // Monday survives via its event, carrying the OLD numbers verbatim…
    expect(find(targets, "monday").calories).toBe(1800);
    // …while the event-less pre-effective_from days are still dropped.
    expect(targets.map((t) => t.day)).toEqual(["monday", "thursday", "friday", "saturday", "sunday"]);
  });

  it("a null effective_from gates nothing (first insert has no prior prescription to protect)", () => {
    const targets = buildDailyTargetsFromPlan({ plan: PLAN, dailyTargetRows: [], includeActivityBurn: true, dietType: "balanced", surplusAsCarbs: false, trainingEvents: undefined, nutritionEvents: undefined, weekWindow: NO_GATE });
    expect(targets).toHaveLength(7);
  });

  it("an effective_from on the week's first day gates nothing — the boundary day is governed", () => {
    const targets = buildDailyTargetsFromPlan({ plan: PLAN, dailyTargetRows: [], includeActivityBurn: true, dietType: "balanced", surplusAsCarbs: false, trainingEvents: undefined, nutritionEvents: undefined, weekWindow: {
      weekStart: "2026-06-08",
      effectiveFrom: "2026-06-08",
      effectiveUntil: null,
    } });
    expect(targets).toHaveLength(7);
  });

  // ── The window's OTHER end (migration 144): a closed version stops serving
  //    template targets past effective_until — those days belong to the next
  //    era, and its own grid must not impersonate it. ──────────────────────────
  it("drops template days dated after effective_until and keeps the rest", () => {
    // Week Mon 06-08 .. Sun 06-14; the version ends Wed 06-10.
    const targets = buildDailyTargetsFromPlan({ plan: PLAN, dailyTargetRows: [], includeActivityBurn: true, dietType: "balanced", surplusAsCarbs: false, trainingEvents: undefined, nutritionEvents: undefined, weekWindow: {
      weekStart: "2026-06-08",
      effectiveFrom: null,
      effectiveUntil: "2026-06-10",
    } });
    expect(targets.map((t) => t.day)).toEqual(["monday", "tuesday", "wednesday"]);
  });

  it("an effective_until on the week's last day gates nothing — the boundary day is governed", () => {
    const targets = buildDailyTargetsFromPlan({ plan: PLAN, dailyTargetRows: [], includeActivityBurn: true, dietType: "balanced", surplusAsCarbs: false, trainingEvents: undefined, nutritionEvents: undefined, weekWindow: {
      weekStart: "2026-06-08",
      effectiveFrom: null,
      effectiveUntil: "2026-06-14",
    } });
    expect(targets).toHaveLength(7);
  });

  it("never gates an event day past the window — events carry their own era's numbers", () => {
    const targets = buildDailyTargetsFromPlan({
      plan: PLAN,
      dailyTargetRows: [],
      includeActivityBurn: true,
      dietType: "balanced",
      surplusAsCarbs: false,
      trainingEvents: undefined,
      nutritionEvents: [
        {
          dayOfWeek: "sunday",
          date: "2026-06-14",
          baselineCalories: 1700,
          trainingBurnCalories: 0,
          proteinG: 150,
          carbG: 150,
          fatG: 55,
          isTrainingDay: false,
          isModified: false,
          calorieSurplusPercentage: null,
        } as never,
      ],
      weekWindow: {
        weekStart: "2026-06-08",
        effectiveFrom: null,
        effectiveUntil: "2026-06-10",
      },
    });
    // Mon-Wed from the template (inside the window) + Sunday from its event.
    expect(targets.map((t) => t.day)).toEqual(["monday", "tuesday", "wednesday", "sunday"]);
    expect(targets.find((t) => t.day === "sunday")?.calories).toBe(1700);
  });
});
