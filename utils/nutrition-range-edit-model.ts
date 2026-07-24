import type { NutritionEvent, DietType } from "@/types/check-in";
import type { DailyNutritionTargets } from "@/utils/nutrition-helpers";
import { mapNutritionEventToDisplayTarget } from "@/utils/nutrition-event-helpers";

/**
 * Pure model for the Edit-targets sheet (no React). Selection resolution,
 * uniform-vs-mixed seeding, the absolute-payload validity matrix, and the
 * client-side delta math live here so they are unit-testable and shared
 * between the form hook and the preview.
 */

/** The materialized-edit payload sent to PATCH …/nutrition/events/range.
 * `note`: omitted = preserve existing notes; "" = clear; string = set (D-B).
 * `holdProtein`: delta only; omitted/true = server holds protein and
 * rebalances carbs/fat (legacy path); false = all three macros scale onto the
 * new total preserving the day's stored split. */
export type RangeEditPayload =
  | { mode: "absolute"; calories: number; proteinG?: number; carbG?: number; fatG?: number; note?: string }
  | { mode: "delta"; percent?: number; calorieDelta?: number; holdProtein?: boolean; note?: string };

// Macros must sum to within this many kcal of the calorie target before an
// exact-macro edit applies.
export const CALORIE_MATCH_TOLERANCE = 15;

export function toInt(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export type ResolvedSelectedDay = {
  date: string;
  event: NutritionEvent;
  /** What the calendar cell displays for this day. */
  target: DailyNutritionTargets;
};

/**
 * Resolve the selected dates against the loaded events, dropping any that have
 * no event or are no longer editable (a refetch or month change can leave
 * selected dates outside the loaded window — they stay selected but contribute
 * nothing to seeds/averages/previews).
 */
export function resolveSelectedEvents(
  dates: Iterable<string>,
  eventsByDate: Map<string, NutritionEvent>,
  includeActivityBurn: boolean,
  surplusAsCarbs: boolean
): ResolvedSelectedDay[] {
  const out: ResolvedSelectedDay[] = [];
  for (const date of [...dates].sort()) {
    const event = eventsByDate.get(date);
    if (!event || event.status !== "scheduled") continue;
    out.push({
      date,
      event,
      target: mapNutritionEventToDisplayTarget(event, includeActivityBurn, surplusAsCarbs),
    });
  }
  return out;
}

type AbsoluteSeedField = { value: string; mixed: boolean };
type AbsoluteSeed = {
  calories: AbsoluteSeedField;
  protein: AbsoluteSeedField;
  carbs: AbsoluteSeedField;
  fat: AbsoluteSeedField;
  /** Uniform diet type across the selection, or null when mixed/empty —
   * the carb/fat auto-rebalance on calorie typing needs a single diet. */
  dietType: DietType | null;
  /** Min–max of displayed calories; present only when calories are mixed. */
  calorieRange: { min: number; max: number } | null;
};

function seedField(values: number[]): AbsoluteSeedField {
  if (values.length === 0) return { value: "", mixed: false };
  const first = values[0];
  const uniform = values.every((v) => v === first);
  if (!uniform) return { value: "", mixed: true };
  return { value: first > 0 ? String(first) : "", mixed: false };
}

export function computeAbsoluteSeed(days: ResolvedSelectedDay[]): AbsoluteSeed {
  const calories = seedField(days.map((d) => d.target.calories));
  const protein = seedField(days.map((d) => d.target.proteinG));
  const carbs = seedField(days.map((d) => d.target.carbsG));
  const fat = seedField(days.map((d) => d.target.fatG));

  const firstDiet = (days[0]?.event.dietType as DietType) || null;
  const dietUniform = days.length > 0 && days.every((d) => (d.event.dietType || null) === firstDiet);

  let calorieRange: AbsoluteSeed["calorieRange"] = null;
  if (calories.mixed) {
    const values = days.map((d) => d.target.calories);
    calorieRange = { min: Math.min(...values), max: Math.max(...values) };
  }

  return { calories, protein, carbs, fat, dietType: dietUniform ? firstDiet : null, calorieRange };
}

/**
 * Which macro shape an absolute apply would send. The server's materialize
 * takes macros verbatim only when ALL THREE are present; a lone protein is
 * held with carbs/fat rebalanced per day; a lone carbs or fat value would be
 * silently ignored server-side, so the form must refuse it.
 */
type AbsoluteMacroState = "verbatim" | "protein-only" | "auto" | "invalid";

export function classifyAbsoluteMacros(protein: string, carbs: string, fat: string): AbsoluteMacroState {
  const p = protein.trim() !== "";
  const c = carbs.trim() !== "";
  const f = fat.trim() !== "";
  if (p && c && f) return "verbatim";
  if (!p && !c && !f) return "auto";
  if (p && !c && !f) return "protein-only";
  return "invalid";
}

/** Mirror of the server's delta resolution: scale by percent, then add the
 * kcal delta, one rounding, floored at zero (a wild delta must never preview —
 * or write — negative calories). The sheet sends exactly one of the two. */
export function applyCalorieDelta(
  base: number,
  delta: { percent?: number; calorieDelta?: number }
): number {
  const scaled = delta.percent != null ? base * (1 + delta.percent / 100) : base;
  return Math.max(0, Math.round(scaled + (delta.calorieDelta ?? 0)));
}

/** Average of the selected days' DISPLAYED calories, or null when nothing resolves. */
export function averageDisplayedCalories(days: ResolvedSelectedDay[]): number | null {
  if (days.length === 0) return null;
  const sum = days.reduce((acc, d) => acc + d.target.calories, 0);
  return Math.round(sum / days.length);
}
