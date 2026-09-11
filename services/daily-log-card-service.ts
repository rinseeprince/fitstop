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
import { getTodayLog } from "./daily-logs-service";
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

/**
 * Per-card nutrition write: the spine link, the four consumed columns, the
 * covering version's stamp when one is known, and `updated_at` — what the
 * client ate and nothing else (owner decision 2026-09-11). No target and no
 * verdict is written: every reader takes a day's target from the computed day
 * and derives the verdict from the pair, so the coach's change to today and a
 * session landing on a logged day reach them at once. A day no version covers
 * saves too, with no stamp; its meals carry no target and no verdict.
 */
export async function upsertNutritionLog(
  clientId: string,
  date: string,
  data: NutritionLogInput,
  ctx: { nutritionPlanId?: string | null }
): Promise<DailyLog> {
  const spineId = await ensureSpine(clientId, date);

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
