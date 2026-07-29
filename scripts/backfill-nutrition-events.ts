/**
 * Backfill nutrition events from existing nutrition plans.
 * Run: npx tsx scripts/backfill-nutrition-events.ts
 *
 * Idempotent — uses upsert with overwrite on conflict, safe to re-run.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { supabaseAdmin } from "@/services/supabase-admin";
import { generateNutritionEvents } from "@/services/nutrition-event-service";
import { getTodayDateString, getDateString } from "@/lib/date-helpers";

async function backfillEvents() {
  const today = getTodayDateString();
  console.log(`Backfill started — today is ${today}`);

  // 1. Fetch active nutrition plans with daily targets. Under the durable-plan
  // model there is exactly one active plan per client → one dense window; the
  // old archived-window/per-version branch is gone.
  const { data: plans, error: plansError } = await supabaseAdmin
    .from("nutrition_plans")
    .select(
      "id, client_id, effective_from, baseline_calories, protein_target_g, diet_type, nutrition_plan_daily_targets(day_of_week, calories, protein_g, carb_g, fat_g, is_training_day)"
    )
    .eq("status", "active");

  if (plansError) {
    console.error("Failed to fetch plans:", plansError.message);
    process.exit(1);
  }

  console.log(`Found ${plans.length} active nutrition plans`);

  let plansProcessed = 0;
  let plansSkipped = 0;

  for (const plan of plans) {
    const dailyTargetRows = (plan.nutrition_plan_daily_targets as Array<{
      day_of_week: string;
      calories: number;
      protein_g: number;
      carb_g: number;
      fat_g: number;
      is_training_day: boolean;
    }>) ?? [];

    if (dailyTargetRows.length === 0) {
      plansSkipped++;
      continue;
    }

    const startDate = plan.effective_from ?? today;

    const endStart = new Date(startDate + "T00:00:00");
    endStart.setDate(endStart.getDate() + 8 * 7);
    let endDate: string = getDateString(endStart);

    // Always extend the dense forward window to today + 8 weeks.
    const futureLimit = new Date(today + "T00:00:00");
    futureLimit.setDate(futureLimit.getDate() + 8 * 7);
    const futureLimitStr = getDateString(futureLimit);
    if (endDate < futureLimitStr) {
      endDate = futureLimitStr;
    }

    try {
      await generateNutritionEvents(
        plan.client_id,
        plan.id,
        {
          baselineCalories: plan.baseline_calories,
          proteinTargetG: Number(plan.protein_target_g),
          dietType: plan.diet_type,
        },
        dailyTargetRows,
        null, // trainingPlan — generateNutritionEvents fetches training events by date range
        startDate,
        endDate
      );
      plansProcessed++;
      if (plansProcessed % 10 === 0) {
        console.log(`  Processed ${plansProcessed} plans...`);
      }
    } catch (err) {
      console.error(`  Error generating events for plan ${plan.id}:`, err);
    }
  }

  console.log(
    `Plans: ${plansProcessed} processed, ${plansSkipped} skipped (no daily targets)`
  );

  // 2. Mark past scheduled events based on nutrition_logs
  console.log("\nMarking past events as logged/missed...");

  // Fetch all past scheduled events
  const { data: pastEvents, error: eventsError } = await supabaseAdmin
    .from("nutrition_events")
    .select("id, client_id, date")
    .lt("date", today)
    .eq("status", "scheduled");

  if (eventsError) {
    console.error("Failed to fetch past events:", eventsError.message);
    return;
  }

  if (!pastEvents || pastEvents.length === 0) {
    console.log("No past scheduled events to process.");
    console.log("\nBackfill complete.");
    return;
  }

  console.log(`Found ${pastEvents.length} past scheduled events`);

  // Fetch all nutrition logs for cross-reference
  const { data: allLogs, error: logsError } = await supabaseAdmin
    .from("nutrition_logs")
    .select("client_id, date");

  if (logsError) {
    console.error("Failed to fetch nutrition logs:", logsError.message);
    return;
  }

  const logSet = new Set(
    (allLogs ?? []).map((l) => `${l.client_id}:${l.date}`)
  );

  const loggedIds: string[] = [];
  const missedIds: string[] = [];

  for (const event of pastEvents) {
    const key = `${event.client_id}:${event.date}`;
    if (logSet.has(key)) {
      loggedIds.push(event.id);
    } else {
      missedIds.push(event.id);
    }
  }

  // Batch update logged events
  if (loggedIds.length > 0) {
    const batchSize = 500;
    for (let i = 0; i < loggedIds.length; i += batchSize) {
      const batch = loggedIds.slice(i, i + batchSize);
      await supabaseAdmin
        .from("nutrition_events")
        .update({ status: "logged", updated_at: new Date().toISOString() })
        .in("id", batch);
    }
  }

  // Batch update missed events
  if (missedIds.length > 0) {
    const batchSize = 500;
    for (let i = 0; i < missedIds.length; i += batchSize) {
      const batch = missedIds.slice(i, i + batchSize);
      await supabaseAdmin
        .from("nutrition_events")
        .update({ status: "missed", updated_at: new Date().toISOString() })
        .in("id", batch);
    }
  }

  console.log(
    `Events: ${loggedIds.length} marked logged, ${missedIds.length} marked missed`
  );
  console.log("\nBackfill complete.");
}

backfillEvents().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
