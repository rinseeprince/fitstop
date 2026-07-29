import { calculateBaselineCaloriesFromRate } from "@/lib/goals/goal-rate";
import type { GoalGender } from "@/lib/goals/goal-rate";
import { calculateDailyMacros } from "@/utils/nutrition-helpers";
import type { DayOfWeek, DietType } from "@/types/check-in";

/**
 * One calorie target per BLOCK, computed from the block's rate.
 *
 * Pure and browser-safe on purpose (the same call 2.3 made for `phase-chain`):
 * Session 3's per-block preview renders from these exact functions, so the
 * numbers a coach sees while authoring and the numbers the server writes cannot
 * disagree. The DB write lives in `services/client-phases-service.ts`.
 *
 * A block stores a RATE and nothing else (invariant 4), so this uses the
 * rate-first entry point rather than the deadline-driven calculator. The two
 * share `capWeeklyRate` and `applyCalorieFloor`, so they cannot drift on what
 * counts as safe.
 */

/** The weekday grid stored on `client_phases.daily_targets` (migration 137). */
export type PhaseDayTarget = {
  day_of_week: string;
  calories: number;
  protein_g: number;
  carb_g: number;
  fat_g: number;
};

const DAYS: DayOfWeek[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

export type PhaseTargetInput = {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  ratePerWeekKg: number;
};

export type PhaseTargetRow = {
  phaseId: string;
  name: string;
  startsOn: string;
  endsOn: string;
  /** What the coach asked for. */
  requestedRateKgPerWeek: number;
  /**
   * What the block will actually run, after the safety cap and the calorie
   * floor. Differs from the requested rate exactly when `capped` or `floored`
   * is true — which is why both are returned per row (invariant 12: every
   * capped rate surfaces in the preview, per row, rather than silently).
   */
  appliedRateKgPerWeek: number;
  baselineCalories: number;
  capped: boolean;
  capKgPerWeek: number;
  floored: boolean;
  floor: number;
  warnings: string[];
  /** The 7-row grid this block writes. */
  dailyTargets: PhaseDayTarget[];
};

/**
 * Run the calculator once per block.
 *
 * **Every block uses the same TDEE.** A client's weight genuinely moves across a
 * 15-week chain, which would move TDEE with it — but nothing in this workstream
 * models per-block weight, and projecting one here would invent numbers no one
 * asked for and that no later measurement would reconcile against. Recorded as a
 * deliberate simplification rather than an oversight.
 *
 * **Protein is held constant across blocks** for the same reason: it is derived
 * from body weight, which is not projected.
 */
export function computePhaseTargets(input: {
  phases: PhaseTargetInput[];
  tdee: number;
  gender: GoalGender;
  proteinTargetG: number;
  dietType: DietType;
}): PhaseTargetRow[] {
  const { phases, tdee, gender, proteinTargetG, dietType } = input;

  return phases.map((phase) => {
    const result = calculateBaselineCaloriesFromRate({
      tdee,
      rateKgPerWeek: phase.ratePerWeekKg,
      gender,
    });

    // The macro split is computed ONCE per block and repeated across the 7 rows.
    // Per-weekday variation is a coach override applied on top (the plan grid's
    // `dayCalorieOverrides` path); a block's own grid is flat by construction.
    const macros = calculateDailyMacros(
      result.baselineCalories,
      proteinTargetG,
      false,
      dietType
    );

    return {
      phaseId: phase.id,
      name: phase.name,
      startsOn: phase.startsOn,
      endsOn: phase.endsOn,
      requestedRateKgPerWeek: result.requestedRateKgPerWeek,
      appliedRateKgPerWeek: result.appliedRateKgPerWeek,
      baselineCalories: result.baselineCalories,
      capped: result.capped,
      capKgPerWeek: result.capKgPerWeek,
      floored: result.floored,
      floor: result.floor,
      warnings: result.warnings,
      dailyTargets: DAYS.map((day) => ({
        day_of_week: day,
        calories: result.baselineCalories,
        protein_g: macros.proteinG,
        carb_g: macros.carbsG,
        fat_g: macros.fatG,
      })),
    };
  });
}
