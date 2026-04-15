import { supabaseAdmin } from "./supabase-admin";
import type { NutritionEvent, NutritionEventStatus, DietType } from "@/types/check-in";
import type { NutritionEventRow, NutritionEventInsert } from "@/lib/database-helpers";
import type { TrainingPlan } from "@/types/training";
import { getTodayDateString, getDateString, DAY_NUM } from "@/lib/date-helpers";
import { getEventsForDateRange } from "@/services/training-event-service";
import { getActiveTrainingPlan } from "@/services/training-service";
import {
  calculateDailyMacros,
  getExternalActivitiesForDay,
  calculateExternalActivityCalories,
} from "@/utils/nutrition-helpers";
import type { DayOfWeek } from "@/utils/nutrition-helpers";

// --- Row mapper ---

function mapNutritionEventRow(row: NutritionEventRow): NutritionEvent {
  return {
    id: row.id,
    clientId: row.client_id,
    nutritionPlanId: row.nutrition_plan_id,
    date: row.date,
    dayOfWeek: row.day_of_week,
    baselineCalories: row.baseline_calories,
    trainingBurnCalories: row.training_burn_calories,
    externalBurnCalories: row.external_burn_calories,
    proteinG: Number(row.protein_g),
    carbG: Number(row.carb_g),
    fatG: Number(row.fat_g),
    dietType: row.diet_type,
    isTrainingDay: row.is_training_day,
    calorieSurplusPercentage: row.calorie_surplus_percentage ?? null,
    status: row.status as NutritionEventStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// --- Plan metadata for event generation ---

type PlanInput = {
  baselineCalories: number;
  proteinTargetG: number;
  dietType: string;
};

type StoredDailyTarget = {
  day_of_week: string;
  calories: number;
  protein_g: number;
  carb_g: number;
  fat_g: number;
  is_training_day: boolean;
};

// --- Generate events ---

/**
 * Generate nutrition events for a plan within a date range.
 * Creates one event row per date with baseline macros + burn fields.
 * Uses upsert with overwrite on conflict (new plan values always win).
 */
export async function generateNutritionEvents(
  clientId: string,
  planId: string,
  plan: PlanInput,
  dailyTargetRows: StoredDailyTarget[] | null,
  trainingPlan: TrainingPlan | null,
  startDate: string,
  endDate: string
): Promise<void> {
  // Fetch training events for burn calculation
  const trainingEvents = await getEventsForDateRange(clientId, startDate, endDate);

  // Build date → training events map
  const trainingEventsByDate = new Map<string, typeof trainingEvents>();
  for (const event of trainingEvents) {
    const dateKey = event.date.split("T")[0];
    const existing = trainingEventsByDate.get(dateKey) ?? [];
    existing.push(event);
    trainingEventsByDate.set(dateKey, existing);
  }

  // Build day-of-week → stored daily target map
  const targetsByDay = new Map(
    (dailyTargetRows || []).map((dt) => [dt.day_of_week, dt])
  );

  // Iterate dates and build insert rows
  const rows: NutritionEventInsert[] = [];
  const start = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = getDateString(d);
    const dayNum = d.getDay();

    // Find the day name (lowercase) from DAY_NUM reverse lookup
    let dayName: DayOfWeek = "monday";
    for (const [name, num] of Object.entries(DAY_NUM)) {
      if (num === dayNum) {
        dayName = name as DayOfWeek;
        break;
      }
    }

    // Training burn: sum estimatedCalories from training events on this date
    const dayTrainingEvents = trainingEventsByDate.get(dateStr) ?? [];
    const trainingBurnCalories = dayTrainingEvents.reduce(
      (sum, e) => sum + (e.estimatedCalories ?? 0),
      0
    );

    // External burn: from training plan template (external activities aren't events yet)
    const externalActivities = getExternalActivitiesForDay(trainingPlan, dayName);
    const externalBurnCalories = calculateExternalActivityCalories(externalActivities);

    // Is training day: based on whether training events exist for this date
    const isTrainingDay = dayTrainingEvents.length > 0;

    // Baseline from stored daily target row (handles custom macros + custom day distribution)
    const stored = targetsByDay.get(dayName);
    const baselineCalories = stored?.calories ?? plan.baselineCalories;
    const proteinG = stored ? Number(stored.protein_g) : plan.proteinTargetG;

    // Calculate baseline macros (from baseline calories only, not burn-inclusive)
    const macros = calculateDailyMacros(
      baselineCalories,
      proteinG,
      isTrainingDay,
      plan.dietType as DietType
    );

    rows.push({
      client_id: clientId,
      nutrition_plan_id: planId,
      date: dateStr,
      day_of_week: dayName,
      baseline_calories: baselineCalories,
      training_burn_calories: trainingBurnCalories,
      external_burn_calories: externalBurnCalories,
      protein_g: macros.proteinG,
      carb_g: macros.carbsG,
      fat_g: macros.fatG,
      diet_type: plan.dietType,
      is_training_day: isTrainingDay,
      status: "scheduled",
    });
  }

  if (rows.length === 0) return;

  // Upsert with overwrite on conflict (no ignoreDuplicates — new plan values always win)
  // supabaseAdmin: system-level write for event generation
  const { error } = await supabaseAdmin
    .from("nutrition_events")
    .upsert(rows, { onConflict: "client_id,date" });

  if (error) throw error;
}

// --- Regenerate future events ---

/**
 * Delete scheduled events from a given date onward and regenerate from current plan.
 * Past events and non-scheduled events (logged, missed) are preserved.
 */
export async function regenerateFutureNutritionEvents(
  clientId: string,
  planId: string,
  effectiveFrom?: string
): Promise<void> {
  const fromDate = effectiveFrom ?? getTodayDateString();

  // Delete scheduled events from effectiveFrom onward
  const { error: deleteError } = await supabaseAdmin
    .from("nutrition_events")
    .delete()
    .eq("nutrition_plan_id", planId)
    .gte("date", fromDate)
    .eq("status", "scheduled");

  if (deleteError) throw deleteError;

  // Fetch plan metadata
  const { data: planRow, error: planError } = await supabaseAdmin
    .from("nutrition_plans")
    .select("baseline_calories, protein_target_g, diet_type")
    .eq("id", planId)
    .single();

  if (planError || !planRow) throw planError ?? new Error("Nutrition plan not found");

  // Fetch daily target rows
  const { data: dailyTargetRows, error: targetsError } = await supabaseAdmin
    .from("nutrition_plan_daily_targets")
    .select("day_of_week, calories, protein_g, carb_g, fat_g, is_training_day")
    .eq("nutrition_plan_id", planId);

  if (targetsError) throw targetsError;

  // Fetch active training plan and sync is_training_day on daily targets
  const trainingPlan = await getActiveTrainingPlan(clientId);
  if (trainingPlan && dailyTargetRows) {
    const { getTrainingDays } = await import("@/utils/nutrition-helpers");
    const trainingDays = getTrainingDays(trainingPlan);
    for (const row of dailyTargetRows) {
      const shouldBeTrain = trainingDays.has(row.day_of_week);
      if (row.is_training_day !== shouldBeTrain) {
        await supabaseAdmin
          .from("nutrition_plan_daily_targets")
          .update({ is_training_day: shouldBeTrain })
          .eq("nutrition_plan_id", planId)
          .eq("day_of_week", row.day_of_week);
        row.is_training_day = shouldBeTrain;
      }
    }
  }

  // Calculate end date
  const endDate = await calculateNutritionEndDate(planId, fromDate);
  if (!endDate || endDate <= fromDate) return;

  // Cap end date if this is the active plan and a planned plan exists
  const { data: thisPlan } = await supabaseAdmin
    .from("nutrition_plans")
    .select("status")
    .eq("id", planId)
    .single();

  let cappedEndDate = endDate;
  if (thisPlan?.status === "active") {
    const { data: plannedNutritionPlan } = await supabaseAdmin
      .from("nutrition_plans")
      .select("effective_from")
      .eq("client_id", clientId)
      .eq("status", "planned")
      .maybeSingle();

    if (plannedNutritionPlan?.effective_from) {
      const dayBefore = new Date(plannedNutritionPlan.effective_from + "T00:00:00");
      dayBefore.setDate(dayBefore.getDate() - 1);
      const capDate = getDateString(dayBefore);
      if (capDate < cappedEndDate) {
        cappedEndDate = capDate;
      }
    }
  }

  if (cappedEndDate <= fromDate) return;

  await generateNutritionEvents(
    clientId,
    planId,
    {
      baselineCalories: planRow.baseline_calories,
      proteinTargetG: Number(planRow.protein_target_g),
      dietType: planRow.diet_type,
    },
    dailyTargetRows,
    trainingPlan,
    fromDate,
    cappedEndDate
  );
}

// --- Calculate end date ---

async function calculateNutritionEndDate(
  planId: string,
  today: string
): Promise<string | null> {
  // Fetch plan for phase_id
  const { data: plan, error: planError } = await supabaseAdmin
    .from("nutrition_plans")
    .select("phase_id")
    .eq("id", planId)
    .single();

  if (planError || !plan) return fallbackEndDate(today);

  // If plan has a phase, use the phase end date
  if (plan.phase_id) {
    const { data: phase, error: phaseError } = await supabaseAdmin
      .from("phases")
      .select("end_date, start_date, duration_weeks")
      .eq("id", plan.phase_id)
      .maybeSingle();

    if (phaseError || !phase) return fallbackEndDate(today);

    if (phase.end_date) return phase.end_date;

    if (phase.start_date && phase.duration_weeks) {
      const start = new Date(phase.start_date + "T00:00:00");
      start.setDate(start.getDate() + phase.duration_weeks * 7);
      return getDateString(start);
    }

    return fallbackEndDate(today);
  }

  return fallbackEndDate(today);
}

function fallbackEndDate(today: string): string {
  const d = new Date(today + "T00:00:00");
  d.setDate(d.getDate() + 8 * 7); // 8 weeks
  return getDateString(d);
}

// --- Delete future events ---

/**
 * Delete all future scheduled events for a plan.
 * Used when a plan is being replaced or deactivated.
 */
export async function deleteFutureNutritionEventsForPlan(
  planId: string,
  fromDate?: string
): Promise<void> {
  const deleteFrom = fromDate ?? getTodayDateString();

  // supabaseAdmin: system-level write for event cleanup
  const { error } = await supabaseAdmin
    .from("nutrition_events")
    .delete()
    .eq("nutrition_plan_id", planId)
    .gte("date", deleteFrom)
    .eq("status", "scheduled");

  if (error) throw error;
}

// --- Query functions ---

/**
 * Get all events for a client within a date range, ordered by date ascending.
 */
export async function getNutritionEventsForDateRange(
  clientId: string,
  startDate: string,
  endDate: string
): Promise<NutritionEvent[]> {
  const { data, error } = await supabaseAdmin
    .from("nutrition_events")
    .select("*")
    .eq("client_id", clientId)
    .gte("date", startDate)
    .lte("date", endDate)
    .order("date", { ascending: true });

  if (error) throw error;
  return (data ?? []).map(mapNutritionEventRow);
}

/**
 * Get a single event for a client on a specific date.
 * Returns null if no event exists.
 */
export async function getNutritionEventForDate(
  clientId: string,
  date: string
): Promise<NutritionEvent | null> {
  const { data, error } = await supabaseAdmin
    .from("nutrition_events")
    .select("*")
    .eq("client_id", clientId)
    .eq("date", date)
    .maybeSingle();

  if (error) throw error;
  return data ? mapNutritionEventRow(data) : null;
}

// --- Training burn updates ---

/**
 * Update the training burn on a nutrition event for a specific date.
 * Called when a client completes a training session (scheduled or alternative)
 * so the nutrition event reflects the actual burn, not the originally planned one.
 */
export async function updateNutritionEventTrainingBurn(
  clientId: string,
  date: string,
  trainingBurnCalories: number
): Promise<void> {
  // supabaseAdmin: system-level write for event accuracy
  const { error } = await supabaseAdmin
    .from("nutrition_events")
    .update({
      training_burn_calories: trainingBurnCalories,
      is_training_day: trainingBurnCalories > 0,
      updated_at: new Date().toISOString(),
    })
    .eq("client_id", clientId)
    .eq("date", date);

  if (error) throw error;
}

// --- Status updates ---

/**
 * Mark a nutrition event as logged (called when a nutrition log is saved).
 */
export async function markNutritionEventLogged(
  clientId: string,
  date: string
): Promise<void> {
  // supabaseAdmin: system-level write for status tracking
  const { error } = await supabaseAdmin
    .from("nutrition_events")
    .update({
      status: "logged",
      updated_at: new Date().toISOString(),
    })
    .eq("client_id", clientId)
    .eq("date", date);

  if (error) throw error;
}

/**
 * Mark all past scheduled events as missed.
 */
export async function markMissedNutritionEvents(
  clientId: string,
  beforeDate: string
): Promise<void> {
  // supabaseAdmin: system-level write for status tracking
  const { error } = await supabaseAdmin
    .from("nutrition_events")
    .update({
      status: "missed",
      updated_at: new Date().toISOString(),
    })
    .eq("client_id", clientId)
    .lt("date", beforeDate)
    .eq("status", "scheduled");

  if (error) throw error;
}
