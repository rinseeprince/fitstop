import { getNutritionEventsForDateRange } from "./nutrition-days-service";
import {
  deleteNutritionDayEdits,
  upsertNutritionDayEdits,
  type NutritionDayEdit,
} from "./nutrition-day-edits-service";
import { calculateDailyMacros } from "@/utils/nutrition-helpers";
import type { DietType, NutritionEvent } from "@/types/check-in";

/**
 * Coach per-day nutrition edits, on the edits table (migration 169).
 *
 * A range edit writes the coach's target onto each selected day as one edit
 * row — the same four numbers for every day, the dialog being the macro
 * balancer — reading the days AS COMPUTED only for what an edit inherits: the
 * standing note, and the protein and diet type a macro-less payload holds
 * and rebalances around. A computed day with an edit takes those numbers
 * verbatim, carries the note, and takes no training surplus
 * (`services/nutrition-day-resolver.ts`). A reset removes the rows, and the
 * plan's own numbers answer again; nothing regenerates.
 *
 * Both paths are today-forward only — past days are immutable. The routes
 * reject an all-past selection; the service additionally floors the list at
 * clientToday. A selected day no version covers has no computed day and is
 * skipped: there is no target to edit.
 *
 * Nothing here touches the food log: a logged day's target is the computed
 * day, so an edit or reset of a today the client has already logged reaches
 * every reader of that log at once.
 */

// `note` semantics (D-B): undefined = preserve any existing note; "" (or
// whitespace) = clear it; a string = set it. The dialog sends a value only for
// the day(s) the coach actually typed on, so a macro-only edit never wipes notes.
export type RangeEdit = {
  calories: number;
  proteinG?: number;
  carbG?: number;
  fatG?: number;
  note?: string | null;
};

/** The edit row a coach's instruction resolves to over one computed day. */
function resolveEdit(day: NutritionEvent, edit: RangeEdit): NutritionDayEdit {
  const { calories } = edit;

  // Macros: the dialog sends all three (the balancer's grams) and they are
  // taken verbatim. A payload without them — a raw API caller's — holds
  // protein (its own, else the day's) and rebalances carbs and fat to the
  // total by the version's diet type.
  let proteinG: number;
  let carbG: number;
  let fatG: number;
  if (edit.proteinG != null && edit.carbG != null && edit.fatG != null) {
    proteinG = edit.proteinG;
    carbG = edit.carbG;
    fatG = edit.fatG;
  } else {
    const macros = calculateDailyMacros(
      calories,
      edit.proteinG ?? day.proteinG,
      false,
      (day.dietType as DietType) || "balanced"
    );
    proteinG = macros.proteinG;
    carbG = macros.carbsG;
    fatG = macros.fatG;
  }

  // D-B: the day's standing note survives an edit that carries none;
  // "" / whitespace clears it; text sets it.
  const note =
    edit.note === undefined
      ? day.note
      : edit.note && edit.note.trim() !== ""
        ? edit.note.trim()
        : null;

  return { date: day.date, calories, proteinG, carbG, fatG, note };
}

type MaterializeParams = {
  clientId: string;
  /** The editing coach — the audit actor on each edit row. */
  coachId: string;
  dates: string[];
  edit: RangeEdit;
  clientToday: string;
};

/**
 * Write the coach's edit onto an explicit LIST of future days (any arrangement
 * — single, scattered, or contiguous). The computed days are read once over the
 * selection's span; only the selected dates are written, so a scattered
 * selection edits exactly the chosen days and leaves the gaps untouched. One
 * upsert for the whole list. Returns the days written.
 */
export async function materializeNutritionEventDays({
  clientId,
  coachId,
  dates,
  edit,
  clientToday,
}: MaterializeParams): Promise<{ updated: number }> {
  // Keep only today-forward dates (defensive — the route also filters); a past
  // day is never written.
  const eligible = new Set(dates.filter((d) => d >= clientToday));
  if (eligible.size === 0) return { updated: 0 };

  const sorted = [...eligible].sort();
  const days = (
    await getNutritionEventsForDateRange(clientId, sorted[0], sorted[sorted.length - 1])
  ).filter((day) => eligible.has(day.date));
  if (days.length === 0) return { updated: 0 };

  const edits = days.map((day) => resolveEdit(day, edit));
  await upsertNutritionDayEdits(clientId, coachId, edits);

  return { updated: edits.length };
}

type ResetParams = {
  clientId: string;
  dates: string[];
  clientToday: string;
};

/**
 * Remove the edits on a LIST of future days in one statement, so the plan's
 * own numbers answer for them again. A scattered selection resets exactly the
 * chosen days. Returns the days that held an edit.
 */
export async function resetNutritionEventDays({
  clientId,
  dates,
  clientToday,
}: ResetParams): Promise<{ reset: number }> {
  const eligibleDates = dates.filter((d) => d >= clientToday);
  if (eligibleDates.length === 0) return { reset: 0 };

  const reset = await deleteNutritionDayEdits(clientId, eligibleDates);

  return { reset };
}
