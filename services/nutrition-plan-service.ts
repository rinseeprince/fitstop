import { supabaseAdmin } from "./supabase-admin";
import type { NutritionPlanNote } from "@/types/nutrition-plan-notes";
import { coversDate } from "./training-plan-window";
import { getBlockBoundForDate } from "./client-blocks-service";
import { getFurthestLiveProgramEnd } from "./training-service";
import { calculateDailyMacros, DAYS_OF_WEEK } from "@/utils/nutrition-helpers";
import { addDaysToDateString } from "@/lib/date-helpers";
import { NUTRITION_PLACEMENT_FALLBACK_DAYS } from "@/lib/constants";
import { fetchAllByChunkedIds } from "@/lib/paged-fetch";
import type { ClientPlanWindow } from "@/lib/prescription-triggers";
import type { DietType } from "@/types/check-in";
import type { TrainingPlan } from "@/types/training";
import type { Database } from "@/types/database";

type NutritionPlanRow = Database["public"]["Tables"]["nutrition_plans"]["Row"];

type CreatePlanRpcArgs = Database["public"]["Functions"]["create_nutrition_plan_atomic"]["Args"];

/**
 * The nine parameters that legitimately carry SQL NULL. `supabase gen types`
 * derives an argument's type from its SQL type alone and never emits `| null`,
 * so the generated Args rejects the nulls this function is written to accept —
 * a client with no goal weight, no deadline, no custom macros, no BMR.
 *
 * `CreatePlanRpcArgs[K]` stops compiling if one of these keys leaves the
 * signature, but the list otherwise tracks the migration BY HAND: a migration
 * that makes a tenth parameter nullable, or makes one of these nine NOT NULL,
 * must update this union — widening a key is invisible to the `satisfies`
 * check below.
 */
type NullableRpcArgKeys =
  | "p_goal_weight_kg"
  | "p_goal_deadline"
  | "p_bmr"
  | "p_tdee"
  | "p_custom_calories"
  | "p_custom_protein_g"
  | "p_custom_carb_g"
  | "p_custom_fat_g"
  | "p_effective_from";

/**
 * The payload this service must send: the 25 parameters migration 166 requires
 * present, with NULL admitted on the nine above, plus migration 172's
 * `p_coach_note`, sent only when the save carries a note — the RPC's DEFAULT
 * NULL is the empty case, never an explicit null. `Required<>` makes the two
 * the SQL gives defaults (`p_effective_from`, `p_today`) mandatory here — the
 * RPC's past-date belt reads `p_today`, so dropping it is a bug on this side
 * even though the function itself would accept the call. `p_effective_until`
 * has no default: a version without an end is the model migration 166 retired.
 */
type CreateNutritionPlanRpcPayload = Required<
  Omit<CreatePlanRpcArgs, NullableRpcArgKeys | "p_coach_note">
> & {
  [K in NullableRpcArgKeys]: CreatePlanRpcArgs[K] | null;
} & Pick<CreatePlanRpcArgs, "p_coach_note">;

type CreateNutritionPlanParams = {
  clientId: string;
  coachId: string;
  /**
   * The client-local today the ROUTE's past-date guard judged against —
   * threaded, never recomputed here. The RPC's belt raises when
   * effectiveFrom < p_today, so a second getClientTodayString call straddling
   * client midnight would make a route-accepted save fail in the RPC with a
   * generic error. Single source: orchestrator :166 → calcInputs.today → here.
   */
  clientToday: string;
  workActivityLevel: string;
  trainingVolumeHours: string;
  proteinTargetGPerKg: number;
  dietType: DietType;
  goalWeightKg: number | null;
  goalDeadline: string | null;
  baselineCalories: number;
  proteinTargetG: number;
  carbTargetG: number;
  fatTargetG: number;
  baseWeightKg: number;
  bmr: number | null;
  tdee: number | null;
  customMacrosEnabled: boolean;
  customCalories: number | null;
  customProteinG: number | null;
  customCarbG: number | null;
  customFatG: number | null;
  regenerationReason: string;
  trainingPlan: TrainingPlan | null;
  effectiveFrom?: string;
  /**
   * The placement's last day — `resolveNutritionPlacementEnd`'s answer for the
   * effective date, resolved once by the orchestrator. The row the RPC writes
   * is the window every day inside it is computed from.
   */
  effectiveUntil: string;
  /**
   * The coach's note for this save — one of the RPC's arguments, so it lands in
   * the version's transaction (migration 172). Omitted when the save carries
   * none, which on a same-day re-save clears the version's note: the note is
   * the latest save's, empty included.
   */
  coachNote?: string;
};

/**
 * Save a nutrition plan VERSION as a PLACEMENT (migration 166 — one
 * transaction). The RPC caps the predecessor at `start − 1`, caps this version
 * at the next queued version's start, REPLACES IN PLACE a version starting on
 * the same day (a same-day re-save collapses; a retry never mints a twin) and
 * inserts otherwise, then replaces the version's daily-target grid. Windows can
 * never overlap: the gist exclusion is the backstop that must never fire.
 * Returns the surviving version's id or null on error.
 */
export async function createNutritionPlan(params: CreateNutritionPlanParams): Promise<string | null> {
  // Compute daily target rows before calling the atomic RPC
  const dailyTargets: { day_of_week: string; calories: number; protein_g: number; carb_g: number; fat_g: number; is_training_day: boolean }[] = [];

  if (params.customMacrosEnabled && params.customCalories != null) {
    for (const day of DAYS_OF_WEEK) {
      dailyTargets.push({
        day_of_week: day,
        calories: params.customCalories,
        protein_g: params.customProteinG ?? params.proteinTargetG,
        carb_g: params.customCarbG ?? params.carbTargetG,
        fat_g: params.customFatG ?? params.fatTargetG,
        is_training_day: false,
      });
    }
  } else {
    // is_training_day is stored for schema compatibility but is no longer the
    // source of truth for the training/rest badge. The badge is derived per
    // day-of-week from live training_events at read time in
    // buildDailyTargetsFromPlan — see that function's `day in surplusByDay`
    // check. Writing false here is safe because calculateDailyMacros ignores
    // the isTrainingDay arg (see the underscore prefix on its parameter).
    for (const day of DAYS_OF_WEEK) {
      const baselineMacros = calculateDailyMacros(
        params.baselineCalories,
        params.proteinTargetG,
        false,
        params.dietType
      );

      dailyTargets.push({
        day_of_week: day,
        calories: params.baselineCalories,
        protein_g: baselineMacros.proteinG,
        carb_g: baselineMacros.carbsG,
        fat_g: baselineMacros.fatG,
        is_training_day: false,
      });
    }
  }

  // Single transactional RPC: cap the predecessor + replace-in-place or insert
  // the new version + replace its daily-target grid (migration 166).
  const { data: newPlanId, error: rpcError } = await supabaseAdmin
    .rpc("create_nutrition_plan_atomic", {
      p_client_id: params.clientId,
      p_coach_id: params.coachId,
      p_work_activity_level: params.workActivityLevel,
      p_training_volume_hours: params.trainingVolumeHours,
      p_protein_target_g_per_kg: params.proteinTargetGPerKg,
      p_diet_type: params.dietType,
      p_goal_weight_kg: params.goalWeightKg,
      p_goal_deadline: params.goalDeadline,
      p_baseline_calories: params.baselineCalories,
      p_protein_target_g: params.proteinTargetG,
      p_carb_target_g: params.carbTargetG,
      p_fat_target_g: params.fatTargetG,
      p_base_weight_kg: params.baseWeightKg,
      p_bmr: params.bmr,
      p_tdee: params.tdee,
      p_custom_macros_enabled: params.customMacrosEnabled,
      p_custom_calories: params.customCalories,
      p_custom_protein_g: params.customProteinG,
      p_custom_carb_g: params.customCarbG,
      p_custom_fat_g: params.customFatG,
      p_regeneration_reason: params.regenerationReason,
      p_daily_targets: dailyTargets,
      p_effective_until: params.effectiveUntil,
      p_effective_from: params.effectiveFrom || null,
      p_today: params.clientToday,
      ...(params.coachNote ? { p_coach_note: params.coachNote } : {}),
      // `satisfies` checks this payload against migration 172's signature (166's
      // 25 parameters plus the optional note): an added, dropped or renamed key is a compile error HERE,
      // rather than a PGRST202 at runtime where PostgREST cannot resolve the
      // overload, rpcError is set below, this returns null, and EVERY plan save
      // fails with "Failed to create nutrition plan" while tsc, eslint and
      // vitest all stay green. The assertion after it launders only the nulls
      // the generated Args cannot express (see NullableRpcArgKeys); it runs
      // second and cannot hide a key mismatch, because `satisfies` has already
      // rejected one.
    } satisfies CreateNutritionPlanRpcPayload as CreatePlanRpcArgs);

  if (rpcError || !newPlanId) {
    console.error("Error creating nutrition plan:", rpcError?.message);
    return null;
  }

  // A plan save touches the client profile zero times. It used to write
  // clients.tdee from the PLAN's own work_activity_level, which is how a
  // client whose profile said "sedentary" ended up costed at ×1.9 — the plan
  // and the profile disagreed and the plan won. The profile owns the pair
  // (services/client-energy-service.ts); the plan row snapshots bmr/tdee (the
  // RPC args above) and a regeneration inherits whatever the profile says at
  // that time. That snapshot is the provenance; nothing else records it.

  return newPlanId;
}

/**
 * The version whose [effective_from, effective_until] window covers `date` —
 * the nutrition twin of `getTrainingPlanForDate`, sharing `coversDate` so the
 * two tracks can never disagree about the window predicate. The status half is
 * a plain `.eq("status", "active")`, deliberately simpler than training's
 * `.neq("status", "archived")`: nutrition has only the two coach-act statuses
 * (active | archived) and no `deleted_at` — do not "unify" the two filters.
 * Ordering matches training (`effective_from DESC, created_at DESC`) so every
 * resolver picks the same row on a tie.
 */
export async function getNutritionPlanForDate(
  clientId: string,
  date: string
): Promise<NutritionPlanRow | null> {
  const { data, error } = await coversDate(
    supabaseAdmin
      .from("nutrition_plans")
      .select("*")
      .eq("client_id", clientId)
      .eq("status", "active"),
    date
  )
    .order("effective_from", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve nutrition plan for date: ${error.message}`);
  }
  return data;
}

/**
 * Id-only twin of `getNutritionPlanForDate` for hot per-write paths (the
 * daily-log stamp fallback) that must not pay for the full row.
 * `.maybeSingle()` so no covering version resolves to null, never a throw.
 */
export async function getNutritionPlanIdForDate(
  clientId: string,
  date: string
): Promise<string | null> {
  const { data, error } = await coversDate(
    supabaseAdmin
      .from("nutrition_plans")
      .select("id")
      .eq("client_id", clientId)
      .eq("status", "active"),
    date
  )
    .order("effective_from", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve nutrition plan id for date: ${error.message}`);
  }
  return data?.id ?? null;
}

type NutritionPlanVersionWindow = {
  id: string;
  effectiveFrom: string;
  effectiveUntil: string;
};

/** Structural shape of the four PostgREST calls the overlap predicate applies (self-returning). */
type OverlapFilterable<T> = {
  eq(column: string, value: string): T;
  gte(column: string, value: string): T;
  lte(column: string, value: string): T;
  order(column: string, options: { ascending: boolean }): T;
};

/**
 * The ONE spelling of "the client's ACTIVE versions overlapping a range,
 * earliest first": `effective_until >= rangeStart AND effective_from <=
 * rangeEnd`. Every version has an end (migration 166), so there is no open-row
 * arm. Kept apart from its one reader so the predicate reads as a sentence.
 */
function overlappingActiveVersions<T extends OverlapFilterable<T>>(
  query: T,
  clientId: string,
  rangeStart: string,
  rangeEnd: string
): T {
  return query
    .eq("client_id", clientId)
    .eq("status", "active")
    .gte("effective_until", rangeStart)
    .lte("effective_from", rangeEnd)
    .order("effective_from", { ascending: true });
}

/** A version's window plus the plan-level prescription a computed day derives from. */
type NutritionVersionPrescription = NutritionPlanVersionWindow & {
  baselineCalories: number;
  proteinTargetG: number;
  dietType: string;
  /** The save's note (migration 172) — the computed day carries it on the
   *  version's start date. */
  coachNote: string | null;
};

/**
 * The day reader's version read: every ACTIVE version overlapping
 * [rangeStart, rangeEnd], earliest first, with the three plan fields the
 * resolver prices a day from.
 */
export async function getNutritionPrescriptionsForRange(
  clientId: string,
  rangeStart: string,
  rangeEnd: string
): Promise<NutritionVersionPrescription[]> {
  const { data, error } = await overlappingActiveVersions(
    supabaseAdmin
      .from("nutrition_plans")
      .select("id, effective_from, effective_until, baseline_calories, protein_target_g, diet_type, coach_note"),
    clientId,
    rangeStart,
    rangeEnd
  );

  if (error) {
    throw new Error(`Failed to fetch nutrition versions for the range: ${error.message}`);
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    effectiveFrom: row.effective_from,
    effectiveUntil: row.effective_until,
    baselineCalories: row.baseline_calories,
    proteinTargetG: Number(row.protein_target_g),
    dietType: row.diet_type,
    coachNote: row.coach_note,
  }));
}

/**
 * The save notes of the versions that START inside [startDate, endDate], oldest
 * first — the client Program tab's read for its current block. A note is a
 * column on its version (migration 172), so an archived version takes its note
 * with it and a version that began before the range keeps its note out of it.
 * The wire shape is the note's: `id` is the version's id, `effectiveOn` the
 * day it took effect.
 */
export async function listNutritionPlanNotesInRange(
  clientId: string,
  startDate: string,
  endDate: string
): Promise<NutritionPlanNote[]> {
  const { data, error } = await supabaseAdmin
    .from("nutrition_plans")
    .select("id, effective_from, coach_note")
    .eq("client_id", clientId)
    .eq("status", "active")
    .not("coach_note", "is", null)
    .gte("effective_from", startDate)
    .lte("effective_from", endDate)
    .order("effective_from", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch nutrition plan notes: ${error.message}`);
  }
  return (data ?? []).flatMap((row) =>
    row.coach_note
      ? [{ id: row.id, effectiveOn: row.effective_from, body: row.coach_note }]
      : []
  );
}

/** One weekday row of a version's grid — the coach's numbers for that weekday. */
type NutritionPlanGridRow = {
  planId: string;
  dayOfWeek: string;
  calories: number;
  proteinG: number;
  carbG: number;
  fatG: number;
};

/**
 * The per-weekday grids of the given versions, in one read. Seven rows per
 * version and single-digit versions per range, so unpaged; `[]` for no ids
 * without a round trip.
 */
export async function getNutritionPlanGrids(planIds: string[]): Promise<NutritionPlanGridRow[]> {
  if (planIds.length === 0) return [];

  const { data, error } = await supabaseAdmin
    .from("nutrition_plan_daily_targets")
    .select("nutrition_plan_id, day_of_week, calories, protein_g, carb_g, fat_g")
    .in("nutrition_plan_id", planIds);

  if (error) {
    throw new Error(`Failed to fetch nutrition plan grids: ${error.message}`);
  }
  return (data ?? []).map((row) => ({
    planId: row.nutrition_plan_id,
    dayOfWeek: row.day_of_week,
    calories: row.calories,
    proteinG: Number(row.protein_g),
    carbG: Number(row.carb_g),
    fatG: Number(row.fat_g),
  }));
}

/**
 * Every ACTIVE version's window for a set of clients, in one chunked read —
 * the attention feed's cross-client read, beside the per-client resolvers
 * above. The window is the row (migration 166), so this is a plain select:
 * no end is derived. An archived version is not returned, so a deleted plan
 * stops the feed's alert the moment the coach retires it.
 */
export async function getNutritionWindowsForClients(
  clientIds: string[]
): Promise<ClientPlanWindow[]> {
  const rows = await fetchAllByChunkedIds<
    { id: string; client_id: string; effective_from: string; effective_until: string },
    string
  >(
    clientIds,
    (chunk, from, to) =>
      supabaseAdmin
        .from("nutrition_plans")
        .select("id, client_id, effective_from, effective_until")
        .in("client_id", chunk)
        .eq("status", "active")
        .order("client_id", { ascending: true })
        .order("effective_from", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    { errorLabel: "nutrition plan versions" }
  );
  return rows.map((row) => ({
    clientId: row.client_id,
    start: row.effective_from,
    end: row.effective_until,
  }));
}

/** Pure window test shared by the in-memory date→version mappers. */
export function versionCoversDate(v: NutritionPlanVersionWindow, date: string): boolean {
  return v.effectiveFrom <= date && v.effectiveUntil >= date;
}

/**
 * The client's LATEST version by start — the last-saved prescription, and
 * therefore the drawer's seed source and the goal-drift comparison's subject:
 * seeding from anything else lets Generate silently clobber a queued
 * prescription. Under the placement model (migration 166) every version has an
 * end, so this is a plain ordering rather than an open-row lookup. Null only
 * when the client has no active version at all.
 */
export async function getLatestNutritionPlan(clientId: string): Promise<NutritionPlanRow | null> {
  const { data, error } = await supabaseAdmin
    .from("nutrition_plans")
    .select("*")
    .eq("client_id", clientId)
    .eq("status", "active")
    .order("effective_from", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch the latest nutrition plan: ${error.message}`);
  }
  return data;
}

type NextFutureNutritionPlan = {
  id: string;
  effectiveFrom: string;
};

/**
 * The earliest version starting strictly after `today` — the window-flipped
 * twin of `getNutritionPlanForDate`, mirroring `getNextFutureTrainingPlan`.
 * Earliest first so a chain of queued changes reports the NEXT one; tiebreak
 * on `created_at DESC` so a correction saved over a queued version for the
 * same start date is the one announced.
 */
export async function getNextFutureNutritionPlan(
  clientId: string,
  today: string
): Promise<NextFutureNutritionPlan | null> {
  const { data, error } = await supabaseAdmin
    .from("nutrition_plans")
    .select("id, effective_from")
    .eq("client_id", clientId)
    .eq("status", "active")
    .gt("effective_from", today)
    .order("effective_from", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve next future nutrition plan: ${error.message}`);
  }
  return data ? { id: data.id, effectiveFrom: data.effective_from } : null;
}

/**
 * The day before the next queued version starts, or null when a version
 * starting on `start` would be the last — training's `getNextPlanStartCap`,
 * for nutrition. Strict `>`, deliberately: a version starting on the same day
 * is the one the RPC replaces in place, not a cap.
 */
export async function getNextNutritionVersionStartCap(
  clientId: string,
  start: string
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("nutrition_plans")
    .select("effective_from")
    .eq("client_id", clientId)
    .eq("status", "active")
    .gt("effective_from", start)
    .order("effective_from", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve the next nutrition version: ${error.message}`);
  }
  return data ? addDaysToDateString(data.effective_from, -1) : null;
}

/**
 * How far a version placed on `start` runs — the question
 * `resolvePlacementWindowEnd` answers for a training program, asked of the
 * same bounds so the two tracks end on the same day inside a block:
 *
 *   1. the last day of the block COVERING `start` — a block is the time-bound
 *      program the coach sells, so its end is the answer whenever the days
 *      being written sit in one. The block covering the start, never the
 *      furthest the client has: a later block the coach has not priced must
 *      not be pulled into this version, or its card would read "Not set" while
 *      its days held numbers;
 *   2. else the furthest live training program's last day on or after `start`;
 *   3. else `NUTRITION_PLACEMENT_FALLBACK_DAYS` from `start`, all a client with
 *      neither has;
 *
 * the fallbacks (2 and 3) capped at the day before the NEXT block when the
 * start is in a gap — a cap, never a length, so targets saved in a gap stop at
 * the block rather than running into one the coach has not set up — and the
 * result capped, whichever it is, at the day before the next queued version —
 * the same cap every training placement takes, so a save before a queued
 * change runs until that change rather than replacing it.
 *
 * Resolved ONCE, at save, and stored on the row (migration 166): the window is
 * the record, and every day inside it is computed from the row. Past it there
 * are deliberately no days, and the client's food log is refused — the coach
 * draws the next bound when they are ready.
 */
export async function resolveNutritionPlacementEnd(
  clientId: string,
  start: string
): Promise<string> {
  const bound = await getBlockBoundForDate(clientId, start);
  let declared =
    bound?.kind === "covering"
      ? bound.endsOn
      : ((await getFurthestLiveProgramEnd(clientId, start)) ??
        addDaysToDateString(start, NUTRITION_PLACEMENT_FALLBACK_DAYS));
  if (bound?.kind === "next") {
    const dayBefore = addDaysToDateString(bound.startsOn, -1);
    if (dayBefore < declared) declared = dayBefore;
  }

  const cap = await getNextNutritionVersionStartCap(clientId, start);
  return cap && cap < declared ? cap : declared;
}
