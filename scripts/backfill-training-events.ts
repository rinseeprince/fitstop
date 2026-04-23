/**
 * Backfill training events from existing training plans.
 * Run: npx tsx scripts/backfill-training-events.ts
 *
 * Idempotent — uses upsert with ignoreDuplicates, safe to re-run.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { supabaseAdmin } from "@/services/supabase-admin";
import {
  generateTrainingEvents,
  getEventForSessionAndDate,
  linkSessionLogToEvent,
  mapCompletionQualityToEventStatus,
} from "@/services/training-event-service";
import { getTodayDateString, getDateString } from "@/lib/date-helpers";

async function backfillEvents() {
  const today = getTodayDateString();
  console.log(`Backfill started — today is ${today}`);

  // 1. Fetch all training plans with sessions
  const { data: plans, error: plansError } = await supabaseAdmin
    .from("training_plans")
    .select(
      "id, client_id, status, effective_from, effective_until, program_duration_weeks, phase_id, training_sessions(id, name, day_of_week, focus, estimated_calories, is_active)"
    );

  if (plansError) {
    console.error("Failed to fetch plans:", plansError.message);
    process.exit(1);
  }

  console.log(`Found ${plans.length} training plans`);

  let plansProcessed = 0;
  let plansSkipped = 0;
  let eventsGenerated = 0;

  for (const plan of plans) {
    const sessions = (plan.training_sessions as Array<{
      id: string;
      name: string;
      day_of_week: string | null;
      focus: string | null;
      estimated_calories: number | null;
      is_active: boolean | null;
    }>)
      .filter((s) => s.is_active !== false && s.day_of_week)
      .map((s) => ({
        id: s.id,
        name: s.name,
        dayOfWeek: s.day_of_week ?? undefined,
        sessionType: "training" as const,
        focus: s.focus ?? undefined,
        estimatedCalories: s.estimated_calories ?? undefined,
      }));

    if (sessions.length === 0) {
      plansSkipped++;
      continue;
    }

    const startDate = plan.effective_from ?? plan.effective_until ?? today;

    let endDate: string;

    if (plan.status === "archived" && plan.effective_until) {
      // Archived plan: events only up to when it was replaced
      endDate = plan.effective_until;
    } else if (plan.program_duration_weeks) {
      const start = new Date(startDate + "T00:00:00");
      start.setDate(start.getDate() + plan.program_duration_weeks * 7);
      endDate = getDateString(start);
    } else if (plan.phase_id) {
      const { data: phase } = await supabaseAdmin
        .from("phases")
        .select("end_date, start_date, duration_weeks")
        .eq("id", plan.phase_id)
        .maybeSingle();

      if (phase?.end_date) {
        endDate = phase.end_date;
      } else if (phase?.start_date && phase?.duration_weeks) {
        const start = new Date(phase.start_date + "T00:00:00");
        start.setDate(start.getDate() + phase.duration_weeks * 7);
        endDate = getDateString(start);
      } else {
        // Fallback: 8 weeks from plan start
        const start = new Date(startDate + "T00:00:00");
        start.setDate(start.getDate() + 8 * 7);
        endDate = getDateString(start);
      }
    } else {
      // No duration info: 8 weeks from plan start
      const start = new Date(startDate + "T00:00:00");
      start.setDate(start.getDate() + 8 * 7);
      endDate = getDateString(start);
    }

    // For active plans, also generate up to 8 weeks from today
    if (plan.status === "active") {
      const futureLimit = new Date(today + "T00:00:00");
      futureLimit.setDate(futureLimit.getDate() + 8 * 7);
      const futureLimitStr = getDateString(futureLimit);
      if (endDate < futureLimitStr) {
        endDate = futureLimitStr;
      }
    }

    try {
      await generateTrainingEvents(
        plan.client_id,
        plan.id,
        sessions,
        startDate,
        endDate
      );
      plansProcessed++;
      eventsGenerated += sessions.length; // approximate
      if (plansProcessed % 10 === 0) {
        console.log(`  Processed ${plansProcessed} plans...`);
      }
    } catch (err) {
      console.error(`  Error generating events for plan ${plan.id}:`, err);
    }
  }

  console.log(
    `Plans: ${plansProcessed} processed, ${plansSkipped} skipped (no eligible sessions)`
  );

  // 2. Link existing session_logs to events
  console.log("\nLinking existing session logs to events...");

  const { data: logs, error: logsError } = await supabaseAdmin
    .from("session_logs")
    .select("id, client_id, training_session_id, completed_at, completion_quality")
    .not("training_session_id", "is", null);

  if (logsError) {
    console.error("Failed to fetch session logs:", logsError.message);
    return;
  }

  console.log(`Found ${logs.length} session logs to link`);

  let linked = 0;
  let notFound = 0;

  for (const log of logs) {
    if (!log.training_session_id || !log.completed_at) continue;

    // Extract date portion from completed_at (could be ISO timestamp or date string)
    const dateStr = log.completed_at.substring(0, 10);

    try {
      const event = await getEventForSessionAndDate(
        log.client_id,
        log.training_session_id,
        dateStr
      );

      if (event) {
        await linkSessionLogToEvent(
          event.id,
          log.id,
          mapCompletionQualityToEventStatus((log.completion_quality ?? "full") as "full" | "partial" | "skipped")
        );
        linked++;
      } else {
        notFound++;
      }
    } catch (err) {
      console.error(`  Error linking log ${log.id}:`, err);
    }

    if ((linked + notFound) % 50 === 0 && (linked + notFound) > 0) {
      console.log(`  Processed ${linked + notFound} logs (${linked} linked, ${notFound} no matching event)...`);
    }
  }

  console.log(
    `Session logs: ${linked} linked, ${notFound} no matching event`
  );
  console.log("\nBackfill complete.");
}

backfillEvents().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
