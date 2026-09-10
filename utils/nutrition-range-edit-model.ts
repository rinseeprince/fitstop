import type { NutritionEvent } from "@/types/check-in";
import type { DailyNutritionTargets } from "@/utils/nutrition-helpers";
import { mapNutritionEventToDisplayTarget } from "@/utils/nutrition-event-helpers";
import type { MacroGrams } from "@/lib/nutrition/macro-balance";

/**
 * Pure model for the Edit-targets sheet (no React). Selection resolution, the
 * absolute seed, and the client-side delta math live here so they are
 * unit-testable and shared between the form hook and the preview.
 */

/** The edit payload sent to PATCH …/nutrition/events/range.
 * Absolute always carries all four numbers — the Set targets tab is the macro
 * balancer, whose grams derive from its calories — and every selected day
 * gets the same four (owner decision 2026-09-10).
 * `note`: omitted = preserve existing notes; "" = clear; string = set (D-B).
 * `holdProtein`: delta only; omitted/true = server holds protein and
 * rebalances carbs/fat (legacy path); false = all three macros scale onto the
 * new total preserving the day's stored split. */
export type RangeEditPayload =
  | { mode: "absolute"; calories: number; proteinG: number; carbG: number; fatG: number; note?: string }
  | { mode: "delta"; percent?: number; calorieDelta?: number; holdProtein?: boolean; note?: string };

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

type AbsoluteSeed = {
  /** The FIRST selected day's displayed calories — what the balancer opens on.
   * Null when nothing is selected or the day shows no calories. */
  calories: number | null;
  /** That day's grams, the split the balancer opens on. */
  grams: MacroGrams | null;
  /** Min–max of the selection's displayed calories; present only when the
   * selected days differ, so the sheet can say what the one target replaces. */
  calorieRange: { min: number; max: number } | null;
};

export function computeAbsoluteSeed(days: ResolvedSelectedDay[]): AbsoluteSeed {
  const first = days[0]?.target ?? null;
  const values = days.map((d) => d.target.calories);
  const min = Math.min(...values);
  const max = Math.max(...values);
  return {
    calories: first && first.calories > 0 ? first.calories : null,
    grams: first ? { proteinG: first.proteinG, carbG: first.carbsG, fatG: first.fatG } : null,
    calorieRange: values.length > 1 && min !== max ? { min, max } : null,
  };
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
