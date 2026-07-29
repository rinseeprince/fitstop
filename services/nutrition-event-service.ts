import { supabaseAdmin } from "./supabase-admin";
import type { NutritionEvent, NutritionEventStatus, DietType } from "@/types/check-in";
import type { NutritionEventRow, NutritionEventInsert } from "@/lib/database-helpers";
import type { TrainingPlan } from "@/types/training";
import {
  getTodayDateString,
  expandDateRange,
  addDaysToDateString,
  DAY_NUM,
} from "@/lib/date-helpers";
import { getPhaseForDate, lastPhaseEnd } from "@/lib/goals/phase-chain";
import type { DatedPhase } from "@/lib/goals/phase-chain";
import { getClientPhases } from "@/services/client-phases-service";
import type { PhaseDailyTarget } from "@/services/client-phases-service";
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

/** What applies to ONE date, after blocks and custom macros have been resolved. */
export type ResolvedDayTargets = {
  baselineCalories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  dietType: string;
};

/**
 * Answers "what are this date's targets?", called once per generated date.
 *
 * This is what makes blocks work: the generator used to close over ONE set of
 * numbers for the whole walk, so every date it wrote got the same targets. It
 * now asks per date, and a date inside a block gets that block's grid.
 *
 * `isTrainingDay` is passed IN rather than resolved here — it is a per-DATE fact
 * derived from live training events, which a weekday-keyed grid cannot carry
 * (migration 137 deliberately omits it from `client_phases.daily_targets`).
 */
export type NutritionTargetResolver = (
  date: string,
  dayName: DayOfWeek,
  isTrainingDay: boolean
) => ResolvedDayTargets;

/** A block's window plus the grid generated for it (null until task 2.6 runs). */
type PhaseGridInput = {
  startsOn: string;
  endsOn: string;
  dailyTargets: PhaseDailyTarget[] | null;
};

/**
 * Build the per-date resolver from a plan, its weekday grid, and the client's
 * blocks. Resolution order, highest priority first:
 *
 *  1. **Custom macros → the plan grid, blocks ignored entirely.** The coach
 *     typed these numbers and the calculator never ran, so no block drove them;
 *     resolving an in-block date to a block's grid would silently overwrite what
 *     the coach typed (`drawer-footer.tsx` — "custom macros ARE the targets").
 *  2. **The block covering this date**, when it has a generated grid.
 *  3. **The plan's `nutrition_plan_daily_targets`** — a client with no blocks
 *     resolves exactly as they did before blocks existed, which is the property
 *     that makes this safe to ship for existing clients.
 */
export function createNutritionTargetResolver(input: {
  plan: PlanInput;
  planDailyTargets: StoredDailyTarget[] | null;
  phases?: PhaseGridInput[];
  customMacrosEnabled?: boolean;
}): NutritionTargetResolver {
  const { plan, planDailyTargets, phases = [], customMacrosEnabled = false } = input;

  const planTargetsByDay = new Map(
    (planDailyTargets || []).map((dt) => [dt.day_of_week, dt])
  );

  // Each block's grid is indexed by weekday up front, so the per-date resolver
  // below is a lookup rather than a scan over 7 rows per date.
  const phaseGrids = phases.map((phase) => ({
    startsOn: phase.startsOn,
    endsOn: phase.endsOn,
    byDay: phase.dailyTargets
      ? new Map(phase.dailyTargets.map((dt) => [dt.day_of_week, dt]))
      : null,
  }));

  return (date, dayName, isTrainingDay) => {
    const coveringPhase = customMacrosEnabled
      ? null
      : getPhaseForDate(phaseGrids, date);
    const phaseRow = coveringPhase?.byDay?.get(dayName);

    if (phaseRow) {
      return {
        baselineCalories: phaseRow.calories,
        proteinG: Number(phaseRow.protein_g),
        carbsG: Number(phaseRow.carb_g),
        fatG: Number(phaseRow.fat_g),
        dietType: plan.dietType,
      };
    }

    // Baseline macros come from the stored row VERBATIM — it already carries
    // custom macros, custom day-distribution and the auto diet-split. Only
    // compute a split when there is no stored row at all.
    const stored = planTargetsByDay.get(dayName);
    const baselineCalories = stored?.calories ?? plan.baselineCalories;

    if (stored) {
      return {
        baselineCalories,
        proteinG: Number(stored.protein_g),
        carbsG: Number(stored.carb_g),
        fatG: Number(stored.fat_g),
        dietType: plan.dietType,
      };
    }

    const macros = calculateDailyMacros(
      baselineCalories,
      plan.proteinTargetG,
      isTrainingDay,
      plan.dietType as DietType
    );
    return {
      baselineCalories,
      proteinG: macros.proteinG,
      carbsG: macros.carbsG,
      fatG: macros.fatG,
      dietType: plan.dietType,
    };
  };
}

// --- Generate events ---

/**
 * Generate nutrition events for a plan within a date range.
 * Creates one event row per date with baseline macros + burn fields.
 * Uses upsert with overwrite on conflict (new plan values always win).
 */
export async function generateNutritionEvents(
  clientId: string,
  planId: string,
  resolveTargets: NutritionTargetResolver,
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

    // Asked PER DATE, so a date inside a block gets that block's numbers.
    const targets = resolveTargets(dateStr, dayName, isTrainingDay);
    const baselineCalories = targets.baselineCalories;

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

    rows.push({
      client_id: clientId,
      nutrition_plan_id: planId,
      date: dateStr,
      day_of_week: dayName,
      baseline_calories: baselineCalories,
      training_burn_calories: trainingBurnCalories,
      protein_g: targets.proteinG,
      carb_g: targets.carbsG,
      fat_g: targets.fatG,
      diet_type: targets.dietType,
      is_training_day: isTrainingDay,
      calorie_surplus_percentage: surplusPercentage,
      status: "scheduled",
    });
  }

  if (rows.length === 0) return;

  // Preserve coach-edited days: an is_modified override that survived the cascade
  // delete must not be clobbered by this client-scoped onConflict(client_id,date)
  // upsert. Key on client_id + date range (NOT nutrition_plan_id) — the conflict
  // key is client-scoped, so an override owned by a different plan in this window
  // must still be protected. A failed read must NOT silently overwrite an edit,
  // so throw (consistent with the delete/plan/targets/upsert errors here).
  // Keyed on the exact date list, not [min,max] — a scattered narrow cascade must
  // not read (or reason about) days it is not writing.
  const { data: protectedDays, error: protectedErr } = await supabaseAdmin
    .from("nutrition_events")
    .select("date")
    .eq("client_id", clientId)
    .eq("is_modified", true)
    .in("date", orderedDates);

  if (protectedErr) throw protectedErr;

  const protectedDates = new Set((protectedDays ?? []).map((r) => r.date));
  const rowsToUpsert = protectedDates.size
    ? rows.filter((r) => !protectedDates.has(r.date))
    : rows;

  // A coach's edit protects THE NUMBERS THEY TYPED — not the training calendar.
  // `is_training_day` is a fact about whether the client trains that day; a coach
  // who edited Tuesday's calories never said "and Tuesday is a training day
  // forever". Freezing it stranded a TRAIN badge on a day the session had been
  // moved OFF (and withheld one from a day it moved onto), permanently: the
  // cascade skips these rows entirely, so nothing else would ever correct it and
  // the only way back was resetting the day.
  //
  // Their calories, macros, surplus and burn stay exactly as the coach left them
  // — `materializeNutritionEventDays` deliberately sets surplus NULL and burn 0
  // so training stops stacking on an edited day, and that must not be undone.
  if (protectedDates.size) {
    await refreshTrainingDayFlagOnEditedDays(
      clientId,
      rows.filter((r) => protectedDates.has(r.date))
    );
  }

  if (rowsToUpsert.length === 0) return;

  // Upsert with overwrite on conflict (no ignoreDuplicates — new plan values always win)
  // supabaseAdmin: system-level write for event generation
  const { error } = await supabaseAdmin
    .from("nutrition_events")
    .upsert(rowsToUpsert, { onConflict: "client_id,date" });

  if (error) throw error;
}

/**
 * Refresh `is_training_day` on coach-edited days, touching no other column.
 *
 * Two batched statements — one for the days that ARE training days, one for the
 * days that are not — rather than an update per row, so round trips stay
 * constant (2 at most) however many days the cascade covers. Both are
 * client-scoped and re-assert `is_modified = true`, so a stale date set can
 * never reach an unprotected row.
 *
 * `updated_at` is stamped explicitly: `nutrition_events` has no trigger, and this
 * is a real UPDATE rather than the upsert half that leaves the column frozen.
 */
async function refreshTrainingDayFlagOnEditedDays(
  clientId: string,
  // `is_training_day` is optional on the insert type, though the generator above
  // always sets it. Coerced rather than asserted so an absent value means "rest",
  // never a write of `undefined`.
  protectedRows: Array<{ date: string; is_training_day?: boolean | null }>
): Promise<void> {
  const byFlag: Array<[boolean, string[]]> = [
    [true, protectedRows.filter((r) => r.is_training_day === true).map((r) => r.date)],
    [false, protectedRows.filter((r) => r.is_training_day !== true).map((r) => r.date)],
  ];

  for (const [flag, dates] of byFlag) {
    if (dates.length === 0) continue;
    const { error } = await supabaseAdmin
      .from("nutrition_events")
      .update({ is_training_day: flag, updated_at: new Date().toISOString() })
      .eq("client_id", clientId)
      .eq("is_modified", true)
      .in("date", dates);

    if (error) throw error;
  }
}

// --- Regenerate future events ---

/**
 * Which dates a regeneration covers.
 *
 * - `dates` — exactly these days. Pure upsert, NO delete: the conflict key is
 *   (client_id, date) and the generator already skips `is_modified` days, so the
 *   delete bought nothing here and only opened a window in which those dates had
 *   no row at all (`getPlanTargetForDate` returns null for a missing row, and that
 *   null is snapshotted permanently into `nutrition_logs`).
 * - `from` — a floor, optionally with an explicit `to`. The DELETE and the
 *   regenerate derive from ONE computed range. Previously the delete was unbounded
 *   above (`.gte` with no `.lte`) while the regenerate stopped at the horizon, so
 *   every cascade silently erased any day past it and never rewrote it.
 */
export type NutritionRegenScope =
  | { kind: "dates"; dates: string[] }
  | { kind: "from"; from: string; to?: string };

/**
 * The one place a scope becomes a concrete date list.
 *
 * Both the DELETE and the regenerate derive from the array this returns, so they
 * cannot disagree about their range — the defect task 1.2 fixed. Widening the
 * horizon for blocks (below) therefore cannot reintroduce it.
 */
function resolveScopeDates(
  scope: NutritionRegenScope,
  phases: DatedPhase[] = []
): string[] {
  if (scope.kind === "dates") return scope.dates;
  const horizon = calculateNutritionEndDate(scope.from, phases);
  const end = scope.to && scope.to > horizon ? scope.to : horizon;
  return expandDateRange(scope.from, end);
}

/**
 * Regenerate a plan's scheduled nutrition events over an explicit scope.
 * Past events and non-scheduled events (logged, missed) are preserved.
 */
export async function regenerateFutureNutritionEvents(
  clientId: string,
  planId: string,
  scope?: NutritionRegenScope
): Promise<void> {
  const resolvedScope: NutritionRegenScope =
    scope ?? { kind: "from", from: await getClientTodayString(clientId) };

  // Loaded ONCE and passed to both the horizon and the per-date resolver — a
  // query inside the per-date loop is the shape CONVENTIONS §2 forbids.
  const phases = await getClientPhases(clientId);

  // Resolve the dates BEFORE any write. The old code deleted first and only then
  // hit its `endDate <= fromDate` guard — a "deleted the calendar, returned
  // success" path that was unreachable only because the horizon was a constant.
  const dates = resolveScopeDates(resolvedScope, phases);
  if (dates.length === 0) return;

  // A `dates` scope skips the delete entirely (see NutritionRegenScope). A `from`
  // scope deletes over exactly the range it is about to regenerate.
  // Always preserve coach-edited days (is_modified): nutrition preserves edits
  // across the cascade unconditionally (no force param, unlike training); an
  // explicit reset clears the flag before regenerating that date.
  if (resolvedScope.kind === "from") {
    const { error: deleteError } = await supabaseAdmin
      .from("nutrition_events")
      .delete()
      .eq("nutrition_plan_id", planId)
      .gte("date", dates[0])
      .lte("date", dates[dates.length - 1])
      .eq("status", "scheduled")
      .eq("is_modified", false);

    if (deleteError) throw deleteError;
  }

  // Fetch plan metadata
  // `custom_macros_enabled` is selected because the resolver must short-circuit
  // blocks when it is true — see createNutritionTargetResolver.
  const { data: planRow, error: planError } = await supabaseAdmin
    .from("nutrition_plans")
    .select("baseline_calories, protein_target_g, diet_type, custom_macros_enabled")
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
  // defaults and wrong badges. All display paths now derive isTrainingDay
  // from the actual event rows via buildDailyTargetsFromPlan, so the stored
  // column is no longer read. The per-date `nutrition_events.is_training_day`
  // written below by generateNutritionEvents remains the source of truth.

  await generateNutritionEvents(
    clientId,
    planId,
    createNutritionTargetResolver({
      plan: {
        baselineCalories: planRow.baseline_calories,
        proteinTargetG: Number(planRow.protein_target_g),
        dietType: planRow.diet_type,
      },
      planDailyTargets: dailyTargetRows,
      phases,
      customMacrosEnabled: planRow.custom_macros_enabled ?? false,
    }),
    null, // trainingPlan param is vestigial; training days derive from training_events
    dates
  );
}

// --- Calculate end date ---

/** Dense forward window for nutrition events, in days. */
const NUTRITION_HORIZON_DAYS = 8 * 7;

/**
 * How far forward events are written: `max(anchor + 8 weeks, last block end)`.
 *
 * A coach who sets a 15-week block chain has told us the plan runs that long, so
 * stopping at 8 weeks would leave the tail of their own plan unwritten. Blocks
 * are bounded at `MAX_CHAIN_WEEKS` (104) by zod in task 2.3, which is what bounds
 * this worst case.
 *
 * UTC-anchored via `addDaysToDateString` rather than `new Date(d).setDate()` —
 * a parse-local/format-UTC mix silently loses a day west of UTC (task 1.4).
 */
function calculateNutritionEndDate(today: string, phases: DatedPhase[] = []): string {
  const horizon = addDaysToDateString(today, NUTRITION_HORIZON_DAYS);
  const lastEnd = lastPhaseEnd(phases);
  return lastEnd && lastEnd > horizon ? lastEnd : horizon;
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
 *   those days. Routes whose change is open-ended forward pass `{kind:"from"}`,
 *   with an explicit `to` when they know where their window ends.
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

