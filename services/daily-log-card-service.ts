/**
 * Per-card daily-log writes.
 *
 * Nutrition and wellness save independently: each card is ONE upsert on its
 * own table, keyed by `(client_id, date)` — the UNIQUE the table carries
 * (migration 202) — so a retry is idempotent and a day has no parent row to
 * write first. Both read the assembled day back for the response.
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

/** Read the assembled day back (the two tables by client and date) for the response. */
async function readBack(clientId: string, date: string): Promise<DailyLog> {
  const log = await getTodayLog(clientId, date);
  if (!log) {
    throw new Error(`Failed to read back daily log for ${date}`);
  }
  return log;
}

/**
 * Per-card nutrition write: the four consumed columns, the covering version's
 * stamp when one is known, and `updated_at` — what the client ate and nothing
 * else (owner decision 2026-09-11). No target and no verdict is written: every
 * reader takes a day's target from the computed day and derives the verdict
 * from the pair, so the coach's change to today and a session landing on a
 * logged day reach them at once. A day no version covers saves too, with no
 * stamp; its meals carry no target and no verdict.
 */
export async function upsertNutritionLog(
  clientId: string,
  date: string,
  data: NutritionLogInput,
  ctx: { nutritionPlanId?: string | null }
): Promise<DailyLog> {
  const { error } = await supabaseAdmin.from("nutrition_logs").upsert(
    {
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
    { onConflict: "client_id,date" }
  );

  if (error) {
    throw new Error(`Failed to upsert nutrition log: ${error.message}`);
  }

  return readBack(clientId, date);
}

/** Per-card wellness write: one upsert on `wellness_logs`, which has no plan FK. */
export async function upsertWellnessLog(
  clientId: string,
  date: string,
  data: WellnessLogInput
): Promise<DailyLog> {
  const { error } = await supabaseAdmin.from("wellness_logs").upsert(
    {
      client_id: clientId,
      date,
      mood: data.mood ?? null,
      energy: data.energy ?? null,
      sleep: data.sleep ?? null,
      stress: data.stress ?? null,
      soreness: data.soreness ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "client_id,date" }
  );

  if (error) {
    throw new Error(`Failed to upsert wellness log: ${error.message}`);
  }

  return readBack(clientId, date);
}
