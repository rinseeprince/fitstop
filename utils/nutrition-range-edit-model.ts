import type { NutritionEvent } from "@/types/check-in";
import type { DailyNutritionTargets } from "@/utils/nutrition-helpers";
import { mapNutritionEventToDisplayTarget } from "@/utils/nutrition-event-helpers";
import type { MacroGrams } from "@/lib/nutrition/macro-balance";

/**
 * Pure model for the Edit-targets dialog (no React). Selection resolution and
 * the seed live here so they are unit-testable and shared between the form
 * hook and the selection bar.
 */

/** The edit payload sent to PATCH …/nutrition/events/range. The dialog is the
 * macro balancer, so it always carries the calories and the three grams its
 * split derives, and every selected day gets the same four (owner decision
 * 2026-09-10). `note`: omitted = preserve existing notes; "" = clear; string =
 * set (D-B). */
export type RangeEditPayload = {
  mode: "absolute";
  calories: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  note?: string;
};

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
 * nothing to seeds/averages/previews). Each day is priced with its own
 * version's surplus settings (migration 196), as its calendar cell is.
 */
export function resolveSelectedEvents(
  dates: Iterable<string>,
  eventsByDate: Map<string, NutritionEvent>
): ResolvedSelectedDay[] {
  const out: ResolvedSelectedDay[] = [];
  for (const date of [...dates].sort()) {
    const event = eventsByDate.get(date);
    if (!event || event.status !== "scheduled") continue;
    out.push({
      date,
      event,
      target: mapNutritionEventToDisplayTarget(event),
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
   * selected days differ, so the dialog can say what the one target replaces. */
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

/** Average of the selected days' DISPLAYED calories, or null when nothing resolves. */
export function averageDisplayedCalories(days: ResolvedSelectedDay[]): number | null {
  if (days.length === 0) return null;
  const sum = days.reduce((acc, d) => acc + d.target.calories, 0);
  return Math.round(sum / days.length);
}
