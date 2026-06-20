/**
 * Recompute cached `nutrition_weekly_summaries` from the (now dense) nutrition
 * events. Run AFTER `scripts/backfill-nutrition-events.ts` — upsertWeeklySummary
 * fills unlogged-day targets via getPlanTargetForDate, which reads the events.
 *
 * Why this is needed: the lazy API backfill only computes *missing* weeks; it
 * never refreshes already-cached rows. Sparse-era summaries used an incomplete
 * denominator, so re-upserting each cached week:
 *   - completes the denominator (some calorie adherence numbers move), and
 *   - applies the surplus-split fix to carb/fat weekly target aggregates.
 * Both are expected, not regressions.
 *
 * Idempotent (overwrite on conflict). Run: npx tsx scripts/recompute-weekly-summaries.ts
 */
import "./env-bootstrap";

import { supabaseAdmin } from "@/services/supabase-admin";
import { upsertWeeklySummary } from "@/services/weekly-nutrition-service";

async function recompute() {
  console.log("Recomputing cached weekly nutrition summaries...");

  const { data: rows, error } = await supabaseAdmin
    .from("nutrition_weekly_summaries")
    .select("client_id, week_start_date");

  if (error) {
    console.error("Failed to fetch weekly summaries:", error.message);
    process.exit(1);
  }

  console.log(`Found ${rows.length} cached summaries to recompute`);

  let done = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      await upsertWeeklySummary(r.client_id, r.week_start_date);
      done++;
      if (done % 50 === 0) console.log(`  Recomputed ${done}...`);
    } catch (err) {
      failed++;
      console.error(
        `  Error recomputing ${r.client_id} ${r.week_start_date}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  console.log(`Recompute complete: ${done} updated, ${failed} failed.`);
}

recompute().catch((err) => {
  console.error("Recompute failed:", err);
  process.exit(1);
});
