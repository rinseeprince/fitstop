// Uses supabaseAdmin: coach-side cross-table query spanning phases and check_ins
import { supabaseAdmin } from "./supabase-admin";
import type { PhaseWeeklyDataRow } from "@/types/roadmap";

/**
 * Fetches weekly check-in data for a phase, using the stored period boundaries
 * on each check-in rather than recalculating week boundaries.
 */
export async function getPhaseWeeklyData(
  phaseId: string,
  clientId: string
): Promise<PhaseWeeklyDataRow[]> {
  // 1. Fetch phase to get date boundaries
  const { data: phase, error: phaseError } = await supabaseAdmin
    .from("phases")
    .select("start_date, end_date")
    .eq("id", phaseId)
    .eq("client_id", clientId)
    .maybeSingle();

  if (phaseError) {
    console.error("Error fetching phase for weekly data:", phaseError);
    throw new Error("Failed to fetch phase");
  }

  if (!phase || !phase.start_date) {
    return [];
  }

  const endDate = phase.end_date ?? new Date().toISOString().split("T")[0];

  // 2. Query check-ins within the phase date range
  const { data: checkIns, error: checkInsError } = await supabaseAdmin
    .from("check_ins")
    .select(
      "weight, nutrition_days_on_target, workouts_completed, period_start, period_end, created_at"
    )
    .eq("client_id", clientId)
    .gte("period_start", phase.start_date)
    .lte("period_end", endDate)
    .order("period_start", { ascending: true });

  if (checkInsError) {
    console.error("Error fetching check-ins for weekly data:", checkInsError);
    throw new Error("Failed to fetch check-in data");
  }

  if (!checkIns || checkIns.length === 0) {
    return [];
  }

  // 3. Filter out check-ins missing period boundaries, then map to PhaseWeeklyDataRow
  return checkIns
    .filter((row) => row.period_start && row.period_end && row.created_at)
    .map((row, index) => ({
      weekNumber: index + 1,
      periodStart: row.period_start!,
      periodEnd: row.period_end!,
      checkInDate: row.created_at!,
      weight: row.weight != null ? Number(row.weight) : null,
      nutritionDaysOnTarget:
        row.nutrition_days_on_target != null
          ? Number(row.nutrition_days_on_target)
          : null,
      trainingSessions: row.workouts_completed ?? 0,
    }));
}
