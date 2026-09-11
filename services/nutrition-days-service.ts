import type { NutritionEvent } from "@/types/check-in";
import { expandDateRange } from "@/lib/date-helpers";
import {
  getNutritionPlanGrids,
  getNutritionPrescriptionsForRange,
  versionCoversDate,
} from "./nutrition-plan-service";
import { getEventsForDateRange } from "./training-event-service";
import { getNutritionDayEditsForRange } from "./nutrition-day-edits-service";
import {
  nutritionDayOfWeek,
  resolveNutritionDay,
  type NutritionDayGridRow,
} from "./nutrition-day-resolver";

/**
 * A client's nutrition days over a range, COMPUTED when asked (owner decision
 * 2026-09-10) — nothing is read from a day table, because there is nothing
 * stored per day but the coach's edit.
 *
 * Batched, never per day: the versions overlapping the range with their
 * prescription (the save note rides that read), then in parallel their grids,
 * the training events in range and the edits in range — four reads for a
 * 31-day month and four for a single day, with the number of days deciding
 * nothing. Every date is then handed to the resolver with the version covering
 * it. A date no version covers yields NO day, exactly as "no row" did: a gap
 * between plans is a real state, and a first food log is refused there (a day
 * the client has already begun stays open, under the target it was logged
 * under).
 *
 * The two function names are the ones every reader already calls; the day
 * table's readers were deleted so the compiler listed every caller.
 */
export async function getNutritionEventsForDateRange(
  clientId: string,
  startDate: string,
  endDate: string
): Promise<NutritionEvent[]> {
  if (endDate < startDate) return [];

  const versions = await getNutritionPrescriptionsForRange(clientId, startDate, endDate);
  if (versions.length === 0) return [];

  const [grids, trainingEvents, edits] = await Promise.all([
    getNutritionPlanGrids(versions.map((version) => version.id)),
    // The generator's own read: every event on the date, whatever its status —
    // a completed or missed session still made the day a training day.
    getEventsForDateRange(clientId, startDate, endDate),
    getNutritionDayEditsForRange(clientId, startDate, endDate),
  ]);

  const gridRowByVersionDay = new Map<string, NutritionDayGridRow>();
  for (const row of grids) {
    gridRowByVersionDay.set(`${row.planId}:${row.dayOfWeek}`, row);
  }

  const trainingByDate = new Map<string, typeof trainingEvents>();
  for (const event of trainingEvents) {
    const dateKey = event.date.split("T")[0];
    const onDate = trainingByDate.get(dateKey) ?? [];
    onDate.push(event);
    trainingByDate.set(dateKey, onDate);
  }

  const editByDate = new Map(edits.map((edit) => [edit.date, edit]));

  return expandDateRange(startDate, endDate).flatMap((date): NutritionEvent[] => {
    const version = versions.find((candidate) => versionCoversDate(candidate, date));
    if (!version) return [];
    return [
      resolveNutritionDay({
        clientId,
        date,
        version,
        gridRow: gridRowByVersionDay.get(`${version.id}:${nutritionDayOfWeek(date)}`) ?? null,
        trainingEvents: trainingByDate.get(date) ?? [],
        edit: editByDate.get(date) ?? null,
        // The version's save note shows on the day the version took effect
        // (migration 172) — the day the change it explains landed.
        coachNote: version.effectiveFrom === date ? version.coachNote : null,
      }),
    ];
  });
}

/** The client's nutrition day on `date`, or null when no version covers it. */
export async function getNutritionEventForDate(
  clientId: string,
  date: string
): Promise<NutritionEvent | null> {
  const [day] = await getNutritionEventsForDateRange(clientId, date, date);
  return day ?? null;
}
