/**
 * Per-card daily-log writes (Session 3.1).
 *
 * The redesign retires the monolithic `upsert_daily_log_atomic` RPC: nutrition and
 * wellness save independently and write the `daily_logs` spine + their own child table
 * directly (docs/CLIENT-PORTAL-REDESIGN.md). Each writer ensures the spine row,
 * then upserts its child. Two-step is safe: a spine row without a child is benign,
 * the unique constraints make retries idempotent, and a failed child write leaves
 * the day open for the next attempt — the day rule keys on the client's check-in
 * weeks, never on whether a row already exists, so a half-written day cannot lock
 * itself out.
 */

import { supabaseAdmin } from "./supabase-admin";
import {
  getTodayLog,
  calculateNutritionAdherence,
  calculateCalorieSurplusDeficit,
} from "./daily-logs-service";
import { getPlanTargetForDate } from "./daily-context-service";
import { getNutritionPlanIdForDate } from "./nutrition-plan-service";
import { captureApiError } from "@/lib/error-handler";
import type { DailyLog } from "@/types/daily-log";

type NutritionLogInput = {
  caloriesConsumed?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
};

type WellnessLogInput = {
  mood?: number;
  energy?: number;
  sleep?: number;
  stress?: number;
  soreness?: number;
};

/**
 * Ensure the `daily_logs` spine row for (clientId, date) exists. Returns the
 * spine id for the child upsert.
 */
async function ensureSpine(clientId: string, date: string): Promise<string> {
  const payload = { client_id: clientId, date, updated_at: new Date().toISOString() };

  const { data, error } = await supabaseAdmin
    .from("daily_logs")
    .upsert(payload, { onConflict: "client_id,date" })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to ensure daily log spine: ${error?.message ?? "no row returned"}`);
  }
  return data.id;
}

/** Read the consolidated daily log back (from daily_logs_full) for the response. */
async function readBack(clientId: string, date: string): Promise<DailyLog> {
  const log = await getTodayLog(clientId, date);
  if (!log) {
    throw new Error(`Failed to read back daily log for ${date}`);
  }
  return log;
}

/** The columns a `nutrition_logs` row takes from the day's target. */
type TargetSnapshot = {
  target_calories: number | null;
  target_protein_g: number | null;
  target_carbs_g: number | null;
  target_fat_g: number | null;
  nutrition_adherence: ReturnType<typeof calculateNutritionAdherence>;
  calorie_surplus_deficit: number | null;
};

/** The adherence figures the consumed calories make against a target. */
function adherenceAgainst(
  caloriesConsumed: number | undefined,
  targetCalories: number | null | undefined
): Pick<TargetSnapshot, "nutrition_adherence" | "calorie_surplus_deficit"> {
  return {
    nutrition_adherence: calculateNutritionAdherence(caloriesConsumed, targetCalories ?? undefined),
    calorie_surplus_deficit: calculateCalorieSurplusDeficit(
      caloriesConsumed,
      targetCalories ?? undefined
    ),
  };
}

/**
 * The day's target, as the day is computed NOW, in the columns the log row
 * carries — the sanctioned snapshot (CONVENTIONS §8; ARCHITECTURE → "Read
 * priority for nutrition targets") — with the adherence figures the consumed
 * calories make against it. ONE helper, two writers: the client's own save
 * re-snapshots through it on every write, and the coach's replacement of a
 * logged today re-records through it (`rerecordNutritionLogTarget`), so the
 * two can never snapshot a day differently. Null when no version covers the
 * date.
 */
async function resolveTargetSnapshot(
  clientId: string,
  date: string,
  caloriesConsumed: number | undefined
): Promise<TargetSnapshot | null> {
  const target = await getPlanTargetForDate(clientId, date);
  if (!target) return null;
  return {
    target_calories: target.calories,
    target_protein_g: target.proteinG,
    target_carbs_g: target.carbsG,
    target_fat_g: target.fatG,
    ...adherenceAgainst(caloriesConsumed, target.calories),
  };
}

/**
 * What a save writes when no version covers the day any more — the coach
 * ended or replaced the plan after the client began the day, and a started
 * day stays open to them (owner, 2026-09-11): the target the day was logged
 * under stays. Its columns are left OUT of the upsert, so the conflict update
 * preserves them, and the adherence is judged against the standing target.
 * With no standing row there is no target to keep, and the columns read null
 * as they always did for a target-less day.
 */
async function keepStandingTarget(
  clientId: string,
  date: string,
  caloriesConsumed: number | undefined
): Promise<Partial<TargetSnapshot>> {
  const { data: standing, error } = await supabaseAdmin
    .from("nutrition_logs")
    .select("target_calories")
    .eq("client_id", clientId)
    .eq("date", date)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to read the standing nutrition log: ${error.message}`);
  }
  if (!standing) {
    return {
      target_calories: null,
      target_protein_g: null,
      target_carbs_g: null,
      target_fat_g: null,
      nutrition_adherence: null,
      calorie_surplus_deficit: null,
    };
  }
  return adherenceAgainst(caloriesConsumed, standing.target_calories);
}

/**
 * Per-card nutrition write. Ensures the spine, snapshots the day's target
 * server-side (the standing target on a day nothing covers any more),
 * computes adherence, and upserts `nutrition_logs`.
 */
export async function upsertNutritionLog(
  clientId: string,
  date: string,
  data: NutritionLogInput,
  ctx: { nutritionPlanId?: string | null }
): Promise<DailyLog> {
  const spineId = await ensureSpine(clientId, date);

  // Targets are authoritative server-side snapshots of the day as computed;
  // never client-supplied.
  const snapshot =
    (await resolveTargetSnapshot(clientId, date, data.caloriesConsumed)) ??
    (await keepStandingTarget(clientId, date, data.caloriesConsumed));

  const { error } = await supabaseAdmin.from("nutrition_logs").upsert(
    {
      daily_log_id: spineId,
      client_id: clientId,
      date,
      // omit when null → preserve existing plan link on conflict
      ...(ctx.nutritionPlanId ? { nutrition_plan_id: ctx.nutritionPlanId } : {}),
      calories_consumed: data.caloriesConsumed ?? null,
      protein_g: data.proteinG ?? null,
      carbs_g: data.carbsG ?? null,
      fat_g: data.fatG ?? null,
      ...snapshot,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "daily_log_id" }
  );

  if (error) {
    throw new Error(`Failed to upsert nutrition log: ${error.message}`);
  }

  return readBack(clientId, date);
}

/**
 * Thrown by `rerecordNutritionLogTarget` when the log could not be rewritten.
 * The change that asked for it — a plan save, a per-day edit or reset — has
 * already landed; only today's snapshot is behind. A caller reports exactly
 * that (CONVENTIONS §2, consistency 12), never "failed to save": the client's
 * next food save re-snapshots the day, and so does saving the change again.
 */
export class NutritionLogRerecordError extends Error {
  constructor() {
    super("The change is saved, but today's food log still shows the previous target.");
    this.name = "NutritionLogRerecordError";
  }
}

/**
 * Re-record a logged day's target from the day as it is NOW computed — the
 * coach replaced today: a plan save whose window covers it, a per-day edit or
 * reset of it (owner, 2026-09-11) — so the history table, the calendar, the
 * client's day and the check-in week read the new target with the logged
 * meals on top, without waiting for the client's next save. The same snapshot
 * their own save writes, and the covering version's stamp with it. Only a day
 * with a row: with none there is nothing to re-record, and with no computed
 * day — nothing covers it now — the row keeps the target it was logged under.
 * Callers hand it the client's TODAY and never a past day: a past day's target
 * is what the client lived under. Returns whether a row was rewritten.
 */
export async function rerecordNutritionLogTarget(
  clientId: string,
  clientToday: string
): Promise<boolean> {
  try {
    const { data: row, error } = await supabaseAdmin
      .from("nutrition_logs")
      .select("id, calories_consumed")
      .eq("client_id", clientId)
      .eq("date", clientToday)
      .maybeSingle();
    if (error) throw new Error(`Failed to read today's nutrition log: ${error.message}`);
    if (!row) return false;

    const [snapshot, nutritionPlanId] = await Promise.all([
      resolveTargetSnapshot(clientId, clientToday, row.calories_consumed ?? undefined),
      getNutritionPlanIdForDate(clientId, clientToday),
    ]);
    if (!snapshot) return false;

    const { error: updateError } = await supabaseAdmin
      .from("nutrition_logs")
      .update({
        ...snapshot,
        ...(nutritionPlanId ? { nutrition_plan_id: nutritionPlanId } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (updateError) {
      throw new Error(`Failed to re-record today's nutrition log: ${updateError.message}`);
    }
    return true;
  } catch (error) {
    console.error("Failed to re-record today's nutrition log target:", error);
    captureApiError(error, { action: "nutrition-log-rerecord", clientId, date: clientToday });
    throw new NutritionLogRerecordError();
  }
}

/**
 * Per-card wellness write. Ensures the spine and upserts `wellness_logs`.
 * wellness_logs has no plan FK.
 */
export async function upsertWellnessLog(
  clientId: string,
  date: string,
  data: WellnessLogInput
): Promise<DailyLog> {
  const spineId = await ensureSpine(clientId, date);

  const { error } = await supabaseAdmin.from("wellness_logs").upsert(
    {
      daily_log_id: spineId,
      client_id: clientId,
      date,
      mood: data.mood ?? null,
      energy: data.energy ?? null,
      sleep: data.sleep ?? null,
      stress: data.stress ?? null,
      soreness: data.soreness ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "daily_log_id" }
  );

  if (error) {
    throw new Error(`Failed to upsert wellness log: ${error.message}`);
  }

  return readBack(clientId, date);
}
