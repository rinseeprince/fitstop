/**
 * One-time cleanup: remove backfill-generated duplicate training events.
 * Run: npx tsx scripts/cleanup-duplicate-events.ts
 *
 * The backfill script generated events for ALL plans (including archived ones),
 * creating overlapping events on the same date from different plan versions.
 * Normal plan replacement only affects future dates, so these duplicates are
 * purely backfill artifacts.
 *
 * Rules for each (client, date) with multiple events:
 * 1. Completed/partial/skipped events always survive (immutable history).
 * 2. Among scheduled events, keep the one from the plan that was active on
 *    that date (latest effective_from <= event date). Delete the rest.
 *
 * Dry-run by default — pass --execute to actually delete.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { supabaseAdmin } from "@/services/supabase-admin";

async function cleanup() {
  const dryRun = !process.argv.includes("--execute");
  console.log(dryRun ? "DRY RUN (pass --execute to delete)\n" : "EXECUTING DELETES\n");

  // 1. Fetch all events
  const { data: allEvents, error } = await supabaseAdmin
    .from("training_events")
    .select("id, client_id, date, status, training_plan_id")
    .order("date", { ascending: true });

  if (error) {
    console.error("Failed to fetch events:", error.message);
    process.exit(1);
  }

  console.log(`Total events in table: ${allEvents.length}`);

  // 2. Group by (client_id, date)
  const groups = new Map<string, typeof allEvents>();
  for (const event of allEvents) {
    const key = `${event.client_id}|${event.date}`;
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }

  const duplicates = [...groups.entries()].filter(([, events]) => events.length > 1);
  console.log(`Dates with duplicate events: ${duplicates.length}\n`);

  if (duplicates.length === 0) {
    console.log("No duplicates found. Nothing to clean up.");
    return;
  }

  // 3. Fetch plan effective dates for determining which plan was active
  // training_plan_id is nullable since mig 113 (FK is ON DELETE SET NULL); an
  // orphaned event has no plan to look up, so drop nulls before the .in() query.
  const planIds = new Set(
    allEvents.map((e) => e.training_plan_id).filter((id): id is string => id !== null)
  );
  const { data: plans, error: plansError } = await supabaseAdmin
    .from("training_plans")
    .select("id, effective_from, effective_until")
    .in("id", [...planIds]);

  if (plansError) {
    console.error("Failed to fetch plans:", plansError.message);
    process.exit(1);
  }

  const planDates = new Map<string, { from: string; until: string | null }>();
  for (const plan of plans ?? []) {
    planDates.set(plan.id, {
      from: plan.effective_from ?? "1970-01-01",
      until: plan.effective_until,
    });
  }

  // 4. For each duplicate group, decide what to keep
  const idsToDelete: string[] = [];

  for (const [key, events] of duplicates) {
    const eventDate = key.split("|")[1];

    // Separate into acted-on (immutable) vs scheduled (backfill artifact candidates)
    const actedOn = events.filter((e) => e.status !== "scheduled");
    const scheduled = events.filter((e) => e.status === "scheduled");

    // All acted-on events survive — they're real history
    // Among scheduled events, keep only the one from the plan active on this date
    if (scheduled.length > 1) {
      // Find the plan that was active on this date:
      // latest effective_from <= event date, and (no effective_until OR effective_until >= event date)
      const scoredScheduled = scheduled.map((e) => {
        const plan = e.training_plan_id ? planDates.get(e.training_plan_id) : undefined;
        const from = plan?.from ?? "1970-01-01";
        const until = plan?.until ?? null;
        const wasActive = from <= eventDate && (until === null || until >= eventDate);
        return { event: e, from, wasActive };
      });

      // Sort: active plans first, then latest effective_from
      scoredScheduled.sort((a, b) => {
        if (a.wasActive !== b.wasActive) return a.wasActive ? -1 : 1;
        return b.from.localeCompare(a.from);
      });

      // Keep the first, delete the rest
      for (let i = 1; i < scoredScheduled.length; i++) {
        idsToDelete.push(scoredScheduled[i].event.id);
      }
    }

    // If there are acted-on events AND scheduled events on the same date,
    // the scheduled events are artifacts (the client already has a real record)
    if (actedOn.length > 0 && scheduled.length > 0) {
      for (const event of scheduled) {
        if (!idsToDelete.includes(event.id)) {
          idsToDelete.push(event.id);
        }
      }
    }

    // Log what we're doing
    const removing = events.filter((e) => idsToDelete.includes(e.id));
    if (removing.length > 0) {
      const kept = events.filter((e) => !idsToDelete.includes(e.id));
      const clientShort = key.split("|")[0].substring(0, 8);
      console.log(
        `  ${eventDate} (${clientShort}...): keeping ${kept.length} (${kept.map((e) => e.status).join(", ")}), deleting ${removing.length} artifact(s)`
      );
    }
  }

  console.log(`\nTotal events to delete: ${idsToDelete.length}`);

  if (dryRun) {
    console.log("\nDry run complete. Pass --execute to delete these events.");
    return;
  }

  // Delete in batches of 100
  let deleted = 0;
  for (let i = 0; i < idsToDelete.length; i += 100) {
    const batch = idsToDelete.slice(i, i + 100);
    const { error: deleteError } = await supabaseAdmin
      .from("training_events")
      .delete()
      .in("id", batch);

    if (deleteError) {
      console.error(`Error deleting batch at offset ${i}:`, deleteError.message);
    } else {
      deleted += batch.length;
    }
  }

  console.log(`\nDeleted ${deleted} duplicate events.`);
}

cleanup().catch((err) => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});
