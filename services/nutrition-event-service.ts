import { supabaseAdmin } from "./supabase-admin";
import type { NutritionEvent, NutritionEventStatus, DietType } from "@/types/check-in";
import type { NutritionEventRow, NutritionEventInsert } from "@/lib/database-helpers";
import type { TrainingPlan } from "@/types/training";
import {
  getTodayDateString,
  getDateString,
  expandDateRange,
  DAY_NUM,
} from "@/lib/date-helpers";
import { getClientTodayString } from "@/services/today-service";
import { getEventsForDateRange } from "@/services/training-event-service";
import { calculateDailyMacros } from "@/utils/nutrition-helpers";
import type { DayOfWeek } from "@/utils/nutrition-helpers";
import { captureApiError } from "@/lib/error-handler";

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
    proteinG: Number(row.protein_g),
    carbG: Number(row.carb_g),
    fatG: Number(row.fat_g),
    dietType: row.diet_type,
    isTrainingDay: row.is_training_day,
    calorieSurplusPercentage: row.calorie_surplus_percentage ?? null,
    isModified: row.is_modified,
    note: row.note ?? null,
    coachNote: row.coach_note ?? null,
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
  dates: string[]
): Promise<void> {
  // An explicit date LIST, not a [start, end] range: a narrow cascade (a move, a
  // duplicate, one surplus edit) rewrites exactly the days it changed and leaves
  // the gaps alone. Contiguous callers expand their range with expandDateRange.
  const orderedDates = Array.from(new Set(dates)).sort();
  if (orderedDates.length === 0) return;

  const rangeStart = orderedDates[0];
  const rangeEnd = orderedDates[orderedDates.length - 1];

  // Fetch training events for burn calculation. Bracketed by the list's extremes
  // rather than queried per date — the per-date map below only reads the dates we
  // are actually writing, so a scattered list over-reads but never over-writes.
  const trainingEvents = await getEventsForDateRange(clientId, rangeStart, rangeEnd);

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

  for (const dateStr of orderedDates) {
    const dayNum = new Date(dateStr + "T00:00:00").getDay();

    // Find the day name (lowercase) from DAY_NUM reverse lookup
    let dayName: DayOfWeek = "monday";
    for (const [name, num] of Object.entries(DAY_NUM)) {
      if (num === dayNum) {
        dayName = name as DayOfWeek;
        break;
      }
    }

    const dayTrainingEvents = trainingEventsByDate.get(dateStr) ?? [];
    const isTrainingDay = dayTrainingEvents.length > 0;

    // Baseline from stored daily target row (handles custom macros + custom day distribution)
    const stored = targetsByDay.get(dayName);
    const baselineCalories = stored?.calories ?? plan.baselineCalories;

    // New percentage model: use surplus % from training event's session
    // Legacy fallback: sum estimatedCalories as flat burn
    const firstEvent = dayTrainingEvents[0];
    const surplusPercentage = firstEvent?.calorieSurplusPercentage ?? null;
    let trainingBurnCalories = 0;
    if (surplusPercentage != null) {
      trainingBurnCalories = Math.round(baselineCalories * surplusPercentage / 100);
    } else {
      trainingBurnCalories = dayTrainingEvents.reduce(
        (sum, e) => sum + (e.estimatedCalories ?? 0),
        0
      );
    }

    // Baseline macros: use the stored daily-target macros VERBATIM — they already
    // carry custom macros, custom day-distribution, and the auto diet-split.
    // Whatever the coach set is what lands on the event (no re-deriving the
    // carb/fat split). Only compute a split when there's no stored target.
    const macros = stored
      ? {
          proteinG: Number(stored.protein_g),
          carbsG: Number(stored.carb_g),
          fatG: Number(stored.fat_g),
        }
      : calculateDailyMacros(
          baselineCalories,
          plan.proteinTargetG,
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
      protein_g: macros.proteinG,
      carb_g: macros.carbsG,
      fat_g: macros.fatG,
      diet_type: plan.dietType,
      is_training_day: isTrainingDay,
      calorie_surplus_percentage: surplusPercentage,
      status: "scheduled",
    });
  }

  if (rows.length === 0) return;

  // One read, two jobs.
  //
  // (1) Preserve coach-edited days: an is_modified override that survived the
  // cascade delete must not be clobbered by this client-scoped
  // onConflict(client_id,date) upsert. Key on client_id + date range (NOT
  // nutrition_plan_id) — the conflict key is client-scoped, so an override
  // owned by a different plan in this window must still be protected.
  //
  // (2) Carry coach notes forward. Annotated days deliberately survive the
  // cascade delete, so they reach this upsert as a conflict and their targets
  // are rewritten. `coach_note` is set EXPLICITLY on every row below rather
  // than omitted-and-assumed-preserved: PostgREST builds its DO UPDATE SET
  // list from the payload keys, so omission would happen to work, but a
  // behaviour this easy to lose to a library change deserves to be stated.
  //
  // A failed read must NOT silently overwrite an edit or drop a note, so throw
  // (consistent with the delete/plan/targets/upsert errors here).
  //
  // Keyed on the exact date list, not [min,max] — a scattered narrow cascade must
  // not read (or reason about) days it is not writing.
  const { data: existingDays, error: protectedErr } = await supabaseAdmin
    .from("nutrition_events")
    .select("date, is_modified, coach_note")
    .eq("client_id", clientId)
    .in("date", orderedDates);

  if (protectedErr) throw protectedErr;

  const protectedDates = new Set(
    (existingDays ?? []).filter((r) => r.is_modified).map((r) => r.date)
  );
  const noteByDate = new Map(
    (existingDays ?? [])
      .filter((r) => r.coach_note != null)
      .map((r) => [r.date, r.coach_note as string])
  );

  const rowsToUpsert = (protectedDates.size
    ? rows.filter((r) => !protectedDates.has(r.date))
    : rows
  ).map((r) => ({ ...r, coach_note: noteByDate.get(r.date) ?? null }));

  if (rowsToUpsert.length === 0) return;

  // Upsert with overwrite on conflict (no ignoreDuplicates — new plan values always win)
  // supabaseAdmin: system-level write for event generation
  const { error } = await supabaseAdmin
    .from("nutrition_events")
    .upsert(rowsToUpsert, { onConflict: "client_id,date" });

  if (error) throw error;
}

// --- Regenerate future events ---

/**
 * Which dates a regeneration covers.
 *
 * - `dates` — exactly these days. Pure upsert, NO delete: the conflict key is
 *   (client_id, date) and the generator already skips `is_modified` days and
 *   carries `coach_note` forward, so the delete bought nothing here and only
 *   opened a four-round-trip window in which those dates had no row at all
 *   (`getPlanTargetForDate` returns null for a missing row, and that null is
 *   snapshotted permanently into `nutrition_logs`).
 * - `from` — a floor; the DELETE and the regenerate derive from ONE computed
 *   range, `[from, from + 8 weeks]`. Days past the horizon keep their existing
 *   (possibly stale) rows; a later cascade sweeps them as today advances.
 *   Stale-but-present beats absent. (3abbfa5 also carried an explicit `to` so
 *   the plan-deletion routes could sweep past the horizon; that half is NOT
 *   re-landed — the stale-tail defect it closed is recorded in
 *   TECHNICAL-DEBT.md rather than fixed here.)
 */
export type NutritionRegenScope =
  | { kind: "dates"; dates: string[] }
  | { kind: "from"; from: string };

/** The one place a scope becomes a concrete date list. */
function resolveScopeDates(scope: NutritionRegenScope): string[] {
  if (scope.kind === "dates") return scope.dates;
  return expandDateRange(scope.from, calculateNutritionEndDate(scope.from));
}

/**
 * Regenerate a plan's scheduled nutrition events over an explicit scope.
 * Past events and non-scheduled events (logged, missed) are preserved by the
 * delete; the upsert then overwrites any surviving row on a covered date with
 * current-plan values (see ARCHITECTURE.md → Training → Nutrition cascade for
 * what that means for logged rows).
 */
export async function regenerateFutureNutritionEvents(
  clientId: string,
  planId: string,
  scope?: NutritionRegenScope
): Promise<void> {
  const resolvedScope: NutritionRegenScope =
    scope ?? { kind: "from", from: await getClientTodayString(clientId) };

  // Resolve the dates BEFORE any write. The old code deleted first and only
  // then hit its range guard — an early return after a delete would clear the
  // window without regenerating it, turning a no-op into a wipe.
  const dates = resolveScopeDates(resolvedScope);
  if (dates.length === 0) return;

  // A `dates` scope skips the delete entirely (see NutritionRegenScope). A
  // `from` scope deletes over exactly the range it is about to regenerate — the
  // upper bound is load-bearing: an unbounded ray (`date >= from`) paired with
  // the fixed 8-week regeneration below meant any cascade anchored EARLIER than
  // the anchor that wrote the rows deleted a tail it never rebuilt.
  //
  // Always preserve coach-edited days (is_modified): nutrition preserves edits
  // across the cascade unconditionally (no force param, unlike training); an
  // explicit reset clears the flag before regenerating that date.
  //
  // Annotated days survive the delete too (`coach_note IS NULL`), and their
  // targets are still rewritten by the upsert below — a coach note describes
  // WHY the prescription changed on that date, so it must outlive the next
  // prescription change. Without this, any later training cascade anchored on
  // or before an annotated date would silently erase the note.
  if (resolvedScope.kind === "from") {
    const { error: deleteError } = await supabaseAdmin
      .from("nutrition_events")
      .delete()
      .eq("nutrition_plan_id", planId)
      .gte("date", dates[0])
      .lte("date", dates[dates.length - 1])
      .eq("status", "scheduled")
      .eq("is_modified", false)
      .is("coach_note", null);

    if (deleteError) throw deleteError;
  }

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

  // `nutrition_plan_daily_targets.is_training_day` is no longer synced here.
  // Under the current architecture training sessions live on dates (via
  // training_events), not days of week — getTrainingDays() used to read
  // session.dayOfWeek which is always null now, producing stale Mon/Tue/Thu/Fri
  // defaults and wrong badges. Display paths now derive isTrainingDay from the
  // actual event rows (the coach calendar reads them directly; the client
  // program card goes through buildDailyTargetsFromPlan), so the stored column
  // is no longer read. The per-date `nutrition_events.is_training_day`
  // written below by generateNutritionEvents remains the source of truth.

  await generateNutritionEvents(
    clientId,
    planId,
    {
      baselineCalories: planRow.baseline_calories,
      proteinTargetG: Number(planRow.protein_target_g),
      dietType: planRow.diet_type,
    },
    dailyTargetRows,
    null, // trainingPlan param is vestigial; training days derive from training_events
    dates
  );
}

// --- Calculate end date ---

// Dense forward window for nutrition events: 8 weeks from the anchor date.
function calculateNutritionEndDate(today: string): string {
  const d = new Date(today + "T00:00:00");
  d.setDate(d.getDate() + 8 * 7); // 8 weeks
  return getDateString(d);
}

// --- Cascade helper ---

/**
 * Regenerate future nutrition events for every active/planned nutrition plan
 * a client has. Shared by all training-side mutations that affect training
 * events (placement, duplicate, move, surplus edits) so calorie targets
 * always stay in sync with the training calendar.
 *
 * Errors are logged to Sentry so a failing regen doesn't block the caller's
 * primary operation.
 *
 * @param scope which dates this change actually touched. Routes that know their
 *   exact dates pass `{kind:"dates"}` (move = [source, target]; duplicate =
 *   [targetDate]; a surplus edit = [eventDate]) and get a pure upsert over just
 *   those days. Routes whose change is open-ended forward pass `{kind:"from"}`.
 */
export async function cascadeNutritionAfterTrainingChange(
  clientId: string,
  scope: NutritionRegenScope,
  actionTag: string,
): Promise<void> {
  // Single durable plan: regenerate the one active plan's future events.
  // (The 'planned' nutrition model was removed in migration 116.)
  const { data: activePlan } = await supabaseAdmin
    .from("nutrition_plans")
    .select("id")
    .eq("client_id", clientId)
    .eq("status", "active")
    .maybeSingle();

  if (!activePlan) return;

  await regenerateFutureNutritionEvents(clientId, activePlan.id, scope).catch((err) =>
    captureApiError(err, { action: actionTag, planId: activePlan.id }),
  );
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
  // UTC fallback only: no clientId in scope to resolve a client-local today.
  // Callers that know the client should pass an explicit date.
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

