import { supabaseAdmin } from "./supabase-admin"; // system-level upserts + RLS-free reads
import type { WeeklyNutritionSummary } from "@/types/weekly-nutrition";
import {
  calculateWeeklySummaryFromLogs,
  type FullWeekTargets,
} from "@/utils/weekly-nutrition-helpers";
import { mapNutritionRowToDailyLog, type NutritionRow } from "@/utils/weekly-nutrition-mappers";
import {
  getNutritionTargetsForDateRange,
  type NutritionDayTarget,
} from "./nutrition-days-service";
import { expandDateRange } from "@/lib/date-helpers";

/** What the client ate — the log stores no target and no verdict. */
const NUTRITION_LOG_SELECT =
  "id, client_id, date, calories_consumed, protein_g, carbs_g, fat_g, created_at, updated_at";

/**
 * What the client was SUPPOSED to eat across the whole period — every day of
 * it, not just the days they logged.
 *
 * This is the denominator half of #5. Summing only the logged days' targets
 * makes a client who logged three of seven perfect days read 100% adherent:
 * the three days they skipped contribute to neither side of the ratio, so the
 * week they mostly ignored scores the same as a week they nailed.
 *
 * Every day's target is the COMPUTED day — the version covering the date, its
 * grid row, the session on the date, the coach's edit — logged or not; a day
 * no version covers contributes nothing. `null` when the period has no
 * targets at all: the caller then falls back to the logged-days total, which
 * is what it did for every call before this.
 */
function sumFullWeekTargets(
  dates: readonly string[],
  targets: ReadonlyMap<string, NutritionDayTarget>
): FullWeekTargets | null {
  let calories = 0;
  let proteinG = 0;
  let carbsG = 0;
  let fatG = 0;
  for (const date of dates) {
    const target = targets.get(date);
    if (!target) continue;
    calories += target.calories;
    proteinG += target.proteinG;
    carbsG += target.carbsG;
    fatG += target.fatG;
  }

  if (calories <= 0) return null;
  return { calories, proteinG, carbsG, fatG };
}

/**
 * Computes a nutrition summary for an arbitrary date range from nutrition_logs,
 * against the WHOLE period's targets.
 *
 * The one place three paths agree on this number: the coach submit path's
 * stored `adherence_percentage` / `nutrition_days_on_target`
 * (`check-in-service`), the client submit path's AI prompt
 * (`client-check-in-service`), and the coach's Regenerate
 * (`/api/check-in/[id]/ai-summary`). Changing the denominator here moves all
 * three together, which is the point — they were never meant to disagree.
 */
export async function getNutritionSummaryForPeriod(
  clientId: string,
  startDate: string,
  endDate: string
): Promise<WeeklyNutritionSummary | null> {
  const { data: rows, error } = await supabaseAdmin
    .from("nutrition_logs")
    .select(NUTRITION_LOG_SELECT)
    .eq("client_id", clientId)
    .gte("date", startDate)
    .lte("date", endDate)
    .order("date", { ascending: true }) as unknown as { data: NutritionRow[] | null; error: { message: string } | null };

  if (error) {
    console.error("Failed to fetch nutrition logs for period summary:", error.message);
    throw new Error("Failed to fetch nutrition logs for period summary");
  }

  if (!rows || rows.length === 0) return null;

  // One target lookup over the period serves both halves: the logged days'
  // own targets (their verdicts) and the whole-period denominator.
  const targets = await getNutritionTargetsForDateRange(clientId, startDate, endDate);
  const logs = rows.map((row) => mapNutritionRowToDailyLog(row, targets.get(row.date) ?? null));

  const dates = expandDateRange(startDate, endDate);
  const daysInPeriod = dates.length;

  // Whole-period targets, not the logged days' own. `null` keeps the previous
  // logged-days-only behaviour rather than inventing a target from nothing.
  const fullWeekTargets = sumFullWeekTargets(dates, targets);

  const summary = calculateWeeklySummaryFromLogs(
    logs,
    startDate,
    daysInPeriod,
    fullWeekTargets ?? undefined,
    endDate
  );

  return {
    ...summary,
    id: "",
    clientId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
