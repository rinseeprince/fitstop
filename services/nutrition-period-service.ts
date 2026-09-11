import { fetchNutritionLogsForPeriod } from "./schedule-data-service";
import { getNutritionTargetsForDateRange } from "./nutrition-days-service";
import { expandDateRange } from "@/lib/date-helpers";
import {
  buildNutritionSummary,
  summarizeNutritionPeriod,
  type NutritionPeriodSummary,
} from "@/utils/nutrition-period-summary";
import type { NutritionDay } from "@/types/schedule";
import type { CheckIn } from "@/types/check-in";
import { readPeriodSnapshot } from "@/lib/check-in/period-snapshot";

type NutritionPeriod = {
  /** One row per date — what the check-in freezes. */
  days: NutritionDay[];
  /** The kernel over those rows — what every surface renders. */
  summary: NutritionPeriodSummary;
};

/**
 * A period's nutrition, LIVE: what the client ate from the food log and every
 * day's computed target from the ONE batched day lookup, through the kernel.
 * The check-in submit freezes `days`; a submitted check-in's surfaces run the
 * kernel over the frozen rows instead of calling this.
 */
export async function getNutritionPeriod(
  clientId: string,
  startDate: string,
  endDate: string
): Promise<NutritionPeriod> {
  const dates = expandDateRange(startDate, endDate);
  const [logs, targets] = await Promise.all([
    fetchNutritionLogsForPeriod(clientId, startDate, endDate),
    getNutritionTargetsForDateRange(clientId, startDate, endDate),
  ]);
  const days = buildNutritionSummary(dates, logs, targets);
  return { days, summary: summarizeNutritionPeriod(days) };
}

/**
 * A check-in's nutrition figures: the kernel over its FROZEN rows when it has
 * them — a submitted check-in reports on the week as it stood at submit, and
 * a plan the coach changes afterwards must not move it — else live over the
 * period, for a row written before the snapshot existed.
 */
export async function getCheckInNutritionSummary(
  checkIn: Pick<CheckIn, "clientId" | "periodSnapshot">,
  startDate: string,
  endDate: string
): Promise<NutritionPeriodSummary> {
  const frozen = readPeriodSnapshot(checkIn.periodSnapshot);
  if (frozen) return summarizeNutritionPeriod(frozen.nutrition);
  return (await getNutritionPeriod(checkIn.clientId, startDate, endDate)).summary;
}
